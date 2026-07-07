/**
 * notes.test.ts — the notes lifecycle. isNoteInWindow is pure and tested directly;
 * dismiss/expire are checked for client scoping + the right status transitions via
 * a mocked db.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  updateSets: [] as unknown[],
  updateWheres: [] as unknown[],
  returnRows: [] as Record<string, unknown>[],
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  isNotNull: (col: unknown) => ({ op: 'isNotNull', col }),
  lt: (col: unknown, val: unknown) => ({ op: 'lt', col, val }),
}));

vi.mock('@sprigly/db', () => {
  const planInputs = new Proxy({}, { get: (_t, p) => String(p) });
  const db = {
    update() { return { set(s: unknown) { h.updateSets.push(s); return {
      where(cond: unknown) {
        h.updateWheres.push(cond);
        return Object.assign(Promise.resolve(), { returning: () => Promise.resolve(h.returnRows) });
      },
    }; } }; },
    select() { return { from() { return { where() { return { orderBy: () => Promise.resolve(h.returnRows) }; } }; } }; },
    insert() { return { values() { return { returning: () => Promise.resolve([{ id: 'note-1' }]) }; } }; },
  };
  return { db, planInputs };
});

import { isNoteInWindow, dismissNote, expireStaleNotes } from './notes';

interface EqDescriptor { op: string; col?: string; val?: unknown; parts?: EqDescriptor[] }
function collect(cond: EqDescriptor | undefined): Array<{ op: string; col: string; val?: unknown }> {
  if (!cond) return [];
  if (cond.op === 'and') return (cond.parts ?? []).flatMap(collect);
  return [{ op: cond.op, col: cond.col as string, val: cond.val }];
}

describe('isNoteInWindow (maturation)', () => {
  const week = ['2026-03-16', '2026-03-22'] as const; // Mon–Sun

  it('a note whose window overlaps the week is relevant', () => {
    expect(isNoteInWindow({ relevantFrom: '2026-03-18', relevantTo: '2026-03-20' }, ...week)).toBe(true);
  });
  it('a note fully before the week is not relevant', () => {
    expect(isNoteInWindow({ relevantFrom: '2026-03-01', relevantTo: '2026-03-10' }, ...week)).toBe(false);
  });
  it('a note fully after the week is not relevant', () => {
    expect(isNoteInWindow({ relevantFrom: '2026-04-01', relevantTo: '2026-04-05' }, ...week)).toBe(false);
  });
  it('open-ended (both null) is always relevant', () => {
    expect(isNoteInWindow({ relevantFrom: null, relevantTo: null }, ...week)).toBe(true);
  });
  it('null relevantTo (open end) starting within the week is relevant', () => {
    expect(isNoteInWindow({ relevantFrom: '2026-03-20', relevantTo: null }, ...week)).toBe(true);
  });
  it('relevantTo exactly on weekStart is still relevant (inclusive)', () => {
    expect(isNoteInWindow({ relevantFrom: null, relevantTo: '2026-03-16' }, ...week)).toBe(true);
  });
});

describe('dismiss + expire scoping', () => {
  beforeEach(() => { h.updateSets.length = 0; h.updateWheres.length = 0; h.returnRows = []; });

  it('dismissNote sets status=dismissed, scoped to client + active only', async () => {
    h.returnRows = [{ id: 'n1', content: 'x', source: 'web', relevantFrom: null, relevantTo: null, createdAt: new Date() }];
    const r = await dismissNote('client-1', 'n1');
    expect(r?.id).toBe('n1');
    expect(h.updateSets[0]).toEqual({ status: 'dismissed' });
    const eqs = collect(h.updateWheres[0] as EqDescriptor);
    expect(eqs).toContainEqual({ op: 'eq', col: 'clientId', val: 'client-1' });
    expect(eqs).toContainEqual({ op: 'eq', col: 'status', val: 'active' });
    expect(eqs).toContainEqual({ op: 'eq', col: 'id', val: 'n1' });
  });

  it('expireStaleNotes sets status=expired for active notes with relevant_to < today', async () => {
    await expireStaleNotes('client-1', '2026-07-07');
    expect(h.updateSets[0]).toEqual({ status: 'expired' });
    const eqs = collect(h.updateWheres[0] as EqDescriptor);
    expect(eqs).toContainEqual({ op: 'eq', col: 'clientId', val: 'client-1' });
    expect(eqs).toContainEqual({ op: 'eq', col: 'status', val: 'active' });
    expect(eqs).toContainEqual({ op: 'lt', col: 'relevantTo', val: '2026-07-07' });
    expect(eqs.some((e) => e.op === 'isNotNull' && e.col === 'relevantTo')).toBe(true);
  });
});
