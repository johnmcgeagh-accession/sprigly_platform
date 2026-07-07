/**
 * flags.ts — per-tenant feature flags for the client plan surface.
 *
 * Flags live in `client_configs.settings` (jsonb, default `{}`), read server-side.
 * This module is intentionally pure (no `@sprigly/db` import) so the predicate is
 * unit-testable without a DATABASE_URL — the DB read is done at the call site
 * (`app/src/app/page.tsx`), which already holds a `db` handle.
 */

/** Swaps the client plan surface to the redesign. Per-tenant, default OFF. */
export const PLAN_REDESIGN_FLAG = 'plan_redesign';

/**
 * The redesign is on only when the flag is explicitly the boolean `true`. Anything
 * else — missing settings, `false`, a truthy string, `1` — is off. Keeping the check
 * strict avoids a stray `"false"` string flipping a tenant into the new surface.
 */
export function readPlanRedesignFlag(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  return settings?.[PLAN_REDESIGN_FLAG] === true;
}
