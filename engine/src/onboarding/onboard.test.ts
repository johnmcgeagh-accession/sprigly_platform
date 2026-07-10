import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clients, clientChannels, clientConfigs, clientPlanningConfig, voiceSnapshots, igPosts, clientProductCatalogue } from '@sprigly/db';

// Mock the Apify fetch so stageTrawl is testable without network.
vi.mock('../apify-ig-fetch.js', () => ({ fetchApifyPostsForHandle: vi.fn() }));
import { fetchApifyPostsForHandle } from '../apify-ig-fetch.js';

import {
  slugify, computeCadence, computeFormatMix, parsePillarsResponse, toConfigPillars,
  stageCreate, stageTrawl, writePlanningConfig, writeVoiceSnapshot, mapShopifyToCatalogue,
  vendorIsOwnBrand, filterOwnBrandProducts,
  THIN_CAPTION_FLOOR, DEFAULT_CATEGORIES, DEFAULT_REGISTER_MAP,
} from './onboard.js';
import { deriveBrandTokens } from '../catalogue/validate-catalogue.js';

// ── scripted db mock ──────────────────────────────────────────────────────────
interface Script { clients?: unknown[]; channels?: unknown[]; configs?: unknown[]; returning?: unknown[] }
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
      if (selTable === clientConfigs) return Promise.resolve(script.configs ?? []);
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

describe('computeFormatMix', () => {
  it('computes % over posts that carry a media type', () => {
    const m = computeFormatMix(['image', 'image', 'reel', 'carousel']);
    expect(m.counted).toBe(4);
    expect([m.imagePct, m.reelPct, m.carouselPct]).toEqual([50, 25, 25]);
  });
  it('ignores posts without a media type (they are not in the denominator)', () => {
    const m = computeFormatMix(['reel', undefined, 'reel', undefined]);
    expect(m.counted).toBe(2);
    expect(m.reelPct).toBe(100);
    expect(m.image).toBe(0);
  });
  it('all-untyped → zeros, no divide-by-zero', () => {
    const m = computeFormatMix([undefined, undefined]);
    expect(m.counted).toBe(0);
    expect([m.imagePct, m.reelPct, m.carouselPct]).toEqual([0, 0, 0]);
  });
});

describe('mapShopifyToCatalogue — Shopify → catalogue contract', () => {
  it('one family per product; product_type → style; first variant option → colourway; provenance; zero sales', () => {
    const products = [
      { title: 'Sea Salt Candle', product_type: 'Candle', body_html: '<p>A <b>fresh</b> scent.</p>', variants: [{ option1: '250g' }, { option1: '500g' }] },
      { title: 'Room Mist', product_type: 'Home Fragrance', tags: ['fragrance'], variants: [{ option1: 'Default Title' }] },
    ];
    const cat = mapShopifyToCatalogue(products);
    expect(cat.source).toBe('shopify-web');
    expect(typeof cat.fetchedAt).toBe('string');
    expect(cat.families.map((f) => f.name)).toEqual(['Sea Salt Candle', 'Room Mist']);
    expect(cat.families[0]!.style).toBe('Candle');
    expect(cat.families[0]!.variants.map((v) => v.colourway)).toEqual(['250g', '500g']);
    expect(cat.families[1]!.variants[0]!.colourway).toBeUndefined();       // "Default Title" → no colourway
    expect(cat.families[0]!.variants[0]!.sales).toEqual({ netItemsSold: 0, netSales: 0, returns: 0 });   // no web sales
    expect(cat.statusBreakdown.live).toBe(3);                              // total variants
  });
  it('style falls back to the first tag, then "Product"', () => {
    const cat = mapShopifyToCatalogue([{ title: 'Mystery Item', tags: ['gift'], variants: [] }]);
    expect(cat.families[0]!.style).toBe('gift');
    expect(cat.families[0]!.variants).toHaveLength(1);   // no variants → one no-colourway entry
  });
  it('empty input → empty families (caller then skips — never writes {})', () => {
    expect(mapShopifyToCatalogue([]).families).toEqual([]);
  });
});

describe('vendorIsOwnBrand — own-brand vendor matching', () => {
  const tokens = deriveBrandTokens('Earl of East');   // → {earl, east}
  it('exact clients.name match (case-insensitive) → own-brand', () => {
    expect(vendorIsOwnBrand('Earl of East', 'Earl of East', tokens)).toBe(true);
    expect(vendorIsOwnBrand('earl of east', 'Earl of East', tokens)).toBe(true);
  });
  it('shared brand token (e.g. sub-line vendor) → own-brand', () => {
    expect(vendorIsOwnBrand('Earl of East Workshops', 'Earl of East', tokens)).toBe(true);
  });
  it('non-matching third-party vendor → NOT own-brand', () => {
    expect(vendorIsOwnBrand('HAY', 'Earl of East', tokens)).toBe(false);
    expect(vendorIsOwnBrand('ferm LIVING', 'Earl of East', tokens)).toBe(false);
  });
  it('missing / blank vendor → NOT own-brand', () => {
    expect(vendorIsOwnBrand(undefined, 'Earl of East', tokens)).toBe(false);
    expect(vendorIsOwnBrand('', 'Earl of East', tokens)).toBe(false);
    expect(vendorIsOwnBrand('   ', 'Earl of East', tokens)).toBe(false);
  });
});

describe('filterOwnBrandProducts — Stage G vendor filter', () => {
  const products = [
    { title: 'Sea Salt Candle', vendor: 'Earl of East' },
    { title: 'Workshop Kit', vendor: 'Earl of East Workshops' },
    { title: 'Stocked Chair', vendor: 'HAY' },
    { title: 'Untagged Item' },                              // missing vendor
  ];
  it('default → keeps only own-brand (exact + token), drops third-party + missing vendor', () => {
    const kept = filterOwnBrandProducts(products, 'Earl of East', false);
    expect(kept.map((p) => p.title)).toEqual(['Sea Salt Candle', 'Workshop Kit']);
  });
  it('--include-all-vendors → returns every product untouched', () => {
    const kept = filterOwnBrandProducts(products, 'Earl of East', true);
    expect(kept).toHaveLength(4);
  });
  it('no own-brand products → empty (caller then skips, writes nothing)', () => {
    const kept = filterOwnBrandProducts(
      [{ title: 'Chair', vendor: 'HAY' }, { title: 'Vase', vendor: 'ferm LIVING' }],
      'Earl of East', false,
    );
    expect(kept).toEqual([]);
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
  it('creates the client_configs row with the plan_redesign flag when none exists', async () => {
    const { db, insertedTables, insertedValues } = makeDb({ clients: [], channels: [], configs: [], returning: [{ id: 'client-1' }] });
    await stageCreate({ db, name: 'The Linen Room', handle: 'linenroom', channel: 'instagram' });
    expect(insertedTables).toContain(clientConfigs);
    const cfgInsert = insertedValues.find((i) => i.table === clientConfigs)!.values as Record<string, unknown>;
    expect(cfgInsert['clientId']).toBe('client-1');
    expect(cfgInsert['settings']).toEqual({ plan_redesign: true });
  });
  it('skips the client_configs insert when a row already exists (never overwrites)', async () => {
    const { db, insertedTables } = makeDb({ clients: [], channels: [], configs: [{ id: 'existing-config' }], returning: [{ id: 'client-1' }] });
    await stageCreate({ db, name: 'The Linen Room', handle: 'linenroom', channel: 'instagram' });
    expect(insertedTables).not.toContain(clientConfigs);
    // client + channel still created:
    expect(insertedTables).toEqual(expect.arrayContaining([clients, clientChannels]));
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
