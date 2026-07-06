/**
 * queue.test.ts — regression guard for audit §7.5 (silent instruction loss).
 *
 * A second instruction for the same post while one is active/waiting must be
 * reported as `busy`, NOT silently returned as an accepted jobId — otherwise
 * the new instruction is dropped and the UI shows the first job's result.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ add: vi.fn(), getJob: vi.fn() }));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: h.add, getJob: h.getJob })),
}));

import { enqueueShape, shapeJobId, type ShapePayload } from './queue';

const payload: ShapePayload = {
  type: 'shape', scope: 'post', clientId: 'C1', cycleId: 'CY1',
  targetPostId: 'P1', instruction: 'make it warmer', source: 'web',
};
const JOB_ID = shapeJobId('CY1', 'P1');

beforeEach(() => {
  h.add.mockReset();
  h.getJob.mockReset();
  process.env.REDIS_URL = 'redis://localhost:6379';
});

describe('enqueueShape dedup', () => {
  it('enqueues when no job exists for the post', async () => {
    h.getJob.mockResolvedValue(undefined);
    const r = await enqueueShape(payload);
    expect(r).toEqual({ jobId: JOB_ID });
    expect(h.add).toHaveBeenCalledTimes(1);
  });

  it('does NOT silently drop a second instruction while one is active', async () => {
    h.getJob.mockResolvedValue({ getState: async () => 'active' });
    const r = await enqueueShape({ ...payload, instruction: 'a completely different change' });
    expect(r).toEqual({ busy: true, jobId: JOB_ID });
    expect(h.add).not.toHaveBeenCalled();
  });

  it('treats a waiting job as busy too', async () => {
    h.getJob.mockResolvedValue({ getState: async () => 'waiting' });
    const r = await enqueueShape(payload);
    expect(r).toEqual({ busy: true, jobId: JOB_ID });
    expect(h.add).not.toHaveBeenCalled();
  });

  it('clears a completed slot and re-enqueues', async () => {
    const remove = vi.fn();
    h.getJob.mockResolvedValue({ getState: async () => 'completed', remove });
    const r = await enqueueShape(payload);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(h.add).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ jobId: JOB_ID });
  });

  it('returns an error when Redis is not configured', async () => {
    delete process.env.REDIS_URL;
    const r = await enqueueShape(payload);
    expect('error' in r).toBe(true);
    expect(h.add).not.toHaveBeenCalled();
  });
});
