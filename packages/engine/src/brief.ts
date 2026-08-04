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

/** Tolerant parse — fenced, prose-wrapped, or bare JSON. */
export function parseDecomposition(text: string): unknown {
  const fenced = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
  let raw = (fenced?.[1] ?? text).trim();
  if (!raw.startsWith('{')) {
    const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) raw = raw.slice(a, b + 1);
  }
  return JSON.parse(raw) as unknown;
}

/** Collapse runs of whitespace so a gap-only check ignores how the model spaced its parts. */
const isWhitespace = (s: string): boolean => s.trim().length === 0;

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

  let cursor = 0;
  const segments: string[] = [];
  const discarded: string[] = [];

  for (const part of outer.data.parts) {
    const idx = source.indexOf(part.text, cursor);
    if (idx < 0) return null;                                   // not verbatim, or out of order
    if (!isWhitespace(source.slice(cursor, idx))) return null;  // a non-whitespace gap = uncovered text
    cursor = idx + part.text.length;
    const trimmed = part.text.trim();
    if (!trimmed) { discarded.push(part.text); continue; }      // whitespace-only part → nothing kept
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
