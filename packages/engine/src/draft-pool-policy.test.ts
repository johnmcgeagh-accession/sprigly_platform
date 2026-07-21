/**
 * draft-pool-policy.test.ts — the tiered replacement pool.
 *
 * ivy-t's rehearsal starved the pool: eleven sentences took it from 21 beats to 5, because
 * every sentence's output was written with basis='client_input' and the old isReplaceable
 * protected that forever. Each sentence immunised the month against the next one, and the
 * client would have hit "there is no room" without ever having touched a beat themselves
 * (docs/reports/ivy-t-rehearsal-failures.md F3).
 *
 * The rule now: the client's HAND outranks the machine, and NEWER words outrank older ones.
 */
import { describe, it, expect } from 'vitest';
import {
  replacementTier, isReplaceable, replacementCandidates, applyLaunchArc, applyEvent, applyEmphasis,
  POOL_EMPTY_NOTE, type TransformBeat,
} from './draft-transforms.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-09';
const TODAY = '2026-09-01';

const template = (): BeatMeta => ({ slotType: 'proven', rationaleEvidence: { basis: 'template', reason: 'no history' } });
const observed = (posts: number, avg = 40): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'observed', formatEngagement: { format: 'reel', avgEngagement: avg, posts } },
});
const fromInput = (reason = 'an earlier sentence'): BeatMeta =>
  ({ slotType: 'proven', rationaleEvidence: { basis: 'client_input', reason } as BeatMeta['rationaleEvidence'] });
const touched = (): BeatMeta => ({ ...observed(50), clientTouched: true });
const touchedInput = (): BeatMeta => ({ ...fromInput(), clientTouched: true });
const handAdded = (): BeatMeta => ({ slotType: 'proven', rationaleEvidence: { basis: 'client_added' } });
const clientExperiment = (): BeatMeta => ({
  slotType: 'experiment', rationaleEvidence: { basis: 'observed', candidateRank: { rank: 1, of: 2, origin: 'client' } },
});

const beat = (id: string, date: string, meta: BeatMeta | null, position = 0): TransformBeat =>
  ({ id, date, format: 'reel', pillar: 'Everyday Ritual', title: `Beat ${id}`, position, beatMeta: meta });

describe('tier assignment', () => {
  it('NEVER replaceable: touched, hand-added, client experiment', () => {
    expect(replacementTier(beat('a', '2026-09-05', touched()))).toBeNull();
    expect(replacementTier(beat('b', '2026-09-05', handAdded()))).toBeNull();
    expect(replacementTier(beat('c', '2026-09-05', clientExperiment()))).toBeNull();
    expect(replacementTier(beat('d', '2026-09-05', touchedInput()))).toBeNull();
  });

  it('tier 0 = template, tier 1 = observed, tier 2 = an earlier input’s untouched beat', () => {
    expect(replacementTier(beat('t', '2026-09-05', template()))).toBe(0);
    expect(replacementTier(beat('o', '2026-09-05', observed(9)))).toBe(1);
    expect(replacementTier(beat('i', '2026-09-05', fromInput()))).toBe(2);
  });

  it('a beat with NO meta at all is tier 0 — nothing ever justified it', () => {
    expect(replacementTier(beat('n', '2026-09-05', null))).toBe(0);
    expect(isReplaceable(beat('n', '2026-09-05', null))).toBe(true);
  });
});

describe('tier ORDER dominates evidence strength', () => {
  const pool = () => replacementCandidates([
    beat('input-weak', '2026-09-10', fromInput(), 5),      // tier 2, no metrics at all
    beat('observed-strong', '2026-09-11', observed(40, 900)),
    beat('template', '2026-09-12', template()),
    beat('observed-weak', '2026-09-13', observed(2, 5)),
  ]).map((b) => b.id);

  it('template first, then observed weakest-first, then the earlier input LAST', () => {
    expect(pool()).toEqual(['template', 'observed-weak', 'observed-strong', 'input-weak']);
  });

  it('a tier-2 beat is not promoted by looking weak — tier leads, always', () => {
    expect(pool()[pool().length - 1]).toBe('input-weak');
  });

  it('and proximity to the date cannot promote a tier-2 beat either', () => {
    const near = replacementCandidates([
      beat('input-right-there', '2026-09-28', fromInput(), 5),
      beat('template-far', '2026-09-02', template()),
    ], '2026-09-28').map((b) => b.id);
    expect(near).toEqual(['template-far', 'input-right-there']);
  });
});

describe('within tier 2: OLDEST application first', () => {
  it('orders by position, which writeOps assigns per application', () => {
    const ordered = replacementCandidates([
      beat('third',  '2026-09-05', fromInput('third sentence'),  30),
      beat('first',  '2026-09-20', fromInput('first sentence'),  10),
      beat('second', '2026-09-12', fromInput('second sentence'), 20),
    ]).map((b) => b.id);
    expect(ordered).toEqual(['first', 'second', 'third']);
  });
});

describe('the pool-empty case: a receipt, never a partial silent application', () => {
  const launch = (): MonthScopedIntent => ({
    kind: 'launch', subject: 'the navy edit', sourceText: 'the navy edit drops on the 28th',
    dateRange: { start: '2026-09-28', end: '2026-09-28' },
  });

  it('applyLaunchArc: nothing applied, and the note names a remedy', () => {
    const res = applyLaunchArc(launch(), [beat('c', '2026-09-09', touched()), beat('h', '2026-09-11', handAdded())], MONTH);
    expect(res.ops).toEqual([]);
    expect(res.note).toBe(POOL_EMPTY_NOTE);
    expect(res.note).toContain('add a day or drop something to make room');
  });

  it('applyEvent: same words, so the client meets one refusal not three', () => {
    const res = applyEvent(
      { kind: 'event', subject: 'x', sourceText: 'x', dateRange: { start: '2026-09-10', end: '2026-09-10' } },
      [beat('c', '2026-09-09', touched())], MONTH,
    );
    expect(res.ops).toEqual([]);
    expect(res.note).toBe(POOL_EMPTY_NOTE);
  });

  it('a PARTIAL placement is still reported as partial, not passed off as complete', () => {
    const res = applyLaunchArc(launch(), [beat('t', '2026-09-02', template()), beat('c', '2026-09-09', touched())], MONTH);
    expect(res.ops.filter((o) => o.op === 'add')).toHaveLength(1);
    expect(res.note).toMatch(/Added 1 of 3/);
  });
});

describe('a tier-2 displacement is NAMED in the receipt', () => {
  it('says an earlier request’s post was replaced', () => {
    const res = applyEvent(
      { kind: 'event', subject: 'the workshop', sourceText: 'workshop on the 10th', dateRange: { start: '2026-09-10', end: '2026-09-10' } },
      [beat('i', '2026-09-11', fromInput(), 5)], MONTH,
    );
    expect(res.note).toBe('Made room by replacing a post from an earlier request.');
  });

  it('pluralises when an arc displaces several', () => {
    const res = applyLaunchArc(
      { kind: 'launch', subject: 'the navy edit', sourceText: 't', dateRange: { start: '2026-09-15', end: '2026-09-15' } },
      [beat('i1', '2026-09-05', fromInput(), 5), beat('i2', '2026-09-08', fromInput(), 6), beat('i3', '2026-09-20', fromInput(), 7)],
      MONTH,
    );
    expect(res.note).toContain('Made room by replacing 3 posts from earlier requests.');
  });

  it('stays QUIET when only tiers 0-1 were displaced — that is the ordinary cost', () => {
    const res = applyEvent(
      { kind: 'event', subject: 'x', sourceText: 'x', dateRange: { start: '2026-09-10', end: '2026-09-10' } },
      [beat('t', '2026-09-11', template())], MONTH,
    );
    expect(res.note).toBeUndefined();
  });
});

describe('emphasis stays out of tier 2', () => {
  it('will not re-pillar a beat an earlier sentence asked for by name', () => {
    const res = applyEmphasis(
      { kind: 'emphasis', subject: 'product', sourceText: 'more product this month', emphasis: 'Product' },
      [beat('i', '2026-09-10', fromInput(), 5)], TODAY,
    );
    expect(res.ops).toEqual([]);
  });

  it('but still tilts ordinary observed beats', () => {
    const res = applyEmphasis(
      { kind: 'emphasis', subject: 'product', sourceText: 'more product this month', emphasis: 'Product' },
      [beat('o1', '2026-09-10', observed(4)), beat('o2', '2026-09-12', observed(9)), beat('o3', '2026-09-14', observed(12))],
      TODAY,
    );
    expect(res.ops.length).toBeGreaterThan(0);
  });
});

describe('the rehearsal scenario: the pool no longer starves', () => {
  it('a month of earlier-input beats is still workable by a NEW request', () => {
    // ivy-t's real end state: 16 client_input beats, 5 observed. Under the old rule a new
    // sentence could only ever reach the 5. Under the new one it reaches those first, and
    // the earlier-input beats remain available behind them.
    const month = [
      ...Array.from({ length: 16 }, (_, i) => beat(`in${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, fromInput(), 100 + i)),
      ...Array.from({ length: 5 }, (_, i) => beat(`ob${i}`, `2026-09-2${i}`, observed(i + 3))),
    ];
    const pool = replacementCandidates(month);
    expect(pool).toHaveLength(21);
    expect(pool.slice(0, 5).every((b) => b.id.startsWith('ob'))).toBe(true);
    expect(pool.slice(5).every((b) => b.id.startsWith('in'))).toBe(true);
  });
});
