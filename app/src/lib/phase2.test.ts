/**
 * phase2.test.ts — the fan-out.
 *
 * The properties worth pinning: one job per post, hooks only where they apply, and — the
 * one that matters most — a single failure lands on ONE post rather than blocking the month.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  posts: [] as unknown[],
  enqueueShape: vi.fn(),
  enqueueHookJob: vi.fn(),
  logged: [] as unknown[],
}));

let updateWrites: { payload: unknown }[] = [];

vi.mock('@sprigly/db', () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q['from']    = vi.fn(() => q);
    q['where']   = vi.fn(() => q);
    q['orderBy'] = vi.fn(() => Promise.resolve(h.posts));
    q['limit']   = vi.fn(() => Promise.resolve([{ sourceMeta: {} }]));
    return q;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: {
      select: vi.fn(() => chain()),
      update: vi.fn(() => ({ set: vi.fn((payload: unknown) => ({ where: vi.fn(() => { updateWrites.push({ payload }); return Promise.resolve(); }) })) })),
    } as any,
    contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
    contentCycles:     new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
    auditLog:          new Proxy({}, { get: (_t, k) => `auditLog.${String(k)}` }),
    POST_STATUS_DRAFT: 'draft',
    PRE_PLANNING_STATUSES: new Set(['scheduled']),
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a, eq: (a: unknown, b: unknown) => ['eq', a, b],
  ne: (a: unknown, b: unknown) => ['ne', a, b], isNull: (a: unknown) => ['isNull', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b], sql: Object.assign(() => 'sql', { raw: () => 'sql' }),
}));

vi.mock('@/lib/queue', () => ({
  enqueueShape:   (...a: unknown[]) => h.enqueueShape(...a),
  enqueueHookJob: (...a: unknown[]) => h.enqueueHookJob(...a),
}));

vi.mock('@/lib/phase2-cost', () => ({
  recordPhase2Run: async (s: unknown) => { h.logged.push(s); },
}));

import { startPhase2 } from '@/lib/phase2';

const CLIENT = 'client-1', CYCLE = 'cycle-1';
const post = (id: string, format: string) => ({ id, format, pillar: 'Everyday Ritual', sourceMeta: { title: `${id} title` } });

beforeEach(() => {
  h.posts = []; h.logged = []; updateWrites = [];
  h.enqueueShape.mockReset().mockResolvedValue({ jobId: 'j1' });
  h.enqueueHookJob.mockReset().mockResolvedValue({ jobId: 'j2' });
});

describe('startPhase2 — one job per post', () => {
  it('queues a caption for every approved beat', async () => {
    h.posts = [post('a', 'single'), post('b', 'carousel'), post('c', 'reel')];
    const res = await startPhase2(CLIENT, CYCLE);
    expect(res.captionsQueued).toBe(3);
    expect(h.enqueueShape).toHaveBeenCalledTimes(3);
  });

  it('queues hooks for reels and carousels ONLY', async () => {
    h.posts = [post('a', 'single'), post('b', 'carousel'), post('c', 'reel')];
    const res = await startPhase2(CLIENT, CYCLE);
    expect(res.hooksQueued).toBe(2);
    const targets = h.enqueueHookJob.mock.calls.map((c) => (c[0] as { targetPostId: string }).targetPostId);
    expect(targets.sort()).toEqual(['b', 'c']);
  });

  it('names the slot in the caption instruction, without restating what the row carries', async () => {
    h.posts = [post('a', 'carousel')];
    await startPhase2(CLIENT, CYCLE);
    const payload = h.enqueueShape.mock.calls[0]![0] as { instruction: string; scope: string; targetPostId: string };
    expect(payload.instruction).toContain('a title');
    expect(payload.instruction).toContain('Everyday Ritual');
    expect(payload.scope).toBe('post');           // per-post — structure never in scope
    expect(payload.targetPostId).toBe('a');
  });

  it('records the fan-out shape for the cost guard', async () => {
    h.posts = [post('a', 'reel'), post('b', 'single')];
    await startPhase2(CLIENT, CYCLE);
    expect(h.logged[0]).toMatchObject({ cycleId: CYCLE, postsTotal: 2, captionsQueued: 2, hooksQueued: 1, enqueueFailures: 0 });
  });

  it('does nothing gracefully for an empty cycle', async () => {
    const res = await startPhase2(CLIENT, CYCLE);
    expect(res).toMatchObject({ captionsQueued: 0, hooksQueued: 0, failed: [] });
  });
});

describe('partial failure — the month is never all-or-nothing', () => {
  it('one caption failing does not stop the others', async () => {
    h.posts = [post('a', 'single'), post('b', 'single'), post('c', 'single')];
    h.enqueueShape
      .mockResolvedValueOnce({ jobId: 'j1' })
      .mockResolvedValueOnce({ error: 'redis unavailable' })
      .mockResolvedValueOnce({ jobId: 'j3' });

    const res = await startPhase2(CLIENT, CYCLE);
    expect(res.captionsQueued).toBe(2);          // the other two still went
    expect(res.failed).toEqual([{ postId: 'b', reason: 'redis unavailable' }]);
  });

  it('marks the failed post visibly rather than leaving it stuck in generating', async () => {
    h.posts = [post('a', 'single')];
    h.enqueueShape.mockResolvedValue({ error: 'redis unavailable' });
    await startPhase2(CLIENT, CYCLE);
    // A row stuck in 'generating' with nothing working on it is invisible to the client
    // and un-retryable. It has to land somewhere they can see and act on.
    expect(updateWrites[0]!.payload).toMatchObject({ status: 'generation_failed' });
    expect(JSON.stringify(updateWrites[0]!.payload)).toContain('redis unavailable');
  });

  it('a HOOK failure is not a post failure — the caption is the post', async () => {
    h.posts = [post('a', 'reel')];
    h.enqueueHookJob.mockResolvedValue({ error: 'redis unavailable' });
    const res = await startPhase2(CLIENT, CYCLE);
    expect(res.captionsQueued).toBe(1);
    expect(res.hooksQueued).toBe(0);
    expect(res.failed).toEqual([]);              // the post is fine
    expect(updateWrites).toHaveLength(0);        // and not marked failed
  });

  it('still records the run when everything failed', async () => {
    h.posts = [post('a', 'single'), post('b', 'single')];
    h.enqueueShape.mockResolvedValue({ error: 'down' });
    await startPhase2(CLIENT, CYCLE);
    expect(h.logged[0]).toMatchObject({ captionsQueued: 0, enqueueFailures: 2 });
  });
});
