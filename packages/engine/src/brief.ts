/**
 * brief.ts — split a pasted DOCUMENT into the separate instructions it contains, so each can
 * run through the existing single-intent classifier.
 *
 * The problem, proven live: real clients paste briefs, not sentences. Sally's actual August
 * brief (~700 words, 13 distinct intents) hit the single-intent extraction and fell to
 * couldnt_apply — the contract could express every intent inside it, but nothing split the
 * document into them (docs/reports/ivy-t-rehearsal-failures.md). This module is that layer.
 *
 * Three honest parts:
 *   1. a DETECTOR — is this document-shaped, or a single sentence the existing path handles?
 *   2. a DECOMPOSER — ONE model call that splits the input into VERBATIM spans (no paraphrase,
 *      no interpretation, no intent labelling), coverage-checked against the source;
 *   3. an ORDERING — the deterministic order the segments' intents must be applied in.
 *
 * The classifier prompt and schema are NOT touched — each segment runs through the demonstrated
 * contract unchanged. Everything here is upstream of it.
 *
 * Pure except decomposeInput's single model call. No db.
 */
import { z } from 'zod';
import type { ModelClient, AuditLogger } from './types.js';
import type { IntakeRouting } from './intake-classify.js';
import { parseLastJsonObject } from './json-salvage.js';

interface Logger { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }

// ── The detector ────────────────────────────────────────────────────────────────

/**
 * Length past which an input is treated as document-shaped regardless of structure. A single
 * instruction rarely runs this long; a brief usually does.
 */
const DOC_MIN_CHARS = 240;

/** Count date-ish signals — ordinal days ("7th", "28th") and month names. Several of them is a
 *  schedule, not a sentence. */
function dateSignalCount(t: string): number {
  const ordinals = t.match(/\b\d{1,2}(?:st|nd|rd|th)\b/gi)?.length ?? 0;
  const months   = t.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi)?.length ?? 0;
  return ordinals + months;
}

/**
 * Is this input a DOCUMENT (route it through the decomposer) or a single instruction (the
 * existing path, byte-identical)?
 *
 * Document-shaped if ANY of:
 *   - it spans 2+ line breaks (people paste briefs with structure — the strongest signal), OR
 *   - it is at least DOC_MIN_CHARS long, OR
 *   - it carries 4+ date signals (ordinal days + month names) — several dates is a schedule.
 *
 * Chosen for a low false-POSITIVE rate on genuine single sentences: "the Navy Edit launches on
 * 28th August at 7pm" is one line, ~44 chars, 2 date signals → NOT a document, so it bypasses
 * the decomposer entirely and the existing path is untouched. A false negative (a short 2-intent
 * paste slipping through as one) is the safer failure: it lands exactly where it does today.
 */
export function isDocumentShaped(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if ((t.match(/\n/g)?.length ?? 0) >= 2) return true;
  if (t.length >= DOC_MIN_CHARS) return true;
  if (dateSignalCount(t) >= 4) return true;
  return false;
}

// ── The decomposition contract ──────────────────────────────────────────────────

/**
 * The model returns the input as an ordered list of parts, each a verbatim span, `keep:true`
 * for a distinct instruction and `keep:false` for connective tissue (greetings, sign-offs).
 * Ordered so the coverage check is a single left-to-right walk.
 */
const decompositionSchema = z.object({
  parts: z.array(z.object({
    text: z.string().min(1),
    keep: z.boolean(),
  })).min(1).max(60),
});

export type Decomposition = { segments: string[]; discarded: string[] };

export const DECOMPOSE_SYSTEM = `You split ONE pasted message from a small brand's owner into the separate instructions it contains, for their social media content plan.

Do NOT interpret, classify, label, summarise, or rephrase anything. Only split.

Return the message as an ordered list of PARTS. Each part is a span copied VERBATIM, character-for-character, from the input, in the order it appears. Set keep=true if the part is a distinct instruction or idea about their content (a launch, an event, a run of posts, one specific post, a posting cadence, a correction, a standing idea for later). Set keep=false if it is connective tissue with no instruction in it — greetings, sign-offs, "hope you're well", "let me know what you think", "thanks so much".

RULES:
- Copy verbatim. Do not drop, add, reorder, or edit a single character — punctuation and wording included. Concatenating every part's text in order should reproduce the input.
- ONE instruction per keep=true part. If two separate instructions sit in one sentence, split them into two parts.
- A dated run of posts ("every Friday: 7th X, 14th Y, 21st Z") is ONE part — it is one instruction with several dates.
- Do not classify or explain what each part is. That is a later step.

Return ONE JSON object, no markdown, no code fences:
{"parts":[{"text":"<verbatim span>","keep":true},{"text":"<verbatim span>","keep":false}]}`;

/**
 * A `"` in the client's own text, emitted unescaped inside the JSON string that carries it.
 *
 * ── The failure ──────────────────────────────────────────────────────────────────────
 *
 * Item 15 of a real brief read: `15) Add a new post in the "What I am most proud of…." series`.
 * DECOMPOSE_SYSTEM says "Copy verbatim. Do not drop, add, reorder, or edit a single character",
 * the model did exactly that, and the result was
 *
 *     {"text":"\n15) Add a new post in the "What I am most proud of…." series", "keep":true}
 *
 * which is not JSON. `JSON.parse` threw at the quote, `parseDecomposition` threw, and 851
 * tokens of a CORRECT fifteen-way split were discarded — twice, because the retry re-ran the
 * same prompt over the same text and got the same character back.
 *
 * The instruction and the format are in direct conflict: one demands the client's bytes
 * untouched, the other reserves one of those bytes. Every brief containing a straight double
 * quote fails, at any length; a single sentence would fail identically.
 *
 * ── Why this is repaired HERE and not in json-salvage.ts ─────────────────────────────
 *
 * Repairing arbitrary malformed JSON is a rabbit hole and json-salvage is deliberately
 * schema-blind — it serves four call sites and knows nothing about any of their shapes. The
 * line drawn is this: **only where the schema is known**. Here it is exactly known, because
 * this module also defines it: a part is `{"text": <string>, "keep": <bool>}` and `keep`
 * follows `text`. That makes `","keep":` an unambiguous terminator, and the recovery a scan
 * rather than a repair. No other malformation is corrected and no other shape is understood.
 *
 * ── Why not change the contract, or instruct escaping ────────────────────────────────
 *
 * A different output format (sentinel-delimited spans, offsets) removes the class rather than
 * recovering from it, and is the better answer in the abstract. It is the worse answer here
 * for the same reason instructing the model to escape is: both are a NEW rule the model must
 * follow on every call, and this codebase has had three prompt-level fences fail in recent
 * weeks. This changes only our code. The model's behaviour is already reliable — it produced
 * the same correct split twice, deterministically — and what failed was our ability to read it.
 *
 * ── Why a wrong recovery is safe ─────────────────────────────────────────────────────
 *
 * `validateDecomposition` is unchanged and still the guarantee: every part must be a verbatim
 * substring of the source, tiling it left-to-right with whitespace-only gaps. A mis-split here
 * cannot invent text, because a recovered span that is not in the source fails `indexOf` and
 * the whole decomposition is rejected. The blast radius of a bad scan is the null we already
 * return today.
 */
const PART_TEXT_OPEN = '"text":';

/** Is the quote at `i` a real string terminator, or one the client typed? Escaped means an
 *  ODD number of backslashes immediately precedes it. */
function isEscaped(s: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) n++;
  return n % 2 === 1;
}

/** JSON-decode one string BODY that may contain bare quotes: escape those, then let JSON do
 *  the rest, so `\n`, `\u2019` and friends decode exactly as they would have. */
function decodeStringBody(body: string): string | null {
  let fixed = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    fixed += c === '"' && !isEscaped(body, i) ? '\\"' : c;
  }
  try { return JSON.parse(`"${fixed}"`) as string; } catch { return null; }
}

/**
 * Read `{"parts":[…]}` by scanning for the known field order rather than by parsing.
 *
 * Returns null on anything it does not recognise — a missing terminator, an undecodable body,
 * a `keep` that is not a literal boolean. Null means "fall through", never "guess".
 */
export function scanDecomposition(text: string): unknown | null {
  const parts: Array<{ text: string; keep: boolean }> = [];
  let i = 0;
  for (;;) {
    const at = text.indexOf(PART_TEXT_OPEN, i);
    if (at < 0) break;
    const open = text.indexOf('"', at + PART_TEXT_OPEN.length);
    if (open < 0) return null;
    // The terminator is the value's closing quote followed by this schema's next field. A
    // quote NOT followed by `,"keep":` is one the client typed, and is stepped over.
    const term = /^"\s*,\s*"keep"\s*:\s*(true|false)/;
    let end = -1;
    let keep = false;
    for (let j = open + 1; j < text.length; j++) {
      if (text[j] !== '"' || isEscaped(text, j)) continue;
      const m = term.exec(text.slice(j));
      if (!m) continue;
      end = j;
      keep = m[1] === 'true';
      i = j + m[0].length;
      break;
    }
    if (end < 0) return null;
    const body = decodeStringBody(text.slice(open + 1, end));
    if (body === null) return null;
    parts.push({ text: body, keep });
  }
  return parts.length > 0 ? { parts } : null;
}

/**
 * Tolerant parse — fenced, prose-wrapped, bare, or SELF-CORRECTED JSON, and now a verbatim
 * span carrying a straight double quote.
 *
 * The self-correction shape is the one that cost an earlier client brief. This model reliably
 * splits a bulleted brief coarsely, writes "Wait, I need to re-examine this more carefully",
 * and then emits a second, correct object. The last complete object wins; see json-salvage.ts,
 * whose blind spot was found here.
 *
 * STRICT FIRST, ALWAYS. `parseLastJsonObject` is unchanged and runs first, so every response
 * that is valid JSON parses exactly as it did before and the scan below never sees it. The
 * scan is reached only where the old code threw.
 */
export function parseDecomposition(text: string): unknown {
  try {
    return parseLastJsonObject(text);
  } catch (strictErr) {
    const scanned = scanDecomposition(text);
    if (scanned) return scanned;
    throw strictErr;
  }
}

/** Collapse runs of whitespace so a gap-only check ignores how the model spaced its parts. */
const isWhitespace = (s: string): boolean => s.trim().length === 0;

/**
 * TYPOGRAPHIC FOLD, FOR LOCATING ONLY — never for what we keep.
 *
 * The second breach on the same real brief, found while verifying the first. Item 7 reads
 * `We get that it’s not for everyone` with a curly apostrophe; the model returned `it's` with
 * a straight one. It is not a paraphrase and not a drop — it is a word processor's instinct,
 * applied to one character in 2,808, and it failed `indexOf` exactly as a rewrite would.
 *
 * Every entry is ONE character mapping to ONE character, which is the property that makes this
 * safe: folding cannot move an offset, so a match found in folded space is at the same index in
 * the original. `…` is deliberately absent — a model writing `...` for it changes the length,
 * and an offset-shifting fold would corrupt every span after it.
 */
const FOLD: ReadonlyMap<string, string> = new Map([
  ['\u2018', "'"], ['\u2019', "'"], ['\u201A', "'"], ['\u2032', "'"],
  ['\u201C', '"'], ['\u201D', '"'], ['\u201E', '"'], ['\u2033', '"'],
  ['\u2013', '-'], ['\u2014', '-'], ['\u2212', '-'],
  ['\u00A0', ' '], ['\u2007', ' '], ['\u202F', ' '],
]);

/** Same length, always — see FOLD. */
function fold(s: string): string {
  let out = '';
  for (const ch of s) out += FOLD.get(ch) ?? ch;
  return out;
}

/**
 * Validate a parsed decomposition into segments + discards, enforcing the coverage contract:
 * every part is a VERBATIM substring, the parts tile the source left-to-right in order, they
 * never overlap, and every non-whitespace character is inside exactly one part. Gaps between
 * parts must be whitespace only — the one thing the model is allowed to omit.
 *
 * Returns null on any breach; the caller retries once then falls back to the whole-input path.
 * Exported so the contract is testable without a model.
 */
export function validateDecomposition(parsed: unknown, source: string): Decomposition | null {
  const outer = decompositionSchema.safeParse(parsed);
  if (!outer.success) return null;

  // Located in FOLDED space, sliced from the ORIGINAL. The fold is length-preserving, so an
  // index found in one is the same index in the other.
  const haystack = fold(source);

  let cursor = 0;
  const segments: string[] = [];
  const discarded: string[] = [];

  for (const part of outer.data.parts) {
    const idx = haystack.indexOf(fold(part.text), cursor);
    if (idx < 0) return null;                                   // not verbatim, or out of order
    if (!isWhitespace(source.slice(cursor, idx))) return null;  // a non-whitespace gap = uncovered text
    /**
     * THE SPAN COMES FROM THE SOURCE, NOT FROM THE MODEL.
     *
     * This is the verbatim guarantee, and it is now structural rather than checked. Before,
     * `part.text` was pushed on the strength of having matched; every segment was the model's
     * echo, correct only because the comparison had been exact. With a fold in the comparison
     * that would no longer hold — a segment could carry the model's straight apostrophe where
     * the client typed a curly one — so the echo is used to LOCATE and then discarded.
     *
     * The stronger property is the point: a segment is a substring of the client's own text by
     * construction, and no future tolerance added to the match can change that.
     */
    const span = source.slice(idx, idx + part.text.length);
    cursor = idx + part.text.length;
    const trimmed = span.trim();
    if (!trimmed) { discarded.push(span); continue; }           // whitespace-only part → nothing kept
    (part.keep ? segments : discarded).push(trimmed);
  }

  if (!isWhitespace(source.slice(cursor))) return null;          // trailing non-whitespace uncovered
  if (segments.length === 0) return null;                        // nothing to route — fall back
  return { segments, discarded };
}

export interface DecomposeParams {
  text:      string;
  model:     ModelClient;
  modelName?: string;
  logger?:   Logger;
  audit?:    AuditLogger;
  clientId?: string;
}

/**
 * Decompose one document into verbatim instruction segments.
 *
 * ONE model call, retry once on a validation breach, then null — the caller falls back to the
 * whole-input path, which couldnt_applies exactly as today (never worse). Every call is put on
 * the cost-guard ledger when an auditor + clientId are supplied.
 */
export async function decomposeInput(params: DecomposeParams): Promise<Decomposition | null> {
  const { text, model, modelName = 'sonnet', logger, audit, clientId } = params;
  const source = text;

  const attempt = async (): Promise<Decomposition | null> => {
    try {
      const res = await model.complete({
        model: modelName, system: DECOMPOSE_SYSTEM,
        messages: [{ role: 'user', content: `OWNER’S MESSAGE:\n${source}\n\nSplit it. JSON only.` }],
        maxTokens: 4000,
      });
      if (audit && clientId) {
        try {
          await audit.logModelCall({
            clientId, modelId: res.modelId, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
            action: 'content-cycle:brief-decompose', metadata: {},
          });
        } catch { /* auditing must never change the outcome */ }
      }
      let parsed: unknown;
      try { parsed = parseDecomposition(res.content); }
      catch (err) { logger?.warn({ err: String(err) }, 'brief-decompose: unparseable output'); return null; }
      return validateDecomposition(parsed, source);
    } catch (err) {
      logger?.warn({ err: String(err) }, 'brief-decompose: model call failed');
      return null;
    }
  };

  const first = await attempt();
  if (first) return first;
  logger?.info({}, 'brief-decompose: first attempt did not satisfy the coverage contract — retrying once');
  return attempt();
}

// ── The application order ─────────────────────────────────────────────────────────

/**
 * The order month-scoped intents must be applied in, so each sees the state it depends on:
 *   launch → series → event/beat_spec → correction/beat_edit → emphasis → cadence
 *
 *   - launch and series come first: they CREATE the anchor beats a later correction may name.
 *   - event and beat_spec share a tier — each just places a dated post, neither depends on the
 *     other.
 *   - correction and beat_edit come after all placement: their targets must already exist
 *     (a correction that runs before its launch has nothing to correct). beat_edit is not in the
 *     spec's list but belongs here for the same reason — it edits an existing beat.
 *   - emphasis tilts the settled month.
 *   - cadence is LAST: its top-up counts the finished month, so it fills the real remaining gap.
 * Evergreen segments touch no beats, so their order is irrelevant; they sort to the end and are
 * filed to the backlog after the plan has settled.
 */
const TIER: Record<string, number> = {
  launch: 0, series: 1, event: 2, beat_spec: 2, correction: 3, beat_edit: 3, emphasis: 4, cadence: 5,
};
const EVERGREEN_TIER = 6;

export function tierOf(routing: IntakeRouting): number {
  // A question inside a pasted brief touches no beats either, so it sorts with the evergreen
  // segments — last, after the plan has settled. It is NOT filed with them: the apply path
  // answers it and files nothing (draft-apply.ts). Only its ORDER is shared.
  if (routing.scope === 'evergreen' || routing.scope === 'question') return EVERGREEN_TIER;
  return TIER[routing.intent.kind] ?? 3;
}

/**
 * The indices of `routings` in application order — a STABLE sort by tier then original position,
 * so the document order is the tiebreak and the same brief always applies the same way.
 */
export function orderIndices(routings: IntakeRouting[]): number[] {
  return routings
    .map((r, i) => ({ i, tier: tierOf(r) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((x) => x.i);
}
