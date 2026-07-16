/**
 * brief-extract.ts — brief-launch primitive, Phase 1: the extractor.
 *
 * Parses a client's UNSTRUCTURED planning brief (intake_json.planContent —
 * answers + freeNotes) into a persisted StructuredBrief: the launch/restock
 * declarations, dated content beats, hero focus families, and plan window. Later
 * phases feed this into the catalogue-grounding vocabulary, the hard colourway
 * validation, and the generation timing signal — NONE of which are wired here.
 *
 * A single pre-assembled Bedrock Sonnet call (eu-west-2, consistent with the rest
 * of the stack). Strict JSON-only system prompt, tolerant parse, and an
 * extract-gate that REJECTS malformed/partial output (throws) rather than
 * shipping a half-parsed brief. Degrades cleanly to an empty StructuredBrief
 * (no model call) when the brief carries no answers and no free notes.
 *
 * PURE with respect to the pipeline: it neither reads nor writes the cycle row.
 * Persistence (migration 0058) and wiring are separate steps.
 */

// Now lives in @sprigly/engine so both the worker (planning) and the app (intake route, FIX 2)
// can run extraction. Uses engine-local contracts to avoid cross-package deps; a minimal Logger
// interface (pino's Logger is structurally assignable) keeps @sprigly/engine free of a pino dep.
import type { ModelClient, AuditLogger } from './types.js';
import type {
  PlanContentAnswers,
  StructuredBrief,
  BriefProduct,
  BriefScheduleBeat,
  BriefContentAsk,
  BriefConflict,
  BriefProductStatus,
} from './types.js';

interface Logger { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }

// The logical model — Sonnet, resolved by the model client to the eu-west-2
// Bedrock physical id. Extraction output is small, so a modest token cap.
const BRIEF_EXTRACT_MODEL = 'sonnet';
const BRIEF_EXTRACT_MAX_TOKENS = 3_000;

/** The empty brief — returned verbatim when there is nothing to extract, and the
 *  shape every caller can rely on. */
export const EMPTY_STRUCTURED_BRIEF: StructuredBrief = {
  products: [],
  schedule: [],
  content_asks: [],
  focus: [],
  conflicts: [],
  plan_window: { from: null, month: null },
};

// ── System prompt (strict JSON-only) ─────────────────────────────────────────

const BRIEF_EXTRACT_SYSTEM = `You are a precise information extractor for a social media planning system. You convert a clothing brand client's UNSTRUCTURED monthly planning brief into a STRUCTURED JSON object. You extract ONLY what the brief actually says. You never invent products, colourways, dates, or beats that are not in the brief.

You are given, in the user message:
- PLAN MONTH: the YYYY-MM the brief is planning for. Use it to resolve any bare dates (e.g. "17 July") into full ISO dates (YYYY-MM-DD) in that month and year.
- BRIEF: the client's planning answers and free notes.

Extract into this EXACT shape:
{
  "products": [ { "product": "", "colourway": null, "status": "new", "launch_date": null, "content_from": null } ],
  "schedule": [ { "date": "", "dateRange": null, "type": "", "product": null, "colourway": null, "note": "" } ],
  "content_asks": [ { "type": "", "product": null, "note": "" } ],
  "focus": [ "" ],
  "conflicts": [ { "description": "", "dates": null, "items": null } ],
  "plan_window": { "from": null, "month": null }
}

Rules:
- products: one entry per product-and-colourway the brief says is LAUNCHING or RETURNING this month. "status" is "new" for a brand-new product or colourway, "restock" for one returning or being restocked. "colourway" is the stated colourway, or null if none is named. "launch_date" is the ISO date it goes live if the brief gives one, else null. "content_from" is an ISO date if the brief says when to start posting about it, else null. Do NOT list products merely mentioned in passing: only genuine launch or restock declarations.
- schedule: one entry per DATED content beat the brief specifies. A beat is EITHER a single day OR a date range — set EXACTLY ONE of these two fields and set the other to null:
    - "date": the ISO day (YYYY-MM-DD) for a beat the brief pins to ONE specific day. When you use "date", "dateRange" MUST be null.
    - "dateRange": { "start": ISO day, "end": ISO day } (inclusive) for a beat the brief gives only VAGUE timing (a week, an "early/mid/late", an "around the Nth", a "weekend of the Nth"). When you use "dateRange", "date" MUST be null.
  NEVER set both, and NEVER set neither. "type" is a short kebab-case label for the beat kind (for example "launch", "weekend-style-guide", "sunday-style", "feature", "colour-palette", "note-from-founder"). "product" and "colourway" name what the beat features, or null. "note" is the beat text as the brief states it — PRESERVE the client's original vague phrasing verbatim (e.g. keep "the last week of August" in the note even though you resolved it to a range).
- content_asks: one entry per content piece the brief asks for this month with NO fixed date (for example "Connie details post", "customer quotes about Connie", "organic-cotton-for-sensitive-skin education", "BTS of receiving the shipment", "Refer a Friend reminder"). "type" is a short kebab-case label. "product" names what it is about, or null. "note" is the ask text as the brief states it. An ask with a specific date belongs in schedule, NOT here; an ask with no date belongs here, NOT in schedule.
- focus: the primary hero product families the brief says to feature heavily this month. Names only.
- conflicts: one entry per internal CONTRADICTION in the brief (for example the same date given to two different beats, or a date whose weekday does not match). "description" states the contradiction. "dates" lists the ISO dates involved (or null). "items" lists the colliding beats/labels (or null).
- plan_window.from: the ISO date the brief says to start planning from (for example "plan from 13 July"), or null. plan_window.month: the PLAN MONTH you were given (YYYY-MM).

VAGUE TIMING → RANGES (resolve against the PLAN MONTH, London calendar). When the brief gives only a fuzzy window rather than a specific day, produce a "dateRange" (start/end inclusive, both in the plan month) using THESE fixed conventions, and keep the original phrasing in "note":
- "first week of <month>" → the first 7 days: the 1st through the 7th.
- "last week of <month>" → the last 7 days: (last day − 6) through the last day (e.g. a 31-day month → the 25th–31st; a 30-day month → the 24th–30th).
- "early <month>" → the 1st–10th. "mid <month>" → the 11th–20th. "late <month>" → the 21st through the last day.
- "around the Nth" / "about the Nth" → a 3-day window centred on N: the (N−1)th–(N+1)th.
- "the weekend of the Nth" → the Saturday–Sunday of the week that contains the Nth.
- Clip every resolved range to the PLAN MONTH. If a resolved range lies WHOLLY OUTSIDE the plan month (e.g. "early September" while planning August), do NOT put it in schedule — put it in content_asks (undated) with the original phrasing.
- An explicit single day ("the 25th", "17 July") stays a single-day beat: set "date", leave "dateRange" null. Never widen a specific day into a range.
- If timing is so vague it cannot be resolved to any range in the plan month at all, put the item in content_asks (undated), NOT schedule.

STRICT LITERAL DATES (this overrides any instinct to tidy the brief):
- A "date" in schedule MUST be a date the brief states LITERALLY (a day number, resolved to ISO in the plan month/year). NEVER invent, shift, or de-collide a date.
- If the brief assigns the SAME date to two different beats, keep BOTH beats on that literal date AND add a conflicts[] entry describing the collision. Do NOT move either beat to a nearby free date.
- If a beat's stated weekday does not match its stated day number, keep the day NUMBER as the literal date and record the weekday mismatch in conflicts[]. Never use the weekday to pick a different date.
- If a date genuinely cannot be resolved to a day in the plan month, omit that beat rather than guess.
- Use null for any string field with no value, and [] for any empty list.

Return ONE JSON object and nothing else. No prose, no markdown, no code fences.`;

// ── User message ─────────────────────────────────────────────────────────────

/** Assemble the single user message: the plan month (date-resolution context), the client's
 *  answers and free notes, and — clearly labelled as a DISTINCT section — the durable
 *  cross-cycle context (plan_inputs idea|next_cycle), so the model treats standing background
 *  notes differently from this month's brief. */
export function buildBriefExtractUserMessage(planContent: PlanContentAnswers, planMonth: string, durableContext: string[] = []): string {
  const answerLines = Object.entries(planContent.answers ?? {})
    .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    .map(([q, a]) => `- ${q}\n  ${a.trim()}`)
    .join('\n');
  const freeNotes = (planContent.freeNotes ?? '').trim();
  const durable = durableContext.filter((s) => typeof s === 'string' && s.trim().length > 0);

  return [
    `PLAN MONTH: ${planMonth}`,
    '',
    'BRIEF — structured answers:',
    answerLines || '(none)',
    freeNotes ? `\nFREE NOTES:\n${freeNotes}` : '',
    durable.length
      ? `\nDURABLE CONTEXT (standing client notes carried across months — background, NOT this month's brief; only extract a beat/product from it if it explicitly names a date or a launch/restock):\n${durable.map((d) => `- ${d}`).join('\n')}`
      : '',
    '',
    'Extract the structured brief now. Output the JSON object specified, JSON only.',
  ].filter((l) => l !== '').join('\n');
}

// ── Tolerant parse (fences / surrounding prose) ──────────────────────────────

/** Slice the model output to its outermost JSON object; one light repair pass
 *  (trailing commas, stray control chars). Returns the parsed value or throws. */
export function parseBriefResponse(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  if (!raw.startsWith('{')) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) raw = raw.slice(start, end + 1);
  }
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    // Light, safe repair: drop trailing commas before } or ], strip stray control
    // characters (keeping \t \n \r) — the malformations a single stray char makes.
    const repaired = raw
      .replace(/,(\s*[}\]])/g, '$1')
      .split('').filter((c) => { const n = c.charCodeAt(0); return n === 9 || n === 10 || n === 13 || n > 31; }).join('');
    if (repaired !== raw) {
      try { return JSON.parse(repaired); } catch { /* fall through to throw */ }
    }
    throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
  }
}

// ── Extract-gate (reject malformed / partial) ────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function fail(msg: string): never {
  throw new Error(`brief-extract gate: ${msg}`);
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Optional string: null/undefined/'' → null; a string → trimmed; else reject. */
function strOrNull(v: unknown, ctx: string): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') fail(`${ctx} must be a string or null`);
  const t = (v as string).trim();
  return t.length > 0 ? t : null;
}
/** Required non-empty string, else reject (partial output). */
function reqStr(v: unknown, ctx: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) fail(`${ctx} is required and must be a non-empty string`);
  return (v as string).trim();
}
/** Optional ISO date (YYYY-MM-DD): null → null; present must match, else reject. */
function isoDateOrNull(v: unknown, ctx: string): string | null {
  const s = strOrNull(v, ctx);
  if (s !== null && !ISO_DATE.test(s)) fail(`${ctx} must be an ISO date (YYYY-MM-DD), got "${s}"`);
  return s;
}
/** Optional inclusive ISO date range: null/undefined → null; else { start, end } with
 *  both an ISO date and start <= end, otherwise reject (fail-loud). */
function dateRangeOrNull(v: unknown, ctx: string): { start: string; end: string } | null {
  if (v == null) return null;
  if (!isObj(v)) fail(`${ctx} must be an object { start, end } or null`);
  const start = reqStr((v as Record<string, unknown>)['start'], `${ctx}.start`);
  const end   = reqStr((v as Record<string, unknown>)['end'], `${ctx}.end`);
  if (!ISO_DATE.test(start)) fail(`${ctx}.start must be an ISO date (YYYY-MM-DD), got "${start}"`);
  if (!ISO_DATE.test(end)) fail(`${ctx}.end must be an ISO date (YYYY-MM-DD), got "${end}"`);
  if (start > end) fail(`${ctx}.start (${start}) must not be after ${ctx}.end (${end})`);
  return { start, end };
}
/** Optional array of non-empty strings: null/undefined → null; else each a string. */
function strArrayOrNull(v: unknown, ctx: string): string[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) fail(`${ctx} must be an array or null`);
  return v.map((x, i) => reqStr(x, `${ctx}[${i}]`));
}

/**
 * Validate + normalise a parsed value into a StructuredBrief. Throws on any
 * structural violation (missing arrays, missing required fields, bad status,
 * malformed dates) so a half-formed extraction fails loudly rather than
 * silently shipping a partial brief.
 */
export function validateStructuredBrief(parsed: unknown): StructuredBrief {
  if (!isObj(parsed)) fail('top-level value is not an object');
  const { products, schedule, content_asks, focus, conflicts, plan_window } = parsed as Record<string, unknown>;

  if (!Array.isArray(products)) fail('"products" must be an array');
  if (!Array.isArray(schedule)) fail('"schedule" must be an array');
  if (!Array.isArray(content_asks)) fail('"content_asks" must be an array');
  if (!Array.isArray(focus)) fail('"focus" must be an array');
  if (!Array.isArray(conflicts)) fail('"conflicts" must be an array');
  if (!isObj(plan_window)) fail('"plan_window" must be an object');

  const outProducts: BriefProduct[] = products.map((p, i) => {
    if (!isObj(p)) fail(`products[${i}] is not an object`);
    const status = p['status'];
    if (status !== 'new' && status !== 'restock') fail(`products[${i}].status must be "new" or "restock", got ${JSON.stringify(status)}`);
    return {
      product:      reqStr(p['product'], `products[${i}].product`),
      colourway:    strOrNull(p['colourway'], `products[${i}].colourway`),
      status:       status as BriefProductStatus,
      launch_date:  isoDateOrNull(p['launch_date'], `products[${i}].launch_date`),
      content_from: isoDateOrNull(p['content_from'], `products[${i}].content_from`),
    };
  });

  const outSchedule: BriefScheduleBeat[] = schedule.map((b, i) => {
    if (!isObj(b)) fail(`schedule[${i}] is not an object`);
    // A beat is EITHER a single day OR a range — exactly one of date / dateRange is present.
    // Fail loud on both or neither (this widens the schema; it does NOT loosen the gate).
    const date      = isoDateOrNull(b['date'], `schedule[${i}].date`);
    const dateRange = dateRangeOrNull(b['dateRange'], `schedule[${i}].dateRange`);
    if (date !== null && dateRange !== null) fail(`schedule[${i}] must not set BOTH date and dateRange`);
    if (date === null && dateRange === null) fail(`schedule[${i}] must set EITHER date or dateRange (got neither)`);
    return {
      date,
      dateRange,
      type:      reqStr(b['type'], `schedule[${i}].type`),
      product:   strOrNull(b['product'], `schedule[${i}].product`),
      colourway: strOrNull(b['colourway'], `schedule[${i}].colourway`),
      note:      strOrNull(b['note'], `schedule[${i}].note`) ?? '',
    };
  });

  const outContentAsks: BriefContentAsk[] = content_asks.map((a, i) => {
    if (!isObj(a)) fail(`content_asks[${i}] is not an object`);
    return {
      type:    reqStr(a['type'], `content_asks[${i}].type`),
      product: strOrNull(a['product'], `content_asks[${i}].product`),
      note:    strOrNull(a['note'], `content_asks[${i}].note`) ?? '',
    };
  });

  const outFocus: string[] = focus.map((f, i) => reqStr(f, `focus[${i}]`));

  const outConflicts: BriefConflict[] = conflicts.map((c, i) => {
    if (!isObj(c)) fail(`conflicts[${i}] is not an object`);
    const dates = strArrayOrNull(c['dates'], `conflicts[${i}].dates`);
    if (dates) dates.forEach((d, j) => { if (!ISO_DATE.test(d)) fail(`conflicts[${i}].dates[${j}] must be an ISO date (YYYY-MM-DD), got "${d}"`); });
    return {
      description: reqStr(c['description'], `conflicts[${i}].description`),
      dates,
      items:       strArrayOrNull(c['items'], `conflicts[${i}].items`),
    };
  });

  const month = strOrNull((plan_window as Record<string, unknown>)['month'], 'plan_window.month');
  if (month !== null && !ISO_MONTH.test(month)) fail(`plan_window.month must be YYYY-MM, got "${month}"`);

  return {
    products:     outProducts,
    schedule:     outSchedule,
    content_asks: outContentAsks,
    focus:        outFocus,
    conflicts:    outConflicts,
    plan_window: {
      from:  isoDateOrNull((plan_window as Record<string, unknown>)['from'], 'plan_window.from'),
      month,
    },
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** True when the brief carries no usable content (no non-empty answers, no notes). */
export function isEmptyBrief(planContent: PlanContentAnswers | null | undefined): boolean {
  if (!planContent) return true;
  const anyAnswer = Object.values(planContent.answers ?? {}).some((v) => typeof v === 'string' && v.trim().length > 0);
  const notes = (planContent.freeNotes ?? '').trim().length > 0;
  return !anyAnswer && !notes;
}

/**
 * QUESTION B (pure form) — "is there enough to generate a real plan?" given durable text that is
 * ALREADY in hand: the brief has content OR there is at least one non-empty durable line. Used on
 * the generator's extract path (where loadDurableContext has already loaded durable by relevance);
 * hasPlannableInput (intake-signals.ts) is the DB-querying twin for callers that must load durable
 * by relevance first. Both are the same question — the planning gate now tracks the generator.
 */
export function isPlannableBrief(planContent: PlanContentAnswers | null | undefined, durableContext: readonly string[]): boolean {
  return !isEmptyBrief(planContent) || durableContext.some((s) => s.trim().length > 0);
}

export interface BriefExtractParams {
  planContent:     PlanContentAnswers;
  planMonth:       string;          // YYYY-MM the plan is for — date-resolution context
  model:           ModelClient;
  logger?:         Logger;
  audit?:          AuditLogger;     // optional — logs the model call when provided
  clientId?:       string;          // required to audit
  // Durable cross-cycle context (plan_inputs idea|next_cycle), read live by the caller and
  // threaded in as a distinct section. Closes the businessContext non-consumption gap.
  durableContext?: string[];
}

/**
 * Extract the StructuredBrief from a cycle's planContent. Empty brief → an empty
 * StructuredBrief with NO model call. Otherwise a single Sonnet call, tolerant
 * parse, and the extract-gate. On unparseable/malformed output the gate throws
 * (the caller decides whether to fail the cycle) — no silent partial brief.
 */
export async function extractStructuredBrief(params: BriefExtractParams): Promise<StructuredBrief> {
  const { planContent, planMonth, model, logger, audit, clientId, durableContext } = params;

  // Nothing to extract only when NOT plannable (question B): no brief content and no durable line.
  if (!isPlannableBrief(planContent, durableContext ?? [])) {
    logger?.info({ planMonth }, 'brief-extract: empty brief + no durable context — returning empty structure (no model call)');
    return EMPTY_STRUCTURED_BRIEF;
  }

  const userMessage = buildBriefExtractUserMessage(planContent, planMonth, durableContext ?? []);
  const result = await model.complete({
    model:     BRIEF_EXTRACT_MODEL,
    system:    BRIEF_EXTRACT_SYSTEM,
    messages:  [{ role: 'user', content: userMessage }],
    maxTokens: BRIEF_EXTRACT_MAX_TOKENS,
  });

  if (audit && clientId) {
    try {
      await audit.logModelCall({
        clientId,
        modelId:      result.modelId,
        inputTokens:  result.inputTokens,
        outputTokens: result.outputTokens,
        action:       'content-cycle:brief-extract',
        metadata:     { planMonth },
      });
    } catch (err) {
      logger?.warn({ planMonth, err: String(err) }, 'brief-extract: audit log failed — non-fatal');
    }
  }

  const brief = validateStructuredBrief(parseBriefResponse(result.content));
  logger?.info(
    { planMonth, products: brief.products.length, schedule: brief.schedule.length,
      contentAsks: brief.content_asks.length, focus: brief.focus.length, conflicts: brief.conflicts.length,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, modelId: result.modelId },
    'brief-extract: structured brief extracted',
  );
  return brief;
}

// ── Answer distribution (freeform brief → base-question answer slots) ─────────
//
// The freeform capture surface sends the whole brief as one block of text. The generator and
// the admin IntakePanel still read intake_json.planContent.answers keyed by the base questions,
// so this maps the free text back into those slots — WITHOUT inventing anything, and returning
// ONLY the questions the text actually addresses. It is SUPPLEMENTARY (not the fail-loud brief
// gate): any parse/model failure returns {} so the caller simply leaves answers empty and the
// free text (freeNotes) — the source of truth for extraction — is never lost.

const ANSWER_DISTRIBUTE_MODEL = 'haiku';   // a lighter routing task than the structured extract
const ANSWER_DISTRIBUTE_MAX_TOKENS = 1_500;

const ANSWER_DISTRIBUTE_SYSTEM = `You sort a client's free-text monthly planning brief into a FIXED list of planning questions. You are given the QUESTIONS and the client's BRIEF. Return a JSON object whose keys are the EXACT question text (copied verbatim) and whose values are the answer drawn from the brief for that question.

Rules:
- Include a question ONLY if the brief actually addresses it. Omit every question the brief does not speak to — do NOT invent, pad, or guess.
- Each value must be grounded in what the brief says; quote or lightly paraphrase the client's own words. Never add information that is not in the brief.
- A single sentence of the brief may answer more than one question; a question may draw from several parts of the brief.
- Keys MUST match the provided question text character-for-character. Do not shorten or reword them.
- Return ONE JSON object and nothing else. No prose, no markdown, no code fences. If the brief addresses none of the questions, return {}.`;

export interface DistributeAnswersParams {
  freeNotes: string;                // the client's free-text brief (planContent.freeNotes)
  questions: string[];              // BASE_QUESTIONS + the channel's extra_questions
  model:     ModelClient;
  logger?:   Logger;
  audit?:    AuditLogger;
  clientId?: string;
}

/**
 * Distribute a free-text brief across the base-question answer slots. Returns a map of
 * { questionText: answer } for ONLY the questions the brief addresses (exact-key matched
 * against `questions`). Non-fatal by contract: returns {} on empty input or any failure.
 */
export async function distributeBriefAnswers(params: DistributeAnswersParams): Promise<Record<string, string>> {
  const { model, logger, audit, clientId } = params;
  const text = (params.freeNotes ?? '').trim();
  const questions = params.questions.filter((q) => typeof q === 'string' && q.trim().length > 0);
  if (!text || questions.length === 0) return {};

  const userMessage = [
    'QUESTIONS:',
    questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
    '',
    'BRIEF:',
    text,
    '',
    'Return the JSON object mapping addressed questions to their answers. JSON only.',
  ].join('\n');

  try {
    const result = await model.complete({
      model:     ANSWER_DISTRIBUTE_MODEL,
      system:    ANSWER_DISTRIBUTE_SYSTEM,
      messages:  [{ role: 'user', content: userMessage }],
      maxTokens: ANSWER_DISTRIBUTE_MAX_TOKENS,
    });
    if (audit && clientId) {
      try {
        await audit.logModelCall({
          clientId, modelId: result.modelId, inputTokens: result.inputTokens,
          outputTokens: result.outputTokens, action: 'content-cycle:distribute-answers', metadata: {},
        });
      } catch (err) { logger?.warn({ err: String(err) }, 'distribute-answers: audit log failed — non-fatal'); }
    }
    const parsed = parseBriefResponse(result.content);
    if (!isObj(parsed)) return {};
    // Keep only exact-match questions with a non-empty string answer (defends key drift).
    const allowed = new Set(questions);
    const out: Record<string, string> = {};
    for (const [q, a] of Object.entries(parsed)) {
      if (allowed.has(q) && typeof a === 'string' && a.trim().length > 0) out[q] = a.trim();
    }
    logger?.info({ addressed: Object.keys(out).length, of: questions.length }, 'distribute-answers: distributed free text into answer slots');
    return out;
  } catch (err) {
    logger?.warn({ err: String(err) }, 'distribute-answers: failed — non-fatal, answers left empty');
    return {};
  }
}
