/**
 * weekly-cron.test.ts — cron registration respects the env flag; the tick fans out
 * one job per client with an active cycle.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { registerWeeklySessionCron, runWeeklySessionTick, londonWeekStart } from './weekly-cron.js';

function fakeQueue() {
  const add = vi.fn(async (..._args: unknown[]) => ({}));
  return { queue: { add } as unknown as Queue, add };
}

describe('registerWeeklySessionCron', () => {
  it('does NOT register when disabled', async () => {
    const { queue, add } = fakeQueue();
    const registered = await registerWeeklySessionCron(queue, false);
    expect(registered).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('registers the Monday repeatable when enabled', async () => {
    const { queue, add } = fakeQueue();
    const registered = await registerWeeklySessionCron(queue, true);
    expect(registered).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    const [name, , opts] = add.mock.calls[0]!;
    expect(name).toBe('weekly-session-tick');
    expect((opts as { repeat: { pattern: string; tz: string } }).repeat).toEqual({ pattern: '0 6 * * 1', tz: 'Europe/London' });
  });
});

describe('runWeeklySessionTick', () => {
  it('enqueues one weekly-session per client with an active cycle (most recent), skipping non-active', async () => {
    const { queue, add } = fakeQueue();
    const rows = [
      { id: 'cyc-a1', clientId: 'client-a', status: 'active', createdAt: new Date('2026-06-01') },
      { id: 'cyc-a2', clientId: 'client-a', status: 'active', createdAt: new Date('2026-07-01') }, // newer wins
      { id: 'cyc-b', clientId: 'client-b', status: 'closed', createdAt: new Date('2026-07-01') },   // skipped
      { id: 'cyc-c', clientId: 'client-c', status: 'delivered', createdAt: new Date('2026-07-01') },
    ];
    const db = { select: () => ({ from: () => Promise.resolve(rows) }) } as never;
    const logger = { info: vi.fn() } as never;

    await runWeeklySessionTick({ db, queue, logger }, new Date('2026-07-15T09:00:00Z'));

    const enqueued = add.mock.calls.map((c) => (c[1] as { cycleId: string }).cycleId).sort();
    expect(enqueued).toEqual(['cyc-a2', 'cyc-c']); // client-a's newer cycle + client-c; client-b skipped
  });
});

describe('londonWeekStart', () => {
  it('returns the Monday of the week', () => {
    expect(londonWeekStart(new Date('2026-07-15T12:00:00Z'))).toBe('2026-07-13'); // Wed → Mon 13th
    expect(londonWeekStart(new Date('2026-07-13T12:00:00Z'))).toBe('2026-07-13'); // Mon → itself
  });
});
