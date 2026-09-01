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
 *  they are the one empty post that nothing is currently doing anything about.
 *
 *  A RETIRED post needs no exclusion here and deliberately gets none: 'generation_expired' is
 *  not in IN_FLIGHT, so `isOnTheWay` is already false for it. That is the property the new
 *  status was added for — the exclusion is structural rather than another clause somebody has
 *  to remember to write. */
export function isPostOnTheWay(post: { status?: PostStatus | null; banked?: boolean | null }): boolean {
  return !isBanked(post) && isOnTheWay(post.status);
}

/**
 * ── THE UNGROUNDED LAUNCH ────────────────────────────────────────────────────────────
 *
 * The third empty post, and the only one that asks the client for something.
 *
 *   ON ITS WAY   we are writing it. Nothing is asked of you.
 *   BANKED       we will write it, on a date we can name. Nothing is asked of you.
 *   UNGROUNDED   we have not written it, and we cannot until you tell us what this is.
 *
 * A launch beat whose product is in no catalogue. We decline before spending anything on it
 * (`phase2.markSubjectUngrounded`) because a launch post's whole job is to name the thing
 * launching, and nothing downstream can tell a real product name from an invented one.
 *
 * Its status is `new`, not `generation_failed` — nothing failed, and `isOnTheWay` must not
 * collapse it into a promise. That is why this predicate keys on the flag alone.
 */
export function isUngrounded(post: { ungrounded?: boolean | null }): boolean {
  return post.ungrounded === true;
}

/**
 * The longest subject that still reads as a question.
 *
 * `deriveTitle` bounds a beat title on a word boundary, not to a noun phrase, so the subject
 * a launch arc carries is usually a name ("Molly") and occasionally a phrase ("Molly launch",
 * from a client who wrote "We have Molly launching on the 21st"). Both survive "What is X?".
 * A whole sentence would not, and `deriveTitle` can produce one — September's back-to-school
 * beat is titled with 54 characters of the client's prose.
 *
 * So the named question is EARNED, not assumed: past this bound the copy asks the generic
 * question instead, which is always answerable and never absurd. Better a plainer question
 * than one nobody can read.
 */
const SUBJECT_MAX_WORDS = 4;
const SUBJECT_MAX_CHARS = 32;

/** The subject if it reads in a question, else null → the caller uses the unnamed copy. */
export function askableSubject(subject: string | null | undefined): string | null {
  const s = (subject ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > SUBJECT_MAX_CHARS) return null;
  if (s.split(' ').length > SUBJECT_MAX_WORDS) return null;
  return s;
}

/** The card's status line, and the sheet's heading. A QUESTION — never a failure. */
export function ungroundedLabel(subject: string | null | undefined): string {
  const s = askableSubject(subject);
  return s ? `What is ${s}?` : 'What are we launching?';
}

/** The card teaser, where a caption excerpt would be. Trimmed to the ASK: the card has no room
 *  to explain itself, and the sheet below is one tap away and does. */
export function ungroundedTeaser(subject: string | null | undefined): string {
  const s = askableSubject(subject);
  return s
    ? `We’ve left this blank rather than guess. Tell us what ${s} is.`
    : 'We’ve left this blank rather than guess. Tell us what this launch is.';
}

/** The sheet's version, which has the room the card does not — and says WHY it is blank.
 *  "rather than guess" is the load-bearing phrase: it makes an empty post read as a decision
 *  we made on their behalf, which it is, instead of as something broken. */
export function ungroundedBody(subject: string | null | undefined): string {
  const s = askableSubject(subject);
  return s
    ? `We don’t know what ${s} is, so we’ve left this one blank rather than guess at it. Tell us — a line is plenty — and we’ll write the post.`
    : 'We don’t know what this launch is, so we’ve left this one blank rather than guess at it. Tell us — a line is plenty — and we’ll write the post.';
}

/** The action. Names the thing where it can, because "Tell us more" asks for nothing in
 *  particular and a client cannot tell whether they have answered it. */
export function ungroundedCta(subject: string | null | undefined): string {
  const s = askableSubject(subject);
  return s ? `Tell us about ${s}` : 'Tell us about this launch';
}

/** Screen-reader phrasing for the marker, which is otherwise a ring. */
export const UNGROUNDED_ARIA = 'Waiting for you to tell us what this is';

/** The card's status line. Short, and it does not promise. */
export const BANKED_LABEL = 'Waiting on your changes';

/** The teaser where a caption excerpt would be, when the stored message is unavailable.
 *  The stored one is preferred everywhere, because it names the actual reset date. */
export const BANKED_TEASER = 'This one is saved and will be written when your changes refresh.';

/** Screen-reader phrasing for the banked marker. */
export const BANKED_ARIA = 'Waiting for your changes to refresh';

/**
 * ── THE RETIRED PROMISE ──────────────────────────────────────────────────────────────
 *
 * The fourth empty post, and the only one that is over.
 *
 *   ON ITS WAY   we are writing it. Nothing is asked of you.
 *   BANKED       we will write it, on a date we can name. Nothing is asked of you.
 *   UNGROUNDED   we have not written it, and we cannot until you tell us what this is.
 *   EXPIRED      we did not write it, the day has gone, and nothing more will happen.
 *
 * A banked post promises a date. When that date arrives and the post's OWN day has already
 * passed, the promise cannot be kept and paying to keep it would be paying for a post about
 * a day that is over (`banked-changes.ts` declines to, deliberately). What was missing was
 * anything that said so: the row kept its `quotaBanked` flag and its message, so the client
 * went on reading "Waiting for your changes to refresh on 1 September" in September, about
 * work already abandoned.
 *
 * KEYED ON THE STATUS, not on a flag, and that is the one difference from its three siblings
 * above. They describe a live post that some process is still reasoning about, so a flag
 * beside the status is the right shape. This describes a post nothing will touch again, and
 * the whole reason it exists is that `generation_failed` DEFAULTS — through `isOnTheWay` — to
 * a promise. Another flag would have inherited that default and needed every consumer to
 * remember it. A distinct status is what makes an unaware consumer render nothing instead.
 */
export function isExpired(post: { status?: PostStatus | null }): boolean {
  return post.status === 'generation_expired';
}

/** The card's status line. States an outcome; promises nothing and asks for nothing.
 *
 *  PROVISIONAL — see `expiredLine` in @sprigly/engine/ai-change-cap. These words and the
 *  banked ones above are one voice describing one sequence of events, and the copy pass that
 *  revisits BANKED_LABEL should revisit this in the same breath. */
export const EXPIRED_LABEL = 'Not written';

/** The teaser, when the row's own stored message is unavailable. The stored one is preferred
 *  everywhere, because it names the actual day that passed. */
export const EXPIRED_TEASER = 'This one’s day passed before your changes came back, so we didn’t write it.';

/** Screen-reader phrasing for the retired marker. */
export const EXPIRED_ARIA = 'Not written — the day passed';
