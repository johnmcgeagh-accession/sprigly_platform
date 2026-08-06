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
// The families live in lib/, not here: a server route cannot reasonably import a component
// folder, and that is exactly why apply/route.ts had grown its own hardcoded copy.
import { evergreenChip } from '@/lib/receipt-copy';

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
    if (receipt.scope === 'evergreen') return evergreenChip(receipt.reason);
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
