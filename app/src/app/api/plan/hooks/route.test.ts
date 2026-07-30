/**
 * hooks route — C4: a REEL never takes the solo-hook path.
 *
 * ── The reachable generation entry points for a reel, established ────────────────────
 *
 *   1. detail sheet · Script tab   → POST /api/plan/script  → enqueueScriptJob  (combined) ✓
 *   2. detail sheet · Hook tab     → POST /api/plan/hooks   → enqueueHookJob    (SOLO)  ✗ ← here
 *   3. agent "generate hooks"      → proposals.ts approve   → enqueueHookJob    (SOLO)  ✗
 *   4. phase-2 fan-out             → HOOK_FORMATS = carousel only; reels via script-ready ✓
 *   5. add path (F5)               → enqueueFollowOnGeneration → carousel only           ✓
 *
 * (2) and (3) were the two solo routes. `script.ts` writes a reel's hook AND script in ONE
 * model call precisely so they cannot disagree ("the split this replaces welded a mismatched
 * hook onto a reel", 73bf1f7) — a hook written by (2) had never seen the script that followed
 * it, which is the operator's video. Both now redirect to the combined job.
 *
 * These tests assert the JOB, which is what decides coherence: one enqueue, of the combined
 * kind, grounded on the caption — not two calls whose outputs are compared afterwards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: { clientId: 'c1', cycleId: 'cyc-1' } as { clientId: string; cycleId: string } | null,
  posts: [] as Record<string, unknown>[],
  gate: { ok: true, cycleId: 'cyc-1', scheduledDate: '2999-01-01', channel: 'instagram' } as Record<string, unknown>,
  enqueueHook: vi.fn(),
  enqueueScript: vi.fn(),
}));

vi.mock('@sprigly/db', () => ({
  hasRealCaption: (c: unknown) => typeof c === 'string' && c.trim().length > 0 && !c.startsWith('Draft idea.'),
}));
vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => h.posts }));
vi.mock('@/lib/edit-scope', () => ({
  gatePostEdit: async () => h.gate,
  editScopeToday: () => '2026-07-30',
}));
vi.mock('@/lib/queue', () => ({
  enqueueHookJob: (...a: unknown[]) => h.enqueueHook(...a),
  enqueueScriptJob: (...a: unknown[]) => h.enqueueScript(...a),
}));

import { POST } from './route';

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1', format: 'reel', caption: 'Sixty seconds on why natural fibres earn their keep',
  scriptLengthSeconds: null, ...over,
});

const call = () => POST(new Request('http://x/api/plan/hooks', {
  method: 'POST', body: JSON.stringify({ targetPostId: 'p1' }),
}));

beforeEach(() => {
  h.session = { clientId: 'c1', cycleId: 'cyc-1' };
  h.gate = { ok: true, cycleId: 'cyc-1', scheduledDate: '2999-01-01', channel: 'instagram' };
  h.posts = [post()];
  h.enqueueHook.mockReset().mockResolvedValue({ jobId: 'hook_cyc-1_p1' });
  h.enqueueScript.mockReset().mockResolvedValue({ jobId: 'script_cyc-1_p1' });
});

describe('a REEL is redirected to the combined hook+script job', () => {
  it('enqueues the COMBINED job — once — and never the solo hook', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'pending', jobId: 'script_cyc-1_p1', combined: true });

    // ONE enqueue, of the combined kind: one job, one Bedrock sequence, one coherent pair.
    expect(h.enqueueScript).toHaveBeenCalledTimes(1);
    expect(h.enqueueScript).toHaveBeenCalledWith({
      type: 'script', clientId: 'c1', cycleId: 'cyc-1', targetPostId: 'p1', lengthSeconds: 30,
    });
    expect(h.enqueueHook).not.toHaveBeenCalled();
  });

  it('honours the post’s own script length when it has one', async () => {
    h.posts = [post({ scriptLengthSeconds: 60 })];
    await call();
    expect(h.enqueueScript).toHaveBeenCalledWith(expect.objectContaining({ lengthSeconds: 60 }));
  });

  it('is GROUNDED ON THE CAPTION: no real caption → 422, and nothing is enqueued', async () => {
    h.posts = [post({ caption: '' })];
    const res = await call();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('caption_required');
    expect(h.enqueueScript).not.toHaveBeenCalled();
    expect(h.enqueueHook).not.toHaveBeenCalled();
  });

  it('the DRAFT PLACEHOLDER is not a caption either — the fresh-reel case', async () => {
    h.posts = [post({ caption: 'Draft idea. Tell Sprigly what this post should be about…' })];
    expect((await call()).status).toBe(422);
    expect(h.enqueueScript).not.toHaveBeenCalled();
  });

  it('a job already in flight is a noop, not a second sequence', async () => {
    h.enqueueScript.mockResolvedValue({ busy: true, jobId: 'script_cyc-1_p1' });
    const res = await call();
    expect((await res.json()).mode).toBe('noop');
  });
});

describe('a CAROUSEL keeps the standalone hook — it has no script to cohere with', () => {
  it('enqueues the hook job and returns candidates to pick from', async () => {
    h.posts = [post({ format: 'carousel' })];
    const res = await call();
    expect(await res.json()).toEqual({ mode: 'pending', jobId: 'hook_cyc-1_p1' });
    expect(h.enqueueHook).toHaveBeenCalledTimes(1);
    expect(h.enqueueScript).not.toHaveBeenCalled();
  });

  it('and a carousel with no caption is NOT refused — its hook does not need one', async () => {
    h.posts = [post({ format: 'carousel', caption: '' })];
    expect((await call()).status).toBe(200);
    expect(h.enqueueHook).toHaveBeenCalled();
  });
});

describe('the unchanged guards', () => {
  it('a single image is refused', async () => {
    h.posts = [post({ format: 'single' })];
    expect((await call()).status).toBe(422);
  });

  it('no session is 401', async () => {
    h.session = null;
    expect((await call()).status).toBe(401);
  });

  it('a past-dated post is refused by the date gate', async () => {
    h.gate = { ok: false, status: 403, error: 'read_only' };
    expect((await call()).status).toBe(403);
    expect(h.enqueueScript).not.toHaveBeenCalled();
  });
});
