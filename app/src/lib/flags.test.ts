import { describe, it, expect } from 'vitest';
import { readPlanRedesignFlag } from './flags';

describe('readPlanRedesignFlag', () => {
  it('is off when settings is absent or empty', () => {
    expect(readPlanRedesignFlag(undefined)).toBe(false);
    expect(readPlanRedesignFlag(null)).toBe(false);
    expect(readPlanRedesignFlag({})).toBe(false);
  });

  it('is off unless the flag is exactly boolean true', () => {
    expect(readPlanRedesignFlag({ plan_redesign: false })).toBe(false);
    expect(readPlanRedesignFlag({ plan_redesign: 'true' })).toBe(false);
    expect(readPlanRedesignFlag({ plan_redesign: 1 })).toBe(false);
  });

  it('is on only when the flag is boolean true', () => {
    expect(readPlanRedesignFlag({ plan_redesign: true })).toBe(true);
  });
});
