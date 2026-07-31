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

/**
 * ── THE BANKED STATE (X2c) ───────────────────────────────────────────────────────────
 *
 * A post the monthly AI-change cap refused is NOT on its way, and rendering it that way was a
 * plain untruth found live: the row carried an honest message in `source_meta.generationError`
 * and its instruction intact, but its status was `generation_failed`, which `isOnTheWay`
 * collapses into "On its way" — so the client was told words were coming when nothing was
 * coming until the allowance reset.
 *
 * The sentence at the top of this file — "there is exactly ONE client-facing answer to 'why is
 * this post empty?'" — still holds for everything the system is working on. This is the state
 * where it genuinely is NOT working on it, and the honest answer is different: it is waiting,
 * it is waiting for a named thing, and that thing has a date.
 *
 * The predicate is a FLAG on the row (`quotaBanked`, written by the one path that refuses on
 * quota), never the message. Copy changes; a fact should not change with it.
 */
export function isBanked(post: { status?: PostStatus | null; banked?: boolean | null }): boolean {
  return post.banked === true;
}

/** Is this post being written, as far as the client is concerned? Banked posts are excluded —
 *  they are the one empty post that nothing is currently doing anything about. */
export function isPostOnTheWay(post: { status?: PostStatus | null; banked?: boolean | null }): boolean {
  return !isBanked(post) && isOnTheWay(post.status);
}

/** The card's status line. Short, and it does not promise. */
export const BANKED_LABEL = 'Waiting on your changes';

/** The teaser where a caption excerpt would be, when the stored message is unavailable.
 *  The stored one is preferred everywhere, because it names the actual reset date. */
export const BANKED_TEASER = 'This one is saved and will be written when your changes refresh.';

/** Screen-reader phrasing for the banked marker. */
export const BANKED_ARIA = 'Waiting for your changes to refresh';
