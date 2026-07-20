/**
 * draft-phrasing.ts — the ONE model call in draft assembly.
 *
 * The assembler produces beats with deterministic titles ("Everyday Ritual — Carousel").
 * Those are honest but graceless, and a client asked to react to a month of them will
 * react to the formatting rather than the plan. This pass phrases them.
 *
 * The contract is narrow on purpose: the model may ONLY restate evidence it was given.
 * It may not name a product, quote a number, or claim a result that is not in its input.
 * That is enforced twice — in the prompt, and in validatePhrasing() afterwards, because a
 * prompt instruction is a request and this needs to be a guarantee. The whole value of a
 * draft is that the client can trust its reasoning; a phrasing pass that invents a
 * product launch would destroy that faster than an ugly title ever could.
 *
 * ONE call per draft, not per beat: the model sees the whole month, so titles vary
 * against each other instead of converging on the same shape 17 times.
 *
 * Never blocks. Retry once, then fall back to the deterministic titles. A draft with
 * plain titles is a working draft; a draft that failed to assemble is nothing.
 */
import type { DraftBeat } from './draft-assembly.js';

export interface PhrasingModel {
  complete(params: {
    model: string; system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number; temperature?: number;
  }): Promise<{ content: string; inputTokens: number; outputTokens: number; modelId: string }>;
}

export const PHRASING_SYSTEM = `You write short content-beat titles for a social media plan.

You will be given a list of beats. Each has a pillar, a format, and the structured evidence it was chosen on. You will also be given a short summary of the brand's voice.

Write ONE title per beat, in the brand's voice, 3-8 words.

ABSOLUTE RULES — these are not style preferences:
- Restate ONLY what the evidence gives you. The pillar, the format, and nothing else.
- NEVER name a product, a colourway, a collection, a price, or a date.
- NEVER state a metric, a number, a percentage, or a performance claim.
- NEVER promise a launch, a restock, a sale, an offer, or an event.
- If you have nothing specific to say about a beat, write a plain title from its pillar. A plain title is correct; an invented one is a failure.

Return ONE JSON object and nothing else, no markdown, no code fences:
{"titles":[{"position":0,"title":""}]}
One entry per beat, using the position number given.`;

/** Words that would mean the model invented something it was not given. */
const FORBIDDEN = [
  /\d+\s*%/,                                          // percentages
  /(?:£|\$|€)\s*\d/,                                  // prices — NO \b: £ is not a word char
  /\b\d{1,2}(?:st|nd|rd|th)\b/i,                      // dates ("28th")
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(?:launch(?:es|ing)?|restock(?:s|ing|ed)?|sale|discount|offer|drop(?:s|ping)?)\b/i,
  /\b(?:in|back in|out of)\s+stock\b/i,               // "back in stock" — a restock by another name
  /\b(?:sold out|best[- ]?sell(?:er|ers|ing)|top[- ]?(?:performing|seller)|most[- ]?liked)\b/i,
];

export interface PhrasingResult {
  titles:  Map<number, string>;
  /** How the titles were produced — recorded so a fallback is never invisible. */
  outcome: 'phrased' | 'fallback';
  reason?: string;
}

/** Parse `{"titles":[{position,title}]}`, tolerant of fences and surrounding prose. */
export function parsePhrasing(text: string): Map<number, string> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  if (!raw.startsWith('{')) {
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
    if (s !== -1 && e > s) raw = raw.slice(s, e + 1);
  }
  const parsed = JSON.parse(raw) as { titles?: unknown };
  if (!Array.isArray(parsed.titles)) throw new Error('phrasing response missing "titles" array');

  const out = new Map<number, string>();
  for (const t of parsed.titles) {
    const o = t as Record<string, unknown>;
    const position = Number(o['position']);
    const title = typeof o['title'] === 'string' ? o['title'].trim() : '';
    if (Number.isInteger(position) && title.length > 0) out.set(position, title);
  }
  return out;
}

/**
 * Validate the model's output against its contract: EVERY beat phrased, and NOTHING
 * introduced. Returns the offending reason, or null when the output is acceptable.
 *
 * Rejecting the whole batch on one bad title is deliberate. A model that invented a
 * launch for beat 7 was not reasoning within its evidence for beats 1-6 either; taking
 * the good ones and dropping the bad would leave output we have no basis to trust.
 */
export function validatePhrasing(beats: DraftBeat[], titles: Map<number, string>): string | null {
  for (const beat of beats) {
    const title = titles.get(beat.position);
    if (!title) return `beat ${beat.position} was not phrased`;
    for (const pattern of FORBIDDEN) {
      if (pattern.test(title)) return `beat ${beat.position} introduced content not in its evidence: "${title}"`;
    }
  }
  return null;
}

function buildUserMessage(beats: DraftBeat[], voiceSummary: string | null): string {
  const lines = beats.map((b) => {
    const ev = b.beatMeta.rationaleEvidence;
    const basis = ev.basis === 'template'
      ? 'no history to draw on — keep this title plain'
      : `chosen because this pillar is ${ev.pillarShare !== undefined ? `${Math.round(ev.pillarShare * 100)}% of their posting` : 'part of their mix'}`;
    return `- position ${b.position}: pillar "${b.pillar}", format "${b.format}" (${basis})`;
  });
  return [
    voiceSummary ? `BRAND VOICE:\n${voiceSummary}` : 'BRAND VOICE: (unavailable — keep titles plain and neutral.)',
    '',
    `BEATS (${beats.length}):`,
    ...lines,
    '',
    `Write one title for each of the ${beats.length} positions above. JSON only.`,
  ].join('\n');
}

/**
 * Phrase a draft's beat titles. NEVER throws and never returns fewer titles than beats —
 * on any failure it reports `outcome: 'fallback'` and the caller keeps the deterministic
 * titles the assembler already produced.
 */
export async function phraseDraftTitles(params: {
  beats:        DraftBeat[];
  voiceSummary: string | null;
  model:        PhrasingModel;
  modelName?:   string;
  onWarn?:      (message: string) => void;
}): Promise<PhrasingResult> {
  const { beats, voiceSummary, model, modelName = 'sonnet', onWarn } = params;
  if (beats.length === 0) return { titles: new Map(), outcome: 'phrased' };

  const user = buildUserMessage(beats, voiceSummary);
  let lastReason = 'unknown';

  // One retry. Phrasing is non-deterministic, so a single malformed or over-reaching
  // response is worth re-asking once — but only once: this is a nicety, not the plan.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await model.complete({
        model: modelName, system: PHRASING_SYSTEM,
        messages: [{ role: 'user', content: user }], maxTokens: 1_500, temperature: 0.7,
      });
      const titles = parsePhrasing(res.content);
      const invalid = validatePhrasing(beats, titles);
      if (invalid) { lastReason = invalid; onWarn?.(`draft phrasing attempt ${attempt} rejected: ${invalid}`); continue; }
      return { titles, outcome: 'phrased' };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
      onWarn?.(`draft phrasing attempt ${attempt} failed: ${lastReason}`);
    }
  }

  return { titles: new Map(), outcome: 'fallback', reason: lastReason };
}

/** Apply phrased titles to beats, keeping the deterministic title wherever one is absent. */
export function applyPhrasing(beats: DraftBeat[], result: PhrasingResult): DraftBeat[] {
  if (result.outcome === 'fallback') return beats;
  return beats.map((b) => ({ ...b, title: result.titles.get(b.position) ?? b.title }));
}
