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
/** Is the allowance spent? An active override means never. */
export function isCapReached(cap, now = new Date()) {
    if (cap.overrideUntil && new Date(cap.overrideUntil).getTime() > now.getTime())
        return false;
    return cap.used >= cap.limit;
}
/** How many changes are left. Infinity under an active override — a number no caller should
 *  print, which is the point: an unlimited client is never told a count. */
export function remainingChanges(cap, now = new Date()) {
    if (cap.overrideUntil && new Date(cap.overrideUntil).getTime() > now.getTime())
        return Infinity;
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
export function isQuotaBanked(sourceMeta) {
    if (!sourceMeta || typeof sourceMeta !== 'object')
        return false;
    return sourceMeta[QUOTA_BANKED_KEY] === true;
}
/** When it was banked, or null. */
export function bankedAt(sourceMeta) {
    if (!sourceMeta || typeof sourceMeta !== 'object')
        return null;
    const v = sourceMeta[QUOTA_BANKED_AT_KEY];
    return typeof v === 'string' && v.trim() ? v : null;
}
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
export function classifyGenerationFailure(sourceMeta) {
    if (isQuotaBanked(sourceMeta))
        return 'quota';
    const error = (() => {
        if (!sourceMeta || typeof sourceMeta !== 'object')
            return '';
        const v = sourceMeta['generationError'];
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
    if (!error)
        return 'transient';
    // Pre-flag rows (see above).
    if (/used all \d+ ai changes/.test(error))
        return 'quota';
    return TRANSIENT.some((m) => error.includes(m)) ? 'transient' : 'deterministic';
}
// ─── COPY ─────────────────────────────────────────────────────────────────────
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
/** An ISO instant or date → '1 August', for client copy. Falls back to the raw string. */
export function resetDayLabel(iso) {
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
export function capAnnouncement(a) {
    const need = `${a.needed} change${a.needed === 1 ? '' : 's'}`;
    const left = a.remaining === 0
        ? 'you’ve none left this month'
        : `you’ve ${a.remaining} left this month`;
    return `That needs ${need} written, and ${left} — they refresh on ${resetDayLabel(a.resetsOn)}. `
        + 'I can save the whole thing and write it the moment they do. Want me to?';
}
/** What a banked post says on the card and in the thread. Never "on its way": nothing is
 *  coming until the date this names. */
export function bankedLine(resetsOn) {
    return `Waiting for your changes to refresh on ${resetDayLabel(resetsOn)}.`;
}
//# sourceMappingURL=ai-change-cap.js.map