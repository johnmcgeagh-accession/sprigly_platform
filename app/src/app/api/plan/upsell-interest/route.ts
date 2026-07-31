/**
 * POST /api/plan/upsell-interest — the client wants more changes this month (X2d).
 *
 * ── What this is, and firmly what it is not ──────────────────────────────────────────
 *
 * It records INTEREST. There is no payment flow here, no plan change, and nothing that alters
 * the client's allowance — the operator reads the row and gets in touch. Building the billing
 * half now would mean shipping a price nobody has set, and the moment worth capturing is the
 * moment the agent says "you've none left this month", which is available today.
 *
 * ── Where it lands, and why there ────────────────────────────────────────────────────
 *
 * `ui_events`, as `ai_change_upsell_interest`. That table already exists for exactly this shape
 * of fact — a client-side act, with a payload, that is analytics rather than a source of truth
 * — and it is indexed on (client_id, created_at), which is the query an operator actually runs.
 * It is deliberately NOT `plan_activity`: nothing about the plan changed, and putting a
 * non-mutation in the mutation ledger is how the ledger stops meaning anything.
 *
 * The operator's query:
 *
 *   SELECT c.name, e.created_at, e.payload
 *     FROM ui_events e JOIN clients c ON c.id = e.client_id
 *    WHERE e.event = 'ai_change_upsell_interest'
 *    ORDER BY e.created_at DESC;
 *
 * The payload carries the client's own numbers at the moment they asked: how many changes the
 * request wanted, what their allowance is, how much of it was left, and when it resets. A row
 * with only a timestamp would tell an operator that somebody wanted more without telling them
 * how much more, which is the one thing the conversation is about.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cycleBelongsToClient } from '@/lib/agent/cycle-state';
import { getUsageForCycle } from '@/lib/usage';
import { recordUiEvent, AI_CHANGE_UPSELL_INTEREST } from '@/lib/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let cycleId = '', wanted = 0;
  try {
    const b = (await req.json()) as { cycleId?: unknown; changesWanted?: unknown };
    cycleId = typeof b.cycleId === 'string' ? b.cycleId : '';
    wanted  = typeof b.changesWanted === 'number' && Number.isFinite(b.changesWanted)
      ? Math.max(0, Math.min(1000, Math.trunc(b.changesWanted)))
      : 0;
  } catch { /* validated below */ }

  // The cycle arrives from the browser, so it is checked rather than trusted — the same rule
  // every other write path on this surface follows.
  const target = cycleId && await cycleBelongsToClient(session.clientId, cycleId) ? cycleId : session.cycleId;

  /**
   * The ALLOWANCE is read server-side rather than taken from the body. The client could send
   * anything, and this row is what an operator quotes back to them in a conversation about
   * money — so every number in it except "how many they wanted" comes from our own tables.
   */
  const usage = await getUsageForCycle(session.clientId, target).catch(() => null);

  await recordUiEvent(session.clientId, AI_CHANGE_UPSELL_INTEREST, {
    cycleId: target,
    changesWanted: wanted,
    ...(usage ? { used: usage.used, limit: usage.limit, remaining: Math.max(0, usage.limit - usage.used), resetsOn: usage.resetsOn } : {}),
  });

  // The client is told what will happen, and it is a promise a person keeps rather than a
  // system: nothing here changes their allowance, and the copy must not imply that it does.
  return NextResponse.json({ ok: true });
}
