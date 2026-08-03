import { describe, it, expect } from 'vitest';
import { ringedDays, ringedPredicate } from './ringed-days';
import type { InterpretedItem } from '@/lib/agent/types';

const change = (over: Partial<Extract<InterpretedItem, { kind: 'change' }>> = {}): InterpretedItem => ({
  kind: 'change', proposalId: 'pr-1', action: 'move', title: 'A room that holds the day',
  fromDate: '2026-10-22', toDate: '2026-10-24', ...over,
});

describe('the days an open turn names', () => {
  it('takes BOTH ends of a move — what leaves the day, and what lands on it', () => {
    expect(ringedDays([change()])).toEqual(['2026-10-22', '2026-10-24']);
  });

  it('takes the one end an add or a remove has', () => {
    expect(ringedDays([change({ action: 'add', fromDate: null, toDate: '2026-10-15' })])).toEqual(['2026-10-15']);
    expect(ringedDays([change({ action: 'remove', fromDate: '2026-10-03', toDate: null })])).toEqual(['2026-10-03']);
  });

  it('deduplicates across a compound turn — two changes to one post ring one day', () => {
    expect(ringedDays([
      change({ proposalId: 'pr-1' }),
      change({ proposalId: 'pr-2', action: 'format', fromDate: '2026-10-24', toDate: null }),
    ])).toEqual(['2026-10-22', '2026-10-24']);
  });

  it('ignores the kinds that name no day at all', () => {
    expect(ringedDays([
      { kind: 'idea', text: 'something for later' },
      { kind: 'unresolved', question: 'Which post did you mean?' },
    ])).toEqual([]);
  });

  it('drops anything that is not a real ISO date rather than ringing a cell that cannot exist', () => {
    expect(ringedDays([change({ fromDate: 'next Tuesday', toDate: '' })])).toEqual([]);
    expect(ringedDays([change({ fromDate: null, toDate: undefined })])).toEqual([]);
  });

  it('an empty turn rings nothing — which is how the marks clear', () => {
    expect(ringedDays([])).toEqual([]);
    expect(ringedPredicate([])('2026-10-22')).toBe(false);
  });

  it('the predicate answers for the days it holds and no others', () => {
    const has = ringedPredicate([change()]);
    expect(has('2026-10-22')).toBe(true);
    expect(has('2026-10-24')).toBe(true);
    expect(has('2026-10-23')).toBe(false);
  });
});
