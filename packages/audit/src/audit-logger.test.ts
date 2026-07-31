/**
 * audit-logger.test.ts — the seam where a row's metadata becomes money.
 *
 * `computeCostPence` is tested directly in price-map.test.ts. What is tested HERE is the wiring:
 * that the cache token counts the conversational call sites already record end up priced, without
 * those call sites having to change. Get that wrong and every cached turn silently posts light
 * again — which is the exact defect this file exists to prevent recurring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('@sprigly/db', () => ({
  db: { insert: () => ({ values: (row: Record<string, unknown>) => { h.rows.push(row); return Promise.resolve(); } }) },
  auditLog: { __table: 'audit_log' },
}));

import { createAuditLogger } from './audit-logger.js';
import { db } from '@sprigly/db';

const HAIKU = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
const log = (metadata?: Record<string, unknown>, input = 63, output = 88) =>
  createAuditLogger(db as never).logModelCall({
    clientId: 'c1', modelId: HAIKU, inputTokens: input, outputTokens: output,
    action: 'plan-agent:parse-tasks', ...(metadata ? { metadata } : {}),
  });

const cost = () => Number(h.rows[h.rows.length - 1]!.costPence);

beforeEach(() => { h.rows.length = 0; });

describe('cache tokens on the metadata are priced onto the row', () => {
  it('a cache-read turn posts the true cost, not the input-only figure', async () => {
    await log({ cacheReadTokens: 5712 });
    expect(cost()).toBe(0.076144);          // hand-computed in price-map.test.ts
  });

  it('a cache-write turn carries the write premium', async () => {
    await log({ cacheWriteTokens: 5712 }, 25, 109);
    expect(cost()).toBe(0.534497);
  });

  it('the same call WITHOUT the metadata posts the old, light figure', async () => {
    await log();
    expect(cost()).toBe(0.036731);          // 51.8% of the true cost — the defect, pinned
  });
});

describe('a bad metadata value can never poison the column', () => {
  // `metadata` is Record<string, unknown>; a caller can put anything under these names, and
  // cost_pence is numeric(12,6) — a NaN or an Infinity reaching it is a failed insert at best
  // and a corrupt ledger at worst. Non-numbers are ignored, never coerced.
  it.each([
    ['a string',   { cacheReadTokens: '5712' }],
    ['null',       { cacheReadTokens: null }],
    ['an object',  { cacheReadTokens: { n: 5712 } }],
    ['NaN',        { cacheReadTokens: NaN }],
    ['Infinity',   { cacheReadTokens: Infinity }],
    ['a negative', { cacheReadTokens: -5712 }],
  ])('%s is ignored rather than coerced', async (_label, metadata) => {
    await log(metadata as Record<string, unknown>);
    expect(cost()).toBe(0.036731);          // priced as if no cache was reported
    expect(Number.isFinite(cost())).toBe(true);
  });
});

describe('the stored value is always a well-formed numeric literal', () => {
  it('is fixed to exactly six decimal places', async () => {
    await log({ cacheReadTokens: 5712 });
    expect(String(h.rows[0]!.costPence)).toMatch(/^\d+\.\d{6}$/);
  });

  it('a Titan embed is a non-zero row rather than a fake 0', async () => {
    await createAuditLogger(db as never).logModelCall({
      clientId: 'c1', modelId: 'amazon.titan-embed-text-v2:0',
      inputTokens: 60, outputTokens: 0, action: 'plan-agent:query-embed',
    });
    expect(cost()).toBeGreaterThan(0);
    expect(cost()).toBeLessThan(0.001);
  });
});
