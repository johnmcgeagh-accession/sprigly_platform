import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock('bullmq', () => ({ Worker: vi.fn() }));

vi.mock('@sprigly/db', () => ({
  db:             {},
  clients:        { id: {}, contentCycleEnabled: {} },
  clientChannels: { clientId: {}, channel: {}, contentCycleSchedule: {} },
  contentCycles:  { id: {}, clientId: {}, channel: {}, cycleMonth: {}, status: {}, intakeJson: {}, createdAt: {} },
  planInputs:     { id: {}, clientId: {}, type: {}, status: {}, createdAt: {} },
}));

vi.mock('drizzle-orm', () => ({
  eq:      vi.fn(() => 'eq'),
  and:     vi.fn(() => 'and'),
  gte:     vi.fn(() => 'gte'),
  inArray: vi.fn(() => 'inArray'),
}));

// scheduler.ts imports questionsForChannel + the shared touch derivation from @sprigly/engine.
// Keep the real touch derivation (importOriginal) so the sender + shared logic can't diverge;
// override the question list at its consumption point — buildQuestionsBlock now goes through
// questionsForChannel (not BASE_QUESTIONS directly), so we stub that with a stable base + the same
// string-filter/order the real helper applies, keeping the questions-block assertion stable.
vi.mock('@sprigly/engine', async (importOriginal) => {
  const BASE = ['Q1 dates?', 'Q2 new?'];
  return {
    ...(await importOriginal<typeof import('@sprigly/engine')>()),
    BASE_QUESTIONS: BASE,
    questionsForChannel: (channel: { extraQuestions?: readonly unknown[] | null }) => {
      const extra = Array.isArray(channel.extraQuestions)
        ? channel.extraQuestions.filter((q): q is string => typeof q === 'string')
        : [];
      return [...BASE, ...extra];
    },
  };
});

// consumer.ts imports needed by transitive dependencies
vi.mock('./extract.js',       () => ({ extractVoiceDeltasForCycle: vi.fn() }));
vi.mock('./apply.js',         () => ({ applyVoiceDeltasForCycle:  vi.fn() }));
vi.mock('../ig-producer.js',  () => ({ runIgTrawlJob:             vi.fn() }));
vi.mock('./stubs.js',         () => ({ requestEmailStub:          vi.fn() }));
vi.mock('@sprigly/prompts',   () => ({ DbPromptResolver:          vi.fn() }));
vi.mock('@sprigly/model-client', () => ({}));
vi.mock('@sprigly/audit',        () => ({}));

import {
  getLondonToday,
  getDataMonth,
  isDue,
  enqueueCycleForClient,
  runContentCycleTick,
  planAutoRunTransitions,
  dueTouch,
  evaluateThreeTouchForClient,
  type CycleSchedule,
} from './scheduler.js';
import { igTrawlJobId, IG_TRAWL_JOB_OPTIONS } from './job-options.js';

const LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

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
  enabledClients: Array<{ clientId: string; channel: string; contentCycleSchedule: { day: number; hour: number; cutoffDay?: number } | null }>,
  existingCycle?: { status: string } | null,
) {
  let selectIdx = 0;

  function makeEnabledChain() {
    const resolved = Promise.resolve(enabledClients);
    return {
      from:      vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where:     vi.fn().mockReturnValue({
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

beforeEach(() => { vi.clearAllMocks(); });

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
  // Day 5 of June 2026 in London (UTC+1 BST): tick at 05:00 London is 04:00 UTC
  const DAY_5_JUN_2026 = new Date('2026-06-05T04:00:00Z');

  it('enqueues ig-trawl for an enabled, due client (schedule from DB)', async () => {
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', contentCycleSchedule: { day: 1, hour: 6 } }],
      null,
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_5_JUN_2026 });

    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'ig-trawl',
      expect.objectContaining({ clientId: 'c1', channel: 'instagram', dataMonth: '2026-05' }),
      expect.objectContaining({ jobId: igTrawlJobId('c1', 'instagram', '2026-05') }),
    );
  });

  it('FIX 3: a cutoffDay client targets the CURRENT month (plan = M+1), not the data month', async () => {
    // Day 10 June: creation is due (10≥5); auto-run (cutoff 20) not reached; three-touch not a
    // touch day (5/17/19) → ONLY the creation branch acts. cutoffDay set ⇒ cycle_month = 2026-06.
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', contentCycleSchedule: { day: 5, hour: 6, cutoffDay: 20 } }],
      null,
    );
    const { queue, add } = makeQueue();
    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: new Date('2026-06-10T04:00:00Z') });
    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'ig-trawl',
      expect.objectContaining({ dataMonth: '2026-06' }),   // current month, NOT 2026-05
      expect.objectContaining({ jobId: igTrawlJobId('c1', 'instagram', '2026-06') }),
    );
  });

  it('skips an enabled client when today is before the scheduled day', async () => {
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', contentCycleSchedule: { day: 15, hour: 6 } }],
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_5_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: { day: 15, hour: 6 } }),
      expect.stringContaining('not yet due'),
    );
  });

  it('uses default schedule {day:1,hour:6} when contentCycleSchedule is null, and enqueues', async () => {
    // null → default day=1; today=5 → due
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', contentCycleSchedule: null }],
      null,
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_5_JUN_2026 });

    expect(add).toHaveBeenCalledOnce();
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1', schedule: { day: 1, hour: 6 } }),
      expect.stringContaining('using default'),
    );
  });

  it('skips when a cycle is already active (status = requested)', async () => {
    const { db } = makeTickDb(
      [{ clientId: 'c1', channel: 'instagram', contentCycleSchedule: { day: 1, hour: 6 } }],
      { status: 'requested' },
    );
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_5_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
  });

  it('produces no queue.add when there are no enabled clients', async () => {
    const { db } = makeTickDb([]);
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_5_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
  });

  it('catches a per-client error and continues to the next client without throwing', async () => {
    // First select (enabled clients) returns one row; second select (cycle check) throws.
    let selectIdx = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        if (selectIdx++ === 0) {
          const rows = [{ clientId: 'c1', channel: 'instagram', contentCycleSchedule: { day: 1, hour: 6 } }];
          const resolved = Promise.resolve(rows);
          return {
            from:      vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where:     vi.fn().mockReturnValue({
              then:    resolved.then.bind(resolved),
              catch:   resolved.catch.bind(resolved),
              finally: resolved.finally.bind(resolved),
            }),
          };
        }
        // cycle-check throws
        return {
          from:  vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockRejectedValue(new Error('DB unavailable')),
        };
      }),
      insert: vi.fn(),
    } as unknown as Parameters<typeof runContentCycleTick>[0]['db'];

    const { queue, add } = makeQueue();

    await expect(
      runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_5_JUN_2026 }),
    ).resolves.toBeUndefined();

    expect(add).not.toHaveBeenCalled();
    expect(LOGGER.warn).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1', err: 'Error: DB unavailable' }),
      expect.any(String),
    );
  });
});

// ── Auto-run (intake-capture) — SHIPS DARK ────────────────────────────────────

describe('planAutoRunTransitions', () => {
  it('scheduled advances through requested to intake_confirmed (run-anyway)', () => {
    expect(planAutoRunTransitions('scheduled')).toEqual(['scheduled->requested', 'requested->intake_confirmed']);
  });
  it('requested / reply_received / awaiting_confirmation advance directly', () => {
    expect(planAutoRunTransitions('requested')).toEqual(['requested->intake_confirmed']);
    expect(planAutoRunTransitions('reply_received')).toEqual(['reply_received->intake_confirmed']);
    expect(planAutoRunTransitions('awaiting_confirmation')).toEqual(['awaiting_confirmation->intake_confirmed']);
  });
  it('returns [] for intake_confirmed or later (nothing to advance)', () => {
    expect(planAutoRunTransitions('intake_confirmed')).toEqual([]);
    expect(planAutoRunTransitions('planning')).toEqual([]);
  });
});

describe('runContentCycleTick — auto-run DARK (AUTO_RUN_ENABLED unset ⇒ false)', () => {
  // Day 25 June 2026 (London, BST). dataMonth = 2026-05.
  const DAY_25_JUN_2026 = new Date('2026-06-25T04:00:00Z');

  // select[0] = enabled clients (thenable). One client: ask day 28 (NOT due on the 25th, so
  // the creation branch issues no cycle-check select) + cutoffDay 20 (reached on the 25th).
  // select[1] = auto-run cycle lookup (.limit → [cycle]); select[2] = plan_inputs (.limit → []).
  function makeAutoRunDb(cycle: { id: string; status: string; intakeJson: unknown; createdAt: Date }) {
    const enabled = [{ clientId: 'c1', channel: 'instagram', contentCycleSchedule: { day: 28, hour: 6, cutoffDay: 20 } }];
    let idx = 0;
    const update = vi.fn();
    const insert = vi.fn();
    const db = {
      select: vi.fn().mockImplementation(() => {
        if (idx++ === 0) {
          const resolved = Promise.resolve(enabled);
          return {
            from:      vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where:     vi.fn().mockReturnValue({
              then: resolved.then.bind(resolved), catch: resolved.catch.bind(resolved), finally: resolved.finally.bind(resolved),
            }),
          };
        }
        const rows = idx === 2 ? [cycle] : [];   // idx 2 = cycle lookup; idx 3 = plan_inputs
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows) };
      }),
      insert, update,
    } as unknown as Parameters<typeof runContentCycleTick>[0]['db'];
    return { db, update, insert };
  }

  it('logs [auto-run:dry] and changes NOTHING for a matched pre-cutoff cycle', async () => {
    const { db, update, insert } = makeAutoRunDb({
      id: 'cyc-1', status: 'scheduled',
      intakeJson: { planContent: { answers: {}, freeNotes: '' } }, createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_25_JUN_2026 });

    // Zero mutation: no enqueue, no insert, no update (⇒ no transition either).
    expect(add).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // The [auto-run:dry] line carries the full plan it WOULD execute + the intake predicate.
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: 'cyc-1', currentStatus: 'scheduled', cutoffDay: 20, hasIntakeInput: false,
        wouldTransition: ['scheduled->requested', 'requested->intake_confirmed'],
        wouldEnqueue: 'planning:cyc-1',
        monthLabel: 'July 2026',   // FIX 3: cohort month 2026-06 → plans July 2026
      }),
      expect.stringContaining('[auto-run:dry]'),
    );
  });

  it('D3: a cycle WITH drafts reports the AUTO-APPROVE plan, never the baseline run', async () => {
    // The interim state from Build A is retired here: a cycle holding drafts can no longer
    // reach the baseline whole-plan path, so a regen can never run alongside surviving
    // invisible draft rows.
    const { db, update, insert } = makeAutoRunDb({
      id: 'cyc-draft', status: 'scheduled',
      intakeJson: { planContent: { answers: {}, freeNotes: '' } }, createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const { queue, add } = makeQueue();
    const approveAndGenerate = vi.fn();
    const autoApprove = { countDrafts: vi.fn().mockResolvedValue(10), approveAndGenerate };

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_25_JUN_2026, autoApprove });

    // Still dark, so still zero mutation — but the plan it announces is the auto-approve.
    expect(add).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(approveAndGenerate).not.toHaveBeenCalled();
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: 'cyc-draft', draftCount: 10 }),
      expect.stringContaining('would AUTO-APPROVE'),
    );
    // And crucially NOT the baseline line.
    expect(LOGGER.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ wouldEnqueue: 'planning:cyc-draft' }),
      expect.anything(),
    );
  });

  it('a cycle with NO drafts still reports the baseline run', async () => {
    // Flag off, or assembly failed at the Ask touch — the baseline remains the path.
    const { db } = makeAutoRunDb({
      id: 'cyc-nodraft', status: 'scheduled',
      intakeJson: { planContent: { answers: {}, freeNotes: '' } }, createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const { queue } = makeQueue();
    const autoApprove = { countDrafts: vi.fn().mockResolvedValue(0), approveAndGenerate: vi.fn() };

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_25_JUN_2026, autoApprove });

    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ wouldEnqueue: 'planning:cyc-nodraft' }),
      expect.stringContaining('[auto-run:dry]'),
    );
  });

  it('with NO autoApprove injected at all, behaviour is exactly as before this build', async () => {
    const { db } = makeAutoRunDb({
      id: 'cyc-legacy', status: 'scheduled',
      intakeJson: { planContent: { answers: {}, freeNotes: '' } }, createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const { queue } = makeQueue();
    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_25_JUN_2026 });
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ wouldEnqueue: 'planning:cyc-legacy' }),
      expect.stringContaining('[auto-run:dry]'),
    );
  });

  it('reports hasIntakeInput:true when the cycle already has intake content', async () => {
    const { db, update } = makeAutoRunDb({
      id: 'cyc-2', status: 'requested',
      intakeJson: { planContent: { answers: { q1: 'launch on the 5th' }, freeNotes: '' } }, createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_25_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(LOGGER.info).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: 'cyc-2', currentStatus: 'requested', hasIntakeInput: true }),
      expect.stringContaining('[auto-run:dry]'),
    );
  });

  it('does not fire (no dry line) when the cycle is already intake_confirmed', async () => {
    const { db, update } = makeAutoRunDb({ id: 'cyc-3', status: 'intake_confirmed', intakeJson: null, createdAt: new Date('2026-05-01T00:00:00Z') });
    const { queue, add } = makeQueue();

    await runContentCycleTick({ db, queue, logger: LOGGER as never, now: DAY_25_JUN_2026 });

    expect(add).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dryCalls = (LOGGER.info as any).mock.calls.filter((c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('[auto-run:dry]'));
    expect(dryCalls).toHaveLength(0);
  });
});

// ── Three-touch reminder sender (intake-capture Build 2) ──────────────────────

describe('dueTouch', () => {
  const sched = (day: number, cutoffDay?: number): CycleSchedule => ({ day, hour: 6, ...(cutoffDay != null ? { cutoffDay } : {}) });

  it('Ask on the reminder day', () => expect(dueTouch(sched(5, 20), 5)).toBe('ask'));
  it('Last Call on cutoffDay − 1', () => expect(dueTouch(sched(5, 20), 19)).toBe('last_call'));
  it('Nudge on cutoffDay − 3 when the window is ≥ 5', () => expect(dueTouch(sched(5, 20), 17)).toBe('nudge'));
  it('no touch on an ordinary day', () => expect(dueTouch(sched(5, 20), 12)).toBeNull());
  it('window-collapse (<5): cutoffDay − 3 yields NO nudge', () => {
    // day 18, cutoff 20 → gap 2; cutoff−3 = 17 must NOT be a nudge day.
    expect(dueTouch(sched(18, 20), 17)).toBeNull();
    expect(dueTouch(sched(18, 20), 18)).toBe('ask');        // still Ask on reminder day
    expect(dueTouch(sched(18, 20), 19)).toBe('last_call');  // still Last Call on cutoff−1
  });
  it('no cutoffDay → never any touch', () => expect(dueTouch(sched(5), 5)).toBeNull());
});

describe('evaluateThreeTouchForClient', () => {
  const TODAY = { year: 2026, month: 6, day: 5 };   // 5 June 2026
  const SCHED: CycleSchedule = { day: 5, hour: 6, cutoffDay: 20 };
  const emptyCycle = {
    id: 'cyc-1', status: 'scheduled', cycleMonth: '2026-06',
    intakeJson: { planContent: { answers: {}, freeNotes: '' } }, createdAt: new Date('2026-06-01T00:00:00Z'),
    askSentAt: null, nudgeSentAt: null, lastCallSentAt: null,
  };
  const clientRow = { name: 'Ivy T' };
  const chanRow   = { contactName: 'Sally', extraQuestions: null };

  // Ordered results for each select().…​.limit() call. `setCalls` captures every .set(patch)
  // payload so a test can tell a timestamp stamp (askSentAt) from a skip-reason stamp.
  function makeSenderDb(limitResults: unknown[][]) {
    let i = 0;
    const setCalls: Record<string, unknown>[] = [];
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockImplementation((patch: Record<string, unknown>) => { setCalls.push(patch); return { where: updateWhere }; });
    const update = vi.fn().mockReturnValue({ set });
    const db = {
      select: vi.fn().mockReturnValue({
        from:  vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => Promise.resolve(limitResults[i++] ?? [])),
      }),
      update,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { db, update, setCalls };
  }
  const base = (db: unknown, over: Partial<Parameters<typeof evaluateThreeTouchForClient>[0]> = {}) => ({
    db: db as never, clientId: 'c1', channel: 'instagram', dataMonth: '2026-06',
    schedule: SCHED, today: TODAY, logger: LOGGER as never,
    sendEmail: vi.fn().mockResolvedValue(true),
    resolveAppLink: vi.fn().mockResolvedValue('https://app/p/tok'),
    ...over,
  });

  it('Ask fires on the reminder day, sends key=ask with a full merge, and stamps ask_sent_at (no skip reason)', async () => {
    const { db, update, setCalls } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const args = base(db);
    const res = await evaluateThreeTouchForClient(args);
    expect(res).toBe('sent');
    expect(args.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      key: 'ask', clientId: 'c1',
      merge: expect.objectContaining({
        clientName: 'Ivy T', contactName: 'Sally', monthLabel: 'July 2026',
        cutoffDate: '20 June', daysToCutoff: '15', intakeLink: 'https://app/p/tok?intake=1', appLink: 'https://app/p/tok',
        questionsBlock: expect.stringContaining('1. Q1 dates?'),
      }),
    }));
    expect(update).toHaveBeenCalledTimes(1);   // the timestamp stamp only
    expect(setCalls).toEqual([{ askSentAt: expect.any(Date) }]);   // NOT a skip reason
    expect(setCalls[0]).not.toHaveProperty('askSkipReason');
  });

  // ── Draft plan on the Ask touch (Build A) ──────────────────────────────────
  // The touch schedule is a commitment to the client; the draft is an enhancement to it.
  // These tests exist to make sure the enhancement can never cost them the touch.

  it('assembles a draft on the Ask touch and sends the ask_drafted variant carrying it', async () => {
    const { db, setCalls } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const assembleDraft = vi.fn().mockResolvedValue({ summary: '17 posts — 9 singles, 8 carousels.' });
    const args = base(db, { assembleDraft });
    expect(await evaluateThreeTouchForClient(args)).toBe('sent');
    expect(assembleDraft).toHaveBeenCalledWith('c1', 'cyc-1');
    expect(args.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      key: 'ask_drafted',
      merge: expect.objectContaining({ beatsSummary: '17 posts — 9 singles, 8 carousels.' }),
    }));
    expect(setCalls).toEqual([{ askSentAt: expect.any(Date) }]);
  });

  it('FAILURE ISOLATION: assembly throwing still sends the ordinary Ask email and stamps the touch', async () => {
    const { db, update, setCalls } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const assembleDraft = vi.fn().mockRejectedValue(new Error('bedrock exploded'));
    const args = base(db, { assembleDraft });
    expect(await evaluateThreeTouchForClient(args)).toBe('sent');   // the touch still happens
    expect(args.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      key: 'ask',                                                    // NOT ask_drafted
      merge: expect.objectContaining({ beatsSummary: '' }),
    }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ askSentAt: expect.any(Date) }]);
  });

  it('never promises a draft it does not have: an empty summary keeps the plain ask template', async () => {
    const { db } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const args = base(db, { assembleDraft: vi.fn().mockResolvedValue({ summary: '' }) });
    expect(await evaluateThreeTouchForClient(args)).toBe('sent');
    expect(args.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ key: 'ask' }));
  });

  it('does NOT assemble a draft on the Nudge or Last Call touches', async () => {
    for (const day of [17, 19]) {   // nudge = cutoff-3, last call = cutoff-1
      const { db } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
      const assembleDraft = vi.fn().mockResolvedValue({ summary: 'x' });
      const args = base(db, { assembleDraft, today: { ...TODAY, day } });
      await evaluateThreeTouchForClient(args);
      expect(assembleDraft).not.toHaveBeenCalled();
    }
  });

  it('FLAG OFF: the Ask touch is byte-identical to its pre-arc behaviour', async () => {
    // The gate lives in the injected assembler (consumer.ts), which returns an empty
    // summary without doing any work when draft_flow_enabled is off. From the scheduler's
    // side that is indistinguishable from the pre-arc world: plain 'ask' template, empty
    // beatsSummary, touch stamped.
    const { db, update, setCalls } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const assembleDraft = vi.fn().mockResolvedValue({ summary: '' });   // what the gate returns
    const args = base(db, { assembleDraft });
    expect(await evaluateThreeTouchForClient(args)).toBe('sent');
    expect(args.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      key: 'ask',
      merge: expect.objectContaining({ beatsSummary: '' }),
    }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ askSentAt: expect.any(Date) }]);
  });

  it('sends the ordinary Ask when no assembler is wired at all', async () => {
    const { db } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const args = base(db, { assembleDraft: undefined });
    expect(await evaluateThreeTouchForClient(args)).toBe('sent');
    expect(args.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ key: 'ask' }));
  });

  it('is at-most-once: a set ask_sent_at → skip, no send, no stamp (reason untouched)', async () => {
    const { db, update } = makeSenderDb([[{ ...emptyCycle, askSentAt: new Date() }]]);
    const args = base(db);
    expect(await evaluateThreeTouchForClient(args)).toBe('skipped');
    expect(args.sendEmail).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();   // already_sent writes nothing — timestamp is the state
  });

  it('is suppressed when intake input already exists → skip, no send, stamps ask_skip_reason=has_input', async () => {
    const withInput = { ...emptyCycle, intakeJson: { planContent: { answers: { q1: 'launch' }, freeNotes: '' } } };
    const { db, update, setCalls } = makeSenderDb([[withInput]]);
    const args = base(db);
    expect(await evaluateThreeTouchForClient(args)).toBe('skipped');
    expect(args.sendEmail).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ askSkipReason: 'has_input' }]);   // reason stamped, NOT ask_sent_at
  });

  it('a send FAILURE is non-fatal, does NOT stamp ask_sent_at, but stamps ask_skip_reason=send_failed', async () => {
    const { db, update, setCalls } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const args = base(db, { sendEmail: vi.fn().mockResolvedValue(false) });
    expect(await evaluateThreeTouchForClient(args)).toBe('skipped');
    expect(args.sendEmail).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ askSkipReason: 'send_failed' }]);
  });

  it('no sender wired → skip, no send, stamps ask_skip_reason=no_sender_wired', async () => {
    const { db, update, setCalls } = makeSenderDb([[emptyCycle], []]);   // cycle, then empty durable-inputs
    const args = base(db, { sendEmail: undefined });
    expect(await evaluateThreeTouchForClient(args)).toBe('skipped');
    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ askSkipReason: 'no_sender_wired' }]);
  });

  it('an error mid-flight stamps ask_skip_reason=error AND re-throws the original error', async () => {
    const { db, update, setCalls } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const boom = new Error('boom');
    const args = base(db, { sendEmail: vi.fn().mockRejectedValue(boom) });
    await expect(evaluateThreeTouchForClient(args)).rejects.toThrow('boom');
    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ askSkipReason: 'error' }]);
  });

  it('a FAILING error-stamp does not swallow the original error', async () => {
    const { db } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const boom = new Error('boom');
    // sendEmail throws 'boom'; the catch tries to stamp 'error' but the UPDATE itself throws.
    db.update = vi.fn(() => { throw new Error('db-down'); });
    const args = base(db, { sendEmail: vi.fn().mockRejectedValue(boom) });
    await expect(evaluateThreeTouchForClient(args)).rejects.toThrow('boom');   // NOT 'db-down'
  });

  it('Last Call fires on cutoffDay − 1 with key=last_call', async () => {
    const { db } = makeSenderDb([[emptyCycle], [], [clientRow], [chanRow]]);
    const args = base(db, { today: { year: 2026, month: 6, day: 19 } });
    expect(await evaluateThreeTouchForClient(args)).toBe('sent');
    expect(args.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ key: 'last_call' }));
  });

  it('a client with no cutoffDay is untouched — no DB read, no send', async () => {
    const { db } = makeSenderDb([]);
    const args = base(db, { schedule: { day: 5, hour: 6 } });   // no cutoffDay
    expect(await evaluateThreeTouchForClient(args)).toBe('skipped');
    expect((db as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled();
    expect(args.sendEmail).not.toHaveBeenCalled();
  });
});
