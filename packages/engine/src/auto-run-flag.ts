/**
 * auto-run-flag.ts — the ONE definition of how the auto-run master switch is read.
 *
 * The scheduler gates the live plan-run enqueue on `process.env.AUTO_RUN_ENABLED === 'true'`
 * (engine/src/content-cycles/scheduler.ts). The admin needs to SHOW that same flag (the
 * auto-run banner) without hardcoding a second copy of the predicate. This module is the shared
 * surface: both sides read the flag through the same env var + comparison, so they can't drift.
 *
 * ⚠ KNOWN GAP — this reads the CALLING process's env, NOT the worker's. Admin (Vercel) and the
 * worker (Railway) have SEPARATE env stores. When admin calls this it reports Vercel's
 * AUTO_RUN_ENABLED; the actual enqueue gate lives in the worker (scheduler.ts:225-247) and reads
 * Railway's. Setting the var on only one side makes the banner and the behaviour DISAGREE: set it
 * on Railway alone and the banner still says "off" while auto-run fires; set it on Vercel alone and
 * the banner hides while auto-run stays dark. THE WORKER IS THE PROCESS THAT DECIDES — the admin
 * banner must say only what it knows ("as seen by admin"), never assert what the worker will do.
 * There is NO cross-process signal today; closing this gap (the worker publishing its runtime
 * flag) is a SEPARATE build, deliberately not attempted here.
 */

/** The env var name — surfaced so the UI can name it in secondary text without a string literal. */
export const AUTO_RUN_ENABLED_ENV = 'AUTO_RUN_ENABLED';

/** True iff auto-run is enabled in this process. Same predicate the scheduler uses ('true'). */
export function isAutoRunEnabled(): boolean {
  return process.env[AUTO_RUN_ENABLED_ENV] === 'true';
}
