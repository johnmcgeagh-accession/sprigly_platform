/**
 * ask-coverage-outcome.test.ts — the audit row that says whether the month carried the brief.
 *
 * `briefAskCoverage` itself is pinned in packages/engine against ivy-t's real September month.
 * What is tested HERE is the wiring: what the row says, when a row is written at all, and — the
 * property that matters most — that no failure in any of it can reach the delivery it measures.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AskCoverage, AskCoverageItem } from '@sprigly/engine';
import { askCoverageMetadata, recordAskCoverage } from './plan-ready.js';

// ── helpers ───────────────────────────────────────────────────────────────────
const item = (over: Partial<AskCoverageItem> & Pick<AskCoverageItem, 'type' | 'verdict'>): AskCoverageItem => ({
  product: null, longestRun: 0, contentWords: 0, titleEcho: false, quotedLine: null, ...over,
});

const coverageOf = (items: AskCoverageItem[]): AskCoverage => ({
  items,
  used:       items.filter((i) => i.verdict === 'used').map((i) => i.type),
  unused:     items.filter((i) => i.verdict === 'unused').map((i) => i.type),
  unmeasured: items.filter((i) => i.verdict === 'unmeasured').map((i) => i.type),
});

/** The September verdicts, as packages/engine measures them off the real month. */
const SEPTEMBER = coverageOf([
  item({ type: 'customer-message-hook',       verdict: 'unused', longestRun: 3, contentWords: 2, quotedLine: 'A customer just sent me this message….' }),
  item({ type: 'wardrobe-avoidance-hook',     verdict: 'unused', quotedLine: 'Do you avoid sorting your wardrobe out?' }),
  item({ type: 'shop-your-wardrobe-hook',     verdict: 'unused', quotedLine: 'Do you avoid shopping your own wardrobe?' }),
  item({ type: 'reach-for-same-clothes-hook', verdict: 'unused', quotedLine: 'Do you always reach for the same clothes?' }),
  item({ type: 'not-fast-fashion-brand-values', verdict: 'used', longestRun: 31, contentWords: 22 }),
  item({ type: 'navy-edit-customer-reaction',   verdict: 'used', product: 'Navy Edit', longestRun: 6, contentWords: 2, titleEcho: true }),
  item({ type: 'named-after-women-brand-story', verdict: 'used', longestRun: 3, contentWords: 1, titleEcho: true }),
  item({ type: 'cost-per-wear-education',       verdict: 'unmeasured', product: 'Audrey', longestRun: 6, contentWords: 4 }),
  item({ type: 'organic-cotton-sensitive-skin-education', verdict: 'unmeasured' }),
  item({ type: 'what-i-am-most-proud-of-series',          verdict: 'unmeasured', longestRun: 3, contentWords: 2 }),
]);

type Row = Record<string, unknown>;

/** A db whose post read and audit insert can each be made to fail. */
function makeDb(opts: { posts?: Row[]; readThrows?: boolean; insertThrows?: boolean } = {}) {
  const inserted: Row[] = [];
  const where = vi.fn(() => (opts.readThrows
    ? Promise.reject(new Error('post read exploded'))
    : Promise.resolve(opts.posts ?? [])));
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    insert: vi.fn(() => ({
      values: vi.fn((v: Row) => {
        if (opts.insertThrows) return Promise.reject(new Error('audit insert exploded'));
        inserted.push(v);
        return Promise.resolve();
      }),
    })),
  };
  return { db, inserted };
}

const logger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() });

/** A brief carrying the four hooks — enough for the detector to reach a real verdict. */
const HOOK_BRIEF = {
  content_asks: [
    { type: 'wardrobe-avoidance-hook',     product: null, note: 'Hook: Do you avoid sorting your wardrobe out?' },
    { type: 'shop-your-wardrobe-hook',     product: null, note: 'Hook: Do you avoid shopping your own wardrobe?' },
    { type: 'not-fast-fashion-brand-values', product: null, note: 'We do not compete with fast fashion because we do not make fast fashion at all, ever.' },
  ],
};

// ── the row's contents ────────────────────────────────────────────────────────
describe('askCoverageMetadata — what an operator reads', () => {
  const meta = askCoverageMetadata('cycle-1', '2026-09', 33, SEPTEMBER) as {
    cycleId: string; planMonth: string; postsMeasured: number;
    counts: { used: number; unused: number; unmeasured: number };
    asks: Array<{ type: string; verdict: string; line?: string; titleEcho: boolean; longestRun: number }>;
  };

  it('carries the three-way split, with unmeasured kept apart from used', () => {
    expect(meta.counts).toEqual({ used: 3, unused: 4, unmeasured: 3 });
  });

  it('identifies the cycle, the month it was for, and how much text was measured', () => {
    expect(meta.cycleId).toBe('cycle-1');
    expect(meta.planMonth).toBe('2026-09');
    expect(meta.postsMeasured).toBe(33);
  });

  it('names every unused ask AND quotes the line that went missing', () => {
    const unused = meta.asks.filter((a) => a.verdict === 'unused');
    expect(unused.map((a) => a.type)).toEqual([
      'customer-message-hook', 'wardrobe-avoidance-hook',
      'shop-your-wardrobe-hook', 'reach-for-same-clothes-hook',
    ]);
    // The finding is legible without going back to the brief.
    expect(unused.map((a) => a.line)).toContain('Do you avoid sorting your wardrobe out?');
    for (const a of unused) expect(a.line).toBeTruthy();
  });

  it('orders the findings first — unused, then unmeasured, then used', () => {
    expect(meta.asks.map((a) => a.verdict)).toEqual([
      'unused', 'unused', 'unused', 'unused',
      'unmeasured', 'unmeasured', 'unmeasured',
      'used', 'used', 'used',
    ]);
  });

  it("carries the detector's own evidence, so a verdict can be judged without re-running it", () => {
    const navy = meta.asks.find((a) => a.type === 'navy-edit-customer-reaction')!;
    // 'used' on the title echo, NOT on its six-word stopword run — the row shows both, so an
    // operator can see which signal carried it rather than taking the verdict on trust.
    expect(navy.titleEcho).toBe(true);
    expect(navy.longestRun).toBe(6);
  });

  it('a thematic ask carries no line, because it never had one to quote', () => {
    expect(meta.asks.find((a) => a.type === 'cost-per-wear-education')!.line).toBeUndefined();
  });
});

// ── when a row is written ─────────────────────────────────────────────────────
describe('recordAskCoverage — writes a baseline, never a guess', () => {
  it('writes one row under content-cycle:ask-coverage-outcome when asks were briefed', async () => {
    const { db, inserted } = makeDb({ posts: [{ title: 'x', caption: 'nothing matching', hook: '', script: '', overlay: '' }] });
    const log = logger();
    await recordAskCoverage({ db, logger: log } as never, 'client-1', 'cycle-1', '2026-09', HOOK_BRIEF);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!['action']).toBe('content-cycle:ask-coverage-outcome');
    expect(inserted[0]!['clientId']).toBe('client-1');
    const meta = inserted[0]!['metadata'] as { counts: { unused: number }; asks: Array<{ type: string; line?: string }> };
    expect(meta.counts.unused).toBe(2);
    expect(meta.asks[0]!.line).toBe('Do you avoid sorting your wardrobe out?');
  });

  it('warns when an ask reached no post — the operator signal, not a client one', async () => {
    const { db } = makeDb({ posts: [{ caption: 'unrelated' }] });
    const log = logger();
    await recordAskCoverage({ db, logger: log } as never, 'c', 'cy', '2026-09', HOOK_BRIEF);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ unused: ['wardrobe-avoidance-hook', 'shop-your-wardrobe-hook'] }),
      expect.stringContaining('reached no post'),
    );
  });

  it('writes a row for a CLEAN month too — silence must not mean "nothing was missing"', async () => {
    const { db, inserted } = makeDb({
      posts: [{ caption: 'Do you avoid sorting your wardrobe out? Do you avoid shopping your own wardrobe? We do not compete with fast fashion because we do not make fast fashion at all, ever.' }],
    });
    await recordAskCoverage({ db, logger: logger() } as never, 'c', 'cy', '2026-09', HOOK_BRIEF);
    expect(inserted).toHaveLength(1);
    expect((inserted[0]!['metadata'] as { counts: { unused: number } }).counts.unused).toBe(0);
  });

  it('writes NOTHING when the brief carried no asks — nothing was measured, so nothing is claimed', async () => {
    const { db, inserted } = makeDb({ posts: [{ caption: 'a month' }] });
    await recordAskCoverage({ db, logger: logger() } as never, 'c', 'cy', '2026-09', { content_asks: [] });
    expect(inserted).toHaveLength(0);
  });

  it('writes nothing for a cycle with no brief at all', async () => {
    const { db, inserted } = makeDb({ posts: [{ caption: 'a month' }] });
    await recordAskCoverage({ db, logger: logger() } as never, 'c', 'cy', '2026-09', null);
    expect(inserted).toHaveLength(0);
  });
});

// ── the property that matters most ────────────────────────────────────────────
describe('recordAskCoverage — cannot reach the delivery it measures', () => {
  it('a failed post read is swallowed and logged, not thrown', async () => {
    const { db, inserted } = makeDb({ readThrows: true });
    const log = logger();
    await expect(recordAskCoverage({ db, logger: log } as never, 'c', 'cy', '2026-09', HOOK_BRIEF)).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.stringContaining('post read exploded') }),
      expect.stringContaining('non-fatal'),
    );
  });

  it('a failed audit insert is swallowed and logged, not thrown', async () => {
    const { db } = makeDb({ posts: [{ caption: 'x' }], insertThrows: true });
    const log = logger();
    await expect(recordAskCoverage({ db, logger: log } as never, 'c', 'cy', '2026-09', HOOK_BRIEF)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.stringContaining('audit insert exploded') }),
      expect.stringContaining('non-fatal'),
    );
  });

  it('a month that was NOT measured says so in the log rather than looking clean', async () => {
    // The distinction the whole design rests on: a failure leaves a warn, so an absent audit
    // row is never silently readable as a month with nothing missing.
    const { db } = makeDb({ readThrows: true });
    const log = logger();
    await recordAskCoverage({ db, logger: log } as never, 'c', 'cy', '2026-09', HOOK_BRIEF);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('a malformed brief is measured as "no asks" rather than throwing', async () => {
    const { db, inserted } = makeDb({ posts: [{ caption: 'x' }] });
    for (const junk of ['not a brief', 42, [], { content_asks: 'nope' }]) {
      await expect(recordAskCoverage({ db, logger: logger() } as never, 'c', 'cy', '2026-09', junk)).resolves.toBeUndefined();
    }
    expect(inserted).toHaveLength(0);
  });
});
