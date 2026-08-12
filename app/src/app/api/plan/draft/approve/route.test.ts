/**
 * approve route test — the one door that spends money, and the month it spends it on.
 *
 * This route took no body at all and committed `session.cycleId`. A client browsing November
 * on a September link who pressed Generate approved SEPTEMBER — every beat flipped to
 * 'generating', captions fanned out to Bedrock, and none of it undoable. It is the most
 * consequential instance of the link-scoping defect and the one with no recovery path, so the
 * cases below are about WHICH MONTH before they are about anything else.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  approveDraft: vi.fn(),
  startPhase2: vi.fn(),
  owned: new Set<string>(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/draft-approval', () => ({ approveDraft: (...a: unknown[]) => h.approveDraft(...a) }));
vi.mock('@/lib/phase2', () => ({ startPhase2: (...a: unknown[]) => h.startPhase2(...a) }));
vi.mock('@/lib/agent/cycle-state', () => ({
  cycleBelongsToClient: async (_c: string, id: string) => h.owned.has(id),
}));

import { POST } from './route';

const CLIENT  = 'client-1';
const SESSION = '11111111-1111-4111-8111-111111111111';   // the link's month
const VIEWED  = '22222222-2222-4222-8222-222222222222';   // the month on screen
const FOREIGN = '33333333-3333-4333-8333-333333333333';   // someone else's

const post = (body?: unknown) =>
  POST(new Request('http://x/api/plan/draft/approve', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: SESSION };
  h.approveDraft.mockReset().mockResolvedValue({ ok: true, approved: 4 });
  h.startPhase2.mockReset().mockResolvedValue({ captionsQueued: 4, hooksQueued: 1, failed: [] });
  h.owned.clear(); h.owned.add(SESSION); h.owned.add(VIEWED);
});

describe('auth', () => {
  it('refuses without a session, and commits nothing', async () => {
    h.session = null;
    expect((await post({ cycleId: VIEWED })).status).toBe(401);
    expect(h.approveDraft).not.toHaveBeenCalled();
    expect(h.startPhase2).not.toHaveBeenCalled();
  });
});

describe('the month approved is the month on screen', () => {
  it('commits the VIEWED cycle, not the session’s', async () => {
    const res = await post({ cycleId: VIEWED });
    expect(res.status).toBe(200);
    expect(h.approveDraft).toHaveBeenCalledWith({ clientId: CLIENT, cycleId: VIEWED });
  });

  /** Approving one month and generating another would be worse than either error alone. */
  it('fans out the SAME cycle it just approved', async () => {
    await post({ cycleId: VIEWED });
    expect(h.startPhase2).toHaveBeenCalledWith(CLIENT, VIEWED);
    expect(h.approveDraft.mock.calls[0]![0].cycleId).toBe(h.startPhase2.mock.calls[0]![1]);
  });

  it('falls back to the session’s cycle when none is sent — an older client still approves', async () => {
    await post({});
    expect(h.approveDraft).toHaveBeenCalledWith({ clientId: CLIENT, cycleId: SESSION });
    expect(h.startPhase2).toHaveBeenCalledWith(CLIENT, SESSION);
  });

  it('survives no body at all, as the route used to be called', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.approveDraft).toHaveBeenCalledWith({ clientId: CLIENT, cycleId: SESSION });
  });
});

describe('what it refuses, before spending anything', () => {
  it('REFUSES another client’s cycle — nothing approved, nothing queued', async () => {
    const res = await post({ cycleId: FOREIGN });
    expect(res.status).toBe(403);
    expect(h.approveDraft).not.toHaveBeenCalled();
    expect(h.startPhase2).not.toHaveBeenCalled();
  });

  /** The defence-in-depth case: a silent fallback here would approve a month the client was
   *  not looking at, irreversibly. Refusal is the only safe answer. */
  it('REFUSES a malformed cycle rather than defaulting to the session’s', async () => {
    for (const junk of ['not-a-uuid', '', ' ', 'DROP TABLE']) {
      h.approveDraft.mockClear(); h.startPhase2.mockClear();
      const res = await post({ cycleId: junk });
      if (junk.trim() === '') {
        // Empty string is ABSENT, not malformed — it falls back, like no body at all.
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(403);
        expect(h.approveDraft).not.toHaveBeenCalled();
        expect(h.startPhase2).not.toHaveBeenCalled();
      }
    }
  });

  it('does not fan out when the approval itself refused', async () => {
    h.approveDraft.mockResolvedValue({ ok: false, error: 'already_approved', message: 'done' });
    const res = await post({ cycleId: VIEWED });
    expect(res.status).toBe(409);
    expect(h.startPhase2).not.toHaveBeenCalled();
  });

  it.each([
    ['no_cycle',         404],
    ['no_draft',         409],
    ['mixed_state',      409],
    ['already_approved', 409],
    ['cutoff_passed',    409],
  ])('%s → %i, message passed through', async (error, status) => {
    h.approveDraft.mockResolvedValue({ ok: false, error, message: 'nope' });
    const res = await post({ cycleId: VIEWED });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error, message: 'nope' });
  });
});
