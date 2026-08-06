/**
 * receipt-summary.ts — the chip's counts, derived from the record.
 *
 * THE CHIP NEVER NARRATES. Its numbers come from `renderDiff`'s own lines, which come from
 * `diffBeats` comparing two row snapshots — a diff of the database, not a model's account of what
 * it did. That distinction is load-bearing: the one thing this surface sells is that the client
 * can trust the causality they are shown, and a summary that could be subtly wrong in ways nobody
 * catches would undo every rationale on the page.
 *
 * So this file parses the receipt's OWN strings rather than being told a count. The verbs are
 * `draft-diff.ts`'s, and if one is ever added there without landing here it shows up as an
 * unclassified line rather than as a wrong number — which the tests pin.
 *
 * Pure. No React, no db.
 */
import type { DraftReceipt, BriefItem } from '../DraftPlanView';

/**
 * The receipt's verbs, in the order the chip states them.
 *
 * ADDED, REPLACED, MOVED are the three spec §3 names. `replaced` is kept deliberately over
 * "changed": the difference between "this post was edited" and "this post was removed and
 * another took its slot" is the thing a client most needs to see, and it is exactly what went
 * wrong in ivy-t's rehearsal — a launch arc that consumed three pillar posts to place three of
 * its own. The last three are the rarer field edits, in the same vocabulary.
 */
const VERBS: { prefix: string; word: string }[] = [
  { prefix: 'Added:',     word: 'added' },
  { prefix: 'Replaced:',  word: 'replaced' },
  { prefix: 'Moved:',     word: 'moved' },
  { prefix: 'Changed:',   word: 'changed' },
  { prefix: 'Re-angled:', word: 're-angled' },
  { prefix: 'Renamed:',   word: 'renamed' },
];

export interface SummaryPart { word: string; count: number }

/** How many of each verb this receipt's lines carry, in the canonical order, zeroes dropped. */
export function countVerbs(lines: readonly string[]): SummaryPart[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const verb = VERBS.find((v) => line.startsWith(v.prefix));
    if (verb) counts.set(verb.word, (counts.get(verb.word) ?? 0) + 1);
  }
  return VERBS
    .map(({ word }) => ({ word, count: counts.get(word) ?? 0 }))
    .filter((p) => p.count > 0);
}

/** How a decomposed brief's segments came out. One count per outcome the client can act on. */
export function countItems(items: readonly BriefItem[]): SummaryPart[] {
  const applied = items.filter((i) => i.outcome === 'applied').length;
  const saved = items.filter((i) => i.outcome === 'idea').length;
  const failed = items.filter((i) => i.outcome === 'couldnt_apply').length;
  // Counted, unlike `noop`: this segment DID file something, so there is a row the client can act
  // on. Folding it into "couldn't apply" was giving a cadence floor already met the language of a
  // failure — the inconsistency that gave one outcome honest copy in a brief and dishonest copy in
  // a sentence, honest in the wrong direction.
  const settled = items.filter((i) => i.outcome === 'nothing_to_do').length;
  // `noop` is deliberately uncounted: a segment that changed nothing and filed nothing is not a
  // number the client can do anything with, and printing "0 changes" is padding.
  return [
    { word: 'applied', count: applied },
    { word: 'saved', count: saved },
    { word: 'couldn’t apply', count: failed },
    { word: 'needed no change', count: settled },
  ].filter((p) => p.count > 0);
}

/**
 * WHAT AN EVERGREEN RECEIPT SAYS, AND WHETHER IT OFFERS THE RESCUE TAP.
 *
 * ── The failure ─────────────────────────────────────────────────────────────────────
 *
 * Six reasons reach an evergreen receipt and five of them rendered the same sentence —
 * *"Saved to your ideas. We've kept this for later rather than changing September."* — which is
 * the copy for a filing the client ASKED FOR. The honest branch existed, in three components,
 * and could only fire when `classifyIntake` threw twice: it was unreachable from every failure
 * that actually happens. So a client whose *"can you move one of the posts to the next
 * available empty day?"* was read as a standing idea was told we had filed it on purpose, with
 * nothing to distinguish that from being understood.
 *
 * ── One function, because three components said it three times ──────────────────────
 *
 * `ReceiptPanel`, `DraftPlanView` and `chipLabel` below each carried their own ternary on
 * `reason === 'couldnt_apply'`. Three copies of a rule is how the chip comes to say "Saved to
 * your ideas" over a panel saying something else, so the rule is stated once and they read it.
 *
 * ── The families ────────────────────────────────────────────────────────────────────
 *
 * `read_as_idea`     the model called it a standing idea and the sentence names an OPERATION on
 *                    an existing post. Cannot be proven a misread — the classifier is the only
 *                    reader of intent and it is what failed — so the copy states what happened
 *                    rather than claiming a mistake, and names the phrasing that does work.
 *                    NO RESCUE: promoting it would title a post with the instruction and evict
 *                    a real one (`namesAnOperation`).
 * `couldnt_apply`    the classifier threw twice. A system failure; say so.
 * `validation_failed`the model's output did not fit its schema. Also a system failure.
 * `not_applicable`   THE TRANSFORM RAN AND PRODUCED NOTHING, WHICH IS OFTEN CORRECT. Its own
 *                    family, and the reason this is not folded in with the two above: the
 *                    cadence branch returns no ops with the note *"Recorded 7 posts a week as
 *                    your floor. You have 9 posts this month"* — a complete success. So does an
 *                    emphasis already satisfied, and a series whose every date lands next month.
 *                    "We couldn't apply this" would be false on all three. The heading states
 *                    the one thing true of every shape and lets the note carry the rest.
 * `model_error`      Bedrock was unreachable. The only failure where saying the same words again
 *                    will probably just work, so that is what it asks for. The row IS filed —
 *                    `saveToBacklog` runs for every evergreen reason — so "it's saved" is a fact,
 *                    not reassurance.
 * anything else      a real filing the client asked for. Unchanged, and it is the common case.
 */
export interface EvergreenCopy {
  heading: string;
  body: string;
  /** Does "Add to this month" belong on this receipt? */
  rescue: boolean;
}

export function evergreenCopy(reason: string | undefined, monthName: string): EvergreenCopy {
  switch (reason) {
    case 'read_as_idea':
      return {
        heading: `Saved as an idea — not a change to ${monthName}`,
        body: `This read as something for later, so nothing in ${monthName} changed.`
          + ` If you meant it now, tell me which post and which date — like “move the 21st to the 30th”.`,
        rescue: false,
      };
    case 'couldnt_apply':
    case 'validation_failed':
      return {
        heading: 'We couldn’t apply this',
        body: `We couldn’t work this into ${monthName} automatically, so we’ve saved it to your ideas.`,
        rescue: true,
      };
    case 'not_applicable':
      return {
        heading: `Nothing changed in ${monthName}`,
        body: `We’ve saved this to your ideas.`,
        rescue: true,
      };
    case 'model_error':
      return {
        heading: 'We couldn’t read this just now',
        body: `Something went wrong on our side, so nothing in ${monthName} changed.`
          + ` It’s saved — try saying it again.`,
        rescue: false,
      };
    default:
      return {
        heading: 'Saved to your ideas',
        body: `We’ve kept this for later rather than changing ${monthName}. If you meant now, add it to this month.`,
        rescue: true,
      };
  }
}

/**
 * The one line on the chip, or '' when there is nothing worth a chip at all.
 *
 * An empty string is a real answer: an application that changed nothing and filed nothing has no
 * summary to give, and a chip reading "0 changes" occupies 48px to say so.
 */
export function chipLabel(receipt: DraftReceipt | null): string {
  if (!receipt) return '';
  // A QUESTION changed nothing, so the month's chip has nothing to say about it. Stated rather
  // than left to fall out of `countVerbs` finding no verbs, which is the same answer by luck.
  if (receipt.scope === 'question') return '';
  const parts = receipt.items ? countItems(receipt.items) : countVerbs(receipt.lines ?? []);
  if (parts.length === 0) {
    // An evergreen receipt applied nothing to the month ON PURPOSE — it filed an idea. That is
    // worth saying, because the client asked for something and needs to know where it went.
    /**
     * The chip is the same FAMILIES as `evergreenCopy`, in the chip's own register.
     *
     * Not the heading verbatim, and the divergence is deliberate rather than drift: the panel
     * heading sits directly above the client's quoted sentence, so it says "this"; the chip is a
     * label on a collapsed strip with the sentence nowhere in sight, so it says "that". The
     * pre-existing pair got that right and a shared string would have flattened it. The month is
     * not in scope here either, which is the second reason these are written out.
     *
     * What must not diverge is WHICH FAMILY a reason belongs to. Adding a case here without one
     * in `evergreenCopy` is the drift that matters, and the tests pin the two together.
     */
    if (receipt.scope === 'evergreen') {
      switch (receipt.reason) {
        case 'read_as_idea':       return 'Saved as an idea — not a change';
        case 'not_applicable':     return 'Nothing needed changing';
        case 'model_error':        return 'We couldn’t read that';
        case 'couldnt_apply':
        case 'validation_failed':  return 'We couldn’t apply that';
        default:                   return 'Saved to your ideas';
      }
    }
    return '';
  }
  return parts.map((p) => `${p.count} ${p.word}`).join(' · ');
}

/** The rollup's own headline, when the receipt is one. Renders `segmentCount`, which is the
 *  decomposer's count and not a re-count of the items we chose to display. */
export function rollupHeadline(receipt: DraftReceipt): string {
  const n = receipt.segmentCount ?? receipt.items?.length ?? 0;
  return `We found ${n} thing${n === 1 ? '' : 's'} in what you sent`;
}
