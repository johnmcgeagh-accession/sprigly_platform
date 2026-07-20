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

    case 'emphasis_reweight':
      // Deliberately cites the client's own words and NOTHING about the old pillar. The
      // metrics that used to justify this beat described a pillar it no longer has.
      return evidence.reason
        ? `Leaned this way because you said: \u201C${evidence.reason}\u201D.`
        : 'You asked us to lean the month this way.';

    case 'template':
      // Deliberately names the gap. The client should know when we are working from a
      // starting shape rather than from their own numbers.
      return 'We don’t have enough of your posting history yet, so this is a starting shape rather than a pattern we’ve seen work.';

    case 'observed': {
      const parts: string[] = [];

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
