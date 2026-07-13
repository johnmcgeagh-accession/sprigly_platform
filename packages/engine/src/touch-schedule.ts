/**
 * touch-schedule.ts — the ONE derivation of the intake-capture three-touch schedule from the
 * two per-client dates (reminder day + cutoff day). Shared by the SENDER (engine scheduler's
 * dueTouch) and the ADMIN "what fires when" readout so they can never disagree.
 *
 * Rules (must match the sender exactly):
 *   Ask       = reminder day.
 *   Last Call = cutoffDay − 1.
 *   Nudge     = cutoffDay − 3, but ONLY when the window (cutoffDay − reminderDay) is at least
 *               AUTO_RUN_MIN_WINDOW (which also guarantees it lands strictly after the reminder);
 *               below that the window "collapses" to Ask + Last Call only.
 *   Plan run  = cutoffDay.
 * No cutoffDay ⇒ auto-run not configured (nothing derived).
 */

export const AUTO_RUN_MIN_WINDOW = 5;

export type Touch = 'ask' | 'nudge' | 'last_call';

export interface TouchSchedule {
  configured:      boolean;       // a cutoffDay is set (auto-run configured)
  reminderDay:     number;
  cutoffDay:       number | null;
  askDay:          number | null;
  nudgeDay:        number | null; // null when the window collapsed
  lastCallDay:     number | null;
  planRunDay:      number | null;
  nudgeSuppressed: boolean;       // window < AUTO_RUN_MIN_WINDOW → no Nudge
}

/** Derive the touch days from the reminder day + (nullable) cutoff day. Pure. */
export function deriveTouchSchedule(reminderDay: number, cutoffDay: number | null): TouchSchedule {
  if (cutoffDay == null) {
    return { configured: false, reminderDay, cutoffDay: null, askDay: null, nudgeDay: null, lastCallDay: null, planRunDay: null, nudgeSuppressed: false };
  }
  const gap = cutoffDay - reminderDay;
  const nudgeOk = gap >= AUTO_RUN_MIN_WINDOW && cutoffDay - 3 > reminderDay;
  return {
    configured:      true,
    reminderDay,
    cutoffDay,
    askDay:          reminderDay,
    nudgeDay:        nudgeOk ? cutoffDay - 3 : null,
    lastCallDay:     cutoffDay - 1,
    planRunDay:      cutoffDay,
    nudgeSuppressed: !nudgeOk,
  };
}

/** Which touch (if any) is due on `todayDay`. Priority Ask → Last Call → Nudge, matching the
 *  sender's original ordering exactly (so e.g. a 1-day window fires Ask, never Last Call). */
export function dueTouchForDay(s: TouchSchedule, todayDay: number): Touch | null {
  if (!s.configured) return null;
  if (todayDay === s.askDay) return 'ask';
  if (todayDay === s.lastCallDay) return 'last_call';
  if (s.nudgeDay != null && todayDay === s.nudgeDay) return 'nudge';
  return null;
}
