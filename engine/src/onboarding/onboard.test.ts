import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clients, clientChannels, clientPlanningConfig, voiceSnapshots, igPosts, clientProductCatalogue } from '@sprigly/db';

// Mock the Apify fetch so stageTrawl is testable without network.
vi.mock('../apify-ig-fetch.js', () => ({ fetchApifyPostsForHandle: vi.fn() }));
import { fetchApifyPostsForHandle } from '../apify-ig-fetch.js';

import {
  slugify, computeCadence, parsePillarsResponse, toConfigPillars,
  stageCreate, stageTrawl, writePlanningConfig, writeVoiceSnapshot,
  THIN_CAPTION_FLOOR, DEFAULT_CATEGORIES, DEFAULT_REGISTER_MAP,
} from './onboard.js';

// ── scripted db mock ──────────────────────────────────────────────────────────
interface Script { clients?: unknown[]; channels?: unknown[]; returning?: unknown[] }
function makeDb(script: Script = {}) {
  const insertedTables: unknown[] = [];
  const insertedValues: Array<{ table: unknown; values: unknown }> = [];
  const updatedTables: unknown[] = [];
  let selTable: unknown;
  const chain: Record<string, unknown> = {
    from(t: unknown) { selTable = t; return chain; },
    where() { return chain; },
    limit() {
      if (selTable === clients) return Promise.resolve(script.clients ?? []);
      if (selTable === clientChannels) return Promise.resolve(script.channels ?? []);
      return Promise.resolve([]);
    },
    set() { return chain; },
    values(v: unknown) { insertedValues[insertedValues.length - 1]!.values = v; return chain; },
    onConflictDoUpdate() { return Promise.resolve(); },
    onConflictDoNothing() { return chain; },
    returning() { return Promise.resolve(script.returning ?? []); },
  };
  const db = {
    select() { return chain; },
    insert(t: unknown) { insertedTables.push(t); insertedValues.push({ table: t, values: undefined }); return chain; },
    update(t: unknown) { updatedTables.push(t); return chain; },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as Parameters<typeof stageCreate>[0]['db'];
  return { db, insertedTables, insertedValues, updatedTables };
}

// ── deterministic helpers ──────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases, hyphenates, strips punctuation and accents', () => {
    expect(slugify('IVY-t')).toBe('ivy-t');
    expect(slugify('Björk & Co!')).toBe('bjork-co');
    expect(slugify('  The   Linen Room  ')).toBe('the-linen-room');
    expect(slugify('A/B Studio')).toBe('a-b-studio');
  });
});

describe('computeCadence', () => {
  it('computes ~posts/week and a suggested cadence from known timestamps', () => {
    // 8 posts spread over exactly 4 weeks (28 days) → 2/week.
    const start = Date.UTC(2026, 4, 1); const day = 86_400_000;
    const ts = Array.from({ length: 8 }, (_, i) => new Date(start + i * 3.5 * day).toISOString());
    const r = computeCadence(ts);
    expect(r.postCount).toBe(8);
    expect(r.windowDays).toBe(25);                 // 7 gaps of 3.5 days
    expect(r.observedPostsPerWeek).toBe(2.3);   // 8 / (24.5/7) = 2.29 → 2.3
    expect(r.cadence.maxPerWeek).toBeGreaterThanOrEqual(r.cadence.minPerWeek);
    expect(r.cadence.postsPerMonthMax).toBeGreaterThanOrEqual(r.cadence.postsPerMonthMin);
  });
  it('handles empty input without dividing by zero', () => {
    const r = computeCadence([]);
    expect(r.postCount).toBe(0);
    expect(r.observedPostsPerWeek).toBe(0);
  });
});

describe('parsePillarsResponse + toConfigPillars', () => {
  it('parses clean and fenced JSON', () => {
    const clean = '{"pillars":[{"name":"Launches","description":"New drops","sharePct":40}]}';
    expect(parsePillarsResponse(clean)[0]).toEqual({ name: 'Launches', description: 'New drops', sharePct: 40 });
    const fenced = '```json\n{"pillars":[{"name":"Styling","description":"How to wear","sharePct":30}]}\n```';
    expect(parsePillarsResponse(fenced)[0]!.name).toBe('Styling');
  });
  it('maps to the config Pillar shape (share dropped from config)', () => {
    const cfg = toConfigPillars([{ name: 'Education', description: 'Fabric facts', sharePct: 20 }]);
    expect(cfg[0]).toEqual({ name: 'Education', tagline: 'Fabric facts', keyMessages: [], contentIdeas: [] });
  });
});

// ── Stage A — create + collision refusal ───────────────────────────────────────

describe('stageCreate', () => {
  it('creates an app-surface client + channel with the handle', async () => {
    const { db, insertedValues } = makeDb({ clients: [], channels: [], returning: [{ id: 'client-1' }] });
    const r = await stageCreate({ db, name: 'The Linen Room', handle: '@linenroom', channel: 'instagram' });
    expect(r.ok).toBe(true);
    expect(r.slug).toBe('the-linen-room');
    expect(r.clientId).toBe('client-1');
    const chanInsert = insertedValues.find((i) => i.table === clientChannels)!.values as Record<string, unknown>;
    expect(chanInsert['deliverySurface']).toBe('app');
    expect(chanInsert['instagramHandle']).toBe('linenroom');   // @ stripped
    expect(chanInsert['driveFolderId']).toBeUndefined();       // no Drive
  });
  it('refuses on slug collision — never mutates', async () => {
    const { db, insertedTables } = makeDb({ clients: [{ id: 'existing' }] });
    const r = await stageCreate({ db, name: 'IVY-t', handle: 'ivy', channel: 'instagram' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already exists/);
    expect(insertedTables).toHaveLength(0);
  });
  it('refuses on handle collision', async () => {
    const { db, insertedTables } = makeDb({ clients: [], channels: [{ id: 'ch', clientId: 'other' }] });
    const r = await stageCreate({ db, name: 'New Brand', handle: 'taken', channel: 'instagram' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already onboarded/);
    expect(insertedTables).toHaveLength(0);
  });
});

// ── Stage B — thin-account gate + writes to ig_posts ───────────────────────────

function apifyPosts(n: number): { posts: unknown[] } {
  const start = Date.UTC(2026, 5, 1);
  return {
    posts: Array.from({ length: n }, (_, i) => ({
      caption: `Caption number ${i} about our organic cotton pieces`,
      timestamp: new Date(start + i * 86_400_000).toISOString(),
      likesCount: 10 + i, commentsCount: i, ownerUsername: 'brand',
    })),
  };
}

describe('stageTrawl', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('flags thin=true below the caption floor, thin=false above, upserts ig_posts', async () => {
    (fetchApifyPostsForHandle as ReturnType<typeof vi.fn>).mockResolvedValueOnce(apifyPosts(5));
    const { db, insertedTables } = makeDb();
    const thin = await stageTrawl({ db, apifyApiKey: 'k', clientId: 'c1', channel: 'instagram', handle: 'brand' });
    expect(thin.thin).toBe(true);
    expect(thin.captions.length).toBe(5);
    expect(thin.captions.length).toBeLessThan(THIN_CAPTION_FLOOR);
    expect(insertedTables).toContain(igPosts);   // still wrote ig_posts

    (fetchApifyPostsForHandle as ReturnType<typeof vi.fn>).mockResolvedValueOnce(apifyPosts(20));
    const { db: db2 } = makeDb();
    const fat = await stageTrawl({ db: db2, apifyApiKey: 'k', clientId: 'c1', channel: 'instagram', handle: 'brand' });
    expect(fat.thin).toBe(false);
    expect(fat.captions.length).toBe(20);
  });
  it('refuses without an Apify key', async () => {
    const { db } = makeDb();
    const r = await stageTrawl({ db, apifyApiKey: undefined, clientId: 'c1', channel: 'instagram', handle: 'brand' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/APIFY_API_KEY/);
  });
});

// ── config writes never touch client_product_catalogue ─────────────────────────

describe('never touches client_product_catalogue', () => {
  it('writePlanningConfig writes only client_planning_config', async () => {
    const { db, insertedTables } = makeDb();
    await writePlanningConfig(db, 'c1', 'instagram', { pillars: [], cadence: { postsPerMonthMin: 1, postsPerMonthMax: 2, maxPerWeek: 1, minPerWeek: 1 }, categories: DEFAULT_CATEGORIES, registerMap: DEFAULT_REGISTER_MAP });
    expect(insertedTables).toContain(clientPlanningConfig);
    expect(insertedTables).not.toContain(clientProductCatalogue);
  });
  it('a full stage sweep never inserts/updates client_product_catalogue', async () => {
    (fetchApifyPostsForHandle as ReturnType<typeof vi.fn>).mockResolvedValueOnce(apifyPosts(20));
    const { db, insertedTables, updatedTables } = makeDb({ clients: [], channels: [], returning: [{ id: 'c1' }] });
    await stageCreate({ db, name: 'New Brand', handle: 'nb', channel: 'instagram' });
    await stageTrawl({ db, apifyApiKey: 'k', clientId: 'c1', channel: 'instagram', handle: 'nb' });
    await writeVoiceSnapshot(db, 'c1', 'instagram', '## Instagram — Voice Profile\n...');
    await writePlanningConfig(db, 'c1', 'instagram', { pillars: [], cadence: { postsPerMonthMin: 1, postsPerMonthMax: 2, maxPerWeek: 1, minPerWeek: 1 }, categories: DEFAULT_CATEGORIES, registerMap: {} });
    expect([...insertedTables, ...updatedTables]).not.toContain(clientProductCatalogue);
    expect(insertedTables).toEqual(expect.arrayContaining([clients, clientChannels, igPosts, voiceSnapshots, clientPlanningConfig]));
  });
});
