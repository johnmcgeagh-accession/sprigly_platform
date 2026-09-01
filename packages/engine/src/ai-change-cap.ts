/**
 * ai-change-cap.ts — the monthly AI-change allowance, as shared property.
 *
 * The cap governs the EXPENSIVE path: post generation and instructed changes, which run through
 * the planning-critic / planning-repair loop and cost a Bedrock call each. It does NOT govern
 * chat turns, and it does not govern structural edits — a move, a delete, a reorder or a format
 * change is free and always has been.
 *
 * Three parties now have to agree about it, which is why the rules are here rather than in any
 * one of them:
 *
 *   - the APP announces the cap before it does the work, and refuses at the moment of spend
 *     (`app/src/lib/usage.ts`, `post-generation.ts`, `agent/proposals.ts`);
 *   - the WORKER releases banked work when the allowance comes back, on the daily tick
 *     (`engine/src/content-cycles/banked-changes.ts`);
 *   - the SURFACE renders a banked post's own quiet state rather than "On its way"
 *     (`app/src/lib/generation-state.ts`).
 *
 * Pure. No db, no queue, no React.
 */

/**
 * The NUMBERS live in @sprigly/db (`ai-change-usage.ts`) — the limit's default, the window, and
 * the read that counts `post_edits` — because both the app and the worker query them, and this
 * package cannot be imported by @sprigly/db without closing a cycle.
 *
 * They are deliberately NOT re-exported from here. `@sprigly/db`'s entry point constructs the
 * database client, so a re-export would mean that importing a copy helper or a predicate pulled
 * a connection (and a DATABASE_URL) in behind it — which is exactly what this module promises
 * not to do. Two imports is the honest cost of one of them being pure.
 *
 * What lives HERE is what the numbers MEAN: is the allowance spent, what is banked, how a
 * failure is classified, and what the client is told. None of it touches a database.
 */

export interface CapState {
  used:          number;
  limit:         number;
  /** ISO, or null. In the future ⇒ unlimited for the duration. */
  overrideUntil: string | null;
}

/** Is the allowance spent? An active override means never. */
export function isCapReached(cap: CapState, now: Date = new Date()): boolean {
  if (cap.overrideUntil && new Date(cap.overrideUntil).getTime() > now.getTime()) return false;
  return cap.used >= cap.limit;
}

/** How many changes are left. Infinity under an active override — a number no caller should
 *  print, which is the point: an unlimited client is never told a count. */
export function remainingChanges(cap: CapState, now: Date = new Date()): number {
  if (cap.overrideUntil && new Date(cap.overrideUntil).getTime() > now.getTime()) return Infinity;
  return Math.max(0, cap.limit - cap.used);
}

// ─── BANKED WORK ──────────────────────────────────────────────────────────────

/** The source_meta key marking a post whose generation is WAITING for the allowance to reset.
 *  Named once so a typo cannot silently turn a banked post back into a plain failure. */
export const QUOTA_BANKED_KEY = 'quotaBanked';
/** When it was banked (ISO). Read by the operator list; never used as a predicate. */
export const QUOTA_BANKED_AT_KEY = 'quotaBankedAt';

/**
 * Is this post banked against the cap?
 *
 * THE FLAG, NEVER THE MESSAGE. The refusal's wording is copy and copy changes; a predicate that
 * reads it would quietly start answering false the first time somebody improved a sentence. The
 * ONE path that refuses on quota (`startPostGeneration`) writes this key, and this is the only
 * thing that reads it.
 */
export function isQuotaBanked(sourceMeta: unknown): boolean {
  if (!sourceMeta || typeof sourceMeta !== 'object') return false;
  return (sourceMeta as Record<string, unknown>)[QUOTA_BANKED_KEY] === true;
}

/** When it was banked, or null. */
export function bankedAt(sourceMeta: unknown): string | null {
  if (!sourceMeta || typeof sourceMeta !== 'object') return null;
  const v = (sourceMeta as Record<string, unknown>)[QUOTA_BANKED_AT_KEY];
  return typeof v === 'string' && v.trim() ? v : null;
}

// ─── WHO IS PAYING (0094) ─────────────────────────────────────────────────────

/**
 * The source_meta key marking a post whose generation the SYSTEM started — the monthly plan
 * fan-out, not anything the client asked for.
 *
 * ── Why this lives on the POST and not only on the job ───────────────────────────────
 *
 * The enqueuer knows who asked; by the time a RE-enqueuer runs, the original payload is gone.
 * The failed-generation sweep and the banked-run trigger both rebuild a job from the post row
 * alone, and both must reach the same answer the first enqueue did — otherwise a fan-out
 * caption that timed out comes back billable, or a client's rewrite comes back free.
 *
 * So the fact is written once, on the row, at the moment the month is approved
 * (`draft-approval-core.ts`), where BOTH fan-out paths already share a single UPDATE. It sits
 * beside `quotaBanked` and `sweepAttempts` — the other two facts about a post's generation
 * that outlive the job that caused it.
 */
export const SYSTEM_GENERATED_KEY = 'systemGenerated';

/**
 * Did the system start this post's generation on its own?
 *
 * THE FLAG, NEVER THE STATUS. A post's status describes where its generation got to, not who
 * asked for it, and the two come apart the moment anything retries.
 *
 * Absent ⇒ false ⇒ billable, which is the safe direction: an unmarked post is charged. The
 * only writer of this key is the approval fan-out, so anything it did not create is, by
 * construction, something the client asked for.
 */
export function isSystemGenerated(sourceMeta: unknown): boolean {
  if (!sourceMeta || typeof sourceMeta !== 'object') return false;
  return (sourceMeta as Record<string, unknown>)[SYSTEM_GENERATED_KEY] === true;
}

/**
 * Does a re-enqueue of this post spend the client's allowance?
 *
 * The one derivation both re-enqueuers use (`generation-sweep.ts`, `banked-changes.ts`), so
 * "what does the sweep think" and "what does the banked release think" cannot drift into two
 * answers about the same post's money.
 */
export function billableForPost(sourceMeta: unknown): boolean {
  return !isSystemGenerated(sourceMeta);
}

// ─── FAILURE CLASSIFICATION (X2e) ─────────────────────────────────────────────

/**
 * What KIND of thing stopped this post being written. The sweep treats each differently, and
 * treating them alike is what made the daily tick spend money re-running a refusal that could
 * only ever be refused again.
 *
 *   quota          the allowance is spent. NEVER retried — retrying cannot succeed until the
 *                  allowance comes back, and the banked-run trigger is what handles that.
 *   transient      the call failed for a reason that is about the moment, not the request: a
 *                  timeout, a throttle, a connection, a 5xx. Worth another go, soon.
 *   deterministic  the request itself cannot be satisfied — a validation gate the caption could
 *                  not pass, a brief the critic keeps rejecting, a missing row. Another attempt
 *                  spends money to reach the same answer, so it stops and an operator sees it.
 */
export type GenerationFailureClass = 'quota' | 'transient' | 'deterministic';

/**
 * The transient markers, matched against the stored error.
 *
 * An explicit LIST rather than a catch-all, and an error that is PRESENT but unrecognised falls
 * to `deterministic`. The two mistakes are not symmetric: classing a deterministic failure as
 * transient bills the same doomed call over and over and surfaces nothing; classing a transient
 * one as deterministic puts it in front of an operator who can look. Almost every unlisted
 * message in this codebase is a gate or critic refusal — "could not produce a clean caption",
 * "could not get that change on-brand" — which is the request failing, not the moment.
 */
const TRANSIENT = [
  'timed out', 'timeout', 'etimedout', 'econnreset', 'econnrefused', 'enotfound', 'socket hang up',
  'throttl', 'too many requests', 'rate exceeded', 'ratelimit', 'rate limit',
  'serviceunavailable', 'service unavailable', 'internalfailure', 'internal server error',
  'modelnotready', 'model timeout', 'network', 'temporarily',
  ' 429', ' 500', ' 502', ' 503', ' 504',
];

/**
 * Classify a post's stored failure.
 *
 * QUOTA is decided by the FLAG, not by the words — see `isQuotaBanked`. One exception, and it is
 * a migration concession rather than a rule: rows written before the flag existed carry only the
 * refusal sentence, so that sentence's stable half ("used all N AI changes") is matched too. New
 * rows never rely on it.
 */
export function classifyGenerationFailure(sourceMeta: unknown): GenerationFailureClass {
  if (isQuotaBanked(sourceMeta)) return 'quota';
  const error = (() => {
    if (!sourceMeta || typeof sourceMeta !== 'object') return '';
    const v = (sourceMeta as Record<string, unknown>)['generationError'];
    return typeof v === 'string' ? v.toLowerCase() : '';
  })();
  /**
   * NO error recorded is a different thing from an unrecognised one, and it gets the opposite
   * answer. Every writer of `generation_failed` stores a reason, so an absent one means the row
   * was written by something we cannot account for — and calling that deterministic would
   * strand it for good. Retrying is BOUNDED (MAX_SWEEP_ATTEMPTS), so the cost of being wrong
   * here is two paid attempts, which is exactly what the sweep spent before it classified
   * anything. Nothing said this failure was about the request; treat it as the moment.
   */
  if (!error) return 'transient';
  // Pre-flag rows (see above).
  if (/used all \d+ ai changes/.test(error)) return 'quota';
  return TRANSIENT.some((m) => error.includes(m)) ? 'transient' : 'deterministic';
}

// ─── COPY ─────────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** An ISO instant or date → '1 August', for client copy. Falls back to the raw string. */
export function resetDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim() : iso;
}

/**
 * WHAT THE AGENT SAYS BEFORE IT DOES THE WORK (X2a).
 *
 * Three facts and an offer, in that order, because that is the order the client needs them: how
 * much this ask costs, how much is left, when more arrives, and what happens if they say yes.
 * Never an apology and never a refusal — the request is not being turned down, it is being
 * scheduled.
 */
export function capAnnouncement(a: { needed: number; remaining: number; resetsOn: string }): string {
  const need = `${a.needed} change${a.needed === 1 ? '' : 's'}`;
  const left = a.remaining === 0
    ? 'you’ve none left this month'
    : `you’ve ${a.remaining} left this month`;
  return `That needs ${need} written, and ${left} — they refresh on ${resetDayLabel(a.resetsOn)}. `
    + 'I can save the whole thing and write it the moment they do. Want me to?';
}

/** What a banked post says on the card and in the thread. Never "on its way": nothing is
 *  coming until the date this names. */
export function bankedLine(resetsOn: string): string {
  return `Waiting for your changes to refresh on ${resetDayLabel(resetsOn)}.`;
}
