import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock BullMQ ─────────────────────────────────────────────────────────────
let capturedProcessor: ((job: { data: unknown }) => Promise<void>) | undefined;

vi.mock('bullmq', () => ({
  Worker: vi.fn((_queue: string, fn: (job: { data: unknown }) => Promise<void>) => {
    capturedProcessor = fn;
    return { close: vi.fn() };
  }),
}));

// ─── Mock @sprigly/db table specs (consumer uses them in .from() calls) ──────
// vi.mock factories are hoisted — use vi.hoisted so symbols are available there.
const { incomingEventsSymbol, workflowRunsSymbol } = vi.hoisted(() => ({
  incomingEventsSymbol: Symbol('incomingEvents'),
  workflowRunsSymbol:   Symbol('workflowRuns'),
}));

vi.mock('@sprigly/db', () => ({
  db: {},
  incomingEvents: incomingEventsSymbol,
  workflowRuns:   workflowRunsSymbol,
}));

import { createConsumer } from './consumer.js';
import type { Logger } from 'pino';

// ─── DB mock factory ─────────────────────────────────────────────────────────

const SAMPLE_EVENT = {
  id: 'evt-1',
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: { from: 'john@example.com', subject: 'Prospect: Test' },
  receivedAt: new Date(),
  content: { text: 'Prospect: Test', structured: { subject: 'Prospect: Test' } },
};

function makeDb() {
  let lastFromTable: unknown;
  const limit = vi.fn().mockImplementation(() => {
    // Distinguish event query vs workflowRuns query by which table .from() last saw
    return Promise.resolve(
      lastFromTable === workflowRunsSymbol ? [{ id: 'run-1' }] : [SAMPLE_EVENT],
    );
  });
  const chain = {
    from:    vi.fn().mockImplementation((t: unknown) => { lastFromTable = t; return chain; }),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit,
    set:     vi.fn().mockReturnThis(),
  } as Record<string, unknown>;
  return {
    select: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
  };
}

const RULE = {
  id: 'rule-1', clientId: 'client-1', enabled: true,
  workflowId: 'sprigly-prospect-research',
  destinations: [], clientConfigId: '', priority: 1, isFallback: false,
  match: { source: 'email', conditions: [] },
};

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function setup(runFn: ReturnType<typeof vi.fn>) {
  const db         = makeDb() as unknown as Parameters<typeof createConsumer>[0];
  const logger     = makeLogger();
  const router     = { route: vi.fn().mockResolvedValue([RULE]) } as unknown as Parameters<typeof createConsumer>[1];
  const registry   = { get: vi.fn().mockReturnValue({ defaultDestinations: [] }) } as unknown as Parameters<typeof createConsumer>[2];
  const runner     = { run: runFn } as unknown as Parameters<typeof createConsumer>[3];
  const dispatcher = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as Parameters<typeof createConsumer>[4];
  capturedProcessor = undefined;
  createConsumer(db, router, registry, runner, dispatcher, logger, 'redis://localhost', vi.fn().mockResolvedValue(undefined), { add: vi.fn().mockResolvedValue(undefined) } as unknown as Parameters<typeof createConsumer>[8]);
  return { logger, dispatcher };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createConsumer — error handling', () => {
  beforeEach(() => { capturedProcessor = undefined; });

  it('re-throws so BullMQ marks the job failed (not a process crash)', async () => {
    const { logger } = setup(vi.fn().mockRejectedValue(new Error('rate limit 429')));

    await expect(capturedProcessor!({ data: { eventId: 'evt-1', clientId: 'client-1' } }))
      .rejects.toThrow('rate limit 429');

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1', message: 'rate limit 429' }),
      'job failed',
    );
  });

  it('extracts statusCode and requestId from Anthropic API error shape', async () => {
    const err = Object.assign(new Error('rate_limit_error'), {
      status: 429,
      request_id: 'req-abc123',
      error: { type: 'rate_limit_error', message: 'Org limit exceeded' },
    });
    const { logger } = setup(vi.fn().mockRejectedValue(err));

    await expect(capturedProcessor!({ data: { eventId: 'evt-1', clientId: 'client-1' } })).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 429, requestId: 'req-abc123' }),
      'job failed',
    );
  });

  it('extracts statusCode and requestId from AWS SDK error shape', async () => {
    const err = Object.assign(new Error('ThrottlingException'), {
      $metadata: { httpStatusCode: 429, requestId: 'aws-req-xyz' },
    });
    const { logger } = setup(vi.fn().mockRejectedValue(err));

    await expect(capturedProcessor!({ data: { eventId: 'evt-1', clientId: 'client-1' } })).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 429, requestId: 'aws-req-xyz' }),
      'job failed',
    );
  });

  it('processes a second job normally after the first fails', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('first error'))
      .mockResolvedValue({ data: { brandName: 'Test' }, pdf: Buffer.from('%PDF') });
    const { dispatcher } = setup(runFn);

    await expect(capturedProcessor!({ data: { eventId: 'evt-1', clientId: 'client-1' } })).rejects.toThrow();
    await expect(capturedProcessor!({ data: { eventId: 'evt-2', clientId: 'client-1' } })).resolves.toBeUndefined();

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
});
