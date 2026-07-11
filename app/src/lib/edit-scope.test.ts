/**
 * edit-scope.test.ts — the pure DATE gate (isEditableDate) and the London-midnight
 * boundary (editScopeToday). No DB — resolvePostForEdit/gatePostEdit are covered via
 * the route/mutation integration tests.
 */
import { describe, it, expect } from 'vitest';
import { isEditableDate, editScopeToday } from './edit-scope';

describe('isEditableDate — the rule (today-onward is editable)', () => {
  const TODAY = '2026-07-11';

  it('TODAY itself is editable (inclusive boundary)', () => {
    expect(isEditableDate(TODAY, TODAY)).toBe(true);
  });
  it('yesterday is read-only', () => {
    expect(isEditableDate('2026-07-10', TODAY)).toBe(false);
  });
  it('tomorrow is editable', () => {
    expect(isEditableDate('2026-07-12', TODAY)).toBe(true);
  });
  it('far past is read-only, far future is editable', () => {
    expect(isEditableDate('2025-01-01', TODAY)).toBe(false);
    expect(isEditableDate('2027-12-31', TODAY)).toBe(true);
  });
  it('compares by calendar date across month/year rollover (lexical ISO is correct)', () => {
    expect(isEditableDate('2026-08-01', '2026-07-31')).toBe(true);   // next month
    expect(isEditableDate('2026-07-31', '2026-08-01')).toBe(false);  // prev month
    expect(isEditableDate('2027-01-01', '2026-12-31')).toBe(true);   // next year
  });
});

describe('editScopeToday — London midnight, server-computed', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(editScopeToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('is computed in Europe/London (not UTC/local drift)', () => {
    const london = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    expect(editScopeToday()).toBe(london);
  });
  it('today is always editable against itself', () => {
    expect(isEditableDate(editScopeToday())).toBe(true);
  });
});
