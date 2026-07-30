/**
 * follow-on-generation.test.ts — F5's split, at the seam itself.
 *
 * carousel → the standalone hook job, autoSelect (no human is mid-flow to pick).
 * reel     → NOTHING here: its {hook, script} is one combined job whose input is the caption,
 *            enqueued by the worker when the caption lands (script-ready.ts).
 * single   → hooks don't apply.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ enqueueHook: vi.fn() }));

vi.mock('./usage', () => ({ getUsageForCycle: vi.fn(), isRewriteBlocked: vi.fn() }));
vi.mock('./queue', () => ({ enqueueShape: vi.fn(), enqueueHookJob: (...a: unknown[]) => h.enqueueHook(...a) }));
vi.mock('./mutations', () => ({ markPostGenerating: vi.fn(), markPostGenerationFailed: vi.fn() }));
vi.mock('./edit-scope', () => ({ editScopeToday: () => '2026-07-30' }));

import { enqueueFollowOnGeneration } from './post-generation';

beforeEach(() => { h.enqueueHook.mockReset().mockResolvedValue({ jobId: 'hook_c_p' }); });

describe('enqueueFollowOnGeneration', () => {
  it('a carousel gets its hook, autoSelect', async () => {
    await enqueueFollowOnGeneration('c1', 'cyc', 'p1', 'carousel');
    expect(h.enqueueHook).toHaveBeenCalledWith({ type: 'hook', clientId: 'c1', cycleId: 'cyc', targetPostId: 'p1', autoSelect: true });
  });

  it('a reel gets nothing here — the combined job is the worker’s, on caption completion', async () => {
    await enqueueFollowOnGeneration('c1', 'cyc', 'p1', 'reel');
    expect(h.enqueueHook).not.toHaveBeenCalled();
  });

  it('a single gets nothing — hooks don’t apply', async () => {
    await enqueueFollowOnGeneration('c1', 'cyc', 'p1', 'single');
    expect(h.enqueueHook).not.toHaveBeenCalled();
  });

  it('a hook enqueue failure never throws — an enhancement must not fail the add', async () => {
    h.enqueueHook.mockRejectedValue(new Error('redis down'));
    await expect(enqueueFollowOnGeneration('c1', 'cyc', 'p1', 'carousel')).resolves.toBeUndefined();
  });
});
