import { describe, it, expect, vi, afterEach } from 'vitest';
import { trawlInstagramPosts } from './ig-producer.js';
import type { IgProducerParams } from './ig-producer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PARAMS = {
  clientId:      'client-1',
  channel:       'instagram',
  month:         '2026-05',
  handle:        'ivy_thebrand',   // sourced from client_channels DB column
};

function makeApifyPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    caption:       'Test post caption for the product launch event',
    timestamp:     '2026-05-10T12:00:00.000Z',
    likesCount:    50,
    commentsCount: 5,
    ownerUsername: 'ivy_thebrand',
    ...overrides,
  };
}

interface UpsertValues { clientId: string; channel: string; month: string; posts: Array<Record<string, unknown>> }
interface CapturedUpsert {
  insertCalled:     number;
  onConflictCalled: number;
  values?:          UpsertValues;
}

// Posts are now upserted into the ig_posts DB table (re-homed off Drive). The mock
// mirrors drizzle's `db.insert(t).values(v).onConflictDoUpdate({...})` chain and
// captures the values payload so tests can assert on what would be written.
function makeDb(): { db: IgProducerParams['db']; captured: CapturedUpsert } {
  const captured: CapturedUpsert = { insertCalled: 0, onConflictCalled: 0 };
  const onConflictDoUpdate = vi.fn(() => { captured.onConflictCalled++; return Promise.resolve(); });
  const values = vi.fn((v: UpsertValues) => { captured.values = v; return { onConflictDoUpdate }; });
  const insert = vi.fn(() => { captured.insertCalled++; return { values }; });
  const db = { insert } as unknown as IgProducerParams['db'];
  return { db, captured };
}

function makeLogger(): IgProducerParams['logger'] {
  return {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as IgProducerParams['logger'];
}

function mockFetch(data: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok:   status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

// ── Missing API key ───────────────────────────────────────────────────────────

describe('missing APIFY_API_KEY', () => {
  it('warns and returns without calling fetch or writing to the DB', async () => {
    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: undefined, logger });

    expect(logger.warn).toHaveBeenCalledOnce();
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatch(/APIFY_API_KEY/);
    expect(captured.insertCalled).toBe(0);
  });
});

// ── Missing handle ────────────────────────────────────────────────────────────

describe('missing instagram_handle', () => {
  it('skips when handle is undefined — does not fetch or write to the DB', async () => {
    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, handle: undefined, db, apifyApiKey: 'key', logger });

    expect(logger.info).toHaveBeenCalledOnce();
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatch(/instagram_handle/);
    expect(captured.insertCalled).toBe(0);
  });
});

// ── Field mapping ─────────────────────────────────────────────────────────────

describe('field mapping', () => {
  it('maps caption, timestamp, likesCount, commentsCount into the ig_posts row', async () => {
    const post = makeApifyPost({
      caption:       'Summer linen in three new colourways',
      timestamp:     '2026-05-15T10:00:00.000Z',
      likesCount:    120,
      commentsCount: 8,
      ownerUsername: 'ivy_thebrand',
    });
    mockFetch([post]);

    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(captured.insertCalled).toBe(1);
    expect(captured.values!.clientId).toBe('client-1');
    expect(captured.values!.channel).toBe('instagram');
    expect(captured.values!.month).toBe('2026-05');
    const written = captured.values!.posts;
    expect(written).toHaveLength(1);
    const item = written[0]!;
    expect(item['caption']).toBe('Summer linen in three new colourways');
    expect(item['timestamp']).toBe('2026-05-15T10:00:00.000Z');
    expect(item['likesCount']).toBe(120);
    expect(item['commentsCount']).toBe(8);
    expect(item).not.toHaveProperty('ownerUsername');
  });
});

// ── Account guard ─────────────────────────────────────────────────────────────

describe('account guard', () => {
  it('returns account_mismatch (no write) when ZERO posts match the handle (all-foreign batch)', async () => {
    const posts = [
      makeApifyPost({ ownerUsername: 'completely_wrong_account' }),
      makeApifyPost({ ownerUsername: 'another_foreign_account' }),
    ];
    mockFetch(posts);

    const { db, captured } = makeDb();
    const logger = makeLogger();

    // The account guard reports a typed outcome ({ status: 'account_mismatch', detail })
    // rather than throwing — a mismatch is a recorded, non-retried condition, not an error.
    const outcome = await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });
    expect(outcome.status).toBe('account_mismatch');
    expect(outcome.detail).toContain('ivy_thebrand');            // the expected handle
    expect(outcome.detail).toContain('completely_wrong_account'); // the foreign owners found
    expect(captured.insertCalled).toBe(0);
  });

  it('drops foreign-owner posts and proceeds when at least one owned post exists (mixed batch)', async () => {
    const posts = [
      makeApifyPost({ ownerUsername: 'ivy_thebrand',        caption: 'Our post',      timestamp: '2026-05-10T12:00:00.000Z' }),
      makeApifyPost({ ownerUsername: 'whatemilyworetoday',  caption: 'Tagged us!',    timestamp: '2026-05-11T12:00:00.000Z' }),
      makeApifyPost({ ownerUsername: 'ivy_thebrand',        caption: 'Another ours',  timestamp: '2026-05-12T12:00:00.000Z' }),
      makeApifyPost({ ownerUsername: 'someotherfashionblog', caption: 'Mention post', timestamp: '2026-05-13T12:00:00.000Z' }),
    ];
    mockFetch(posts);

    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(captured.insertCalled).toBe(1);
    const written = captured.values!.posts as Array<{ caption: string }>;
    expect(written).toHaveLength(2);
    expect(written.every((p) => ['Our post', 'Another ours'].includes(p.caption))).toBe(true);

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const dropLog   = infoCalls.find(([ctx]) => typeof ctx === 'object' && 'droppedCount' in ctx);
    expect(dropLog).toBeDefined();
    expect(dropLog![0]['droppedCount']).toBe(2);
  });

  it('logs nothing about drops and proceeds when all posts are from the owned account', async () => {
    const posts = [
      makeApifyPost({ ownerUsername: 'ivy_thebrand', timestamp: '2026-05-10T12:00:00.000Z' }),
      makeApifyPost({ ownerUsername: 'ivy_thebrand', timestamp: '2026-05-11T12:00:00.000Z' }),
    ];
    mockFetch(posts);

    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(captured.insertCalled).toBe(1);
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const dropLog   = infoCalls.find(([ctx]) => typeof ctx === 'object' && 'droppedCount' in ctx);
    expect(dropLog).toBeUndefined();
  });

  it('is case-insensitive (IVY_THEBRAND matches ivy_thebrand)', async () => {
    const post = makeApifyPost({ ownerUsername: 'IVY_THEBRAND' });
    mockFetch([post]);

    const { db, captured } = makeDb();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger: makeLogger() });

    expect(captured.insertCalled).toBe(1);
  });
});

// ── Hidden / negative counts ──────────────────────────────────────────────────

describe('hidden/negative like and comment counts', () => {
  it('skips posts with likesCount = -1, does not throw, writes remaining posts', async () => {
    const hiddenPost = makeApifyPost({ likesCount: -1, ownerUsername: 'ivy_thebrand' });
    const validPost  = makeApifyPost({ caption: 'Valid post', likesCount: 30, ownerUsername: 'ivy_thebrand' });
    mockFetch([hiddenPost, validPost]);

    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(captured.insertCalled).toBe(1);
    expect(captured.values!.posts).toHaveLength(1);

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const skipLog   = infoCalls.find((c) => String(c[1]).includes('hidden'));
    expect(skipLog).toBeDefined();
  });

  it('skips posts with null commentsCount', async () => {
    const nullComments = makeApifyPost({ commentsCount: null, ownerUsername: 'ivy_thebrand' });
    const valid        = makeApifyPost({ likesCount: 10, ownerUsername: 'ivy_thebrand' });
    mockFetch([nullComments, valid]);

    const { db, captured } = makeDb();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger: makeLogger() });

    expect(captured.values!.posts).toHaveLength(1);
  });

  it('logs count of skipped hidden posts at info', async () => {
    const posts = [
      makeApifyPost({ likesCount: -1 }),
      makeApifyPost({ commentsCount: null }),
      makeApifyPost({ likesCount: 20 }),
    ];
    mockFetch(posts);

    const { db } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const skipLog   = infoCalls.find(([ctx]) => typeof ctx === 'object' && 'skipped' in ctx);
    expect(skipLog).toBeDefined();
    expect(skipLog![0]['skipped']).toBe(2);
  });

  it('warns and returns without writing when all posts are hidden (0 survive month filter)', async () => {
    const allHidden = [makeApifyPost({ likesCount: -1 }), makeApifyPost({ commentsCount: -1 })];
    mockFetch(allHidden);

    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(captured.insertCalled).toBe(0);
  });
});

// ── London timezone month filter ──────────────────────────────────────────────

describe('Europe/London month filter', () => {
  it('excludes a UTC-late post that falls in the following month in London (BST)', async () => {
    // 2026-05-31T23:30:00Z = 2026-06-01T00:30:00 in BST (UTC+1) → June, not May
    const juneInLondon = makeApifyPost({
      timestamp:     '2026-05-31T23:30:00.000Z',
      ownerUsername: 'ivy_thebrand',
    });
    const validMay = makeApifyPost({
      timestamp:     '2026-05-15T12:00:00.000Z',
      ownerUsername: 'ivy_thebrand',
    });
    mockFetch([juneInLondon, validMay]);

    const { db, captured } = makeDb();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger: makeLogger() });

    const written = captured.values!.posts as Array<{ timestamp: string }>;
    expect(written).toHaveLength(1);
    expect(written[0]!.timestamp).toBe('2026-05-15T12:00:00.000Z');
  });

  it('warns and returns without writing when 0 posts match target month', async () => {
    const aprilPost = makeApifyPost({
      timestamp:     '2026-04-10T12:00:00.000Z',
      ownerUsername: 'ivy_thebrand',
    });
    mockFetch([aprilPost]);

    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(logger.warn).toHaveBeenCalledOnce();
    const [ctx, msg] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]! as [Record<string, unknown>, string];
    expect(msg).toMatch(/no posts/);
    expect(ctx['handle']).toBe('ivy_thebrand');
    expect(captured.insertCalled).toBe(0);
  });
});

// ── Schema validation ─────────────────────────────────────────────────────────

describe('schema validation', () => {
  it('throws when a mapped item has a non-integer likesCount (float)', async () => {
    const badPost = makeApifyPost({ likesCount: 12.5, ownerUsername: 'ivy_thebrand' });
    mockFetch([badPost]);

    const { db, captured } = makeDb();

    await expect(
      trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger: makeLogger() }),
    ).rejects.toThrow(/schema validation failed/);

    expect(captured.insertCalled).toBe(0);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('upserts a single ig_posts row via onConflictDoUpdate (latest-wins)', async () => {
    mockFetch([makeApifyPost()]);

    const { db, captured } = makeDb();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger: makeLogger() });

    expect(captured.insertCalled).toBe(1);
    expect(captured.onConflictCalled).toBe(1);
  });
});

// ── Coverage visibility ───────────────────────────────────────────────────────

describe('coverage visibility', () => {
  it('logs oldestTimestamp and monthStart at info', async () => {
    const posts = [
      makeApifyPost({ timestamp: '2026-05-20T00:00:00.000Z' }),
      makeApifyPost({ timestamp: '2026-05-01T00:00:00.000Z' }),
    ];
    mockFetch(posts);

    const { db } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const coverageLog = infoCalls.find(([ctx]) => typeof ctx === 'object' && 'oldestTimestamp' in ctx);
    expect(coverageLog).toBeDefined();
    expect(coverageLog![0]['oldestTimestamp']).toBe('2026-05-01T00:00:00.000Z');
    expect(coverageLog![0]['monthStart']).toBe('2026-05-01');
    expect(coverageLog![0]['resultsLimit']).toBe(50);
  });
});

// ── Media type: mapped, and loud when it is not ───────────────────────────────
//
// The payload shapes below are the real ones. A 300-deep probe of ivy_thebrand
// (2026-07-31) returned exactly three `type` values across 278 owned items — Video 184,
// Sidecar 87, Image 7 — and every one mapped. The unmapped cases are therefore
// constructed, not observed: the point of the warn is that the FIRST time Apify sends
// something new, it is on the record instead of being absorbed as a missing key.

describe('media type mapping', () => {
  it('writes the mediaType for every live Apify type, and warns about none', async () => {
    mockFetch([
      makeApifyPost({ type: 'Video',   timestamp: '2026-05-02T12:00:00.000Z', productType: 'clips' }),
      makeApifyPost({ type: 'Sidecar', timestamp: '2026-05-03T12:00:00.000Z' }),
      makeApifyPost({ type: 'Image',   timestamp: '2026-05-04T12:00:00.000Z' }),
    ]);
    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(captured.values!.posts.map((p) => p['mediaType'])).toEqual(['reel', 'carousel', 'image']);
    const warns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    expect(warns.find(([ctx]) => typeof ctx === 'object' && 'unmappedTypes' in ctx)).toBeUndefined();
  });

  it('warns with the raw value and count when a type does not map, and still stores the post', async () => {
    mockFetch([
      makeApifyPost({ type: 'Video', timestamp: '2026-05-02T12:00:00.000Z' }),
      makeApifyPost({ type: 'Story', timestamp: '2026-05-03T12:00:00.000Z' }),
      makeApifyPost({ type: 'Story', timestamp: '2026-05-04T12:00:00.000Z' }),
      makeApifyPost({ timestamp: '2026-05-05T12:00:00.000Z' }),   // no `type` at all
    ]);
    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    const warns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const unmappedWarn = warns.find(([ctx]) => typeof ctx === 'object' && 'unmappedTypes' in ctx);
    expect(unmappedWarn).toBeDefined();
    expect(unmappedWarn![0]['unmappedTypes']).toEqual({ Story: 2, '(absent)': 1 });
    expect(unmappedWarn![0]['unmappedCount']).toBe(3);
    expect(unmappedWarn![0]['ofPosts']).toBe(4);

    // The post is NOT dropped — only its media type is unknown.
    expect(captured.values!.posts).toHaveLength(4);
    expect(captured.values!.posts.filter((p) => p['mediaType'] === undefined)).toHaveLength(3);
  });

  it('maps a lowercase type rather than losing it', async () => {
    mockFetch([makeApifyPost({ type: 'video', timestamp: '2026-05-02T12:00:00.000Z' })]);
    const { db, captured } = makeDb();
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger });

    expect(captured.values!.posts[0]!['mediaType']).toBe('reel');
  });
});

// ── Depth is a parameter ──────────────────────────────────────────────────────

describe('resultsLimit', () => {
  it('defaults to 50 and is sent to Apify', async () => {
    mockFetch([makeApifyPost()]);
    const { db } = makeDb();
    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger: makeLogger() });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body['resultsLimit']).toBe(50);
  });

  it('sends an operator-specified depth when one is given', async () => {
    mockFetch([makeApifyPost()]);
    const { db } = makeDb();
    await trawlInstagramPosts({ ...BASE_PARAMS, db, apifyApiKey: 'key', logger: makeLogger(), resultsLimit: 300 });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body['resultsLimit']).toBe(300);
  });
});
