/**
 * weekly-session route test — the session runs against the VIEWED cycle. POST
 * /api/plan/weekly-session enqueues for the cycleId the client sends (validated for
 * client ownership, same guard as /api/jobs; and for AUDITABLE status, the same rule
 * the Monday cron fan-out uses), NOT the token's home cycle. Regression guard for the
 * session.cycleId anchor. Unowned → 403; ineligible status → 409 noop; absent → home.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  cycleRows: [] as unknown[],
  ownershipWheres: [] as unknown[],
  enqueue: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}));
vi.mock('@sprigly/db', () => {
  const contentCycles = new Proxy({}, { get: (_t, p) => String(p) });
  const db = {
    select: () => ({ from: () => ({ where: (cond: unknown) => { h.ownershipWheres.push(cond); return { limit: () => Promise.resolve(h.cycleRows) }; } }) }),
  };
  return { db, contentCycles };
});
vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/queue', () => ({ enqueueWeeklySession: (...a: unknown[]) => h.enqueue(...a) }));

import { POST } from './route';

const CLIENT = 'client-1';
const HOME = 'cycle-home';   // the token's cycle
const JULY = 'cycle-july';   // a non-home viewed cycle
const call = (body?: unknown) =>
  POST(new Request('http://x/api/plan/weekly-session', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  }));

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: HOME };
  h.cycleRows = [{ id: JULY, status: 'active' }];   // default: owned + auditable
  h.ownershipWheres.length = 0;
  h.enqueue.mockReset().mockResolvedValue({ jobId: 'weekly_cycle-july_2026-07-06' });
});

describe('POST /api/plan/weekly-session — viewed-cycle targeting', () => {
  it('401 without a session', async () => {
    h.session = null;
    expect((await call({ cycleId: JULY })).status).toBe(401);
  });

  it('enqueues for the VIEWED (non-home) cycle when owned + auditable', async () => {
    const res = await call({ cycleId: JULY, weekStart: '2026-07-06' });
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe('pending');
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT, cycleId: JULY, weekStart: '2026-07-06' }));
    // ownership checked against the requested cycle + the session client (not session.cycleId).
    const eqs = JSON.stringify(h.ownershipWheres[0]);
    expect(eqs).toContain(JULY);
    expect(eqs).toContain(CLIENT);
    expect(eqs).not.toContain(HOME);
  });

  it('no cycleId → enqueues for the session home cycle', async () => {
    h.cycleRows = [{ id: HOME, status: 'active' }];
    await call({ weekStart: '2026-07-06' });
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ cycleId: HOME }));
  });

  it('403 when the requested cycle does not belong to the client (never enqueue)', async () => {
    h.cycleRows = [];   // ownership query finds nothing
    const res = await call({ cycleId: 'cycle-someone-else' });
    expect(res.status).toBe(403);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('409 noop when the cycle is owned but not in an auditable status (same rule as the cron)', async () => {
    h.cycleRows = [{ id: JULY, status: 'scheduled' }];   // owned, but not active/delivered/finalised
    const res = await call({ cycleId: JULY });
    expect(res.status).toBe(409);
    expect((await res.json()).mode).toBe('noop');
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('surfaces a busy enqueue as a noop', async () => {
    h.enqueue.mockResolvedValue({ busy: true, jobId: 'weekly_cycle-july_2026-07-06' });
    const res = await call({ cycleId: JULY });
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe('noop');
  });
});
