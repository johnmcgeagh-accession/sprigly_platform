/**
 * draft-rationale.ts — turn a beat's structured evidence into a sentence.
 *
 * TEMPLATES OVER STRUCTURED FIELDS. No model, no free text, no generation of any kind.
 * The evidence is the source of truth; this file only chooses the words to read it out in.
 * That is the whole contract of the arc: rationales are computed evidence phrased at most,
 * never model narration.
 *
 * The rule that governs every branch: say only what the evidence contains. Where a field
 * is absent, the sentence gets shorter — it never gets filled in. A beat with no evidence
 * says so plainly rather than reaching for a plausible-sounding reason, because a client
 * who catches one invented rationale has no reason to trust any of the others.
 *
 * Pure. Directly testable. No React.
 */
import type { BeatEvidence, DraftBeatView } from '@/lib/types';

const FORMAT_WORD: Record<string, string> = {
  reel:     'reels',
  carousel: 'carousels',
  single:   'single posts',
};

const formatWord = (f: string): string => FORMAT_WORD[f] ?? `${f} posts`;

/** The singular of the same word. The summary counts formats, and a month holding one of a kind
 *  must say "1 carousel" — the acceptance run said "1 carousels", which is the sort of seam a
 *  client reads as carelessness on the one panel built to be checked. */
const FORMAT_ONE: Record<string, string> = {
  reel:     'reel',
  carousel: 'carousel',
  single:   'single post',
};

const formatCount = (f: string, n: number): string =>
  `${n} ${n === 1 ? (FORMAT_ONE[f] ?? `${f} post`) : formatWord(f)}`;

/** "3 posts" / "1 post" — the sample size, stated so the client can judge it themselves. */
const posts = (n: number): string => `${n} post${n === 1 ? '' : 's'}`;

/** '2026-07-26' → '26 July'. Returns null for anything that is not an ISO date, so a
 *  malformed value produces a shorter sentence rather than "Invalid Date". */
function shortDate(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
}

/**
 * The reason a recurring-series beat is here: their own standing feature, and when it last ran.
 *
 * Leads every other clause on a series beat. "Sunday Style runs on Sundays" is a fact about a
 * commitment they made; "carousels average 32 likes" is a fact about their feed. On a slot that
 * exists because of the first, opening with the second buries it.
 *
 * A series that has never been planned says so. It is a weaker claim than a date, and pretending
 * otherwise — by omitting the clause, or by reaching for a date we do not have — is exactly the
 * failure the evidence contract exists to prevent.
 */
function seriesClause(s: NonNullable<BeatEvidence['seriesDue']>): string {
  const when = s.lastPlanned ? shortDate(s.lastPlanned) : null;
  const cadence = s.dayOfWeek === 'monthly' ? 'runs monthly' : `runs on ${s.dayOfWeek}s`;
  if (!when) return `${s.name} ${cadence}, and hasn’t run yet`;
  const over = s.monthsObserved > 0
    ? ` — we’ve planned it in ${s.monthsObserved} of your recent month${s.monthsObserved === 1 ? '' : 's'}`
    : '';
  return `${s.name} ${cadence}; it last ran on ${when}${over}`;
}

/**
 * How much of the client's own sentence a card quotes back.
 *
 * A single instruction is short — "The Wilderness candle relaunches on the 24th, can we build up
 * to it?" is 74 characters. A segment of a pasted brief can be much longer: Sally's August brief
 * ran ~700 words across 14 instructions, and one of its segments is a 200-character paragraph.
 * A card has two lines. 120 characters is roughly those two lines at 13.5px on a 350px measure.
 */
const QUOTE_MAX = 120;

/** Trim to a word boundary, never mid-word, and only when it is actually too long. */
function trimQuote(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= QUOTE_MAX) return t;
  const cut = t.slice(0, QUOTE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > QUOTE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * The reason a coverage beat is here: their own product, and how long since they last posted
 * about it.
 *
 * This is the strongest sentence the assembler can write, because it is checkable in one
 * scroll of their own feed. "Jules — not featured since 3 February" is a claim they can
 * falsify in ten seconds, which is exactly why it is worth making.
 *
 * NEVER FEATURED is its own clause, not a date-shaped hole. `lastFeatured: null` says the
 * product has no captions at all, and the mention count is not repeated after it — "0
 * mentions" adds nothing to "hasn't appeared".
 */
function productClause(p: NonNullable<BeatEvidence['productCoverage']>): string {
  if (p.lastFeatured === null) return `${p.product} hasn’t appeared in any of your captions`;
  const when = shortDate(p.lastFeatured);
  if (!when) return `${p.product} hasn’t appeared in your captions for a while`;
  const sample = ` (${p.mentions} caption${p.mentions === 1 ? '' : 's'} in the history we have)`;
  return `you haven’t posted about ${p.product} since ${when}${sample}`;
}

/** '2026-06-14' → 'June'. null for anything that is not an ISO date. */
function monthName(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/**
 * A product's coverage gap, split into the CLAIM and its SAMPLE SIZE.
 *
 * Two readings need this fact at two lengths — the sheet, studying one beat, wants the caption
 * count with it; the month summary, listing ten products at once, does not. Splitting it here
 * rather than writing it twice makes the summary's line a literal PREFIX of the sheet's, so a
 * client who reads both reads the same sentence and can never be shown two different dates for
 * the same product (S3). It is pinned that way in the tests.
 *
 * NEVER FEATURED is its own claim and carries no sample: "0 captions" adds nothing to "never
 * appeared", and a date-shaped hole would be worse than either.
 */
function productCoverageFact(p: NonNullable<BeatEvidence['productCoverage']>): { claim: string; sample: string } {
  const when = p.lastFeatured ? shortDate(p.lastFeatured) : null;
  return when
    ? { claim: `${p.product} — last in a caption on ${when}`, sample: ` (${p.mentions} caption${p.mentions === 1 ? '' : 's'})` }
    : { claim: `${p.product} — never appeared in a caption`, sample: '' };
}

/**
 * Did this beat come from something the client sent us?
 *
 * The summary counts exactly the beats whose SHEET shows her own words, which is why this is a
 * predicate rather than a second reading of the evidence: `groundingLines` and the count cannot
 * drift apart if they ask the same question. A beat carrying both a backlog idea and a reason
 * renders two lines on the sheet and counts once here — the count is of beats, not of lines.
 */
function fromClient(e: BeatEvidence): boolean {
  if (e.backlogIdea?.text?.trim()) return true;
  return (e.basis === 'client_input' || e.basis === 'emphasis_reweight') && !!e.reason?.trim();
}

/** One fact behind a beat. `kind` keys the list and tells the sheet what to draw. */
export interface GroundingLine {
  kind: 'series' | 'product' | 'backlog' | 'format' | 'cadence' | 'pillar' | 'thin' | 'added';
  text: string;
  /** The client's own words, rendered as a quotation under `text`. */
  quote?: string;
}

/**
 * Every fact behind a beat, one per line — the sheet's reading of the same evidence
 * `rationaleFor` compresses into a sentence for the card.
 *
 * TWO READINGS, ONE SOURCE. The card has three clamped lines and needs a sentence; the sheet
 * has the room and the client is there to study it, so it gets the facts separately, each one
 * checkable on its own. Both derive from `rationaleEvidence` and neither adds anything to it.
 * A second function rather than a formatting flag because they genuinely differ in shape, and
 * a shared one would end up serving neither.
 *
 * ABSENCE IS A VALUE, and it is the whole discipline of this file: a field that is not there
 * produces NO LINE. Not a zero, not "no data", not a hedge. An empty array means the beat has
 * nothing to show and the sheet shows nothing, which is the honest rendering of a beat we
 * cannot justify.
 *
 * Order is fixed and meaningful: the standing commitment, then the product gap, then her own
 * words, then the measurements. Strongest and most specific first.
 */
export function groundingLines(evidence: BeatEvidence, pillar: string): GroundingLine[] {
  const out: GroundingLine[] = [];

  if (evidence.basis === 'client_added') {
    return [{ kind: 'added', text: 'You added this one yourself.' }];
  }

  // A beat a transform built from something she wrote. Her sentence is the whole reason.
  if ((evidence.basis === 'client_input' || evidence.basis === 'emphasis_reweight') && evidence.reason?.trim()) {
    out.push({
      kind: 'backlog',
      text: evidence.basis === 'client_input' ? 'From what you told us' : 'You asked us to lean the month this way',
      quote: evidence.reason.trim(),
    });
  }

  const s = evidence.seriesDue;
  if (s) {
    const cadence = s.dayOfWeek === 'monthly' ? 'monthly' : 'weekly';
    const when = s.lastPlanned ? shortDate(s.lastPlanned) : null;
    out.push({ kind: 'series', text: `${s.name} — ${cadence}; ${when ? `last ran ${when}` : 'hasn’t run yet'}` });
  }

  const p = evidence.productCoverage;
  if (p) {
    const { claim, sample } = productCoverageFact(p);
    out.push({ kind: 'product', text: `${claim}${sample}` });
  }

  // Her backlog sentence, and when she sent it. `sourceRef` points at the plan_inputs row and
  // a client surface cannot go and fetch it, which is why the text travels on the beat.
  const idea = evidence.backlogIdea;
  if (idea?.text?.trim()) {
    const month = idea.givenAt ? monthName(idea.givenAt) : null;
    out.push({
      kind: 'backlog',
      text: month ? `From what you told us in ${month}` : 'From what you told us',
      quote: idea.text.trim(),
    });
  }

  const fe = evidence.formatEngagement;
  if (fe && fe.posts > 0) {
    const word = formatWord(fe.format);
    out.push({
      kind: 'format',
      text: `${word.charAt(0).toUpperCase()}${word.slice(1)} average ${Math.round(fe.avgEngagement)} likes and comments across your last ${posts(fe.posts)}`,
    });
  }

  const share = evidence.pillarShare;
  if (typeof share === 'number' && share > 0 && pillar) {
    out.push({ kind: 'pillar', text: `${pillar} is about ${Math.round(share * 100)}% of what you post` });
  }

  const cb = evidence.cadenceBasis;
  if (cb && cb.postsPerWeek > 0) {
    out.push({
      kind: 'cadence',
      text: cb.source === 'observed'
        ? `You post about ${cb.postsPerWeek} times a week, measured over ${cb.months} month${cb.months === 1 ? '' : 's'} of your feed`
        : `Planned at ${cb.postsPerWeek} posts a week, the rate set on your account`,
    });
  }

  if (evidence.basis === 'template') {
    out.push({
      kind: 'thin',
      text: 'We don’t have enough of your posting history yet, so this month uses a starting shape rather than a pattern we’ve seen work.',
    });
  }

  return out;
}

// ── The month's own account of itself ────────────────────────────────────────────────
//
// A client landing on a draft month sees thirty title-only rows and can read it as unfinished
// work. It is not: a draft is a DIRECTION OF TRAVEL, and the captions, hooks and scripts are
// written after it is agreed. The summary says that in one place, and states the month's
// argument where the reasoning is not otherwise reachable except per-beat behind an icon.
//
// SAME RULE AS `groundingLines`, and the same module on purpose (S3): every line is computed
// from the beats' own evidence, there is no model prose on this path, and a fact that is not in
// the evidence produces NO LINE. A thin month says less; it never pads. The two renderings share
// the derivation — `productCoverageFact` and `fromClient` above are read by both — so the panel
// and the sheet cannot show a client two different versions of the same fact.

/**
 * One row of the summary.
 *
 * `count` is set only where the fact IS a count (a pillar's share of the month), so the number
 * can sit in its own column instead of inside the sentence.
 *
 * `answerable` marks the one row the client can DO something about. Its `text` is already the
 * question form (`assumptionPrompt`), because that is what the day's strip showed before this
 * panel absorbed it — the affordance moved, the wording did not.
 */
export interface SummaryFact { text: string; count?: string; answerable?: boolean }

export type SummaryKey = 'mix' | 'series' | 'products' | 'client' | 'assumptions';

/** A group of rows under one heading. A section with no facts is never built. */
export interface SummarySection { key: SummaryKey; heading: string; facts: SummaryFact[] }

export interface MonthSummary {
  /** The two-line collapsed form's first line: how much, over how long. */
  headline: string;
  /** What a draft IS and what happens when it is agreed. Null on a month that can no longer be
   *  worked on, where the promise would not be true. */
  stage: string | null;
  sections: SummarySection[];
}

const DAY_MS = 86_400_000;

/** The Monday that starts this date's week. Null for anything that is not an ISO date, so a
 *  malformed row is left out of the week count rather than inventing a week. */
function weekStartOf(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const back = (d.getUTCDay() + 6) % 7;           // Monday = 0
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** 'June and July' / 'June, July and August'. Never an Oxford comma — this is her register. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Count occurrences, then order by count descending and name ascending — a total order, so the
 *  same month always renders the same way. */
function tally(values: readonly string[]): { name: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/**
 * The month, read out of its own beats.
 *
 * Returns null for a month with nothing in it: an empty month has no argument to state, and a
 * panel saying "0 planned posts across 0 weeks" spends the top of the screen to say nothing.
 *
 * THE ASSUMPTIONS ARE ALL HERE NOW. They used to be split: one re-voiced as a tappable question
 * at the foot of the day, the rest stated in this panel. The day's strip is gone (M4), so the
 * panel carries the whole set and the question travels with them — see the assumptions block.
 */
export function monthSummary(
  beats: readonly DraftBeatView[],
  opts: { monthName: string; editable: boolean },
): MonthSummary | null {
  if (beats.length === 0) return null;

  const weeks = new Set(beats.map((b) => weekStartOf(b.date)).filter((w): w is string => w !== null)).size;
  const n = beats.length;
  const headline = weeks > 0
    ? `${n} planned post${n === 1 ? '' : 's'} across ${weeks} week${weeks === 1 ? '' : 's'}`
    : `${n} planned post${n === 1 ? '' : 's'}`;

  const sections: SummarySection[] = [];

  // ── The mix ────────────────────────────────────────────────────────────────────────
  // Format first (one line, two or three words) and the pillars under it, each with its count
  // in its own column. The counts are the client's own categories, so they are stated as
  // counts and not as percentages: 5 of 30 is checkable, 16.7% is arithmetic.
  const mix: SummaryFact[] = [];
  const formats = tally(beats.map((b) => b.format).filter(Boolean));
  if (formats.length > 0) mix.push({ text: formats.map((f) => formatCount(f.name, f.n)).join(' · ') });
  for (const p of tally(beats.map((b) => b.pillar).filter(Boolean))) mix.push({ text: p.name, count: String(p.n) });
  if (mix.length > 0) sections.push({ key: 'mix', heading: 'The mix', facts: mix });

  // ── The standing commitments ───────────────────────────────────────────────────────
  // What the client already runs every week, and how many instances this month holds. The full
  // configured name, matching the sheet's grounding line rather than the title's shorthand —
  // this is a fact panel, and it is the right place to spell the name out.
  const series = new Map<string, { day: string; n: number }>();
  for (const b of beats) {
    const s = b.evidence.seriesDue;
    if (!s?.name) continue;
    const prev = series.get(s.name);
    series.set(s.name, { day: prev?.day ?? s.dayOfWeek, n: (prev?.n ?? 0) + 1 });
  }
  if (series.size > 0) {
    sections.push({
      key: 'series',
      heading: 'The ones that always run',
      facts: [...series.entries()]
        .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
        .map(([name, { day, n }]) => ({
          text: day && day !== 'monthly'
            ? `${name} — ${n} ${day}${n === 1 ? '' : 's'}`
            : `${name} — ${n === 1 ? 'once' : `${n} times`} this month`,
        })),
    });
  }

  // ── The products, and why each one ─────────────────────────────────────────────────
  // The strongest claim in the panel, because every line is falsifiable in one scroll of her own
  // feed. Ordered the way the assembler orders them — never-featured first, then oldest gap
  // first, then by name — so the panel's reading and the engine's cannot disagree either.
  const products = new Map<string, NonNullable<BeatEvidence['productCoverage']>>();
  for (const b of beats) {
    const p = b.evidence.productCoverage;
    if (p?.product && !products.has(p.product)) products.set(p.product, p);
  }
  if (products.size > 0) {
    const ordered = [...products.values()].sort((a, b) =>
      (a.lastFeatured === null ? 0 : 1) - (b.lastFeatured === null ? 0 : 1)
      || (a.lastFeatured ?? '').localeCompare(b.lastFeatured ?? '')
      || a.product.localeCompare(b.product));
    sections.push({
      key: 'products',
      heading: 'What we’re featuring, and why',
      // The CLAIM only. The caption count stays on the sheet, where one beat is being studied;
      // ten of them here would be ten numbers nobody is comparing.
      facts: ordered.map((p) => ({ text: productCoverageFact(p).claim })),
    });
  }

  // ── Her own ideas ──────────────────────────────────────────────────────────────────
  // Counted by the same predicate the sheet uses, so this number is exactly "how many beats show
  // your words when you open them". The months come from the ideas that carry a date; where none
  // does, the line simply stops — it never guesses when she sent them.
  const hers = beats.filter((b) => fromClient(b.evidence));
  if (hers.length > 0) {
    const dated = hers
      .map((b) => b.evidence.backlogIdea?.givenAt)
      .filter((g): g is string => typeof g === 'string' && !!monthName(g))
      .sort();
    const months: string[] = [];
    for (const g of dated) {
      const name = monthName(g)!;
      if (!months.includes(name)) months.push(name);
    }
    const when = months.length > 0 ? ` in ${andList(months)}` : '';
    sections.push({
      key: 'client',
      heading: 'From you',
      facts: [{ text: `${hers.length} idea${hers.length === 1 ? '' : 's'} you gave us${when}` }],
    });
  }

  // ── What we assumed ────────────────────────────────────────────────────────────────
  //
  // The WHOLE set now, in the assembler's own words, because the day's strip that used to carry
  // one of them is gone (M4). The affordance came with them rather than being dropped: the one
  // assumption `firstAnswerable` ranks highest is re-voiced as its question and marked
  // `answerable`, which is exactly what the strip did — same predicate, same ranking, same
  // wording, a different place on the screen.
  //
  // ONE QUESTION, not one per assumption. The strip had a single slot and that forced a ranking;
  // the panel has room and could ask them all. It deliberately does not. Asking a client three
  // things at once is a different act from asking them one, and widening it is a decision about
  // how much to demand of them — not a consequence of moving a control.
  //
  // The question sorts LAST so the two tappable rows in the panel — this and the shaping prompt
  // under it — sit together, and the statements read as statements above them.
  const seen: string[] = [];
  for (const b of beats) for (const a of b.assumptions) {
    const t = a.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  if (seen.length > 0) {
    // Only on a month that can still be changed: a question the client cannot act on is a dead
    // prompt, and the strip was never rendered on a closed month either.
    const askable = opts.editable ? firstAnswerable(seen) : null;
    sections.push({
      key: 'assumptions',
      heading: 'What we assumed',
      facts: [
        ...seen.filter((t) => t !== askable).map((text) => ({ text })),
        ...(askable ? [{ text: assumptionPrompt(askable), answerable: true }] : []),
      ],
    });
  }

  return {
    headline,
    // Only where it is true. A draft past its cutoff cannot be turned into captions by agreeing
    // to it, and promising that it can would be the one dishonest line in a panel built to be
    // checkable.
    stage: opts.editable ? `This is the shape of ${opts.monthName} — once you’re happy, we’ll write every post.` : null,
    sections,
  };
}

/**
 * The one-line reason this beat is here.
 *
 * Returns '' when the evidence supports nothing sayable — the caller renders no rationale
 * at all rather than a hedge. Silence is honest; "chosen to balance your content" is not.
 */
export function rationaleFor(evidence: BeatEvidence, pillar: string): string {
  switch (evidence.basis) {
    case 'client_added':
      return 'You added this one.';

    /**
     * The strongest rationale in the system, and until now the only one rendering blank.
     *
     * Spec gap 4. Every post a launch / event / series / beat_spec transform creates carries
     * `{basis:'client_input', reason: sourceText}` — the client's own words, stored, verbatim.
     * There was no branch for it, so it fell through to '' and those posts — the ones that came
     * from something the client actually said — showed NO reason at all, while a hand-added post
     * said "You added this one."
     *
     * Quoting them back is not decoration. Every other branch here is us telling the client
     * something about their feed that they have to take on trust; this one is us showing them
     * their own sentence and saying *this is why*. It is the cheapest fix in the gap list and the
     * one with the largest effect on whether a client believes the rest.
     *
     * A `client_input` beat with no recorded text says nothing rather than inventing a sentence —
     * the same rule every other branch follows.
     */
    case 'client_input':
      return evidence.reason?.trim()
        ? `From what you told us: “${trimQuote(evidence.reason)}”`
        : '';

    case 'emphasis_reweight':
      // Deliberately cites the client's own words and NOTHING about the old pillar. The
      // metrics that used to justify this beat described a pillar it no longer has.
      return evidence.reason
        ? `Leaned this way because you said: \u201C${evidence.reason}\u201D.`
        : 'You asked us to lean the month this way.';

    case 'template':
      // A configured series survives the thin-history path — it is a standing commitment, not
      // an inference — so it still gets its sentence. Saying only "we don't have enough
      // history" on a Sunday Style beat would withhold the one thing we do know about it.
      {
        // A series and a caption date are both FACTS, not inferences from posting patterns.
        // Thin history is no reason to withhold either — saying only "we don't have enough
        // history" would drop the one checkable thing this beat knows about itself.
        const kept = [
          ...(evidence.seriesDue ? [seriesClause(evidence.seriesDue)] : []),
          ...(evidence.productCoverage ? [productClause(evidence.productCoverage)] : []),
        ];
        if (kept.length === 0) {
          return 'We don’t have enough of your posting history yet, so this is a starting shape rather than a pattern we’ve seen work.';
        }
        const [first, ...rest] = kept;
        const sentence = [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join('; ');
        return `${sentence}. We don’t have enough of your posting history yet to say more.`;
      }

    case 'observed': {
      const parts: string[] = [];

      // A standing commitment leads. See seriesClause.
      if (evidence.seriesDue) parts.push(seriesClause(evidence.seriesDue));

      // Then the product gap — the one claim on the card they can check against their own feed.
      if (evidence.productCoverage) parts.push(productClause(evidence.productCoverage));

      const fe = evidence.formatEngagement;
      if (fe && fe.posts > 0) {
        parts.push(`${formatWord(fe.format)} average ${Math.round(fe.avgEngagement)} likes and comments across your last ${posts(fe.posts)}`);
      }

      const share = evidence.pillarShare;
      if (typeof share === 'number' && share > 0 && pillar) {
        parts.push(`${pillar} is about ${Math.round(share * 100)}% of what you post`);
      }

      const cr = evidence.candidateRank;
      if (cr) {
        parts.push(cr.origin === 'client'
          ? 'this came from an idea you sent us'
          : 'this came from something working for a competitor');
      }

      if (parts.length === 0) return '';
      // Sentence-case the first clause, join the rest with a semicolon so each claim stays
      // separately checkable rather than blurring into one assertion.
      const [first, ...rest] = parts;
      const sentence = [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join('; ');
      return `${sentence}.`;
    }

    default:
      return '';
  }
}

/**
 * The short label under a beat's date — what KIND of slot this is.
 * Experiment slots are labelled so the client can tell a bet from a safe pick.
 */
export function slotLabel(slotType: 'proven' | 'experiment'): string | null {
  return slotType === 'experiment' ? 'Something new' : null;
}

/**
 * Turn an assumption into the question it implies.
 *
 * Build B renders these as prompts but does NOT accept answers — answering is Build C.
 * They are phrased as questions anyway, because an assumption the client can see but not
 * correct is at least an assumption they can correct by email, and phrasing it as a
 * statement would read as a decision already made.
 */
/**
 * Is this assumption one the client can DO something about?
 *
 * The assembler attaches the same list to every planned post, and the surface shows the ONE a
 * client can act on rather than all of them (spec §2). The dividing line is not how important
 * the assumption is — it is whose fact it states:
 *
 *   answerable    a gap in what WE KNOW ABOUT THEIR MONTH. "Nothing's launching?" "Want
 *                 particular products featured?" "Want the pillars weighted differently?" Each
 *                 has an answer only they have, and the answer changes the plan.
 *   not answerable  a fact about OUR DATA. "Some older posts don't say what format they were."
 *                 True, worth recording, and a client can do precisely nothing with it. Showing
 *                 it as a nudge asks them to fix our bookkeeping.
 *
 * For Earl of East that keeps "nothing's launching this month" and drops "no pillar weights are
 * on record", which is the split spec §2 names by hand. This is that split as a rule, so a new
 * assumption from the assembler lands on the right side without anyone re-deriving it.
 *
 * An UNKNOWN assumption is treated as answerable. The failure modes are asymmetric: a needless
 * question costs a tap, and a suppressed one costs a month.
 */
export function isAnswerable(assumption: string): boolean {
  return !/format mix is based on/i.test(assumption.trim());
}

/**
 * How directly the client can act on each kind, best first.
 *
 * ORDER IS NOT THE ASSEMBLER'S. It attaches the same list to every planned post and nothing
 * about that list's order says which question is worth the one slot the surface has. Earl of
 * East's live October carries exactly two:
 *
 *   "No launches or restocks are on record for this month — the draft assumes a
 *    business-as-usual month."
 *   "No pillar weights are on record, so the month splits evenly across pillars."
 *
 * Spec §2 names that pair and rules: keep the first, drop the second. Both are answerable —
 * "want to weight it differently?" is a real question with a real transform behind it — so the
 * ruling is about PRIORITY, not about eligibility. A launch is a fact only the client has and it
 * reshapes the month; a pillar weighting is a preference they may not have thought about, and
 * asking it first spends the one slot on the smaller question.
 *
 * Anything unmatched sorts last but still qualifies: a needless question costs a tap, and a
 * suppressed one costs a month.
 */
const ANSWERABLE_RANK: RegExp[] = [
  /launches or restocks/i,   // "anything coming up?" — reshapes the month
  /catalogue/i,              // "want particular products featured?"
  /evenly across pillars/i,  // "want it weighted differently?"
  /posting history/i,        // "tell us what's worked before?"
];

/**
 * The one assumption worth surfacing, or null.
 *
 * The assembler attaches the same list to every planned post, so this belongs to the MONTH and
 * is shown once — never repeated on ten cards.
 */
export function firstAnswerable(assumptions: readonly string[]): string | null {
  const rank = (a: string): number => {
    const i = ANSWERABLE_RANK.findIndex((re) => re.test(a));
    return i === -1 ? ANSWERABLE_RANK.length : i;
  };
  const eligible = assumptions.filter(isAnswerable);
  if (eligible.length === 0) return null;
  // Stable within a rank: `sort` on a mapped index keeps the assembler's order as the tiebreak.
  return [...eligible.entries()].sort((a, b) => rank(a[1]) - rank(b[1]) || a[0] - b[0])[0]![1];
}

export function assumptionPrompt(assumption: string): string {
  const a = assumption.trim();
  if (/launches or restocks/i.test(a)) return 'We’ve assumed nothing’s launching this month — anything coming up?';
  if (/catalogue/i.test(a))            return 'We haven’t named specific products — want particular ones featured?';
  if (/posting history/i.test(a))      return 'We’re working from limited history — tell us what’s worked before?';
  if (/format mix is based on/i.test(a)) return 'Some older posts don’t say what format they were, so the mix is a best guess.';
  if (/evenly across pillars/i.test(a)) return 'We’ve split the month evenly across your pillars — want to weight it differently?';
  // Unknown assumption: show it verbatim rather than guessing at a question for it.
  return a;
}
