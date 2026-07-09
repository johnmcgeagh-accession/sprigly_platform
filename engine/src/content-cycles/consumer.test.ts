import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

let capturedProcessor: (job: { data: unknown; id?: string }) => Promise<void>;

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_queue: string, processor: typeof capturedProcessor) => {
    capturedProcessor = processor;
    return { close: vi.fn() };
  }),
}));

vi.mock('@sprigly/db',          () => ({ db: {} }));
vi.mock('@sprigly/oauth-tokens',() => ({}));
vi.mock('@sprigly/sources',     () => ({}));
vi.mock('@sprigly/prompts',     () => ({ DbPromptResolver: vi.fn() }));
vi.mock('@sprigly/model-client',() => ({}));
vi.mock('@sprigly/audit',       () => ({}));

vi.mock('./extract.js', () => ({ extractVoiceDeltasForCycle: vi.fn() }));
vi.mock('./apply.js',   () => ({ applyVoiceDeltasForCycle:  vi.fn() }));
vi.mock('../ig-producer.js', () => ({ runIgTrawlJob:        vi.fn() }));
vi.mock('./stubs.js',   () => ({ requestEmailStub:          vi.fn() }));
vi.mock('./scheduler.js',() => ({ runContentCycleTick:      vi.fn() }));

import {
  createContentCycleConsumer,
  requestEmailJobId,
  IG_TRAWL_JOB_OPTIONS,
  REQUEST_EMAIL_JOB_OPTIONS,
} from './consumer.js';
import { extractVoiceDeltasForCycle } from './extract.js';
import { applyVoiceDeltasForCycle }   from './apply.js';
import { runIgTrawlJob }              from '../ig-producer.js';
import { requestEmailStub }           from './stubs.js';
import { runContentCycleTick }        from './scheduler.js';

// ─── Shared setup ─────────────────────────────────────────────────────────────

const extractMock         = extractVoiceDeltasForCycle as ReturnType<typeof vi.fn>;
const applyMock           = applyVoiceDeltasForCycle   as ReturnType<typeof vi.fn>;
const igTrawlMock         = runIgTrawlJob              as ReturnType<typeof vi.fn>;
const requestEmailMock    = requestEmailStub            as ReturnType<typeof vi.fn>;
const schedulerTickMock   = runContentCycleTick         as ReturnType<typeof vi.fn>;

const LOGGER        = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const mockQueueAdd  = vi.fn().mockResolvedValue({ id: 'enqueued-job' });
// The ig-trawl → request-email chain calls queue.getJob(emailJobId) to clear a stale
// completed/failed entry before re-enqueuing (BullMQ dedups against the completed set).
// Default: no existing job (a fresh enqueue). Dedup-path tests override it per-call with
// completedJob(). mockJobRemove is the spy the consumer's existingEmail.remove() hits.
const mockJobRemove = vi.fn().mockResolvedValue(undefined);
const mockQueueGetJob = vi.fn().mockResolvedValue(undefined);
const completedJob = () => ({ getState: vi.fn().mockResolvedValue('completed'), remove: mockJobRemove });
const MOCK_QUEUE    = { add: mockQueueAdd, getJob: mockQueueGetJob };

function makeConsumer(apifyApiKey?: string) {
  return createContentCycleConsumer(
    {} as never,
    {} as never,
    'gid',
    'gsecret',
    {} as never,
    {} as never,
    {} as never,
    LOGGER as never,
    'redis://localhost',
    apifyApiKey,
    MOCK_QUEUE as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueueAdd.mockResolvedValue({ id: 'enqueued-job' });
  mockQueueGetJob.mockResolvedValue(undefined); // default: no existing email job (fresh enqueue)
  mockJobRemove.mockResolvedValue(undefined);
  makeConsumer();
});

// ─── extract-voice ────────────────────────────────────────────────────────────

describe('extract-voice job', () => {
  it('dispatches to extractVoiceDeltasForCycle with cycleId', async () => {
    extractMock.mockResolvedValue(undefined);
    await capturedProcessor({ data: { type: 'extract-voice', cycleId: 'cycle-1' }, id: 'j1' });
    expect(extractMock).toHaveBeenCalledOnce();
    expect(extractMock).toHaveBeenCalledWith(
      'cycle-1',
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });
});

// ─── apply-voice ─────────────────────────────────────────────────────────────

describe('apply-voice job', () => {
  it('dispatches to applyVoiceDeltasForCycle with cycleId', async () => {
    applyMock.mockResolvedValue(undefined);
    await capturedProcessor({ data: { type: 'apply-voice', cycleId: 'cycle-2' }, id: 'j2' });
    expect(applyMock).toHaveBeenCalledOnce();
    expect(applyMock).toHaveBeenCalledWith(
      'cycle-2',
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(),
    );
  });
});

// ─── ig-trawl — dispatch ─────────────────────────────────────────────────────

describe('ig-trawl job — dispatch', () => {
  it('calls runIgTrawlJob with (clientId, channel, dataMonth, deps)', async () => {
    igTrawlMock.mockResolvedValue(undefined);
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c1', channel: 'instagram', dataMonth: '2026-05' },
      id: 'j3',
    });
    expect(igTrawlMock).toHaveBeenCalledOnce();
    expect(igTrawlMock).toHaveBeenCalledWith(
      'c1', 'instagram', '2026-05',
      expect.objectContaining({ apifyApiKey: undefined }),
    );
  });

  it('passes apifyApiKey from constructor into runIgTrawlJob', async () => {
    igTrawlMock.mockResolvedValue(undefined);
    makeConsumer('my-apify-key');
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c2', channel: 'instagram', dataMonth: '2026-06' },
      id: 'j4',
    });
    expect(igTrawlMock).toHaveBeenCalledWith(
      'c2', 'instagram', '2026-06',
      expect.objectContaining({ apifyApiKey: 'my-apify-key' }),
    );
  });
});

// ─── ig-trawl → request-email chain ─────────────────────────────────────────

describe('ig-trawl → request-email chain', () => {
  it('enqueues request-email after trawl success (file written)', async () => {
    igTrawlMock.mockResolvedValue(undefined);
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c1', channel: 'instagram', dataMonth: '2026-05' },
      id: 'j5',
    });
    expect(mockQueueAdd).toHaveBeenCalledOnce();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'request-email',
      { type: 'request-email', clientId: 'c1', channel: 'instagram', dataMonth: '2026-05' },
      expect.objectContaining({
        jobId:    requestEmailJobId('c1', 'instagram', '2026-05'),
        attempts: REQUEST_EMAIL_JOB_OPTIONS.attempts,
      }),
    );
  });

  it('enqueues request-email even when trawl writes NO file (APIFY_API_KEY absent / zero posts)', async () => {
    // runIgTrawlJob returns void without writing — same as missing key or no owned posts.
    // The email must still be enqueued so lean-line degrades to sales-only.
    igTrawlMock.mockResolvedValue(undefined);
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c2', channel: 'instagram', dataMonth: '2026-05' },
      id: 'j6',
    });
    expect(mockQueueAdd).toHaveBeenCalledOnce();
    const [name, payload] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('request-email');
    expect(payload.clientId).toBe('c2');
  });

  it('does NOT enqueue request-email when trawl throws (chain broken by error)', async () => {
    igTrawlMock.mockRejectedValue(new Error('Apify network timeout'));
    await expect(
      capturedProcessor({
        data: { type: 'ig-trawl', clientId: 'c3', channel: 'instagram', dataMonth: '2026-05' },
        id: 'j7',
      }),
    ).rejects.toThrow('Apify network timeout');
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('uses a deterministic jobId so BullMQ deduplicates re-enqueues from trawl retries', async () => {
    igTrawlMock.mockResolvedValue(undefined);
    // First enqueue (e.g. trawl attempt 1 succeeded after previous failure) — no prior job.
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c4', channel: 'instagram', dataMonth: '2026-07' },
      id: 'j8',
    });
    // Second enqueue (trawl retry also succeeded): the first email job has completed, so the
    // consumer finds it via getJob and clears it so the deterministic re-enqueue takes effect.
    mockQueueGetJob.mockResolvedValueOnce(completedJob());
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c4', channel: 'instagram', dataMonth: '2026-07' },
      id: 'j9',
    });
    expect(mockJobRemove).toHaveBeenCalledOnce();   // stale completed entry cleared before re-add
    const jobIds = mockQueueAdd.mock.calls.map((c) => (c[2] as Record<string, unknown>)['jobId']);
    expect(jobIds[0]).toBe(jobIds[1]);   // same deterministic jobId both times
    expect(jobIds[0]).toBe(requestEmailJobId('c4', 'instagram', '2026-07'));
  });
});

// ─── request-email — never enqueues a trawl ──────────────────────────────────

describe('request-email job', () => {
  it('dispatches to requestEmailStub with (clientId, channel, dataMonth)', async () => {
    requestEmailMock.mockResolvedValue(undefined);
    await capturedProcessor({
      data: { type: 'request-email', clientId: 'c5', channel: 'instagram', dataMonth: '2026-05' },
      id: 'j10',
    });
    expect(requestEmailMock).toHaveBeenCalledOnce();
    expect(requestEmailMock).toHaveBeenCalledWith('c5', 'instagram', '2026-05');
  });

  it('never enqueues any job (no trawl re-trigger, no side-effects)', async () => {
    requestEmailMock.mockResolvedValue(undefined);
    await capturedProcessor({
      data: { type: 'request-email', clientId: 'c5', channel: 'instagram', dataMonth: '2026-05' },
      id: 'j11',
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

// ─── Full chain re-run idempotency ────────────────────────────────────────────

describe('full chain re-run on already-completed cycle', () => {
  it('trawl re-runs (refreshes Drive file), chains email; email no-ops if already requested', async () => {
    // Simulate: cycle was already completed (status = 'requested') from a prior run.
    // requestEmailStub's internal runRequestEmail would early-return on 'requested' status —
    // this is covered in request-email.test.ts. Here we verify the chain still fires.
    igTrawlMock.mockResolvedValue(undefined);    // trawl overwrites Drive file (idempotent)
    requestEmailMock.mockResolvedValue(undefined); // stub/early-return — no cycle transition

    // First pass (original run)
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c6', channel: 'instagram', dataMonth: '2026-08' },
      id: 'ja',
    });
    expect(mockQueueAdd).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'enqueued-job' });
    // On the re-run the email from the first pass has already completed ('requested'), so the
    // consumer finds and clears that stale entry so the deterministic re-enqueue takes effect.
    mockQueueGetJob.mockResolvedValue(completedJob());
    mockJobRemove.mockResolvedValue(undefined);

    // Second pass (re-run of the same month)
    await capturedProcessor({
      data: { type: 'ig-trawl', clientId: 'c6', channel: 'instagram', dataMonth: '2026-08' },
      id: 'jb',
    });
    // Trawl ran again (refreshed Drive file)
    expect(igTrawlMock).toHaveBeenCalledOnce();
    // The stale completed email entry was cleared before re-enqueue.
    expect(mockJobRemove).toHaveBeenCalledOnce();
    // Email was re-enqueued with same deterministic jobId (BullMQ deduplicates if still pending)
    expect(mockQueueAdd).toHaveBeenCalledOnce();
    expect(mockQueueAdd.mock.calls[0][2]).toMatchObject({
      jobId: requestEmailJobId('c6', 'instagram', '2026-08'),
    });
    // If email runs again, requestEmailStub early-returns (cycle already 'requested') — no draft
    await capturedProcessor({
      data: { type: 'request-email', clientId: 'c6', channel: 'instagram', dataMonth: '2026-08' },
      id: 'jc',
    });
    expect(requestEmailMock).toHaveBeenCalledWith('c6', 'instagram', '2026-08');
    // No new queue.add from the email job
    expect(mockQueueAdd).toHaveBeenCalledOnce(); // still just the one from ig-trawl above
  });
});

// ─── Retry policy exports ─────────────────────────────────────────────────────

describe('retry policy constants', () => {
  it('ig-trawl uses more attempts than request-email (Apify is network-flaky)', () => {
    expect(IG_TRAWL_JOB_OPTIONS.attempts!).toBeGreaterThan(REQUEST_EMAIL_JOB_OPTIONS.attempts!);
  });

  it('ig-trawl uses exponential backoff', () => {
    expect((IG_TRAWL_JOB_OPTIONS.backoff as { type: string }).type).toBe('exponential');
  });

  it('request-email uses fixed backoff', () => {
    expect((REQUEST_EMAIL_JOB_OPTIONS.backoff as { type: string }).type).toBe('fixed');
  });
});

// ─── scheduler-tick ───────────────────────────────────────────────────────────

describe('scheduler-tick job', () => {
  it('dispatches to runContentCycleTick and does not enqueue any jobs itself', async () => {
    schedulerTickMock.mockResolvedValue(undefined);
    await capturedProcessor({ data: { type: 'scheduler-tick' }, id: 'je' });
    expect(schedulerTickMock).toHaveBeenCalledOnce();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

// ─── unknown type ─────────────────────────────────────────────────────────────

describe('unknown job type', () => {
  it('logs a warning, does not throw, does not enqueue anything', async () => {
    await capturedProcessor({ data: { type: 'not-a-real-type' }, id: 'jd' });
    expect(LOGGER.warn).toHaveBeenCalledOnce();
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(igTrawlMock).not.toHaveBeenCalled();
    expect(requestEmailMock).not.toHaveBeenCalled();
    expect(extractMock).not.toHaveBeenCalled();
  });
});
