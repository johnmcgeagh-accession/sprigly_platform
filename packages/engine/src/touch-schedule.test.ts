import { describe, it, expect } from 'vitest';
import { deriveTouchSchedule, dueTouchForDay, AUTO_RUN_MIN_WINDOW } from './touch-schedule.js';

describe('deriveTouchSchedule', () => {
  it('unconfigured when there is no cutoffDay', () => {
    const s = deriveTouchSchedule(5, null);
    expect(s).toEqual({ configured: false, reminderDay: 5, cutoffDay: null, askDay: null, nudgeDay: null, lastCallDay: null, planRunDay: null, nudgeSuppressed: false });
  });

  it('a wide window (>= AUTO_RUN_MIN_WINDOW) yields all four days', () => {
    const s = deriveTouchSchedule(5, 20);
    expect(s).toMatchObject({ configured: true, askDay: 5, nudgeDay: 17, lastCallDay: 19, planRunDay: 20, nudgeSuppressed: false });
  });

  it('collapses (drops the Nudge) when the window is under AUTO_RUN_MIN_WINDOW', () => {
    const s = deriveTouchSchedule(18, 20);  // gap 2
    expect(s).toMatchObject({ askDay: 18, nudgeDay: null, lastCallDay: 19, planRunDay: 20, nudgeSuppressed: true });
    expect(AUTO_RUN_MIN_WINDOW).toBe(5);
  });

  it('exactly at the window boundary (gap 5) keeps the Nudge', () => {
    expect(deriveTouchSchedule(5, 10).nudgeDay).toBe(7);      // gap 5 → nudge day 7
    expect(deriveTouchSchedule(5, 9).nudgeSuppressed).toBe(true); // gap 4 → collapsed
  });
});

describe('dueTouchForDay (matches the sender ordering)', () => {
  const wide = deriveTouchSchedule(5, 20);
  it('Ask on reminder, Last Call on cutoff-1, Nudge on cutoff-3', () => {
    expect(dueTouchForDay(wide, 5)).toBe('ask');
    expect(dueTouchForDay(wide, 19)).toBe('last_call');
    expect(dueTouchForDay(wide, 17)).toBe('nudge');
    expect(dueTouchForDay(wide, 12)).toBeNull();
  });
  it('collapsed window: cutoff-3 is NOT a nudge day', () => {
    const collapsed = deriveTouchSchedule(18, 20);
    expect(dueTouchForDay(collapsed, 17)).toBeNull();  // would be nudge if wide
    expect(dueTouchForDay(collapsed, 18)).toBe('ask');
    expect(dueTouchForDay(collapsed, 19)).toBe('last_call');
  });
  it('a 1-day window fires Ask (priority), never Last Call, on the shared day', () => {
    const tiny = deriveTouchSchedule(19, 20); // ask 19, lastCall 19
    expect(dueTouchForDay(tiny, 19)).toBe('ask');
  });
  it('unconfigured is never due', () => {
    expect(dueTouchForDay(deriveTouchSchedule(5, null), 5)).toBeNull();
  });
});
