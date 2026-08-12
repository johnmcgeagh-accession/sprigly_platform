/**
 * write-cycle.ts — which month does this WRITE land on?
 *
 * ── The defect this exists to close ──────────────────────────────────────────────────
 *
 * A magic link is minted for one cycle, but the surface lets the client walk to any month
 * they have. The READ routes learned that: `GET /api/plan`, `GET /api/plan/draft`,
 * `generation-status`, `changes`, `conversation`, `weekly-session` and `POST /api/plan/agent`
 * all take the viewed cycle and verify it. The DRAFT WRITE routes were never brought along —
 * they took `session.cycleId` and nothing else, so a client browsing November on a September
 * link had their reshapes, their added beats, their receipts and their APPROVAL applied to
 * September. `agent/route.ts:9-17` records the same bug on the read side and the same fix.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────
 *
 * ABSENT      → the session's own cycle. Every existing caller sent no cycle at all, and a
 *               route that started refusing them would break the surface rather than fix it.
 * PRESENT     → used only after `cycleBelongsToClient`. Anything else — another client's
 *               cycle, a cycle that does not exist, a malformed id — is REFUSED with 403.
 *
 * That refusal is the one place this deliberately parts company with the read routes. The
 * read helpers (`changes`, `conversation`) silently fall back to the session's cycle on an
 * unrecognised id, which is harmless when the answer is a list. It is not harmless when the
 * call commits a month: a client whose id we failed to recognise would have their approval
 * land somewhere they were not looking. `generation-status/route.ts:41-46` already refuses on
 * exactly this shape, and this follows it rather than inventing a third posture.
 *
 * SECURITY MODEL — CLIENT-SCOPED, not link-scoped. Any cycle belonging to the session's
 * client is writable, which is what the surface's own month navigation already implies. The
 * link names a starting point, never a boundary.
 */
import { cycleBelongsToClient } from '@/lib/agent/cycle-state';

export interface WriteCycleSession {
  clientId: string;
  cycleId:  string;
}

export type WriteCycleResult =
  | { ok: true;  cycleId: string }
  | { ok: false; error: 'forbidden' };

/** A UUID, shaped. Rejects a malformed id before it reaches the database, so a junk value is
 *  a clean 403 rather than a driver-level error inside a route that has already started. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the cycle a write should land on.
 *
 * `requested` is whatever the caller sent — a string, undefined, or anything at all off a
 * JSON body. Only a non-empty string that differs from the session's cycle is checked; the
 * session's own cycle needs no lookup, because the token is already proof of it.
 */
export async function resolveWriteCycle(
  session:   WriteCycleSession,
  requested: unknown,
): Promise<WriteCycleResult> {
  if (typeof requested !== 'string' || requested.trim() === '') {
    return { ok: true, cycleId: session.cycleId };
  }
  const wanted = requested.trim();
  if (wanted === session.cycleId) return { ok: true, cycleId: session.cycleId };
  if (!UUID.test(wanted)) return { ok: false, error: 'forbidden' };
  if (!(await cycleBelongsToClient(session.clientId, wanted))) return { ok: false, error: 'forbidden' };
  return { ok: true, cycleId: wanted };
}

/** Pull `cycleId` off an already-parsed JSON body without asserting its type. */
export const requestedCycleId = (body: Record<string, unknown> | null | undefined): unknown =>
  body?.['cycleId'];
