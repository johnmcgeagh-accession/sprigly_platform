import { describe, it, expect, vi, afterEach } from 'vitest';
import { trawlInstagramPosts } from './ig-producer.js';
import type { IgProducerParams } from './ig-producer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PARAMS = {
  clientId:      'client-1',
  channel:       'instagram',
  month:         '2026-05',
  driveFolderId: 'folder-xyz',
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

type DriveMock = Pick<IgProducerParams['drive'], 'listFiles' | 'downloadFile' | 'createFile' | 'updateFile'>;

function makeDrive(opts: {
  handle?:             string;
  hasConfig?:          boolean;
  hasExistingPostsFile?: boolean;
  createFileFn?:       ReturnType<typeof vi.fn>;
  updateFileFn?:       ReturnType<typeof vi.fn>;
} = {}): IgProducerParams['drive'] {
  const { handle, hasConfig = true, hasExistingPostsFile = false } = opts;
  const files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }> = [];

  if (hasConfig) {
    files.push({ id: 'config-id', name: 'calendar-config.json', mimeType: 'application/json', modifiedTime: '' });
  }
  if (hasExistingPostsFile) {
    files.push({ id: 'posts-id', name: 'instagram-posts-2026-05.json', mimeType: 'application/json', modifiedTime: '' });
  }

  const config: Record<string, unknown> = { client: 'Ivy-T' };
  if (handle !== undefined) config.instagram_handle = handle;

  const mock: DriveMock = {
    listFiles:    vi.fn().mockResolvedValue(files),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify(config))),
    createFile:   (opts.createFileFn ?? vi.fn().mockResolvedValue('new-file-id')) as DriveMock['createFile'],
    updateFile:   (opts.updateFileFn ?? vi.fn().mockResolvedValue(undefined)) as DriveMock['updateFile'],
  };
  return mock as unknown as IgProducerParams['drive'];
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
  it('warns and returns without calling fetch or Drive', async () => {
    const drive  = makeDrive({ handle: 'ivy_thebrand' });
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: undefined, logger });

    expect(logger.warn).toHaveBeenCalledOnce();
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatch(/APIFY_API_KEY/);
    expect(drive.listFiles).not.toHaveBeenCalled();
    expect(drive.createFile).not.toHaveBeenCalled();
  });
});

// ── Missing handle ────────────────────────────────────────────────────────────

describe('missing instagram_handle', () => {
  it('skips when calendar-config.json is absent', async () => {
    const drive  = makeDrive({ hasConfig: false });
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    expect(logger.info).toHaveBeenCalledOnce();
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatch(/calendar-config/);
    expect(drive.createFile).not.toHaveBeenCalled();
  });

  it('skips when instagram_handle key is absent from config', async () => {
    // makeDrive with no handle → config JSON has no instagram_handle field
    const drive  = makeDrive({});
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const messages  = infoCalls.map((c: unknown[]) => String(c[1]));
    expect(messages.some((m) => m.includes('instagram_handle'))).toBe(true);
    expect(drive.createFile).not.toHaveBeenCalled();
  });
});

// ── Field mapping ─────────────────────────────────────────────────────────────

describe('field mapping', () => {
  it('maps caption, timestamp, likesCount, commentsCount into Drive file', async () => {
    const post = makeApifyPost({
      caption:       'Summer linen in three new colourways',
      timestamp:     '2026-05-15T10:00:00.000Z',
      likesCount:    120,
      commentsCount: 8,
      ownerUsername: 'ivy_thebrand',
    });
    mockFetch([post]);

    const createFile = vi.fn().mockResolvedValue('file-id-123');
    const drive      = makeDrive({ handle: 'ivy_thebrand', createFileFn: createFile });
    const logger     = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    expect(createFile).toHaveBeenCalledOnce();
    const [, filename, , contentBuf] = (createFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string, string, Buffer];
    expect(filename).toBe('instagram-posts-2026-05.json');
    const written = JSON.parse(contentBuf.toString('utf-8')) as unknown[];
    expect(written).toHaveLength(1);
    const item = written[0] as Record<string, unknown>;
    expect(item['caption']).toBe('Summer linen in three new colourways');
    expect(item['timestamp']).toBe('2026-05-15T10:00:00.000Z');
    expect(item['likesCount']).toBe(120);
    expect(item['commentsCount']).toBe(8);
    expect(item).not.toHaveProperty('ownerUsername');
  });
});

// ── Account guard ─────────────────────────────────────────────────────────────

describe('account guard', () => {
  it('throws only when ZERO posts match the handle (all-foreign batch)', async () => {
    // All posts are from a completely different account — genuine wrong-handle case.
    const posts = [
      makeApifyPost({ ownerUsername: 'completely_wrong_account' }),
      makeApifyPost({ ownerUsername: 'another_foreign_account' }),
    ];
    mockFetch(posts);

    const drive  = makeDrive({ handle: 'ivy_thebrand' });
    const logger = makeLogger();

    await expect(
      trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger }),
    ).rejects.toThrow(/account mismatch/);

    await expect(
      trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger }),
    ).rejects.toThrow(/ivy_thebrand/);

    // Error lists distinct foreign owners found
    await expect(
      trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger }),
    ).rejects.toThrow(/completely_wrong_account/);

    expect(drive.createFile).not.toHaveBeenCalled();
  });

  it('drops foreign-owner posts and proceeds when at least one owned post exists (mixed batch)', async () => {
    // Realistic: actor returns ivy_thebrand's posts + tagged posts from other accounts.
    const posts = [
      makeApifyPost({ ownerUsername: 'ivy_thebrand',        caption: 'Our post',       timestamp: '2026-05-10T12:00:00.000Z' }),
      makeApifyPost({ ownerUsername: 'whatemilyworetoday',  caption: 'Tagged us!',     timestamp: '2026-05-11T12:00:00.000Z' }),
      makeApifyPost({ ownerUsername: 'ivy_thebrand',        caption: 'Another ours',   timestamp: '2026-05-12T12:00:00.000Z' }),
      makeApifyPost({ ownerUsername: 'someotherfashionblog', caption: 'Mention post',  timestamp: '2026-05-13T12:00:00.000Z' }),
    ];
    mockFetch(posts);

    const createFile = vi.fn().mockResolvedValue('file-id');
    const drive      = makeDrive({ handle: 'ivy_thebrand', createFileFn: createFile });
    const logger     = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    // File written with only the 2 owned posts
    expect(createFile).toHaveBeenCalledOnce();
    const [, , , buf] = (createFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string, string, Buffer];
    const written     = JSON.parse(buf.toString('utf-8')) as Array<{ caption: string }>;
    expect(written).toHaveLength(2);
    expect(written.every((p) => ['Our post', 'Another ours'].includes(p.caption))).toBe(true);

    // Dropped count logged at info
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

    const createFile = vi.fn().mockResolvedValue('file-id');
    const drive      = makeDrive({ handle: 'ivy_thebrand', createFileFn: createFile });
    const logger     = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    expect(createFile).toHaveBeenCalledOnce();
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const dropLog   = infoCalls.find(([ctx]) => typeof ctx === 'object' && 'droppedCount' in ctx);
    expect(dropLog).toBeUndefined();
  });

  it('is case-insensitive (IVY_THEBRAND matches ivy_thebrand in config)', async () => {
    const post = makeApifyPost({ ownerUsername: 'IVY_THEBRAND' });
    mockFetch([post]);

    const createFile = vi.fn().mockResolvedValue('file-id');
    const drive      = makeDrive({ handle: 'ivy_thebrand', createFileFn: createFile });

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger: makeLogger() });

    expect(createFile).toHaveBeenCalledOnce();
  });
});

// ── Hidden / negative counts ──────────────────────────────────────────────────

describe('hidden/negative like and comment counts', () => {
  it('skips posts with likesCount = -1, does not throw, writes remaining posts', async () => {
    const hiddenPost = makeApifyPost({ likesCount: -1, ownerUsername: 'ivy_thebrand' });
    const validPost  = makeApifyPost({ caption: 'Valid post', likesCount: 30, ownerUsername: 'ivy_thebrand' });
    mockFetch([hiddenPost, validPost]);

    const createFile = vi.fn().mockResolvedValue('file-id');
    const drive      = makeDrive({ handle: 'ivy_thebrand', createFileFn: createFile });
    const logger     = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    // File written — the valid post survives
    expect(createFile).toHaveBeenCalledOnce();
    const [, , , buf] = (createFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string, string, Buffer];
    const written     = JSON.parse(buf.toString('utf-8')) as unknown[];
    expect(written).toHaveLength(1);

    // Skip logged at info
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const skipLog   = infoCalls.find((c) => String(c[1]).includes('hidden'));
    expect(skipLog).toBeDefined();
  });

  it('skips posts with null commentsCount', async () => {
    const nullComments = makeApifyPost({ commentsCount: null, ownerUsername: 'ivy_thebrand' });
    const valid        = makeApifyPost({ likesCount: 10, ownerUsername: 'ivy_thebrand' });
    mockFetch([nullComments, valid]);

    const createFile = vi.fn().mockResolvedValue('file-id');
    const drive      = makeDrive({ handle: 'ivy_thebrand', createFileFn: createFile });

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger: makeLogger() });

    const [, , , buf] = (createFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string, string, Buffer];
    const written     = JSON.parse(buf.toString('utf-8')) as unknown[];
    expect(written).toHaveLength(1);
  });

  it('logs count of skipped hidden posts at info', async () => {
    const posts = [
      makeApifyPost({ likesCount: -1 }),
      makeApifyPost({ commentsCount: null }),
      makeApifyPost({ likesCount: 20 }),  // only this one survives
    ];
    mockFetch(posts);

    const drive  = makeDrive({ handle: 'ivy_thebrand' });
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const skipLog   = infoCalls.find(([ctx]) => typeof ctx === 'object' && 'skipped' in ctx);
    expect(skipLog).toBeDefined();
    expect(skipLog![0]['skipped']).toBe(2);
  });

  it('warns and returns without writing when all posts are hidden (0 survive month filter)', async () => {
    const allHidden = [makeApifyPost({ likesCount: -1 }), makeApifyPost({ commentsCount: -1 })];
    mockFetch(allHidden);

    const drive  = makeDrive({ handle: 'ivy_thebrand' });
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(drive.createFile).not.toHaveBeenCalled();
  });
});

// ── London timezone month filter ──────────────────────────────────────────────

describe('Europe/London month filter', () => {
  it('excludes a UTC-late post that falls in the following month in London (BST)', async () => {
    // 2026-05-31T23:30:00Z = 2026-06-01T00:30:00 in BST (UTC+1) → June, not May
    const juneInLondon = makeApifyPost({
      timestamp: '2026-05-31T23:30:00.000Z',
      ownerUsername: 'ivy_thebrand',
    });
    const validMay = makeApifyPost({
      timestamp: '2026-05-15T12:00:00.000Z',
      ownerUsername: 'ivy_thebrand',
    });
    mockFetch([juneInLondon, validMay]);

    const createFile = vi.fn().mockResolvedValue('file-id');
    const drive      = makeDrive({ handle: 'ivy_thebrand', createFileFn: createFile });

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger: makeLogger() });

    const [, , , buf] = (createFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string, string, Buffer];
    const written     = JSON.parse(buf.toString('utf-8')) as Array<{ timestamp: string }>;
    expect(written).toHaveLength(1);
    expect(written[0]!.timestamp).toBe('2026-05-15T12:00:00.000Z');
  });

  it('warns and returns without writing when 0 posts match target month', async () => {
    // All posts are in April
    const aprilPost = makeApifyPost({
      timestamp:     '2026-04-10T12:00:00.000Z',
      ownerUsername: 'ivy_thebrand',
    });
    mockFetch([aprilPost]);

    const drive  = makeDrive({ handle: 'ivy_thebrand' });
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    expect(logger.warn).toHaveBeenCalledOnce();
    const [ctx, msg] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]! as [Record<string, unknown>, string];
    expect(msg).toMatch(/no posts/);
    expect(ctx['handle']).toBe('ivy_thebrand');
    expect(drive.createFile).not.toHaveBeenCalled();
  });
});

// ── Schema validation ─────────────────────────────────────────────────────────

describe('schema validation', () => {
  it('throws when a mapped item has a non-integer likesCount (float)', async () => {
    // 12.5 passes count filter (>= 0) but fails z.number().int()
    const badPost = makeApifyPost({ likesCount: 12.5, ownerUsername: 'ivy_thebrand' });
    mockFetch([badPost]);

    const drive = makeDrive({ handle: 'ivy_thebrand' });

    await expect(
      trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger: makeLogger() }),
    ).rejects.toThrow(/schema validation failed/);

    expect(drive.createFile).not.toHaveBeenCalled();
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('calls createFile when no existing posts file is present', async () => {
    mockFetch([makeApifyPost()]);

    const createFile = vi.fn().mockResolvedValue('new-file-id');
    const updateFile = vi.fn().mockResolvedValue(undefined);
    const drive      = makeDrive({ handle: 'ivy_thebrand', hasExistingPostsFile: false, createFileFn: createFile, updateFileFn: updateFile });

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger: makeLogger() });

    expect(createFile).toHaveBeenCalledOnce();
    expect(updateFile).not.toHaveBeenCalled();
  });

  it('calls updateFile (not createFile) when posts file already exists', async () => {
    mockFetch([makeApifyPost()]);

    const createFile = vi.fn().mockResolvedValue('new-file-id');
    const updateFile = vi.fn().mockResolvedValue(undefined);
    const drive      = makeDrive({ handle: 'ivy_thebrand', hasExistingPostsFile: true, createFileFn: createFile, updateFileFn: updateFile });

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger: makeLogger() });

    expect(updateFile).toHaveBeenCalledOnce();
    expect(createFile).not.toHaveBeenCalled();
    // Confirm it passed the right fileId
    const [fileId] = (updateFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string, Buffer];
    expect(fileId).toBe('posts-id');
  });
});

// ── Coverage visibility ───────────────────────────────────────────────────────

describe('coverage visibility', () => {
  it('logs oldestTimestamp and monthStart at info', async () => {
    const posts = [
      makeApifyPost({ timestamp: '2026-05-20T00:00:00.000Z' }),
      makeApifyPost({ timestamp: '2026-05-01T00:00:00.000Z' }),  // oldest
    ];
    mockFetch(posts);

    const drive  = makeDrive({ handle: 'ivy_thebrand' });
    const logger = makeLogger();

    await trawlInstagramPosts({ ...BASE_PARAMS, drive, apifyApiKey: 'key', logger });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, unknown>, string]>;
    const coverageLog = infoCalls.find(([ctx]) => typeof ctx === 'object' && 'oldestTimestamp' in ctx);
    expect(coverageLog).toBeDefined();
    expect(coverageLog![0]['oldestTimestamp']).toBe('2026-05-01T00:00:00.000Z');
    expect(coverageLog![0]['monthStart']).toBe('2026-05-01');
    expect(coverageLog![0]['resultsLimit']).toBe(50);
  });
});
