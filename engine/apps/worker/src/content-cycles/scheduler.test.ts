import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock('bullmq', () => ({ Worker: vi.fn() }));

vi.mock('@sprigly/db', () => ({
  db:             {},
  clients:        { id: {}, contentCycleEnabled: {} },
  clientChannels: { clientId: {}, channel: {}, driveFolderId: {} },
  contentCycles:  { clientId: {}, channel: {}, cycleMonth: {}, status: {} },
}));

vi.mock('drizzle-orm', () => ({
  eq:  vi.fn(() => 'eq'),
  and: vi.fn(() => 'and'),
}));

vi.mock('@sprigly/oauth-tokens', () => ({
  getTokens:   vi.fn().mockResolvedValue({ accessToken: 'tok' }),
  storeTokens: vi.fn().mockResolvedValue(undefined),
}));

const mockDriveInstance = {
  listFiles:    vi.fn(),
  downloadFile: vi.fn(),
};
vi.mock('@sprigly/sources', () => ({
  DriveApiClient: vi.fn().mockImplementation(() => mockDriveInstance),
}));

// consumer.ts imports needed by transitive dependencies
vi.mock('./extract.js',       () => ({ extractVoiceDeltasForCycle: vi.fn() }));
vi.mock('./apply.js',         () => ({ applyVoiceDeltasForCycle:  vi.fn() }));
vi.mock('../ig-producer.js',  () => ({ runIgTrawlJob:             vi.fn() }));
vi.mock('./stubs.js',         () => ({ requestEmailStub:          vi.fn() }));
vi.mock('@sprigly/prompts',   () => ({ DbPromptResolver:          vi.fn() }));
vi.mock('@sprigly/model-client', () => ({}));
vi.mock('@sprigly/audit',        () => ({}));

import {
  parseCycleSchedule,
  getLondonToday,
  getDataMonth,
  isDue,
  enqueueCycleForClient,
  runContentCycleTick,
  type CycleSchedule,
} from './scheduler.js';
import { igTrawlJobId, IG_TRAWL_JOB_OPTIONS } from './job-options.js';
import { getTokens } from '@sprigly/oauth-tokens';

const getTokensMock = getTokens as ReturnType<typeof vi.fn>;

const LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const DEFAULT_CALENDAR_CONFIG = {};  // no content_cycle_schedule → default (day=1)
const DUE_CONFIG              = { content_cycle_schedule: { day: 1,  hour: 6 } };
const NOT_YET_DUE_CONFIG      = { content_cycle_schedule: { day: 15, hour: 6 } };

// ── DB mock helpers ────────────────────────────────────────────────────────────

// For enqueueCycleForClient: single select().from().where().limit() + optional insert
function makeEnqueueDb(existingCycle?: { status: string }) {
  const selectChain = {
    from:  vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(existingCycle ? [existingCycle] : []),
  };
  const insertChain = {
    values:              vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  };
  const db = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
  };
  return { db: db as unknown as Parameters<typeof enqueueCycleForClient>[0]['db'], insertChain };
}

// For runContentCycleTick: first select = enabled-clients (directly awaitable),
// subsequent selects = cycle-status checks (awaited via .limit()).
function makeTickDb(
  enabledClients: Array<{ clientId: string; channel: string; driveFolderId: string | null }>,
  existingCycle?: { status: string } | null,
) {
  let selectIdx = 0;

  function makeEnabledChain() {
    const resolved = Promise.resolve(enabledClients);
    const chain: Record<string, () => unknown> = {} as Record<string, () => unknown>;
    for (const m of ['from', 'innerJoin', 'where']) {
      chain[m] = vi.fn().mockReturnValue({
        ...chain,
        then:    resolved.then.bind(resolved),
        catch:   resolved.catch.bind(resolved),
        finally: resolved.finally.bind(resolved),
      });
    }
    // Make the chain itself thenable so `await db.select().from().innerJoin().where()` resolves
    return {
      from:    vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where:   vi.fn().mockReturnValue({
        then:    resolved.then.bind(resolved),
        catch:   resolved.catch.bind(resolved),
        finally: resolved.finally.bind(resolved),
      }),
    };
  }

  function makeCycleCheckChain() {
    return {
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(existingCycle ? [existingCycle] : []),
    };
  }

  const insertChain = {
    values:              vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  };

  const db = {
    select: vi.fn().mockImplementation(() =>
      selectIdx++ === 0 ? makeEnabledChain() : makeCycleCheckChain(),
    ),
    insert: vi.fn().mockReturnValue(insertChain),
  };

  return { db: db as unknown as Parameters<typeof runContentCycleTick>[0]['db'], insertChain };
}

function makeQueue() {
  const add = vi.fn().mockResolvedValue({ id: 'j1' });
  return { queue: { add } as unknown as Parameters<typeof enqueueCycleForClient>[0]['queue'], add };
}

const ENC_PROVIDER = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  getTokensMock.mockResolvedValue({ accessToken: 'tok' });
  mockDriveInstance.listFiles.mockResolvedValue([{ id: 'cfg-id', name: 'calendar-config.json' }]);
  mockDriveInstance.downloadFile.mockResolvedValue(
    Buffer.from(JSON.stringify(DEFAULT_CALENDAR_CONFIG)),
  );
});

// ── Pure function: parseCycleSchedule ────────────────────────────────────────

describe('parseCycleSchedule', () => {
  it('returns default and logs info when content_cycle_schedule is absent', () => {
    const schedule = parseCycleSchedule({}, LOGGER as never, {});
    expect(schedule).toEqual({ day: 1, hour: 6 });
    expect(LOGGER.info).toHaveBeenCalledOnce();
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: { day: 1, hour: 6 } }),
      expect.any(String),
    );
  });

  it('parses day and hour from the config', () => {
    const schedule = parseCycleSchedule(
      { content_cycle_schedule: { day: 5, hour: 8 } },
      LOGGER as never,
      {},
    );
    expect(schedule).toEqual({ day: 5, hour: 8 });
    expect(LOGGER.info).not.toHaveBeenCalled();
  });

  it('clamps day to 1–28', () => {
    const lo = parseCycleSchedule({ content_cycle_schedule: { day: 0,  hour: 6 } }, LOGGER as never, {});
    const hi = parseCycleSchedule({ content_cycle_schedule: { day: 31, hour: 6 } }, LOGGER as never, {});
    expect(lo.day).toBe(1);
    expect(hi.day).toBe(28);
  });
});

// ── Pure function: getDataMonth ───────────────────────────────────────────────

describe('getDataMonth', () => {
  it('returns the previous month for a mid-year date', () => {
    expect(getDataMonth({ year: 2026, month: 6 })).toBe('2026-05');
  });

  it('wraps to December of previous year on January', () => {
    expect(getDataMonth({ year: 2027, month: 1 })).toBe('2026-12');
  });

  it('zero-pads single-digit months', () => {
    expect(getDataMonth({ year: 2026, month: 2 })).toBe('2026-01');
  });
});

// ── Pure function: isDue ──────────────────────────────────────────────────────

describe('isDue', () => {
  const s: CycleSchedule = { day: 5, hour: 6 };

  it('returns true when today.day equals schedule.day', () =>
    expect(isDue(s, { day: 5 })).toBe(true));

  it('returns true when today.day is past schedule.day', () =>
    expect(isDue(s, { day: 15 })).toBe(true));

  it('returns false when today.day is before schedule.day', () =>
    expect(isDue(s, { day: 4 })).toBe(false));
});

// ── Pure function: getLondonToday ─────────────────────────────────────────────

describe('getLondonToday', () => {
  it('converts a UTC Date to Europe/London local date parts', () => {
    // 2026-06-15T05:30:00Z is 06:30 BST (UTC+1) → 15 June 2026
    const result = getLondonToday(new Date('2026-06-15T05:30:00Z'));
    expect(result).toEqual({ year: 2026, month: 6, day: 15 });
  });

  it('applies winter offset (UTC → UTC+0 in London)', () => {
    // 2027-01-01T00:30:00Z is 00:30 GMT (UTC+0) → 1 January 2027
    const result = getLondonToday(new Date('2027-01-01T00:30:00Z'));
    expect(result).toEqual({ year: 2027, month: 1, day: 1 });
  });
});

// ── enqueueCycleForClient ─────────────────────────────────────────────────────

describe('enqueueCycleForClient', () => {
  const BASE = { clientId: 'c1', channel: 'instagram', dataMonth: '2026-05' };

  it('enqueues ig-trawl with deterministic jobId and IG_TRAWL_JOB_OPTIONS when no cycle exists', async () => {
    const { db } = makeEnqueueDb();
    const { queue, add } = makeQueue();

    const result = await enqueueCycleForClient({ db, queue, logger: LOGGER as never, ...BASE });

    expect(result).toBe('enqueued');
    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'ig-trawl',
      { type: 'ig-trawl', ...BASE },
      expect.objectContaining({
        jobId:    igTrawlJobId('c1', 'instagram', '2026-05'),
        attempts: IG_TRAWL_JOB_OPTIONS.attempts,
      }),
    );
  });

  it('returns skipped and does NOT call queue.add when cycle is already requested', async () => {
    const { db } = makeEnqueueDb({ status: 'requested' });
    const { queue, add } = makeQueue();

    const result = await enqueueCycleForClient({ db, queue, logger: LOGGER as never, ...BASE });

    expect(result).toBe('skipped');
    expect(add).not.toHaveBeenCalled();
  });

  it('returns skipped for any post-requested status (e.g. delivered)', async () => {
    const { db } = makeEnqueueDb({ status: 'delivered' });
    const { queue, add } = makeQueue();

    const result = await enqueueCycleForClient({ db, queue, logger: LOGGER as never, ...BASE });

    expect(result).toBe('skipped');
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueues even when a "scheduled" row already exists (job may have been lost from Redis)', async () => {
    const { db } = makeEnqueueDb({ status: 'scheduled' });
    const { queue, add } = makeQueue();

    const result = await enqueueCycleForClient({ db, queue, logger: LOGGER as never, ...BASE });

    expect(result).toBe('enqueued');
    expect(add).toHaveBeenCalledOnce();
  });

  it('produces the same jobId on repeated calls — BullMQ deduplicates via jobId', async () => {
    // Both calls enqueue, both produce the same jobId.
    // BullMQ's own dedup mechanism ensures only one job runs.
    const call1 = async () => {
      const { db } = makeEnqueueDb();
      const { queue, add } = makeQueue();
      await enqueueCycleForClient({ db, queue, logger: LOGGER as never, ...BASE });
      return (add.mock.calls[0]![2] as Record<string, unknown>)['jobId'];
    };
    const call2 = async () => {
      const { db } = makeEnqueueDb();
      const { queue, add } = makeQueue();
      await enqueueCycleForClient({ db, queue, logger: LOGGER as never, ...BASE });
      return (add.mock.calls[0]![2] as Record<string, unknown>)['jobId'];
    };
    expect(await call1()).toBe(await call2());
    expect(await call1()).toBe(igTrawlJobId('c1', 'instagram', '2026-05'));
  });
});

// ── runContentCycleTick ───────────────────────────────────────────────────────

describe('runContentCycleTick', () => {
  const BASE_TICK_PARAMS = {
    encProvider:        ENC_PROVIDER,
    googleClientId:     'gid',
    googleClientSecret: 'gsecret',
    logger:             LOGGER as never,
    // now injected per test
  };

  // Day 5 of June 2026 in London (UTC+1 BST): tick at 05:00 London is 04:00 UTC
  const DAY_5_JUN_2026 = new Date('2026-06-05T04:00:00Z');

  it('enqueues ig-trawl for an enabled, due client', async () => {
    mockDriveInstance.downloadFile.mockResolvedValue(
      Buffer.from(JSON.stringify(DUE_CONFIG)),  // schedule day=1, today=5 → due
    );
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', driveFolderId: 'f1' }],
      null,
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ ...BASE_TICK_PARAMS, db, queue, now: DAY_5_JUN_2026 });

    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'ig-trawl',
      expect.objectContaining({ clientId: 'c1', channel: 'instagram', dataMonth: '2026-05' }),
      expect.objectContaining({ jobId: igTrawlJobId('c1', 'instagram', '2026-05') }),
    );
  });

  it('skips an enabled client when today is before the scheduled day', async () => {
    mockDriveInstance.downloadFile.mockResolvedValue(
      Buffer.from(JSON.stringify(NOT_YET_DUE_CONFIG)),  // schedule day=15, today=5 → not due
    );
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', driveFolderId: 'f1' }],
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ ...BASE_TICK_PARAMS, db, queue, now: DAY_5_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: { day: 15, hour: 6 } }),
      expect.stringContaining('not yet due'),
    );
  });

  it('skips when a cycle is already active (status = requested)', async () => {
    mockDriveInstance.downloadFile.mockResolvedValue(
      Buffer.from(JSON.stringify(DUE_CONFIG)),
    );
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', driveFolderId: 'f1' }],
      { status: 'requested' },
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ ...BASE_TICK_PARAMS, db, queue, now: DAY_5_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
  });

  it('produces no queue.add when there are no enabled clients', async () => {
    const { db } = makeTickDb([]);
    const { queue, add } = makeQueue();

    await runContentCycleTick({ ...BASE_TICK_PARAMS, db, queue, now: DAY_5_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
  });

  it('skips a client that has no Drive tokens and does not throw', async () => {
    getTokensMock.mockResolvedValue(null);  // no tokens
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', driveFolderId: 'f1' }],
    );
    const { queue, add } = makeQueue();

    await expect(
      runContentCycleTick({ ...BASE_TICK_PARAMS, db, queue, now: DAY_5_JUN_2026 }),
    ).resolves.toBeUndefined();

    expect(add).not.toHaveBeenCalled();
    expect(LOGGER.warn).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1' }),
      expect.stringContaining('no Drive tokens'),
    );
  });

  it('skips a client when Drive read throws and continues to the next client', async () => {
    getTokensMock.mockRejectedValue(new Error('Redis unavailable'));
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', driveFolderId: 'f1' }],
    );
    const { queue, add } = makeQueue();

    await expect(
      runContentCycleTick({ ...BASE_TICK_PARAMS, db, queue, now: DAY_5_JUN_2026 }),
    ).resolves.toBeUndefined();

    expect(add).not.toHaveBeenCalled();
    expect(LOGGER.warn).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1', err: 'Error: Redis unavailable' }),
      expect.any(String),
    );
  });

  it('uses default schedule when calendar-config.json is absent from Drive', async () => {
    // listFiles returns no calendar-config.json
    mockDriveInstance.listFiles.mockResolvedValue([]);
    // schedule defaults to day=1; today=5 → due
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', driveFolderId: 'f1' }],
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ ...BASE_TICK_PARAMS, db, queue, now: DAY_5_JUN_2026 });

    expect(add).toHaveBeenCalledOnce();
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1' }),
      expect.stringContaining('using default schedule'),
    );
  });
});
