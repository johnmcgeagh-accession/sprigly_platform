/**
 * preview route test — the live workspace preview. Session-gated; short input short-circuits with
 * NO model call; a normal call returns the preview and NEVER writes the DB; the token bucket backstop
 * degrades to an empty preview (rateLimited) rather than erroring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: { clientId: 'c1', cycleId: 'cyc' } as { clientId: string; cycleId: string } | null,
  allow: true,
  previewCalls: [] as Array<Record<string, unknown>>,
  writes: 0,
}));

vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ p }), eq: () => 'eq', gte: () => 'gte', lte: () => 'lte', or: () => 'or', isNull: () => 'isNull',
}));
vi.mock('@sprigly/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ content: 'relaunch in autumn', createdAt: new Date('2026-06-10T00:00:00Z') }]) }) }) }),
    update: () => { h.writes++; return { set: () => ({ where: () => Promise.resolve(undefined) }) }; },
  },
  planInputs: new Proxy({}, { get: (_t, p) => String(p) }),
}));
vi.mock('@sprigly/engine', () => ({
  PREVIEW_MIN_CHARS: 12,
  EMPTY_PREVIEW: { campaigns: [], themes: [], products: [], dates: [], availability: [], ideas: [], followUp: null },
  previewBrief: (a: Record<string, unknown>) => { h.previewCalls.push(a); return Promise.resolve({ campaigns: [{ text: 'Sale', from: null }], themes: [], products: [], dates: [], availability: [], ideas: [], followUp: 'Any key dates?' }); },
}));
vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/rate-limit', () => ({ allowRequest: () => h.allow }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}) }));

import { POST } from './route';

const call = (body: unknown) => POST(new Request('http://x/api/plan/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => { h.session = { clientId: 'c1', cycleId: 'cyc' }; h.allow = true; h.previewCalls.length = 0; h.writes = 0; });

describe('POST /api/plan/preview', () => {
  it('401 without a session', async () => { h.session = null; expect((await call({ text: 'x'.repeat(20) })).status).toBe(401); });

  it('short input short-circuits: empty preview, NO model call, NO DB write', async () => {
    const res = await call({ text: 'hi' });
    const body = await res.json();
    expect(body.preview.campaigns).toEqual([]);
    expect(h.previewCalls).toHaveLength(0);
    expect(h.writes).toBe(0);
  });

  it('runs the preview (with durables loaded) and never writes the DB', async () => {
    const res = await call({ text: 'launching on the 25th and a weekend sale' });
    const body = await res.json();
    expect(h.previewCalls).toHaveLength(1);
    expect(Array.isArray((h.previewCalls[0]!.durables as unknown[]))).toBe(true);   // durables passed for provenance
    expect(body.preview.campaigns[0].text).toBe('Sale');
    expect(body.preview.followUp).toBe('Any key dates?');
    expect(h.writes).toBe(0);                                                        // pure preview — no DB write
  });

  it('token-bucket backstop → empty preview flagged rateLimited (not an error)', async () => {
    h.allow = false;
    const res = await call({ text: 'launching on the 25th and a weekend sale' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rateLimited).toBe(true);
    expect(h.previewCalls).toHaveLength(0);
  });
});
