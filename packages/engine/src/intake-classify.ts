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
/**
 * One post of an ENUMERATED series — the client listed the dates themselves.
 *
 * `subject` is per-instance because that is how clients actually write these: "every Friday
 * in August: 7th — Maggie t-shirt; 14th — Lily tee" is four different posts, not one post
 * repeated. Dropping the per-date subject would turn four planned products into four
 * identical beats, which is the same information loss as not supporting series at all.
 */
const seriesInstanceSchema = z.object({
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subject: z.string().min(1).max(200).nullable().optional(),
});

/**
 * A series stated as a RULE rather than a list — "one post every 3 weeks from early August".
 *
 * `count` and `until` are both optional and both bounds: expansion stops at whichever comes
 * first, and at the plan month's end regardless. Neither is required, because a client
 * saying "every 3 weeks" usually means "until I say otherwise" — the month boundary is the
 * honest default bound, not a guess at how long they meant.
 */
const recurrenceSchema = z.object({
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  intervalDays: z.number().int().min(1).max(366),
  count:       z.number().int().min(1).max(60).nullable().optional(),
  until:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const monthScopedIntentSchema = z.object({
  kind:       z.enum(['launch', 'event', 'series', 'beat_spec', 'emphasis', 'beat_edit', 'correction']),
  subject:    z.string().min(1).max(200),
  sourceText: z.string().min(1),
  dateRange:  dateRangeSchema.nullable().optional(),
  /**
   * beat_spec only — the format the client named for this one post ("a reel on the 22nd").
   * Absent when they named a date and a title but no format; the transform fills it from the
   * month's commonest format then, rather than guessing.
   */
  format:     z.enum(['reel', 'carousel', 'single']).nullable().optional(),
  /**
   * series only — the dates the client listed, in their order. Takes precedence over
   * `recurrence` when both are present: an enumerated date is something the client stated,
   * a computed one is something we inferred, and the stated thing wins.
   */
  instances:  z.array(seriesInstanceSchema).max(60).nullable().optional(),
  /** series only — the rule, when they gave a cadence instead of a list. */
  recurrence: recurrenceSchema.nullable().optional(),
  /** beat_edit only: which beat, in the client's words ("the Friday reel"). */
  beatRef:    z.string().max(200).nullable().optional(),
  /** beat_edit only: what to do with it. */
  edit:       z.enum(['move', 'swap_format', 'drop']).nullable().optional(),
  editValue:  z.string().max(64).nullable().optional(),
  /** emphasis only: the pillar or format to weight up. */
  emphasis:   z.string().max(120).nullable().optional(),
  /**
   * correction only: what the owner is correcting ABOUT, in their words — "the Meadow
   * candle launch". Matched against the beats already on the plan, so a correction acts on
   * what is there rather than adding something new.
   *
   * Distinct from beatRef, which points at ONE post by day/format/date. A correction names
   * a SUBJECT and may move a whole arc: "the Meadow launch is the 10th not the 1st" is
   * three beats, not one.
   */
  correctionOf: z.string().max(200).nullable().optional(),
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
  | 'couldnt_apply'          // two extraction attempts failed — filed, and the client is TOLD
  | 'model_error';           // the call itself failed

export const CLASSIFY_SYSTEM = `You route a single message from a small brand's owner about their social media content plan.

Decide ONE thing: is this about THIS MONTH's plan specifically, or is it a standing idea for later?

MONTH_SCOPED — act on the current draft now:
- a launch, restock, event or campaign with a time attached ("the navy edit drops on the 28th")
- a REPEATING run of posts ("every Friday in August", "one post every 3 weeks", "a weekly series")
- a change to a specific planned post ("move the Friday reel to Saturday", "make the 3rd a carousel")
- a shift of emphasis for THIS month ("more product this month", "less founder stuff in September")

EVERGREEN — a standing idea for the backlog:
- a format or theme with no timing ("we should do more behind-the-scenes")
- an idea for "sometime", "at some point", "in future", "next time"
- an observation about what works, with no instruction attached

RULES:
- If you are not sure, choose EVERGREEN. Being filed as an idea is easy to undo; changing a month the owner was happy with is not.
- SERIES is any run of posts on a repeating pattern. "Every Friday", "one post every 3 weeks", "weekly", "monthly", "a mini-series" are ALWAYS kind=series and NEVER kind=launch. A series is a rhythm; a launch is one moment with a build-up. Do not turn a series into a launch because it has a start date.
- For a series, prefer ENUMERATED dates. If the owner lists the dates ("7th, 14th, 21st, 28th"), return instances:[{date,subject}] with one entry per date, and put THAT DATE'S OWN subject on it (the specific product, theme or story they named for it). Only use recurrence:{startDate,intervalDays} when they give a cadence with no list ("every 3 weeks from the 1st"). If they give both a list and a cadence, the list wins — return instances and leave recurrence null.
- BEAT_SPEC is a single dated post the owner has SPELLED OUT — one date, an optional format, and a title, with no build-up and no repeat. "add a reel on the 22nd called What I am most proud of part 2", "a carousel on the 14th: Weekend Style Guide". Set kind=beat_spec, dateRange for the single date (start=end), format when they named one ("reel"/"carousel"/"single"), and subject = the title they gave, VERBATIM. It is NOT a launch (no tease/follow-up) and NOT a series (it happens once). Most typed rows are caught before you see them; use beat_spec for the ones phrased as a short request.
- CORRECTION is for fixing something already on the plan: "X is the 10th not the 1st", "actually the workshop is the 15th", "move the launch to the 3rd", "make the launch post a reel". Set kind=correction, correctionOf = the thing being corrected in the owner's words, and dateRange for a new date (or edit/editValue for a format change). A correction is NOT a new launch — do not use kind=launch to restate a date the owner is fixing.
- Do NOT invent a date. Only set dateRange when a real date or clear window is stated. Resolve relative dates ("next Friday", "the 28th") against the PLAN MONTH you are given.
- subject is a short noun phrase in the owner's own words. Do not embellish it.
- sourceText is the owner's message, VERBATIM.

Return ONE JSON object, no markdown, no code fences:
{"scope":"month_scoped","intent":{"kind":"launch|event|series|beat_spec|emphasis|beat_edit|correction","subject":"","sourceText":"","dateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}|null,"format":null,"instances":null,"recurrence":null,"beatRef":null,"edit":null,"editValue":null,"emphasis":null,"correctionOf":null}}

For a single spelled-out post:
{"scope":"month_scoped","intent":{"kind":"beat_spec","subject":"What I am most proud of part 2","sourceText":"","dateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"format":"reel","instances":null,"recurrence":null,...}}

For a series with listed dates:
{"scope":"month_scoped","intent":{"kind":"series","subject":"Weekend Style Guide","sourceText":"","instances":[{"date":"YYYY-MM-DD","subject":"what that date is about"}],"recurrence":null,...}}

For a series with a cadence and no list:
{"scope":"month_scoped","intent":{"kind":"series","subject":"","sourceText":"","instances":null,"recurrence":{"startDate":"YYYY-MM-DD","intervalDays":21,"count":null,"until":null},...}}
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

  // A correction that names nothing to correct cannot be matched against the plan.
  if (intent.data.kind === 'correction' && !intent.data.correctionOf && !intent.data.subject) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A beat_edit that does not say WHAT to change cannot be applied deterministically.
  // Routing it to the backlog (with a receipt) beats guessing at the client's meaning.
  if (intent.data.kind === 'beat_edit' && (!intent.data.edit || !intent.data.beatRef)) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A launch or event with no date has no anchor to place an arc against.
  if ((intent.data.kind === 'launch' || intent.data.kind === 'event') && !intent.data.dateRange) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A series needs a rhythm. Neither a list nor a rule means the model read "series" out of
  // words like "mini-series" without any timing behind it — which is an idea for the
  // backlog, not a run of dated posts. Filing it is right; inventing a cadence is not.
  if (intent.data.kind === 'series'
      && !(intent.data.instances && intent.data.instances.length > 0)
      && !intent.data.recurrence) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A beat_spec is a typed calendar row — it needs a date to place it. The title (subject)
  // is already required by the schema; without a date there is nowhere to put the post, so
  // it is filed rather than dropped on the month at a guessed date.
  if (intent.data.kind === 'beat_spec' && !intent.data.dateRange) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }

  // Trust the model for meaning, never for provenance: sourceText is overwritten with the
  // text we actually received, so a receipt can never quote words the client did not send.
  return { scope: 'month_scoped', intent: { ...intent.data, sourceText }, sourceText };
}

// ── Deterministic beat_spec pre-parse ───────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A typed calendar ROW: an optional weekday, a day, a month name, an optional format word,
 * then the title. Date-leading by construction — there is no verb before the date to make it
 * a request. "Sat 22 Aug Reel What I am most proud of… — part 2" is this shape.
 */
const BEAT_SPEC_RE =
  /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(reels?|carousels?|singles?))?\s+(\S[\s\S]*?)\s*$/i;

/** A title that opens with one of these is a request ("move the reel…"), not a row title —
 *  let the model classify it rather than titling a beat with an instruction. */
const INTENT_VERB_RE = /^(?:move|add|make|change|swap|remove|drop|delete|shift|reschedule|turn|set|put)\b/i;

/**
 * Recognise a typed calendar row without the model.
 *
 * The rehearsal showed operators typing ROWS, not requests, and two of them bounced to the
 * ideas backlog twice (docs/reports/ivy-t-rehearsal-failures.md). A date-leading
 * [date][format?][title] line is not a question to route — it is a beat to place, literally:
 * the given date, the named format (or the month's commonest, decided later by the transform),
 * and the title VERBATIM. So it short-circuits the one model call entirely.
 *
 * Conservative on purpose: no leading date, no real month, an empty title, or a title that
 * opens with an instruction verb all return null and fall through to the model. This claims
 * only the inputs it is certain about; the model (and then the asymmetry rule) owns the rest.
 *
 * Pure and exported so the contract is testable without a model call. `planMonth` supplies the
 * year — a typed row names a day and a month, never a year.
 */
export function parseBeatSpec(text: string, planMonth: string): MonthScopedIntent | null {
  const line = text.trim();
  if (!line || /\n/.test(line)) return null;         // a paragraph is a message, not a row

  const m = BEAT_SPEC_RE.exec(line);
  if (!m) return null;

  const day = Number(m[1]);
  const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
  if (!month || day < 1 || day > 31) return null;

  const title = (m[4] ?? '').trim();
  if (!title || INTENT_VERB_RE.test(title)) return null;

  const year = Number(planMonth.slice(0, 4));
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const fmtRaw = m[3]?.toLowerCase().replace(/s$/, '');
  const format = fmtRaw === 'reel' || fmtRaw === 'carousel' || fmtRaw === 'single' ? fmtRaw : null;

  return {
    kind: 'beat_spec',
    subject: title,
    sourceText: line,
    dateRange: { start: date, end: date },
    ...(format ? { format } : {}),
  };
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

  // A typed calendar row is applied literally, without a model call. The deterministic
  // pre-parse runs FIRST: a date-leading [date][format?][title] line is a beat to place, not
  // a request to interpret, so it never reaches Bedrock.
  const spec = parseBeatSpec(sourceText, planMonth);
  if (spec) {
    logger?.info({ planMonth, kind: 'beat_spec', preParsed: true }, 'intake-classify: typed row pre-parsed — no model call');
    return { scope: 'month_scoped', intent: spec, sourceText };
  }

  const user = [
    `PLAN MONTH: ${planMonth} (resolve any relative date against this month)`,
    '',
    'OWNER’S MESSAGE:',
    sourceText,
    '',
    'Route it now. JSON only.',
  ].join('\n');

  // ONE RETRY, then honesty. A single schema miss is usually a bad sample, not a bad
  // request — the uat data shows a client correcting a launch date twice and being filed as
  // an "idea" both times with no signal that nothing had happened
  // (docs/reports/wrong-month-generated.md §6). Retrying costs one call; the alternative
  // cost that client their month.
  const attempt = async (): Promise<IntakeRouting> => {
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
  };

  const first = await attempt();
  // Only a FAILURE to extract is retried. A confident 'classified_evergreen' is an answer,
  // not a miss, and asking twice would just spend money to hear it again.
  if (first.scope !== 'evergreen' || first.reason !== 'validation_failed') return first;

  logger?.info({ planMonth }, 'intake-classify: extraction failed — retrying once');
  const second = await attempt();
  if (second.scope === 'month_scoped') return second;
  if (second.scope === 'evergreen' && second.reason !== 'validation_failed') return second;

  // Twice is a pattern, not a blip. File it — but as couldnt_apply, so the receipt can say
  // so rather than presenting it as a filing the client asked for.
  logger?.warn({ planMonth }, 'intake-classify: extraction failed twice — filing as couldnt_apply');
  return { scope: 'evergreen', sourceText, reason: 'couldnt_apply' };
}
