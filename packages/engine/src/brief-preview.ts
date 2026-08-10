/**
 * brief-preview.ts — the LIVE preview pass for the planning workspace (Phase 1).
 *
 * A lightweight, cheap HAIKU read over the client's in-progress brief text, producing a
 * sectioned preview (campaigns / themes / products / dates / availability / ideas) plus AT MOST
 * ONE short follow-up question. It is PURE PREVIEW: it never writes the DB, never gates anything,
 * and degrades to an empty preview on any failure. The authoritative brief is still the commit-
 * time Sonnet extraction (unchanged) — this only mirrors what's being typed, as it's typed.
 *
 * Durable awareness: the client's active plan_inputs (each tagged with the month it was captured)
 * are passed in so the preview can (b) raise a follow-up connecting a stored durable to THIS month
 * and (c) tag any item that came from a durable with its provenance month. Memory surfaces ONLY
 * through these two channels — there is no memory card.
 */
import type { ModelClient, AuditLogger } from './types.js';
import { parseBriefResponse } from './brief-extract.js';

interface Logger { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }

const PREVIEW_MODEL = 'haiku';
const PREVIEW_MAX_TOKENS = 1_200;
/** Below this many characters we don't call the model — nothing meaningful to preview yet. */
export const PREVIEW_MIN_CHARS = 12;

/** A preview line. `from` is the provenance month (e.g. "June") when the item came from a stored
 *  durable rather than the current input; null/absent when it's from what's being typed now. */
export interface PreviewItem { text: string; from?: string | null }
export interface PreviewDate { when: string; what: string; from?: string | null }

export interface BriefPreview {
  campaigns:     PreviewItem[];
  themes:        PreviewItem[];
  products:      PreviewItem[];
  dates:         PreviewDate[];
  availability:  PreviewItem[];
  ideas:         PreviewItem[];
  /** A single short follow-up to surface beneath the input (gap-filling OR durable-connecting), or
   *  null when nothing is worth asking. Never a list. */
  followUp:      string | null;
}

export const EMPTY_PREVIEW: BriefPreview = {
  campaigns: [], themes: [], products: [], dates: [], availability: [], ideas: [], followUp: null,
};

/** A stored durable, with the month it was captured, for provenance + connection follow-ups. */
export interface PreviewDurable { content: string; month: string }

export interface PreviewBriefParams {
  text:      string;
  durables?: PreviewDurable[];
  /**
   * The month this brief is FOR, as a label the model can read ("September 2026").
   *
   * Deterministic — `nextMonth(cycle.cycleMonth)`, resolved by the caller from the cycle row,
   * never inferred from the text. Optional only so a caller that cannot resolve it degrades to
   * the previous behaviour rather than failing; every real caller supplies it.
   */
  planMonth?: string;
  model:     ModelClient;
  logger?:   Logger;
  audit?:    AuditLogger;
  clientId?: string;
}

const PREVIEW_SYSTEM = `You are a live planning assistant. As a client types their monthly content brief, you mirror back a lightweight, evolving preview of what you've understood SO FAR — like notes taking shape. You never invent; you only reflect what the text (or a clearly-relevant stored memory) says.

Return a JSON object with EXACTLY these keys:
{
  "campaigns":    [ { "text": "", "from": null } ],   // named campaigns / launches / promotions / sales
  "themes":       [ { "text": "", "from": null } ],   // angles, moods, stories to lean into (or avoid)
  "products":     [ { "text": "", "from": null } ],   // specific products / ranges / items mentioned
  "dates":        [ { "when": "", "what": "", "from": null } ],  // any timing: "the 25th", "last week", "mid-month"
  "availability": [ { "text": "", "from": null } ],   // stock notes: sold out, restock, limited, back in
  "ideas":        [ { "text": "", "from": null } ],   // looser ideas / maybes / nice-to-haves
  "followUp":     null                                // ONE short question, or null
}

Rules:
- Extract ONLY what the brief actually says. Empty sections are fine — return []. Keep each item to a few words.
- MEMORY: you may be given DURABLES — standing notes the client saved in earlier months, each tagged with the month it was captured. If a durable is clearly relevant to what's being typed now, you may include it as an item with "from" set to its month (e.g. "from": "June"). Otherwise ignore it. Items from the current text have "from": null.
- followUp: at MOST ONE short question, and ONLY when it genuinely helps — either (a) a real gap ("Any key dates this month?" only if NO dates are present), or (b) connecting a durable to now ("You mentioned relaunching the range in autumn — is that this month?"). If the brief is already clear, or nothing is worth asking, set followUp to null. Never ask more than one thing. Never ask something the text already answers.
- THE PLAN MONTH IS GIVEN TO YOU, AND IT IS NOT IN DOUBT. A bare day with no month — "the 25th", "the last weekend", "mid-month" — is a day in the PLAN MONTH. That is settled: never ask which month it is, never offer a different month for it, and never ask whether it belongs to something a DURABLE mentions happening in another month. Echo it back in "when" exactly as the client wrote it.
- A date the brief names in a DIFFERENT month from the plan month ("the 3rd of October" while planning September) is genuinely worth one question, because it may be a note for later rather than a beat for this month. That is the ONLY case where a date earns a follow-up about timing.
- Return ONE JSON object and nothing else. No prose, no markdown, no code fences.`;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function itemsOf(v: unknown): PreviewItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((o) => (isObj(o) ? { text: str(o.text), from: str(o.from) || null } : { text: str(o), from: null }))
          .filter((it) => it.text.length > 0);
}
function datesOf(v: unknown): PreviewDate[] {
  if (!Array.isArray(v)) return [];
  return v.map((o) => (isObj(o) ? { when: str(o.when), what: str(o.what), from: str(o.from) || null } : { when: str(o), what: '', from: null }))
          .filter((d) => d.when.length > 0);
}

/** One Haiku preview pass. Non-fatal: returns EMPTY_PREVIEW for short/empty input or any error. */
export async function previewBrief(params: PreviewBriefParams): Promise<BriefPreview> {
  const { model, logger, audit, clientId } = params;
  const text = (params.text ?? '').trim();
  if (text.length < PREVIEW_MIN_CHARS) return EMPTY_PREVIEW;

  const durables = (params.durables ?? []).filter((d) => d.content.trim().length > 0);
  /**
   * THE MONTH LEADS, as it does in `buildBriefExtractUserMessage`.
   *
   * This pass used to be given no month at all, and it showed: asked to preview "a launch on the
   * 25th" it would reach for a month named somewhere in the DURABLES and ask the client to choose
   * between them — "Is the 25th launch the same as the October product on the waitlist?" — on a
   * surface whose own heading reads "Let's plan September 2026 together". The durables are what
   * made it possible (with none supplied it asks what is launching, never when), but the missing
   * month is what made it reasonable: a bare ordinal genuinely is ambiguous to a reader who has
   * not been told which month they are reading for.
   *
   * The month is a deterministic fact of the cycle. It is supplied rather than inferred, in the
   * same position and for the same reason as the commit-time extraction — which was given it all
   * along, which is why the two paths behaved differently on the same sentence.
   */
  const userMessage = [
    params.planMonth ? `PLAN MONTH: ${params.planMonth}\n` : '',
    durables.length ? `DURABLES (standing memories from earlier months):\n${durables.map((d) => `- [${d.month}] ${d.content}`).join('\n')}\n` : '',
    'BRIEF SO FAR:',
    text,
    '',
    'Return the preview JSON now. JSON only.',
  ].filter(Boolean).join('\n');

  try {
    const result = await model.complete({
      model: PREVIEW_MODEL, system: PREVIEW_SYSTEM,
      messages: [{ role: 'user', content: userMessage }], maxTokens: PREVIEW_MAX_TOKENS,
    });
    if (audit && clientId) {
      try { await audit.logModelCall({ clientId, modelId: result.modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, action: 'content-cycle:brief-preview', metadata: {} }); }
      catch (err) { logger?.warn({ err: String(err) }, 'brief-preview: audit log failed — non-fatal'); }
    }
    const p = parseBriefResponse(result.content);
    if (!isObj(p)) return EMPTY_PREVIEW;
    const fu = str(p.followUp);
    return {
      campaigns: itemsOf(p.campaigns), themes: itemsOf(p.themes), products: itemsOf(p.products),
      dates: datesOf(p.dates), availability: itemsOf(p.availability), ideas: itemsOf(p.ideas),
      followUp: fu.length > 0 ? fu : null,
    };
  } catch (err) {
    logger?.warn({ err: String(err) }, 'brief-preview: failed — non-fatal, empty preview');
    return EMPTY_PREVIEW;
  }
}
