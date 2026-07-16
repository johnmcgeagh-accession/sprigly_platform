'use client';

// Deep import (not the @sprigly/engine barrel): this is a CLIENT component, and the barrel
// re-exports server modules that pull @sprigly/db → postgres → Node builtins, which the browser
// bundle can't resolve. touch-schedule.ts is pure (zero imports), so the subpath is clean.
import { deriveTouchSchedule } from '@sprigly/engine/touch-schedule';

/** The current cycle's send-log stamps + input-landed flag, for the "where are we" readout. */
export interface CurrentCycleStatus {
  monthLabel:     string;         // the plan month, e.g. "August 2026"
  askSentAt:      string | null;  // ISO or null
  nudgeSentAt:    string | null;
  lastCallSentAt: string | null;
  // Per-beat skip reason (0080) — WHY a NULL *_sent_at happened. null = unknown / predates.
  askSkipReason:      string | null;  // 'has_input'|'send_failed'|'no_sender_wired'|'error'|null
  nudgeSkipReason:    string | null;
  lastCallSkipReason: string | null;
  inputLanded:    boolean;        // hasAnyIntakeInput for this cycle
}

/** Human labels for the skip-reason domain (migration 0080). */
const SKIP_REASON_LABEL: Record<string, string> = {
  has_input:       'Suppressed — input landed',
  send_failed:     'Send failed',
  no_sender_wired: 'No sender configured',
  error:           'Errored',
};

function ord(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * "What fires when" — derived ENTIRELY from the two dates via the SHARED derivation
 * (deriveTouchSchedule, same as the sender), plus the current cycle's live status. No new
 * storage. Window-collapse hides the Nudge and says so; no cutoffDay → manual-only.
 */
export function ScheduleReadout({ reminderDay, cutoffDay, currentCycle }: {
  reminderDay: number | null;
  cutoffDay:   number | null;
  currentCycle: CurrentCycleStatus | null;
}) {
  if (reminderDay == null) {
    return <p className="text-xs text-gray-400">Set a reminder day to preview the schedule.</p>;
  }
  const s = deriveTouchSchedule(reminderDay, cutoffDay);

  if (!s.configured) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <span className="font-medium text-gray-700">Auto-run not configured — manual runs only.</span>{' '}
        The reminder/ask email fires on the {ord(reminderDay)}.
      </div>
    );
  }

  const parts = [
    `Ask: ${ord(s.askDay!)}`,
    s.nudgeDay != null ? `Nudge: ${ord(s.nudgeDay)}` : null,
    `Last Call: ${ord(s.lastCallDay!)}`,
    `Plan runs: ${ord(s.planRunDay!)}`,
  ].filter(Boolean);

  // Three display states (0080), replacing the old NULL→"pending" lie:
  //   sent (timestamp)  → "Ask: Sent 13 Jul"
  //   NULL + reason     → "Ask: Suppressed — input landed" (etc.)
  //   NULL + no reason  → "Ask: No reminder sent"  (unknown / predates the column)
  const status = (label: string, at: string | null, reason: string | null) => {
    if (at) return `${label}: Sent ${shortDate(at)}`;
    if (reason) return `${label}: ${SKIP_REASON_LABEL[reason] ?? reason}`;
    return `${label}: No reminder sent`;
  };

  return (
    <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-gray-700">
      <div className="font-medium text-gray-800">{parts.join(' · ')}</div>
      {s.nudgeSuppressed && (
        <div className="mt-0.5 text-gray-500">Nudge skipped — the reminder→cutoff window is under 5 days.</div>
      )}
      {currentCycle && (
        <div className="mt-2 border-t border-blue-100 pt-2 text-gray-600">
          <div className="font-medium text-gray-700">This month ({currentCycle.monthLabel}):</div>
          <div>
            {status('Ask', currentCycle.askSentAt, currentCycle.askSkipReason)}
            {s.nudgeDay != null ? ` · ${status('Nudge', currentCycle.nudgeSentAt, currentCycle.nudgeSkipReason)}` : ''}
            {` · ${status('Last Call', currentCycle.lastCallSentAt, currentCycle.lastCallSkipReason)}`}
          </div>
          <div>Input landed: {currentCycle.inputLanded ? 'yes — reminders now suppressed' : 'not yet'}</div>
        </div>
      )}
    </div>
  );
}
