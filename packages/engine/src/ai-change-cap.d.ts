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
    used: number;
    limit: number;
    /** ISO, or null. In the future ⇒ unlimited for the duration. */
    overrideUntil: string | null;
}
/** Is the allowance spent? An active override means never. */
export declare function isCapReached(cap: CapState, now?: Date): boolean;
/** How many changes are left. Infinity under an active override — a number no caller should
 *  print, which is the point: an unlimited client is never told a count. */
export declare function remainingChanges(cap: CapState, now?: Date): number;
/** The source_meta key marking a post whose generation is WAITING for the allowance to reset.
 *  Named once so a typo cannot silently turn a banked post back into a plain failure. */
export declare const QUOTA_BANKED_KEY = "quotaBanked";
/** When it was banked (ISO). Read by the operator list; never used as a predicate. */
export declare const QUOTA_BANKED_AT_KEY = "quotaBankedAt";
/**
 * Is this post banked against the cap?
 *
 * THE FLAG, NEVER THE MESSAGE. The refusal's wording is copy and copy changes; a predicate that
 * reads it would quietly start answering false the first time somebody improved a sentence. The
 * ONE path that refuses on quota (`startPostGeneration`) writes this key, and this is the only
 * thing that reads it.
 */
export declare function isQuotaBanked(sourceMeta: unknown): boolean;
/** When it was banked, or null. */
export declare function bankedAt(sourceMeta: unknown): string | null;
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
 * Classify a post's stored failure.
 *
 * QUOTA is decided by the FLAG, not by the words — see `isQuotaBanked`. One exception, and it is
 * a migration concession rather than a rule: rows written before the flag existed carry only the
 * refusal sentence, so that sentence's stable half ("used all N AI changes") is matched too. New
 * rows never rely on it.
 */
export declare function classifyGenerationFailure(sourceMeta: unknown): GenerationFailureClass;
/** An ISO instant or date → '1 August', for client copy. Falls back to the raw string. */
export declare function resetDayLabel(iso: string): string;
/**
 * WHAT THE AGENT SAYS BEFORE IT DOES THE WORK (X2a).
 *
 * Three facts and an offer, in that order, because that is the order the client needs them: how
 * much this ask costs, how much is left, when more arrives, and what happens if they say yes.
 * Never an apology and never a refusal — the request is not being turned down, it is being
 * scheduled.
 */
export declare function capAnnouncement(a: {
    needed: number;
    remaining: number;
    resetsOn: string;
}): string;
/** What a banked post says on the card and in the thread. Never "on its way": nothing is
 *  coming until the date this names. */
export declare function bankedLine(resetsOn: string): string;
//# sourceMappingURL=ai-change-cap.d.ts.map