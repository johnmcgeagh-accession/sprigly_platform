import { describe, it, expect } from 'vitest';
import {
  daysBetween, dueDate, isAtRisk, ringOf, postAtRisk, bucketOf, groupTasks,
} from './checklist';

describe('dueDate', () => {
  it('subtracts lead_days from the scheduled date', () => {
    expect(dueDate('2026-07-15', 4)).toBe('2026-07-11');
    expect(dueDate('2026-07-01', 1)).toBe('2026-06-30'); // crosses month
    expect(dueDate('2026-03-01', 1)).toBe('2026-02-28'); // non-leap Feb
    expect(dueDate('2026-07-15', 0)).toBe('2026-07-15');
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed', () => {
    expect(daysBetween('2026-07-10', '2026-07-17')).toBe(7);
    expect(daysBetween('2026-07-17', '2026-07-10')).toBe(-7);
    expect(daysBetween('2026-07-10', '2026-07-10')).toBe(0);
  });
});

describe('isAtRisk', () => {
  const scheduled = '2026-07-15'; // caption (lead 1) due 07-14; shoot (lead 3) due 07-12
  it('is true when not done and due date is before today', () => {
    expect(isAtRisk({ done: false, leadDays: 3 }, scheduled, '2026-07-13')).toBe(true);
  });
  it('is false when done, even if overdue', () => {
    expect(isAtRisk({ done: true, leadDays: 3 }, scheduled, '2026-07-13')).toBe(false);
  });
  it('is false when the due date is today or later', () => {
    expect(isAtRisk({ done: false, leadDays: 3 }, scheduled, '2026-07-12')).toBe(false); // due today
    expect(isAtRisk({ done: false, leadDays: 3 }, scheduled, '2026-07-11')).toBe(false); // due tomorrow
  });
});

describe('ringOf', () => {
  it('counts done vs total', () => {
    expect(ringOf([{ done: true, leadDays: 1 }, { done: false, leadDays: 2 }])).toEqual({ done: 1, total: 2 });
    expect(ringOf([])).toEqual({ done: 0, total: 0 });
  });
});

describe('postAtRisk', () => {
  it('is true if any step is at risk', () => {
    const steps = [{ done: true, leadDays: 4 }, { done: false, leadDays: 3 }];
    expect(postAtRisk(steps, '2026-07-15', '2026-07-13')).toBe(true);
  });
  it('is false if all outstanding steps are still in the future', () => {
    const steps = [{ done: true, leadDays: 4 }, { done: false, leadDays: 1 }];
    expect(postAtRisk(steps, '2026-07-15', '2026-07-13')).toBe(false); // caption due 07-14 (future)
  });
});

describe('bucketOf', () => {
  const today = '2026-07-13';
  it('overdue when due before today', () => expect(bucketOf('2026-07-12', today)).toBe('overdue'));
  it('next7 from today through +7 days', () => {
    expect(bucketOf('2026-07-13', today)).toBe('next7'); // today
    expect(bucketOf('2026-07-20', today)).toBe('next7'); // +7
  });
  it('later beyond +7 days', () => expect(bucketOf('2026-07-21', today)).toBe('later'));
});

describe('groupTasks', () => {
  const today = '2026-07-13';
  it('buckets, excludes done, and stable-sorts by due date', () => {
    const tasks = [
      { id: 'a', done: false, leadDays: 1, scheduledDate: '2026-07-30' }, // due 07-29 later
      { id: 'b', done: false, leadDays: 3, scheduledDate: '2026-07-14' }, // due 07-11 overdue
      { id: 'c', done: true,  leadDays: 1, scheduledDate: '2026-07-14' }, // done → excluded
      { id: 'd', done: false, leadDays: 1, scheduledDate: '2026-07-15' }, // due 07-14 next7
      { id: 'e', done: false, leadDays: 2, scheduledDate: '2026-07-13' }, // due 07-11 overdue (tie with b)
    ];
    const g = groupTasks(tasks, today);
    // b and e both due 07-11; stable order keeps b before e (input order).
    expect(g.overdue.map((t) => t.item.id)).toEqual(['b', 'e']);
    expect(g.next7.map((t) => t.item.id)).toEqual(['d']);
    expect(g.later.map((t) => t.item.id)).toEqual(['a']);
    expect(g.overdue.every((t) => t.bucket === 'overdue')).toBe(true);
  });
  it('handles an empty list', () => {
    expect(groupTasks([], today)).toEqual({ overdue: [], next7: [], later: [] });
  });
});
