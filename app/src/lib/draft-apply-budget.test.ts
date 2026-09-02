/**
 * draft-apply-budget.test.ts — the two decisions the reshape's write layer makes on its own.
 *
 * `partitionRemovals` is the gate a beat passes through immediately before it is deleted, and
 * `overshootLine` is the only place a grown month becomes visible to the client. Both are pure
 * and both are exported for exactly that reason: they are the parts worth pinning, and pinning
 * them through a transaction would test the mock.
 */
import { describe, it, expect } from 'vitest';
import { partitionRemovals, overshootLine } from './draft-apply';
import type { BeatOp, TransformBeat } from '@sprigly/engine';
import type { BeatMeta } from '@sprigly/db';

const beat = (id: string, meta: BeatMeta | null, title = `Beat ${id}`): TransformBeat => ({
  id, date: '2026-09-05', format: 'carousel', pillar: 'Everyday Ritual', title, position: 0, beatMeta: meta,
});

const observed = (): BeatMeta => ({ slotType: 'proven', rationaleEvidence: { basis: 'observed' } });
const touched  = (): BeatMeta => ({ ...observed(), clientTouched: true });
const added    = (): BeatMeta => ({ slotType: 'proven', rationaleEvidence: { basis: 'client_added' } });
const series   = (): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: {
    basis: 'observed',
    seriesDue: { name: 'WSG (Weekend Style Guide)', dayOfWeek: 'Saturday', lastPlanned: null, monthsObserved: 4 },
  } as BeatMeta['rationaleEvidence'],
});

const remove = (id: string): BeatOp => ({ op: 'remove', id });
const add = (): BeatOp => ({
  op: 'add', date: '2026-09-12', format: 'reel', pillar: 'Everyday Ritual', title: 'New',
  beatMeta: observed(),
});

describe('partitionRemovals — the last gate before a beat is deleted', () => {
  it('lets an ordinary removal through', () => {
    const before = [beat('a', observed())];
    const r = partitionRemovals([remove('a')], before);
    expect(r.ops).toEqual([remove('a')]);
    expect(r.blocked).toHaveLength(0);
  });

  it('blocks a clientTouched beat even when a transform asked for it', () => {
    const before = [beat('t', touched())];
    const r = partitionRemovals([remove('t')], before);
    expect(r.ops).toHaveLength(0);
    expect(r.blocked.map((b) => b.protection)).toEqual(['client_touched']);
  });

  it('blocks a series beat, and a client-added one', () => {
    const before = [beat('s', series()), beat('c', added())];
    const r = partitionRemovals([remove('s'), remove('c')], before);
    expect(r.ops).toHaveLength(0);
    expect(r.blocked.map((b) => b.protection).sort()).toEqual(['client_added', 'series']);
  });

  it('never touches non-remove ops — an add is not a deletion', () => {
    const before = [beat('t', touched())];
    const r = partitionRemovals([add(), remove('t'), add()], before);
    expect(r.ops).toHaveLength(2);
    expect(r.ops.every((o) => o.op === 'add')).toBe(true);
  });

  it('passes through a removal naming a beat it cannot see', () => {
    // Blocking on ignorance would refuse a legitimate delete because this function happened
    // not to be handed the row. The scoped statement downstream is what decides.
    const r = partitionRemovals([remove('ghost')], [beat('a', observed())]);
    expect(r.ops).toEqual([remove('ghost')]);
    expect(r.blocked).toHaveLength(0);
  });

  it('keeps the beat itself, so the receipt can name what it kept', () => {
    const before = [beat('s', series(), 'Weekend Style Guide')];
    const [blocked] = partitionRemovals([remove('s')], before).blocked;
    expect(blocked!.beat.title).toBe('Weekend Style Guide');
  });

  it('a mixed batch keeps the allowed removals and blocks only the protected', () => {
    const before = [beat('ok1', observed()), beat('prot', touched()), beat('ok2', observed())];
    const r = partitionRemovals([remove('ok1'), remove('prot'), remove('ok2')], before);
    expect(r.ops.map((o) => (o as { id: string }).id)).toEqual(['ok1', 'ok2']);
    expect(r.blocked).toHaveLength(1);
  });
});

describe('overshootLine — a grown month says so, with both numbers', () => {
  it('says nothing while the month is within the stated ceiling', () => {
    expect(overshootLine(28, 31)).toBeNull();
    expect(overshootLine(31, 31)).toBeNull();       // AT the ceiling is not over it
  });

  it('names the new count AND the ceiling once the month is over', () => {
    const line = overshootLine(34, 31)!;
    expect(line).toContain('34 posts');
    expect(line).toContain('31 you normally publish');
  });

  it('says nothing when no cadence is configured — we invent no rhythm to warn about', () => {
    expect(overshootLine(40, null)).toBeNull();
    expect(overshootLine(0, null)).toBeNull();
  });

  it('is silent for a month that grew but stayed under the ceiling', () => {
    // The transform overshot its own POOL, which is our arithmetic, not the client's rhythm.
    expect(overshootLine(15, 31)).toBeNull();
  });

  it('tells the client nothing was dropped — that is the trade being reported', () => {
    expect(overshootLine(34, 31)).toContain('Nothing was dropped');
  });
});
