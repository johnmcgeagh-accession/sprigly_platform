import { describe, it, expect, vi } from 'vitest';
import { ensureAppLink } from './planning.js';
import { isAllowedTransition } from './machine.js';

// ── mock db for ensureAppLink ─────────────────────────────────────────────────
// Mirrors: db.select({...}).from(t).where(...).orderBy(...).limit(1) → rows
//          db.insert(t).values({...}) → resolves
function makeDb(existingToken: string | null): {
  db: Parameters<typeof ensureAppLink>[0];
  captured: { selects: number; inserts: number; insertValues?: Record<string, unknown> };
} {
  const captured = { selects: 0, inserts: 0 } as { selects: number; inserts: number; insertValues?: Record<string, unknown> };
  const rows = existingToken ? [{ token: existingToken }] : [];
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => { captured.selects++; return { from }; });
  const values = vi.fn((v: Record<string, unknown>) => { captured.insertValues = v; return Promise.resolve(); });
  const insert = vi.fn(() => { captured.inserts++; return { values }; });
  const db = { select, insert } as unknown as Parameters<typeof ensureAppLink>[0];
  return { db, captured };
}

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Parameters<typeof ensureAppLink>[4];

describe('ensureAppLink — per-cycle idempotency', () => {
  it('reuses a live token if one exists (no mint)', async () => {
    const { db, captured } = makeDb('existing-token-abc');
    const url = await ensureAppLink(db, 'client-1', 'cycle-1', 'https://app.example.com', logger);
    expect(url).toBe('https://app.example.com/p/existing-token-abc');
    expect(captured.inserts).toBe(0);          // reused — never minted
  });

  it('mints a token when none exists', async () => {
    const { db, captured } = makeDb(null);
    const url = await ensureAppLink(db, 'client-1', 'cycle-1', 'https://app.example.com', logger);
    expect(captured.inserts).toBe(1);
    expect(captured.insertValues?.['clientId']).toBe('client-1');
    expect(captured.insertValues?.['cycleId']).toBe('cycle-1');
    expect(typeof captured.insertValues?.['token']).toBe('string');
    expect(url).toMatch(/^https:\/\/app\.example\.com\/p\/.+/);
  });

  it('strips a trailing slash on the base URL', async () => {
    const { db } = makeDb('tok');
    const url = await ensureAppLink(db, 'c', 'cy', 'https://app.example.com/', logger);
    expect(url).toBe('https://app.example.com/p/tok');
  });

  it('returns null (no query) when APP_BASE_URL is unset', async () => {
    const { db, captured } = makeDb('tok');
    const url = await ensureAppLink(db, 'c', 'cy', '', logger);
    expect(url).toBeNull();
    expect(captured.selects).toBe(0);
    expect(captured.inserts).toBe(0);
  });

  it('returns null (non-fatal) on a DB error', async () => {
    const db = { select: () => { throw new Error('db down'); } } as unknown as Parameters<typeof ensureAppLink>[0];
    const url = await ensureAppLink(db, 'c', 'cy', 'https://app.example.com', logger);
    expect(url).toBeNull();
  });
});

describe('app-surface state edges (intake_confirmed → planning → workbook_built)', () => {
  it('both edges the app path uses are allowed', () => {
    expect(isAllowedTransition('intake_confirmed', 'planning', null)).toBe(true);
    expect(isAllowedTransition('planning', 'workbook_built', null)).toBe(true);
  });
  it('there is no direct intake_confirmed → workbook_built edge (must go via planning)', () => {
    expect(isAllowedTransition('intake_confirmed', 'workbook_built', null)).toBe(false);
  });
});
