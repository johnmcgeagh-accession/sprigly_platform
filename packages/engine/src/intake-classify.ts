/**
 * intake-classify.ts — the ONE model call in the intake→reshape path.
 *
 * A client sends one sentence. This decides two things about it:
 *   AXIS 1 (existing, elsewhere): pre-cutoff vs post-cutoff — cycle lifecycle, not content.
 *   AXIS 2 (here): MONTH-SCOPED (act on this month's draft now) vs EVERGREEN (an idea for
 *   the backlog). And, when month-scoped, WHAT to do — as a structured intent.
 *
 * Everything downstream of this file is deterministic. The model extracts intent; named
 * transforms apply it; the diff is computed from row deltas. The model never edits the
 * plan and never narrates what changed.
 *
 * ── Why this is a separate call from extractStructuredBrief ──────────────────
 * The brief asked me not to add a second LLM call if the existing extractor could carry
 * both axes. It cannot, for three reasons:
 *   1. It runs over the ACCUMULATED intake (merged answers + freeNotes), so it cannot say
 *      which input caused which change — and the diff receipt has to be tied to the
 *      sentence that caused it.
 *   2. Its output is a month BRIEF (products / schedule / content_asks) — a description of
 *      the month, not a routing decision about one input.
 *   3. It runs AFTER the intake is persisted, whereas routing must be decided before we
 *      know whether to touch the month at all.
 * They also fail differently: a failed brief extraction loses beat display, a failed
 * classification must silently become backlog routing. Merging them would couple those.
 *
 * ── The asymmetry rule ───────────────────────────────────────────────────────
 * Ambiguity routes to EVERGREEN. Always. Backlog-when-they-meant-now costs one tap to
 * fix; plan-when-they-meant-someday is a confusing mutation of a month they were happy
 * with. The costs are not symmetric, so the default is not neutral.
 */
import { z } from 'zod';
// Engine-local contracts, matching brief-extract.ts — keeps @sprigly/engine free of
// @sprigly/model-client and pino deps. pino's Logger is structurally assignable.
import type { ModelClient, AuditLogger } from './types.js';

interface Logger { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }

// ── The validated contract ────────────────────────────────────────────────────

const dateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * What the client wants done to this month.
 *
 * `sourceText` is REQUIRED on every intent: the receipt has to be able to show the client
 * the words that caused the change, and a transform writes it into the new beat's
 * evidence. An intent that cannot point back at its cause is not traceable, and
 * traceability is the whole promise of this surface.
 */
export const monthScopedIntentSchema = z.object({
  kind:       z.enum(['launch', 'event', 'emphasis', 'beat_edit']),
  subject:    z.string().min(1).max(200),
  sourceText: z.string().min(1),
  dateRange:  dateRangeSchema.nullable().optional(),
  /** beat_edit only: which beat, in the client's words ("the Friday reel"). */
  beatRef:    z.string().max(200).nullable().optional(),
  /** beat_edit only: what to do with it. */
  edit:       z.enum(['move', 'swap_format', 'drop']).nullable().optional(),
  editValue:  z.string().max(64).nullable().optional(),
  /** emphasis only: the pillar or format to weight up. */
  emphasis:   z.string().max(120).nullable().optional(),
});

export type MonthScopedIntent = z.infer<typeof monthScopedIntentSchema>;

const classificationSchema = z.object({
  scope:  z.enum(['month_scoped', 'evergreen']),
  intent: monthScopedIntentSchema.nullable().optional(),
});

export type IntakeRouting =
  | { scope: 'month_scoped'; intent: MonthScopedIntent; sourceText: string }
  | { scope: 'evergreen'; sourceText: string; reason: EvergreenReason };

/** Why an input went to the backlog. Surfaced in the receipt so "we filed this" is never
 *  mysterious, and recorded so a misroute is diagnosable rather than just annoying. */
export type EvergreenReason =
  | 'classified_evergreen'   // the model read it as a standing idea
  | 'ambiguous'              // the model was unsure — the asymmetry rule applied
  | 'validation_failed'      // output did not satisfy the contract
  | 'model_error';           // the call itself failed

export const CLASSIFY_SYSTEM = `You route a single message from a small brand's owner about their social media content plan.

Decide ONE thing: is this about THIS MONTH's plan specifically, or is it a standing idea for later?

MONTH_SCOPED — act on the current draft now:
- a launch, restock, event or campaign with a time attached ("the navy edit drops on the 28th")
- a change to a specific planned post ("move the Friday reel to Saturday", "make the 3rd a carousel")
- a shift of emphasis for THIS month ("more product this month", "less founder stuff in September")

EVERGREEN — a standing idea for the backlog:
- a format or theme with no timing ("we should do more behind-the-scenes")
- an idea for "sometime", "at some point", "in future", "next time"
- an observation about what works, with no instruction attached

RULES:
- If you are not sure, choose EVERGREEN. Being filed as an idea is easy to undo; changing a month the owner was happy with is not.
- Do NOT invent a date. Only set dateRange when a real date or clear window is stated. Resolve relative dates ("next Friday", "the 28th") against the PLAN MONTH you are given.
- subject is a short noun phrase in the owner's own words. Do not embellish it.
- sourceText is the owner's message, VERBATIM.

Return ONE JSON object, no markdown, no code fences:
{"scope":"month_scoped","intent":{"kind":"launch|event|emphasis|beat_edit","subject":"","sourceText":"","dateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}|null,"beatRef":null,"edit":null,"editValue":null,"emphasis":null}}
or
{"scope":"evergreen"}`;

/** Tolerant parse — fenced, prose-wrapped, or bare JSON. */
export function parseClassification(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  if (!raw.startsWith('{')) {
    const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) raw = raw.slice(a, b + 1);
  }
  return JSON.parse(raw) as unknown;
}

/**
 * Validate a parsed classification into a routing decision.
 *
 * EVERY failure path lands on evergreen. A malformed intent, a month_scoped verdict with
 * no intent attached, an unparseable response — all of them mean "we could not establish
 * that the client wanted their month changed", and the honest response to that is to file
 * the input, not to guess at a mutation. Exported so the fallback is directly testable
 * without a model.
 */
export function routeFromParsed(parsed: unknown, sourceText: string): IntakeRouting {
  const outer = classificationSchema.safeParse(parsed);
  if (!outer.success) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };
  if (outer.data.scope === 'evergreen') return { scope: 'evergreen', sourceText, reason: 'classified_evergreen' };

  if (!outer.data.intent) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };
  const intent = monthScopedIntentSchema.safeParse(outer.data.intent);
  if (!intent.success) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };

  // A beat_edit that does not say WHAT to change cannot be applied deterministically.
  // Routing it to the backlog (with a receipt) beats guessing at the client's meaning.
  if (intent.data.kind === 'beat_edit' && (!intent.data.edit || !intent.data.beatRef)) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A launch or event with no date has no anchor to place an arc against.
  if ((intent.data.kind === 'launch' || intent.data.kind === 'event') && !intent.data.dateRange) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }

  // Trust the model for meaning, never for provenance: sourceText is overwritten with the
  // text we actually received, so a receipt can never quote words the client did not send.
  return { scope: 'month_scoped', intent: { ...intent.data, sourceText }, sourceText };
}

export interface ClassifyParams {
  text:      string;
  planMonth: string;            // 'YYYY-MM' — relative-date resolution context
  model:     ModelClient;
  modelName?: string;
  logger?:   Logger;
  audit?:    AuditLogger;
  clientId?: string;
}

/**
 * Classify one intake input. NEVER throws — a model failure routes to the backlog, because
 * an input the client typed must always land somewhere.
 */
export async function classifyIntake(params: ClassifyParams): Promise<IntakeRouting> {
  const { text, planMonth, model, modelName = 'sonnet', logger, audit, clientId } = params;
  const sourceText = text.trim();
  if (!sourceText) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };

  const user = [
    `PLAN MONTH: ${planMonth} (resolve any relative date against this month)`,
    '',
    'OWNER’S MESSAGE:',
    sourceText,
    '',
    'Route it now. JSON only.',
  ].join('\n');

  try {
    const res = await model.complete({
      model: modelName, system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: user }],
      // NOTE: the engine-local ModelCompleteParams has no `temperature`. A routing
      // decision ideally would not vary between identical inputs; the safety net is
      // that every failure mode here lands on evergreen, so variance costs a tap.
      maxTokens: 600,
    });

    if (audit && clientId) {
      try {
        await audit.logModelCall({
          clientId, modelId: res.modelId, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
          action: 'content-cycle:intake-classify', metadata: { planMonth },
        });
      } catch { /* auditing must never change routing */ }
    }

    // Parsed separately from the call so the two failures stay distinguishable: the model
    // answering with junk is not the same event as the model being unreachable, and a
    // misroute is only diagnosable if the receipt records which one happened.
    let parsed: unknown;
    try {
      parsed = parseClassification(res.content);
    } catch (parseErr) {
      logger?.warn({ planMonth, err: String(parseErr) }, 'intake-classify: unparseable output — routing to the backlog');
      return { scope: 'evergreen', sourceText, reason: 'validation_failed' };
    }

    const routing = routeFromParsed(parsed, sourceText);
    logger?.info({ planMonth, scope: routing.scope, ...(routing.scope === 'evergreen' ? { reason: routing.reason } : { kind: routing.intent.kind }) },
      'intake-classify: routed');
    return routing;
  } catch (err) {
    logger?.warn({ planMonth, err: String(err) }, 'intake-classify: model call failed — routing to the backlog');
    return { scope: 'evergreen', sourceText, reason: 'model_error' };
  }
}
