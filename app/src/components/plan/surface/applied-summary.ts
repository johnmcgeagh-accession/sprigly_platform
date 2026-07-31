/**
 * applied-summary.ts — the failure sentence for a background apply (F4).
 *
 * Pure, and derived from the SAME interpreted items the client consented to — never from a
 * sentence the model wrote. It names what did NOT apply, because "2 of 3 went through" without
 * saying which two leaves the client diffing their own month to find out.
 *
 * `appliedChipLabel` used to live here and compressed what LANDED into counts ('1 moved ·
 * 1 added'). It went with the chip it was written for (X5b) — it had no other reader, and a
 * pure function nothing calls is a surface waiting to come back by accident. What applied is
 * said once, in the thread's own confirmation turn, and shown once, on the cards.
 */
import type { InterpretedItem } from '@/lib/agent/types';

type Change = Extract<InterpretedItem, { kind: 'change' }>;

/** One line naming a change, for the failure report: `Move "Title"`. */
function nameOf(c: Change): string {
  const VERB: Record<Change['action'], string> = {
    move: 'Move', add: 'Add', remove: 'Remove', rewrite: 'Rewrite',
    format: 'Reformat', hook: 'Generate hooks for', refine: 'Refine',
  };
  return `${VERB[c.action] ?? 'Change'}${c.title ? ` “${c.title}”` : ''}`;
}

/** A change that did not apply, with the guard's own words for why. */
export interface Failure {
  change: Change;
  /** The server's refusal, verbatim. Null when nothing came back with a reason. */
  reason: string | null;
  /** Could pressing Apply again ever work? A blocked ordering dependency: yes. A guard that
   *  refused the change outright: no — the rescue is to amend it. */
  retryable: boolean;
}

/**
 * The single-channel failure sentence: what didn't apply, BY NAME, WHY, and what to do next.
 * Empty string when nothing failed.
 *
 * ── What this said before, and why it was not enough (G3) ────────────────────────────
 *
 * It named the changes and promised "It's still here to try again." Two things were wrong
 * with that, and the October launch arc hit both. It never reached the client at all, because
 * `applyChanges` was counting guard refusals as successes (see `usePlanData.decide`) — so
 * `failed` was empty and this function was never called. And when it did fire, the promise was
 * false for a REFUSED change: the guard consumed the proposal, so there was nothing left to
 * try again, and the client was invited to press a button that no longer existed.
 *
 * So: the reason travels, and the next step matches the failure. A refused change offers the
 * rescue that would actually work — amend it, right here in the thread — because the date is
 * usually the only thing wrong with it and the client is already in a conversation.
 */
export function applyFailureMessage(failures: readonly Failure[], appliedCount: number): string {
  if (!failures.length) return '';
  const one = failures.length === 1;
  const named = failures
    .map((f) => (f.reason ? `${nameOf(f.change)} — ${f.reason}` : nameOf(f.change)))
    .join('; ');
  const head = appliedCount
    ? `${appliedCount} change${appliedCount === 1 ? '' : 's'} went through, but not ${one ? 'this one' : 'these'}: ${named}`
    : `That didn’t go through: ${named}`;
  // The trailing stop belongs to the reason when there is one — the guards write sentences.
  const stop = /[.!?]$/.test(head) ? '' : '.';
  const tail = failures.every((f) => f.retryable)
    ? `${one ? 'It’s' : 'They’re'} still here to try again.`
    // THE RESCUE, IN-THREAD. The client is standing in a conversation, so the fix is a sentence
    // rather than a trip to the calendar — and naming the sentence is what makes it one.
    : `Tell me another date and I’ll ${one ? 'put it in' : 'put them in'}.`;
  return `${head}${stop} ${tail}`;
}
