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
import type { BeatEvidence } from '@/lib/types';

const FORMAT_WORD: Record<string, string> = {
  reel:     'reels',
  carousel: 'carousels',
  single:   'single posts',
};

const formatWord = (f: string): string => FORMAT_WORD[f] ?? `${f} posts`;

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
