import { describe, it, expect } from 'vitest';
import { nextMonth } from './planning.js';
import { prevMonth } from '../drive-poller.js';

describe('month offset — plan = data month + 1', () => {
  it('nextMonth advances within a year', () => {
    expect(nextMonth('2026-05')).toBe('2026-06');
    expect(nextMonth('2026-01')).toBe('2026-02');
  });
  it('nextMonth rolls the year at December', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
  it('prevMonth is the inverse', () => {
    expect(prevMonth('2026-06')).toBe('2026-05');
    expect(prevMonth('2027-01')).toBe('2026-12');
  });
  it('round-trips for every month', () => {
    for (let m = 1; m <= 12; m++) {
      const mm = `2026-${String(m).padStart(2, '0')}`;
      expect(prevMonth(nextMonth(mm))).toBe(mm);
    }
  });
});
