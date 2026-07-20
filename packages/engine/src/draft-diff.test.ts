import { describe, it, expect } from 'vitest';
import { diffBeats, renderDiff, renderDelta, shortDate, isNoOp, type DiffBeat } from './draft-diff.js';

const b = (id: string, over: Partial<DiffBeat> = {}): DiffBeat => ({
  id, date: '2026-09-02', format: 'carousel', pillar: 'Everyday Ritual', title: `Beat ${id}`, ...over,
});

describe('diffBeats — every delta type', () => {
  it('detects an addition', () => {
    const d = diffBeats([b('a')], [b('a'), b('new')]);
    expect(d.deltas).toEqual([{ type: 'added', beat: b('new') }]);
    expect(d.changedIds).toEqual(['new']);
  });

  it('detects a removal — and does NOT mark it changed (it is gone)', () => {
    const d = diffBeats([b('a'), b('old')], [b('a')]);
    expect(d.deltas).toEqual([{ type: 'removed', beat: b('old') }]);
    expect(d.changedIds).toEqual([]);
  });

  it('detects a move', () => {
    const d = diffBeats([b('a')], [b('a', { date: '2026-09-10' })]);
    expect(d.deltas).toEqual([{ type: 'moved', beat: b('a', { date: '2026-09-10' }), from: '2026-09-02', to: '2026-09-10' }]);
    expect(d.changedIds).toEqual(['a']);
  });

  it('detects a reformat, a re-pillar and a retitle', () => {
    expect(diffBeats([b('a')], [b('a', { format: 'reel' })]).deltas[0]).toMatchObject({ type: 'reformatted', from: 'carousel', to: 'reel' });
    expect(diffBeats([b('a')], [b('a', { pillar: 'Home & Space' })]).deltas[0]).toMatchObject({ type: 'repillared', from: 'Everyday Ritual', to: 'Home & Space' });
    expect(diffBeats([b('a')], [b('a', { title: 'New title' })]).deltas[0]).toMatchObject({ type: 'retitled', from: 'Beat a', to: 'New title' });
  });

  it('reports MULTIPLE deltas for one beat rather than collapsing them to "changed"', () => {
    // Collapsing would hide half of what happened to it.
    const d = diffBeats([b('a')], [b('a', { date: '2026-09-10', format: 'reel' })]);
    expect(d.deltas.map((x) => x.type).sort()).toEqual(['moved', 'reformatted']);
    expect(d.changedIds).toEqual(['a']);   // still one changed beat
  });

  it('is empty for identical snapshots', () => {
    const snap = [b('a'), b('b')];
    const d = diffBeats(snap, snap);
    expect(d.deltas).toEqual([]);
    expect(isNoOp(d)).toBe(true);
  });

  it('handles a full replacement (the launch-arc shape)', () => {
    const before = [b('t1'), b('t2'), b('t3'), b('keep', { title: 'Kept' })];
    const after  = [b('keep', { title: 'Kept' }), b('n1', { title: 'Navy — Tease' }), b('n2', { title: 'Navy — Launch' }), b('n3', { title: 'Navy — Follow-up' })];
    const d = diffBeats(before, after);
    expect(d.deltas.filter((x) => x.type === 'added')).toHaveLength(3);
    expect(d.deltas.filter((x) => x.type === 'removed')).toHaveLength(3);
    expect(d.changedIds).toEqual(['n1', 'n2', 'n3']);
  });

  it('is order-stable — the same snapshots always render the same receipt', () => {
    const before = [b('a'), b('b')];
    const after  = [b('a', { date: '2026-09-11' }), b('c')];
    expect(diffBeats(before, after)).toEqual(diffBeats(before, after));
  });
});

describe('rendering — facts, not narration', () => {
  it('renders each delta as a plain statement of what happened', () => {
    expect(renderDelta({ type: 'added', beat: b('n', { title: 'Navy — Tease', date: '2026-09-23' }) }))
      .toBe('Added: Navy — Tease, Wed 23 Sep');
    expect(renderDelta({ type: 'removed', beat: b('o', { title: 'Brand story', date: '2026-09-02' }) }))
      .toBe('Replaced: Brand story, Wed 2 Sep');
    expect(renderDelta({ type: 'moved', beat: b('a', { title: 'Sunday style' }), from: '2026-09-02', to: '2026-09-10' }))
      .toBe('Moved: Sunday style, Wed 2 Sep → Thu 10 Sep');
    expect(renderDelta({ type: 'reformatted', beat: b('a', { title: 'Sunday style' }), from: 'carousel', to: 'reel' }))
      .toBe('Changed: Sunday style, carousel → reel');
  });

  it('never explains WHY — the rationale lives on the beat, the receipt states the fact', () => {
    const lines = renderDiff(diffBeats([b('a')], [b('a', { date: '2026-09-10' }), b('new')]));
    for (const line of lines) {
      expect(line).not.toMatch(/because|to better|we thought|in order to|balance/i);
    }
  });

  it('formats dates readably and falls back rather than guessing', () => {
    expect(shortDate('2026-09-28')).toBe('Mon 28 Sep');
    expect(shortDate('not-a-date')).toBe('not-a-date');
  });

  it('renders nothing for an empty diff, so the surface can say "no change" itself', () => {
    expect(renderDiff({ deltas: [], changedIds: [] })).toEqual([]);
  });
});
