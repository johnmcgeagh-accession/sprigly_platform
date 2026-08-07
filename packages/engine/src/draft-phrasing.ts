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
 * ── What changed, and why "narrow" is not the same as "empty" ─────────────────
 *
 * The pass used to be handed one line per beat — a pillar name, a format word, and a
 * percentage — under a blanket ban on naming anything. Given a pillar tagline and a
 * prohibition on specificity, a paraphrase of the tagline is the ONLY legal output, and
 * that is exactly what a month of it looked like: thirty beats reading "Fewer decisions,
 * better mornings" (docs/reports/beat-grounding.md §1.4). The generic month was the
 * contract working as written on an input that contained nothing else.
 *
 * So the evidence now travels. Every field the beat already carries — format engagement
 * and its sample, pillar share, cadence, slot type, the catalogue coverage gap, the
 * recurring series — is stated in the prompt, and the ban is relaxed to exactly what the
 * beat itself holds:
 *
 *   a title may name the ONE product in ITS OWN productCoverage, and no other;
 *   a title may name the ONE series in ITS OWN seriesDue, and no other.
 *
 * That is a per-beat licence checked against a per-beat fact, not a global allow. A beat
 * with no productCoverage naming a product is still a fabrication and still fails the
 * whole batch. Dates, launches, restocks, prices and metrics stay banned outright: no
 * beat carries evidence for any of them, so there is nothing to relax them against.
 *
 * ONE call per draft, not per beat: the model sees the whole month, so titles vary
 * against each other instead of converging on the same shape 17 times.
 *
 * Never blocks. Retry once, then fall back to the deterministic titles. A draft with
 * plain titles is a working draft; a draft that failed to assemble is nothing. The
 * deterministic titles are themselves grounded now (draft-assembly.ts: a series beat is
 * titled for its series, a backlog beat for the client's own words, a coverage beat for
 * its product), so a fallback month is a concrete month, not a pillar month.
 */
import type { DraftBeat } from './draft-assembly.js';
import { seriesMatchTerms, mentionsTerm } from './draft-recurring.js';
import { parseLastJsonObject } from './json-salvage.js';

export interface PhrasingModel {
  complete(params: {
    model: string; system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number; temperature?: number;
  }): Promise<{ content: string; inputTokens: number; outputTokens: number; modelId: string }>;
}

/**
 * The names a title could plausibly claim, so validatePhrasing can tell "named the product
 * this beat is about" from "named a different one".
 *
 * Both lists are ALLOWLISTS OF THINGS TO POLICE, not things to permit — a name appearing
 * here is checked against the beat's own evidence, and a name absent from here is invisible
 * to the check. That asymmetry is why the caller must exclude ambiguous names before
 * passing them in (draft-plan.ts): "Joy" is a real ivy-t product AND a word she writes in
 * four captions, and policing it would reject an honest title for using an ordinary word.
 */
export interface PhrasingVocabulary {
  /** Catalogue product names. A title may use one only if it is that beat's productCoverage. */
  productNames?: readonly string[];
  /** Configured recurring series names. Same rule, against that beat's seriesDue. */
  seriesNames?:  readonly string[];
}

export const PHRASING_SYSTEM = `You write short content-beat titles for a social media plan.

You will be given a list of beats. Each has a pillar, a format, and the structured evidence it was chosen on. Some beats also name a PRODUCT or a recurring SERIES. You will also be given a short summary of the brand's voice.

Write ONE title per beat, in the brand's voice, 3-8 words.

ABSOLUTE RULES — these are not style preferences:
- Restate ONLY what THAT BEAT's evidence gives you.
- If a beat names a PRODUCT, you MAY use that product's name, spelled exactly as given. You may NOT name any other product, and you may NOT name a product on a beat that gives you none.
- If a beat names a SERIES, you MAY use that series' name, spelled exactly as given. You may NOT name a series on a beat that gives you none.
- NEVER name a colourway, a collection, or a price.
- NEVER state a metric, a number, a percentage, or a performance claim. The engagement figures are context for YOUR choice of subject; they are not material for the title.
- NEVER promise a launch, a restock, a sale, an offer, or an event, and never name a date or a month.
- A beat marked KEEP AS IS is the client's own wording. Do not write a title for it. It is listed so your other titles do not repeat it.
- If you have nothing specific to say about a beat, write a plain title from its pillar. A plain title is correct; an invented one is a failure.

Return ONE JSON object and nothing else, no markdown, no code fences:
{"titles":[{"position":0,"title":""}]}
One entry per beat you were asked to write, using the position number given.`;

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

/**
 * Is this beat's title the client's own words, to be left exactly as it is?
 *
 * True for an experiment slot filled by a CLIENT-origin candidate: the whole point of such a
 * beat is that the client recognises the sentence they sent us (experimentTitle,
 * draft-assembly.ts). Letting the model paraphrase it would quietly undo that — they would
 * read our words back and have no way to tell we had used their idea at all.
 *
 * The predicate deliberately mirrors the immunity replacementTier already grants the same
 * beats (draft-transforms.ts:122-123): the client's hand outranks the machine, in the
 * replacement pool and in the phrasing pass alike.
 */
export function isTitleFixed(beat: DraftBeat): boolean {
  const meta = beat.beatMeta;
  return meta.slotType === 'experiment'
      && meta.rationaleEvidence.candidateRank?.origin === 'client';
}

/**
 * Parse `{"titles":[{position,title}]}`, tolerant of fences, surrounding prose and a model
 * self-correction (the last complete object wins — see json-salvage.ts).
 */
export function parsePhrasing(text: string): Map<number, string> {
  const parsed = parseLastJsonObject(text) as { titles?: unknown };
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
 * Naming a thing — the boundary rule and the series-name expansion — belongs to
 * draft-recurring.ts, which is where a series name is defined. Both are used here so that
 * "the title named this series" means exactly what it means when the history matcher decides
 * "this past post WAS this series".
 */
const mentions = mentionsTerm;

/** term (as written) → the canonical configured name it stands for. */
function seriesTermIndex(names: readonly string[]): Array<{ term: string; name: string }> {
  const out: Array<{ term: string; name: string }> = [];
  for (const name of names) for (const term of seriesMatchTerms(name)) out.push({ term, name });
  // Longest term first so "Weekend Style Guide" is reported before a shorter overlapping one.
  return out.sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Validate the model's output against its contract: EVERY beat phrased, and NOTHING
 * introduced. Returns the offending reason, or null when the output is acceptable.
 *
 * Three checks, in order of how badly they break trust:
 *   1. every beat that WANTED a title got one (fixed-title beats are exempt — see isTitleFixed);
 *   2. no title names a product or series the BEAT ITSELF does not carry;
 *   3. no title trips the outright bans (dates, launches, prices, metrics).
 *
 * Rejecting the whole batch on one bad title is deliberate. A model that invented a
 * launch for beat 7 was not reasoning within its evidence for beats 1-6 either; taking
 * the good ones and dropping the bad would leave output we have no basis to trust.
 */
export function validatePhrasing(
  beats: DraftBeat[], titles: Map<number, string>, vocab: PhrasingVocabulary = {},
): string | null {
  const products = vocab.productNames ?? [];
  const series   = seriesTermIndex(vocab.seriesNames ?? []);

  for (const beat of beats) {
    const title = titles.get(beat.position);
    if (isTitleFixed(beat)) continue;                  // the client's words; nothing to check
    if (!title) return `beat ${beat.position} was not phrased`;

    const ev = beat.beatMeta.rationaleEvidence;

    // A named product must be THIS beat's product. Absence of productCoverage is itself the
    // answer: a beat with no coverage evidence may name no product at all.
    const own = ev.productCoverage?.product;
    for (const name of products) {
      if (!mentions(title, name)) continue;
      if (own && sameName(own, name)) continue;
      return own
        ? `beat ${beat.position} named "${name}", but its evidence is for "${own}": "${title}"`
        : `beat ${beat.position} named product "${name}", which is not in its evidence: "${title}"`;
    }

    const ownSeries = ev.seriesDue?.name;
    for (const { term, name } of series) {
      if (!mentions(title, term)) continue;
      if (ownSeries && sameName(ownSeries, name)) continue;
      return ownSeries
        ? `beat ${beat.position} named series "${name}", but its evidence is for "${ownSeries}": "${title}"`
        : `beat ${beat.position} named series "${name}", which is not in its evidence: "${title}"`;
    }

    for (const pattern of FORBIDDEN) {
      if (pattern.test(title)) return `beat ${beat.position} introduced content not in its evidence: "${title}"`;
    }
  }
  return null;
}

/** "31.9 across 86 posts" — a figure never travels without the sample behind it. */
const sample = (n: number): string => `${n} post${n === 1 ? '' : 's'}`;

/**
 * One prompt line per beat, carrying every field that beat actually holds.
 *
 * Order matters: the SUBJECT (series, product, or the client's own words) leads, because it
 * is what the title is about; the metrics follow as the reason the slot exists. A beat with
 * no subject gets the pillar and nothing more, which is the honest description of it.
 */
function beatLines(beats: DraftBeat[]): string[] {
  return beats.map((b) => {
    if (isTitleFixed(b)) {
      return `- position ${b.position}: KEEP AS IS — the client's own words: "${b.title}"`;
    }

    const ev = b.beatMeta.rationaleEvidence;
    const head: string[] = [`- position ${b.position}: pillar "${b.pillar}", format "${b.format}"`];

    if (ev.seriesDue) {
      const { name, dayOfWeek, lastPlanned, monthsObserved } = ev.seriesDue;
      head.push(`SERIES "${name}" (${dayOfWeek}) — you may name it`);
      head.push(lastPlanned
        ? `last planned ${lastPlanned}, seen in ${monthsObserved} month${monthsObserved === 1 ? '' : 's'}`
        : 'never planned before');
    }
    if (ev.productCoverage) {
      const { product, lastFeatured, mentions: n } = ev.productCoverage;
      head.push(`PRODUCT "${product}" — you may name it, spelled exactly`);
      head.push(lastFeatured
        ? `last in a caption on ${lastFeatured}, ${n} caption${n === 1 ? '' : 's'} in all`
        : 'never appeared in a caption');
    }

    const why: string[] = [];
    if (ev.basis === 'template') {
      why.push(`no history to draw on${ev.reason ? ` (${ev.reason})` : ''} — keep this title plain`);
    } else {
      if (ev.pillarShare !== undefined) why.push(`this pillar is ${Math.round(ev.pillarShare * 100)}% of their posting`);
      const fe = ev.formatEngagement;
      if (fe && fe.posts > 0) why.push(`${fe.format}s average ${fe.avgEngagement} likes+comments over ${sample(fe.posts)}`);
      const cb = ev.cadenceBasis;
      if (cb) why.push(`cadence ${cb.postsPerWeek}/week (${cb.source}, ${cb.months} month${cb.months === 1 ? '' : 's'})`);
    }
    if (b.beatMeta.slotType === 'experiment') why.push('this is an experiment slot, not a proven one');

    return `${head.join('; ')}${why.length ? `\n    evidence: ${why.join('; ')}` : ''}`;
  });
}

function buildUserMessage(beats: DraftBeat[], voiceSummary: string | null): string {
  const wanted = beats.filter((b) => !isTitleFixed(b));
  return [
    voiceSummary ? `BRAND VOICE:\n${voiceSummary}` : 'BRAND VOICE: (unavailable — keep titles plain and neutral.)',
    '',
    `BEATS (${beats.length}):`,
    ...beatLines(beats),
    '',
    `Write one title for each of the ${wanted.length} positions above that is NOT marked KEEP AS IS. JSON only.`,
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
  vocab?:       PhrasingVocabulary;
  modelName?:   string;
  onWarn?:      (message: string) => void;
}): Promise<PhrasingResult> {
  const { beats, voiceSummary, model, vocab = {}, modelName = 'sonnet', onWarn } = params;
  if (beats.length === 0) return { titles: new Map(), outcome: 'phrased' };
  // Every beat carries the client's own words — there is nothing for the model to write.
  if (beats.every(isTitleFixed)) return { titles: new Map(), outcome: 'phrased' };

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
      const invalid = validatePhrasing(beats, titles, vocab);
      if (invalid) { lastReason = invalid; onWarn?.(`draft phrasing attempt ${attempt} rejected: ${invalid}`); continue; }
      return { titles, outcome: 'phrased' };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
      onWarn?.(`draft phrasing attempt ${attempt} failed: ${lastReason}`);
    }
  }

  return { titles: new Map(), outcome: 'fallback', reason: lastReason };
}

/**
 * Apply phrased titles to beats, keeping the deterministic title wherever one is absent.
 *
 * A fixed-title beat is never replaced, even if the model returned something for it: the
 * guarantee that the client reads their own sentence back cannot depend on the model having
 * followed an instruction.
 */
export function applyPhrasing(beats: DraftBeat[], result: PhrasingResult): DraftBeat[] {
  if (result.outcome === 'fallback') return beats;
  return beats.map((b) => (isTitleFixed(b) ? b : { ...b, title: result.titles.get(b.position) ?? b.title }));
}
