import { describe, it, expect, vi } from 'vitest';
import {
  parseSalesCsv,
  parseIgPostsJson,
  buildLeanLine,
  LEAN_LINE_WORKFLOW,
  LEAN_LINE_STEP,
} from './lean-line.js';
import type { BuildLeanLineParams } from './lean-line.js';

// ── parseSalesCsv ─────────────────────────────────────────────────────────────

describe('parseSalesCsv', () => {
  it('ranks products by units and returns top 5', () => {
    const csv = [
      'Product title,Net quantity',
      'Linen blazer,42',
      'Cotton dress,31',
      'Silk top,28',
      'Denim jeans,15',
      'Wool coat,12',
      'Scarf,5',
    ].join('\n');

    const result = parseSalesCsv(Buffer.from(csv), '2026-05');
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ product: 'Linen blazer', units: 42 });
    expect(result[4]).toEqual({ product: 'Wool coat', units: 12 });
  });

  it('handles "Net items sold" column name (Shopify drift)', () => {
    const csv = ['Product title,Net items sold', 'Linen blazer,42'].join('\n');
    const result = parseSalesCsv(Buffer.from(csv), '2026-05');
    expect(result).toEqual([{ product: 'Linen blazer', units: 42 }]);
  });

  it('handles "Items sold" column name', () => {
    const csv = ['Product title,Items sold', 'Cotton dress,31'].join('\n');
    const result = parseSalesCsv(Buffer.from(csv), '2026-05');
    expect(result).toEqual([{ product: 'Cotton dress', units: 31 }]);
  });

  it('filters by date column when present', () => {
    const csv = [
      'Day,Product title,Net quantity',
      '2026-05-01,Linen blazer,10',
      '2026-05-15,Linen blazer,12',
      '2026-04-20,Cotton dress,50',   // prior month — excluded
    ].join('\n');

    const result = parseSalesCsv(Buffer.from(csv), '2026-05');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ product: 'Linen blazer', units: 22 });
  });

  it('sums multiple rows for the same product', () => {
    const csv = [
      'Product title,Net quantity',
      'Linen blazer,10',
      'Linen blazer,15',
      'Linen blazer,17',
    ].join('\n');

    const result = parseSalesCsv(Buffer.from(csv), '2026-05');
    expect(result).toEqual([{ product: 'Linen blazer', units: 42 }]);
  });

  it('skips rows with non-positive quantity', () => {
    const csv = [
      'Product title,Net quantity',
      'Returned item,-5',
      'Linen blazer,10',
    ].join('\n');

    const result = parseSalesCsv(Buffer.from(csv), '2026-05');
    expect(result).toEqual([{ product: 'Linen blazer', units: 10 }]);
  });

  it('strips BOM from Shopify UTF-8 exports', () => {
    const csv = '﻿Product title,Net quantity\nLinen blazer,42\n';
    const result = parseSalesCsv(Buffer.from(csv), '2026-05');
    expect(result).toEqual([{ product: 'Linen blazer', units: 42 }]);
  });

  it('returns [] when product column not found', () => {
    const csv = ['SKU,Quantity', 'sku-1,10'].join('\n');
    expect(parseSalesCsv(Buffer.from(csv), '2026-05')).toEqual([]);
  });

  it('returns [] for empty / header-only input', () => {
    expect(parseSalesCsv(Buffer.from(''), '2026-05')).toEqual([]);
    expect(parseSalesCsv(Buffer.from('Product title,Net quantity'), '2026-05')).toEqual([]);
  });
});

// ── parseIgPostsJson ──────────────────────────────────────────────────────────

describe('parseIgPostsJson', () => {
  it('ranks posts by engagement (likes + comments) for the target month', () => {
    const posts = [
      { caption: 'Post one',  timestamp: '2026-05-10T12:00:00Z', likesCount: 80, commentsCount: 10 },
      { caption: 'Post two',  timestamp: '2026-05-15T08:00:00Z', likesCount: 50, commentsCount: 5  },
      { caption: 'Post three',timestamp: '2026-04-20T12:00:00Z', likesCount: 200, commentsCount: 50 }, // prior month
    ];
    const result = parseIgPostsJson(Buffer.from(JSON.stringify(posts)), '2026-05');
    expect(result).toHaveLength(2);
    expect(result[0]!.engagement).toBe(90);
    expect(result[1]!.engagement).toBe(55);
  });

  it('truncates caption snippet to 15 words with ellipsis', () => {
    const words16 = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const posts = [
      { caption: words16, timestamp: '2026-05-10T12:00:00Z', likesCount: 10, commentsCount: 0 },
    ];
    const result = parseIgPostsJson(Buffer.from(JSON.stringify(posts)), '2026-05');
    // ellipsis is appended inline to the 15th word, so splitting on whitespace gives 15 tokens
    expect(result[0]!.snippet).toMatch(/…$/);
    expect(result[0]!.snippet.split(/\s+/).length).toBe(15);
  });

  it('does not add ellipsis when caption is exactly 15 words', () => {
    const words15 = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
    const posts = [{ caption: words15, timestamp: '2026-05-10T12:00:00Z', likesCount: 5, commentsCount: 0 }];
    const result = parseIgPostsJson(Buffer.from(JSON.stringify(posts)), '2026-05');
    expect(result[0]!.snippet).not.toMatch(/…$/);
  });

  it('applies Europe/London timezone when filtering (UTC-adjacent day boundary)', () => {
    // 2026-05-31T23:30:00Z = 2026-06-01T00:30:00+01:00 BST → June in London
    const posts = [
      { caption: 'Late may UTC',   timestamp: '2026-05-31T23:30:00Z', likesCount: 100, commentsCount: 0 },
      { caption: 'Early may UTC',  timestamp: '2026-05-01T00:30:00Z', likesCount: 50,  commentsCount: 0 },
    ];
    const result = parseIgPostsJson(Buffer.from(JSON.stringify(posts)), '2026-05');
    // 23:30 UTC on May 31 = 00:30 BST June 1 → excluded from May
    expect(result).toHaveLength(1);
    expect(result[0]!.snippet).toBe('Early may UTC');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseIgPostsJson(Buffer.from('not json'), '2026-05')).toThrow();
  });

  it('throws on non-array JSON (schema mismatch)', () => {
    expect(() => parseIgPostsJson(Buffer.from('{}'), '2026-05')).toThrow();
  });

  it('throws when required fields are missing (e.g. likesCount absent)', () => {
    const posts = [{ caption: 'Post', timestamp: '2026-05-10T12:00:00Z' }]; // missing likesCount/commentsCount
    expect(() => parseIgPostsJson(Buffer.from(JSON.stringify(posts)), '2026-05')).toThrow();
  });

  it('returns [] when no posts match the month (valid schema)', () => {
    const posts = [
      { caption: 'April post', timestamp: '2026-04-10T12:00:00Z', likesCount: 100, commentsCount: 0 },
    ];
    expect(parseIgPostsJson(Buffer.from(JSON.stringify(posts)), '2026-05')).toEqual([]);
  });

  it('caps result at top 5', () => {
    const posts = Array.from({ length: 10 }, (_, i) => ({
      caption: `Post ${i}`,
      timestamp: '2026-05-10T12:00:00Z',
      likesCount: 10 - i,
      commentsCount: 0,
    }));
    expect(parseIgPostsJson(Buffer.from(JSON.stringify(posts)), '2026-05')).toHaveLength(5);
  });
});

// ── buildLeanLine — four degradation paths ────────────────────────────────────

const SALES_CSV = Buffer.from([
  'Product title,Net quantity',
  'Linen blazer,42',
  'Cotton dress,31',
].join('\n'));

const IG_JSON = Buffer.from(JSON.stringify([
  { caption: 'Our linen blazer is perfect for summer evenings out', timestamp: '2026-05-10T12:00:00Z', likesCount: 80, commentsCount: 10 },
  { caption: 'New cotton dress just dropped', timestamp: '2026-05-20T12:00:00Z', likesCount: 50, commentsCount: 5 },
]));

function makeDrive(files: Record<string, Buffer>): BuildLeanLineParams['drive'] {
  return {
    listFiles: vi.fn().mockResolvedValue(
      Object.keys(files).map((name) => ({ id: name, name, mimeType: '', modifiedTime: '' })),
    ),
    downloadFile: vi.fn().mockImplementation((id: string) => {
      const buf = files[id];
      if (!buf) throw new Error(`file not found: ${id}`);
      return Promise.resolve(buf);
    }),
  } as unknown as BuildLeanLineParams['drive'];
}

function makeModel(response = 'Leaning towards the linen blazer next month.'): BuildLeanLineParams['model'] {
  return {
    completeStreaming: vi.fn().mockResolvedValue({
      content: response,
      inputTokens: 50,
      outputTokens: 20,
      modelId: 'haiku',
      stopReason: 'end_turn',
    }),
    complete: vi.fn(),
  };
}

function makeLogger(): BuildLeanLineParams['logger'] {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as BuildLeanLineParams['logger'];
}

function makePrompts(text = 'system prompt from store'): BuildLeanLineParams['prompts'] {
  return { resolve: vi.fn().mockResolvedValue(text) };
}

const BASE_PARAMS = {
  clientId:      'client-1',
  clientName:    'Ivy-T',
  channel:       'instagram',
  month:         '2026-05',
  driveFolderId: 'folder-xyz',
  prompts:       makePrompts(),
};

// ── Prompt resolver wiring ────────────────────────────────────────────────────

describe('buildLeanLine — prompt resolver', () => {
  it('uses the workflow and step constants that match the migration seed', () => {
    expect(LEAN_LINE_WORKFLOW).toBe('content-cycle-request-email');
    expect(LEAN_LINE_STEP).toBe('lean-line');
  });

  it('calls prompts.resolve with (clientId, workflow, step) when model is invoked', async () => {
    const prompts = makePrompts();
    const drive   = makeDrive({ 'sales-2026-05.csv': SALES_CSV });
    await buildLeanLine({ ...BASE_PARAMS, drive, model: makeModel(), logger: makeLogger(), prompts });
    expect(prompts.resolve).toHaveBeenCalledOnce();
    expect(prompts.resolve).toHaveBeenCalledWith('client-1', LEAN_LINE_WORKFLOW, LEAN_LINE_STEP);
  });

  it('passes the resolved prompt text as system to model.completeStreaming', async () => {
    const CUSTOM = 'Custom prompt text from DB';
    const prompts = makePrompts(CUSTOM);
    const model   = makeModel();
    const drive   = makeDrive({ 'sales-2026-05.csv': SALES_CSV });
    await buildLeanLine({ ...BASE_PARAMS, drive, model, logger: makeLogger(), prompts });
    const call = (model.completeStreaming as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toBe(CUSTOM);
  });

  it('propagates resolver error (no silent fallback)', async () => {
    const prompts = {
      resolve: vi.fn().mockRejectedValue(
        new Error('No prompt template found for workflow=content-cycle-request-email step=lean-line'),
      ),
    };
    const drive = makeDrive({ 'sales-2026-05.csv': SALES_CSV });
    await expect(
      buildLeanLine({ ...BASE_PARAMS, drive, model: makeModel(), logger: makeLogger(), prompts }),
    ).rejects.toThrow('No prompt template found');
  });

  it('does not call prompts.resolve when both sources are absent', async () => {
    const prompts = makePrompts();
    const result  = await buildLeanLine({ ...BASE_PARAMS, drive: makeDrive({}), model: makeModel(), logger: makeLogger(), prompts });
    expect(result).toBeNull();
    expect(prompts.resolve).not.toHaveBeenCalled();
  });
});

// ── Degradation paths ─────────────────────────────────────────────────────────

describe('buildLeanLine — degradation paths', () => {
  it('both sources present: calls model with both sections, returns lean line', async () => {
    const model = makeModel();
    const drive = makeDrive({
      'sales-2026-05.csv':         SALES_CSV,
      'instagram-posts-2026-05.json': IG_JSON,
    });

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger: makeLogger() });

    expect(result).toBe('Leaning towards the linen blazer next month.');
    const call = (model.completeStreaming as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.messages[0].content).toContain('TOP SELLERS');
    expect(call.messages[0].content).toContain('TOP POSTS');
    expect(call.messages[0].content).toContain('BOTH lists');
    expect(call.model).toBe('haiku');
    expect(call.maxTokens).toBe(150);
  });

  it('sales only: calls model with sales note, no engagement section', async () => {
    const model = makeModel();
    const drive = makeDrive({ 'sales-2026-05.csv': SALES_CSV });

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger: makeLogger() });

    expect(result).toBeTruthy();
    const call = (model.completeStreaming as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.messages[0].content).toContain('TOP SELLERS');
    expect(call.messages[0].content).not.toContain('TOP POSTS');
    expect(call.messages[0].content).toContain('Engagement data unavailable');
  });

  it('engagement only: calls model with engagement note, no sellers section', async () => {
    const model = makeModel();
    const drive = makeDrive({ 'instagram-posts-2026-05.json': IG_JSON });

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger: makeLogger() });

    expect(result).toBeTruthy();
    const call = (model.completeStreaming as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.messages[0].content).not.toContain('TOP SELLERS');
    expect(call.messages[0].content).toContain('TOP POSTS');
    expect(call.messages[0].content).toContain('Sales data unavailable');
  });

  it('both sources absent: returns null without calling model', async () => {
    const model = makeModel();
    const drive = makeDrive({});

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger: makeLogger() });

    expect(result).toBeNull();
    expect(model.completeStreaming).not.toHaveBeenCalled();
  });

  it('returns null when model returns empty string', async () => {
    const model = makeModel('');
    const drive = makeDrive({ 'sales-2026-05.csv': SALES_CSV });

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger: makeLogger() });
    expect(result).toBeNull();
  });

  it('treats Drive API errors as absent sources and degrades gracefully', async () => {
    const model = makeModel();
    const drive = {
      listFiles:    vi.fn().mockRejectedValue(new Error('Drive API error')),
      downloadFile: vi.fn(),
    } as unknown as BuildLeanLineParams['drive'];

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger: makeLogger() });
    expect(result).toBeNull();
    expect(model.completeStreaming).not.toHaveBeenCalled();
  });

  it('IG file present but invalid JSON: warns with filename, returns null, no model call', async () => {
    const logger  = makeLogger();
    const model   = makeModel();
    const drive   = makeDrive({ 'instagram-posts-2026-05.json': Buffer.from('not valid json') });

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger });
    expect(result).toBeNull();
    expect(model.completeStreaming).not.toHaveBeenCalled();
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    expect(warnCalls.some((c: unknown[]) =>
      typeof c[1] === 'string' && c[1].includes('parse/validation'),
    )).toBe(true);
  });

  it('IG file present but schema mismatch: warns with filename, returns null', async () => {
    const logger  = makeLogger();
    const model   = makeModel();
    // Missing likesCount/commentsCount — fails igPostSchema
    const badPosts = [{ caption: 'test', timestamp: '2026-05-01T12:00:00Z' }];
    const drive   = makeDrive({ 'instagram-posts-2026-05.json': Buffer.from(JSON.stringify(badPosts)) });

    const result = await buildLeanLine({ ...BASE_PARAMS, drive, model, logger });
    expect(result).toBeNull();
    expect(model.completeStreaming).not.toHaveBeenCalled();
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    expect(warnCalls.some((c: unknown[]) => {
      const ctx = c[0] as Record<string, unknown>;
      return typeof ctx['filename'] === 'string' && typeof ctx['reason'] === 'string';
    })).toBe(true);
  });
});
