import { describe, it, expect, vi, afterEach } from 'vitest';
import { groupByLondonMonth, planWrites, summarise, runDeepTrawl } from './deep-trawl.js';
import type { DeepTrawlParams } from './deep-trawl.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const post = (timestamp: string, mediaType?: string): Record<string, unknown> =>
  ({ timestamp, caption: 'c', likesCount: 1, commentsCount: 0, ...(mediaType ? { mediaType } : {}) });

const apify = (timestamp: string, type?: string): Record<string, unknown> =>
  ({ timestamp, caption: 'a caption', likesCount: 10, commentsCount: 2, ownerUsername: 'ivy_thebrand', ...(type ? { type } : {}) });

function makeLogger(): DeepTrawlParams['logger'] {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as DeepTrawlParams['logger'];
}

interface Written { month: string; posts: Array<Record<string, unknown>> }

/** Mocks drizzle's select-from-where read and insert-values-onConflictDoUpdate write. */
function makeDb(stored: Record<string, Array<Record<string, unknown>>>): { db: DeepTrawlParams['db']; written: Written[] } {
  const written: Written[] = [];
  const rows = Object.entries(stored).map(([month, posts]) => ({ month, posts }));
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    insert: () => ({
      values: (v: Written) => ({
        onConflictDoUpdate: () => { written.push({ month: v.month, posts: v.posts }); return Promise.resolve(); },
      }),
    }),
  } as unknown as DeepTrawlParams['db'];
  return { db, written };
}

function mockFetch(data: unknown): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data),
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

const BASE = {
  clientId: 'client-1', channel: 'instagram', handle: 'ivy_thebrand',
  resultsLimit: 300, apifyApiKey: 'key', dryRun: false, allowShrink: false,
};

// ── planWrites — the no-regress guarantee ─────────────────────────────────────

describe('planWrites', () => {
  it('inserts a month that is not stored at all', () => {
    const plans = planWrites(new Map(), new Map([['2025-11', [post('2025-11-01T00:00:00Z')]]]), false);
    expect(plans).toEqual([{ month: '2025-11', stored: 0, incoming: 1, action: 'insert', write: true }]);
  });

  it('deepens a month the trawl reached further into', () => {
    const stored = new Map([['2026-06', [post('2026-06-20T00:00:00Z')]]]);
    const incoming = new Map([['2026-06', [post('2026-06-01T00:00:00Z'), post('2026-06-20T00:00:00Z')]]]);
    expect(planWrites(stored, incoming, false)[0]).toMatchObject({ action: 'deepen', write: true, stored: 1, incoming: 2 });
  });

  it('REFUSES a month that would shrink, and says so', () => {
    const stored = new Map([['2026-06', [post('a'), post('b'), post('c')]]]);
    const incoming = new Map([['2026-06', [post('c')]]]);
    expect(planWrites(stored, incoming, false)[0]).toMatchObject({ action: 'skipped_would_shrink', write: false, stored: 3, incoming: 1 });
  });

  it('writes the shrinking month only when the operator forces it', () => {
    const stored = new Map([['2026-06', [post('a'), post('b'), post('c')]]]);
    const incoming = new Map([['2026-06', [post('c')]]]);
    expect(planWrites(stored, incoming, true)[0]).toMatchObject({ action: 'shrink_forced', write: true });
  });

  it('never mentions a stored month the trawl did not reach — untouched months cannot be written', () => {
    const stored = new Map([['2024-01', [post('a')]], ['2026-06', [post('b')]]]);
    const incoming = new Map([['2026-06', [post('b'), post('c')]]]);
    const plans = planWrites(stored, incoming, false);
    expect(plans.map((p) => p.month)).toEqual(['2026-06']);
  });

  it('rewrites an identical month rather than treating equality as a shrink', () => {
    const stored = new Map([['2026-06', [post('a'), post('b')]]]);
    const incoming = new Map([['2026-06', [post('a'), post('b')]]]);
    expect(planWrites(stored, incoming, false)[0]).toMatchObject({ action: 'unchanged', write: true });
  });
});

// ── groupByLondonMonth ────────────────────────────────────────────────────────

describe('groupByLondonMonth', () => {
  it('groups on London wall-clock, not UTC', () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London (BST).
    const { byMonth } = groupByLondonMonth([apify('2026-06-30T23:30:00.000Z', 'Video')]);
    expect([...byMonth.keys()]).toEqual(['2026-07']);
  });

  it('carries the mapped mediaType through and counts what it dropped', () => {
    const { byMonth, dropped } = groupByLondonMonth([
      apify('2026-05-02T12:00:00.000Z', 'Video'),
      apify('2026-05-03T12:00:00.000Z', 'Sidecar'),
      { caption: 'no timestamp', likesCount: 1, commentsCount: 1 },
      { timestamp: 'not-a-date', likesCount: 1, commentsCount: 1 },
    ]);
    expect(byMonth.get('2026-05')!.map((p) => p['mediaType'])).toEqual(['reel', 'carousel']);
    expect(dropped).toBe(2);
  });
});

// ── summarise ─────────────────────────────────────────────────────────────────

describe('summarise', () => {
  it('reports typed coverage and the format breakdown per month and overall', () => {
    const s = summarise(new Map([
      ['2026-06', [post('2026-06-01T00:00:00Z', 'reel'), post('2026-06-02T00:00:00Z')]],
      ['2026-07', [post('2026-07-01T00:00:00Z', 'reel'), post('2026-07-09T00:00:00Z', 'carousel')]],
    ]));
    expect(s.posts).toBe(4);
    expect(s.typed).toBe(3);
    expect(s.formats).toEqual({ reel: 2, carousel: 1 });
    expect(s.oldest).toBe('2026-06-01T00:00:00Z');
    expect(s.newest).toBe('2026-07-09T00:00:00Z');
    expect(s.months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(s.months[0]!.typed).toBe(1);
  });
});

// ── runDeepTrawl ──────────────────────────────────────────────────────────────

describe('runDeepTrawl', () => {
  it('sends the operator depth to Apify and deepens the shallow month', async () => {
    mockFetch([
      apify('2026-06-01T12:00:00.000Z', 'Video'),
      apify('2026-06-15T12:00:00.000Z', 'Sidecar'),
      apify('2026-06-20T12:00:00.000Z', 'Image'),
      apify('2025-11-05T12:00:00.000Z', 'Video'),
    ]);
    const { db, written } = makeDb({ '2026-06': [post('2026-06-20T12:00:00.000Z', 'image')] });

    const r = await runDeepTrawl({ ...BASE, db, logger: makeLogger() });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body['resultsLimit']).toBe(300);

    expect(r.before.posts).toBe(1);
    expect(written.map((w) => w.month).sort()).toEqual(['2025-11', '2026-06']);
    expect(written.find((w) => w.month === '2026-06')!.posts).toHaveLength(3);
    expect(r.plans.find((p) => p.month === '2026-06')!.action).toBe('deepen');
    expect(r.plans.find((p) => p.month === '2025-11')!.action).toBe('insert');
  });

  it('a dry run writes nothing but still projects the end state', async () => {
    mockFetch([apify('2025-11-05T12:00:00.000Z', 'Video'), apify('2026-06-01T12:00:00.000Z', 'Video')]);
    const { db, written } = makeDb({ '2026-06': [post('2026-06-20T12:00:00.000Z', 'image')] });

    const r = await runDeepTrawl({ ...BASE, db, logger: makeLogger(), dryRun: true });

    expect(written).toEqual([]);
    expect(r.wrote).toBe(false);
    // 2026-06 would shrink 1 → 1... it is equal, so it writes; 2025-11 is new.
    expect(r.after.months.map((m) => m.month)).toEqual(['2025-11', '2026-06']);
  });

  it('does not write a month that would shrink, and leaves the stored row alone', async () => {
    mockFetch([apify('2026-06-20T12:00:00.000Z', 'Video')]);
    const { db, written } = makeDb({
      '2026-06': [post('2026-06-01T00:00:00Z', 'reel'), post('2026-06-10T00:00:00Z', 'reel'), post('2026-06-20T00:00:00Z', 'reel')],
    });

    const r = await runDeepTrawl({ ...BASE, db, logger: makeLogger() });

    expect(written).toEqual([]);
    expect(r.plans[0]!.action).toBe('skipped_would_shrink');
  });

  it('refuses outright when nothing in the response belongs to the handle', async () => {
    mockFetch([{ ...apify('2026-06-01T12:00:00.000Z', 'Video'), ownerUsername: 'someone_else' }]);
    const { db, written } = makeDb({});

    await expect(runDeepTrawl({ ...BASE, db, logger: makeLogger() })).rejects.toThrow(/no posts owned by "ivy_thebrand"/);
    expect(written).toEqual([]);
  });

  it('warns with the raw value when a type does not map', async () => {
    mockFetch([apify('2026-06-01T12:00:00.000Z', 'Story'), apify('2026-06-02T12:00:00.000Z', 'Video')]);
    const { db } = makeDb({});
    const logger = makeLogger();

    const r = await runDeepTrawl({ ...BASE, db, logger });

    expect(r.unmappedTypes).toEqual({ Story: 1 });
    const warns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    expect(warns.find(([ctx]) => 'unmappedTypes' in ctx)).toBeDefined();
  });
});
