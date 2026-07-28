/**
 * generation-state.ts — what a client is told about a post that has no caption yet.
 *
 * Spec G4 and gap 7. There is exactly ONE client-facing answer to "why is this post empty?",
 * and it is *on its way*. Not "failed", not "needs a retry", not a button. That is not a
 * softening of the truth: since the failed-generation sweep landed
 * (engine/src/content-cycles/generation-sweep.ts) a post in `generation_failed` genuinely
 * does have a retry coming, and the one that runs out of passes genuinely does have an
 * operator coming (admin → Failed Posts). The sentence is true by construction, and it stops
 * being true the moment either half is removed.
 *
 * Why `generating` and `generation_failed` collapse into one client state: the difference
 * between them is *which* of our processes is next, and no client has any use for that. Both
 * mean the same thing to the person reading — the words are not here yet, and nothing is
 * being asked of you. The real status stays on the row for the operator.
 *
 * One definition, deliberately, because the failure mode here is partial application: the
 * legacy shell, the redesign card, the detail sheet and the month grid each rendering their
 * own idea of it, one of which still says "failed".
 */
import type { PostStatus } from '@/lib/types';

/** Statuses that mean "we are still writing this one". */
const IN_FLIGHT: ReadonlySet<PostStatus> = new Set<PostStatus>(['generating', 'generation_failed']);

/**
 * Is this post still being written, as far as the client is concerned?
 *
 * `generation_failed` is deliberately in here. It is the state a post lands in when BullMQ has
 * nothing left to retry — but the daily sweep picks it up twice more, so from the client's
 * side nothing has ended.
 */
export function isOnTheWay(status: PostStatus | undefined | null): boolean {
  return !!status && IN_FLIGHT.has(status);
}

/** The status line beside the in-flight marker. Short, because it sits on a card. */
export const ON_THE_WAY_LABEL = 'On its way';

/** The card teaser, where a caption excerpt would be. */
export const ON_THE_WAY_TEASER = 'We’re still writing this one. It’ll appear here shortly.';

/** The sheet's version, which has room for the reassurance the card does not. */
export const ON_THE_WAY_BODY =
  'We’re still writing this one. It’ll appear here as soon as it’s ready — there’s nothing you need to do.';

/** Screen-reader / aria phrasing for the in-flight marker, which is otherwise three dots. */
export const ON_THE_WAY_ARIA = 'Still being written';
