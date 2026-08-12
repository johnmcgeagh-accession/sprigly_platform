/**
 * receipt-items.ts — a draft receipt, as the NEXT turn's parser reads it.
 *
 * ── Why a receipt needs a second form ────────────────────────────────────────────────
 *
 * `threadForParser` (agent/conversation.ts) serialises an assistant turn from its RESOLVED
 * items — title plus ISO dates — and falls back to the turn's raw prose when it has none.
 * Committed-path turns carry items, so they serialise to a line each. Draft-apply turns
 * carried none, so the whole receipt went into the window verbatim: measured across this
 * client, 405 characters on average and 1,708 at the top, against ~120 for the committed
 * path's equivalent.
 *
 * That is the wrong text as well as too much of it. "Moved: Ethical, without cutting corners,
 * Tue 17 Nov → Tue 10 Nov" is written for a person reading a receipt; the parser needs the
 * date in the form a reference resolves against, which is ISO, and it needs to know the ACTION
 * was a move without inferring it from a capitalised English word.
 *
 * ── What maps, and what is deliberately left as prose ────────────────────────────────
 *
 * Only the two outcomes that have something structured to say map here:
 *
 *   month_scoped WITH deltas  → one `change` item per delta. This is the case the whole build
 *                               exists for: "move a post from the 17th" then "I only wanted one
 *                               of those moving" — "those" resolves against these lines.
 *   evergreen                 → one `idea` item. It says the sentence was FILED, which is the
 *                               fact a follow-up correction needs and the one the prose buried.
 *
 * Everything else returns nothing and keeps the prose fallback, on purpose:
 *
 *   question                  → the answer IS the content, and a follow-up ("the same for
 *                               November") refers to what was said, not to a change. Compacting
 *                               it would throw away the referent.
 *   month_scoped, no deltas   → a kept month context or "nothing needed changing". The only
 *                               item shape available is `unresolved`, which `threadForParser`
 *                               labels "could not do:" — and telling the next turn that a
 *                               context we DID keep could not be done is worse than the note.
 *
 * The loss worth stating: a `repillared` delta becomes `refine "<title>"` and its pillar is
 * dropped, because `InterpretedItem` has no pillar slot. The title survives, which is what a
 * later "that one" resolves against; the pillar is recoverable from the plan itself.
 */
import type { BeatDelta } from '@sprigly/engine';
import type { InterpretedItem } from './agent/types';

/** The fields of a receipt this reads. Structural, so `DraftApplication` satisfies it without
 *  this module importing the apply path (and the apply path importing this one). */
export interface ReceiptItemSource {
  scope:       string;
  sourceText?: string | undefined;
  deltas?:     readonly BeatDelta[] | undefined;
}

/**
 * One delta, as a change item.
 *
 * `proposalId` carries the BEAT id. On this surface a reshape has already landed — there is no
 * proposal to apply and nothing pending — so the closest true thing is the row the line is
 * about. It is never resolvable as a proposal by accident: the draft surface passes no
 * `isPending`, and a beat id cannot collide with a proposal id it is never compared against.
 */
function changeOf(d: BeatDelta): InterpretedItem {
  switch (d.type) {
    case 'added':
      return { kind: 'change', proposalId: d.beat.id, action: 'add', title: d.beat.title, toDate: d.beat.date };
    case 'removed':
      return { kind: 'change', proposalId: d.beat.id, action: 'remove', title: d.beat.title, fromDate: d.beat.date };
    case 'moved':
      return { kind: 'change', proposalId: d.beat.id, action: 'move', title: d.beat.title, fromDate: d.from, toDate: d.to };
    case 'reformatted':
      return { kind: 'change', proposalId: d.beat.id, action: 'format', title: d.beat.title, format: d.to };
    case 'retitled':
      return { kind: 'change', proposalId: d.beat.id, action: 'rewrite', title: d.to };
    case 'repillared':
    default:
      return { kind: 'change', proposalId: d.beat.id, action: 'refine', title: d.beat.title };
  }
}

/**
 * The items a draft receipt contributes to the thread. Empty when the receipt is better read as
 * the prose it already is — see the header for which, and why.
 */
export function receiptItems(app: ReceiptItemSource | null | undefined): InterpretedItem[] {
  if (!app) return [];
  if (app.deltas?.length) return app.deltas.map(changeOf);
  if (app.scope === 'evergreen') {
    const text = (app.sourceText ?? '').trim();
    return text ? [{ kind: 'idea', text }] : [];
  }
  return [];
}
