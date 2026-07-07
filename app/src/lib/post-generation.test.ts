/**
 * post-generation.test.ts — startPostGeneration: quota gate, enqueue-once, and
 * the truthful failed state on block/enqueue-error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  usage: { used: 0, limit: 30, unlimited: false } as Record<string, unknown>,
  blocked: false,
  enqueue: vi.fn(),
  markGenerating: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock('./usage', () => ({ getUsageForCycle: async () => h.usage, isRewriteBlocked: () => h.blocked }));
vi.mock('./queue', () => ({ enqueueShape: (...a: unknown[]) => h.enqueue(...a) }));
vi.mock('./mutations', () => ({
  markPostGenerating: (...a: unknown[]) => h.markGenerating(...a),
  markPostGenerationFailed: (...a: unknown[]) => h.markFailed(...a),
}));

import { startPostGeneration } from './post-generation';

beforeEach(() => {
  h.blocked = false; h.usage = { used: 0, limit: 30, unlimited: false };
  h.enqueue.mockReset().mockResolvedValue({ jobId: 'shape_cycle-1_post-9' });
  h.markGenerating.mockReset(); h.markFailed.mockReset();
});

describe('startPostGeneration', () => {
  it('quota OK → marks generating and enqueues one shape job with the instruction', async () => {
    const r = await startPostGeneration('client-1', 'cycle-1', 'post-9', 'make it about linen');
    expect(r).toEqual({ jobId: 'shape_cycle-1_post-9' });
    expect(h.markGenerating).toHaveBeenCalledWith('client-1', 'cycle-1', 'post-9', 'make it about linen');
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue.mock.calls[0]![0]).toMatchObject({ scope: 'post', targetPostId: 'post-9', instruction: 'make it about linen' });
    expect(h.markFailed).not.toHaveBeenCalled();
  });

  it('quota exhausted → marks failed, does NOT enqueue', async () => {
    h.blocked = true;
    const r = await startPostGeneration('client-1', 'cycle-1', 'post-9', 'x');
    expect('blocked' in r && r.blocked).toBe(true);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.markFailed).toHaveBeenCalledTimes(1);
    expect(h.markGenerating).not.toHaveBeenCalled();
  });

  it('enqueue error → marks failed and surfaces the error', async () => {
    h.enqueue.mockResolvedValue({ error: 'redis down' });
    const r = await startPostGeneration('client-1', 'cycle-1', 'post-9', 'x');
    expect(r).toEqual({ error: 'redis down' });
    expect(h.markFailed).toHaveBeenCalledWith('client-1', 'cycle-1', 'post-9', 'redis down');
  });
});
