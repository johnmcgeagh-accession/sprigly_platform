/**
 * usage route test — the badge reflects the VIEWED cycle. GET /api/usage?cycleId=
 * returns usage for the cycleId the client sends (validated for client ownership, the
 * same guard as /api/jobs), NOT the token's home cycle. Regression guard for the
 * session.cycleId anchor that showed home-cycle usage while edits debit the edited
 * post's cycle. An unowned cycleId is refused (403); an absent one falls back to home.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  ownedRows: [] as unknown[],
  ownershipWheres: [] as unknown[],
  usageFor: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}));
vi.mock('@sprigly/db', () => {
  const contentCycles = new Proxy({}, { get: (_t, p) => String(p) });
  const db = {
    select: () => ({ from: () => ({ where: (cond: unknown) => { h.ownershipWheres.push(cond); return { limit: () => Promise.resolve(h.ownedRows) }; } }) }),
  };
  return { db, contentCycles };
});
vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/usage', () => ({ getUsageForCycle: (...a: unknown[]) => h.usageFor(...a) }));

import { GET } from './route';

const CLIENT = 'client-1';
const HOME = 'cycle-home';   // the token's cycle
const JULY = 'cycle-july';   // a non-home viewed cycle
const USAGE = { used: 4, limit: 30, overrideUntil: null, resetsOn: '2026-08-01T00:00:00.000Z', unlimited: false };
const call = (url: string) => GET(new Request(url));

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: HOME };
  h.ownedRows = [{ id: JULY }];   // default: the requested cycle belongs to the client
  h.ownershipWheres.length = 0;
  h.usageFor.mockReset().mockResolvedValue(USAGE);
});

describe('GET /api/usage — viewed-cycle usage', () => {
  it('401 without a session', async () => {
    h.session = null;
    expect((await call('http://x/api/usage')).status).toBe(401);
  });

  it('no cycleId → home cycle usage (no ownership query)', async () => {
    const res = await call('http://x/api/usage');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(USAGE);
    expect(h.usageFor).toHaveBeenCalledWith(CLIENT, HOME);
    expect(h.ownershipWheres).toHaveLength(0);   // home needs no ownership check
  });

  it('returns the VIEWED (non-home) cycle usage when the client owns it', async () => {
    const res = await call(`http://x/api/usage?cycleId=${JULY}`);
    expect(res.status).toBe(200);
    expect(h.usageFor).toHaveBeenCalledWith(CLIENT, JULY);   // viewed cycle, not HOME
    // ownership checked against the requested cycle + the session client (not session.cycleId).
    const eqs = JSON.stringify(h.ownershipWheres[0]);
    expect(eqs).toContain(JULY);
    expect(eqs).toContain(CLIENT);
  });

  it('cycleId === home is treated as home (no ownership query needed)', async () => {
    await call(`http://x/api/usage?cycleId=${HOME}`);
    expect(h.usageFor).toHaveBeenCalledWith(CLIENT, HOME);
    expect(h.ownershipWheres).toHaveLength(0);
  });

  it('403 when the requested cycle does not belong to the client (never leak)', async () => {
    h.ownedRows = [];   // ownership query finds nothing
    const res = await call('http://x/api/usage?cycleId=cycle-someone-else');
    expect(res.status).toBe(403);
    expect(h.usageFor).not.toHaveBeenCalled();
  });
});
