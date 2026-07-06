/**
 * proposals-endpoints.test.ts — the three proposal endpoints gate on the session
 * and pass the session's clientId (never a client-supplied one) to the service.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  listPending: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/agent/proposals', () => ({
  listPendingProposals: (...a: unknown[]) => h.listPending(...a),
  approveProposal: (...a: unknown[]) => h.approve(...a),
  rejectProposal: (...a: unknown[]) => h.reject(...a),
}));

import { GET } from './route';
import { POST as APPROVE } from './[id]/approve/route';
import { POST as REJECT } from './[id]/reject/route';

beforeEach(() => {
  h.session = { clientId: 'client-1', cycleId: 'cycle-1' };
  h.listPending.mockReset().mockResolvedValue([{ id: 'p1', intent: 'note_for_month', summary: 's', status: 'pending' }]);
  h.approve.mockReset().mockResolvedValue({ id: 'p1', intent: 'note_for_month', summary: 's', status: 'applied' });
  h.reject.mockReset().mockResolvedValue({ id: 'p1', intent: 'note_for_month', summary: 's', status: 'rejected' });
});

describe('GET /api/plan/proposals', () => {
  it('401 without a session', async () => {
    h.session = null;
    const res = await GET(new Request('http://x/api/plan/proposals?status=pending'));
    expect(res.status).toBe(401);
  });

  it('lists pending proposals scoped to the session client', async () => {
    const res = await GET(new Request('http://x/api/plan/proposals?status=pending'));
    expect(res.status).toBe(200);
    expect(h.listPending).toHaveBeenCalledWith('client-1');
    const body = await res.json();
    expect(body.proposals).toHaveLength(1);
  });
});

describe('POST /api/plan/proposals/:id/approve', () => {
  it('401 without a session', async () => {
    h.session = null;
    const res = await APPROVE(new Request('http://x', { method: 'POST' }), { params: { id: 'p1' } });
    expect(res.status).toBe(401);
  });

  it('approves using the session clientId (not a client-supplied one)', async () => {
    const res = await APPROVE(new Request('http://x', { method: 'POST' }), { params: { id: 'p1' } });
    expect(res.status).toBe(200);
    expect(h.approve).toHaveBeenCalledWith('client-1', 'p1', 'client');
  });

  it('404 when the proposal is not found for this client', async () => {
    h.approve.mockResolvedValue(null);
    const res = await APPROVE(new Request('http://x', { method: 'POST' }), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/plan/proposals/:id/reject', () => {
  it('rejects using the session clientId', async () => {
    const res = await REJECT(new Request('http://x', { method: 'POST' }), { params: { id: 'p1' } });
    expect(res.status).toBe(200);
    expect(h.reject).toHaveBeenCalledWith('client-1', 'p1', 'client');
  });
});
