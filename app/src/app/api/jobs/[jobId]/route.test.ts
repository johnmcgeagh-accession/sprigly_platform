/**
 * jobs route test — polling authorises by the session CLIENT owning the job's cycle
 * (any cycle, not just the token home), so a job enqueued for the viewed (non-home)
 * cycle is pollable; a cycle the client doesn't own is refused (403). Regression guard
 * for the session.cycleId anchor that made every non-home job 403 → infinite poll.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  ownedRows: [] as unknown[],
  ownershipWheres: [] as unknown[],
  readHook: vi.fn(),
  readShape: vi.fn(),
  readScript: vi.fn(),
  loadPlanPosts: vi.fn(),
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
vi.mock('@/lib/queue', () => ({
  readHookJob: (...a: unknown[]) => h.readHook(...a),
  readShapeJob: (...a: unknown[]) => h.readShape(...a),
  readScriptJob: (...a: unknown[]) => h.readScript(...a),
}));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: (...a: unknown[]) => h.loadPlanPosts(...a), loadDraftBeats: async () => [] }));

import { GET } from './route';

const CLIENT = 'client-1';
const HOME = 'cycle-home';        // the token's cycle
const JULY = 'cycle-july';        // a non-home viewed cycle
const call = (jobId: string) => GET(new Request(`http://x/api/jobs/${jobId}`), { params: { jobId } });

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: HOME };
  h.ownedRows = [{ id: JULY }];   // default: the job's cycle belongs to the client
  h.ownershipWheres.length = 0;
  h.readHook.mockReset().mockResolvedValue({ status: 'done', candidates: ['a', 'b', 'c'] });
  h.readShape.mockReset().mockResolvedValue({ status: 'done', changedPostIds: ['post-9'], summary: 'ok' });
  h.readScript.mockReset().mockResolvedValue({ status: 'done', changedPostIds: ['post-9'], summary: 'ok' });
  h.loadPlanPosts.mockReset().mockResolvedValue([{ id: 'post-9' }]);
});

describe('GET /api/jobs/:jobId — client-ownership authorisation', () => {
  it('401 without a session', async () => {
    h.session = null;
    expect((await call(`hook_${JULY}_post-9`)).status).toBe(401);
  });

  it('polls a HOOK job for the VIEWED (non-home) cycle when the client owns it', async () => {
    const res = await call(`hook_${JULY}_post-9`);   // job cycle = July, session home = HOME
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'done', candidates: ['a', 'b', 'c'] });
    expect(h.readHook).toHaveBeenCalledWith(`hook_${JULY}_post-9`);
    // ownership was checked against the JOB's cycle + the session client (not session.cycleId).
    const eqs = JSON.stringify(h.ownershipWheres[0]);
    expect(eqs).toContain(JULY);
    expect(eqs).toContain(CLIENT);
    expect(eqs).not.toContain(HOME);
  });

  it('a SHAPE job for the viewed cycle re-reads THAT cycle’s posts on done (not home)', async () => {
    const res = await call(`shape_${JULY}_post-9`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('done');
    expect(h.loadPlanPosts).toHaveBeenCalledWith(CLIENT, JULY);   // job's cycle, not HOME
  });

  it('a SCRIPT job dispatches to readScriptJob', async () => {
    await call(`script_${JULY}_post-9`);
    expect(h.readScript).toHaveBeenCalledWith(`script_${JULY}_post-9`);
  });

  it('403 when the job’s cycle does not belong to the session client (never leak)', async () => {
    h.ownedRows = [];   // ownership query finds nothing
    const res = await call(`hook_cycle-someone-else_post-9`);
    expect(res.status).toBe(403);
    expect(h.readHook).not.toHaveBeenCalled();
  });

  it('403 on a malformed jobId (unknown type / missing cycle)', async () => {
    expect((await call('bogus')).status).toBe(403);
    expect((await call('hook_')).status).toBe(403);
  });
});
