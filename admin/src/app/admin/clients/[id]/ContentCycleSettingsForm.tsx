'use client';

import { useRef, useState } from 'react';
import { updateContentCycleSettings, updateContentCycleEnabled } from './actions';
import { ScheduleReadout, type CurrentCycleStatus } from './ScheduleReadout';

interface Props {
  clientId:             string;
  clientName:           string;
  channel:              string;
  instagramHandle:      string | null;
  contactEmail:         string | null;
  contactName:          string | null;
  contentCycleSchedule: { day: number; hour: number; cutoffDay?: number | null } | null;
  extraQuestions:       string[] | null;
  contentCycleEnabled:  boolean;
  // The current cycle's send-log stamps + input-landed flag for the "where are we" readout.
  currentCycle:         CurrentCycleStatus | null;
}

export function ContentCycleSettingsForm({
  clientId,
  clientName,
  channel,
  instagramHandle,
  contactEmail,
  contactName,
  contentCycleSchedule,
  extraQuestions,
  contentCycleEnabled,
  currentCycle,
}: Props) {
  const settingsFormRef  = useRef<HTMLFormElement>(null);
  const enableFormRef    = useRef<HTMLFormElement>(null);
  const enabledValueRef  = useRef<HTMLInputElement>(null);

  const [enabled, setEnabled]     = useState(contentCycleEnabled);
  const [showConfirm, setShowConfirm] = useState(false);
  // Live readout state — mirrors the day/cutoff inputs so "what fires when" updates as you type
  // (the inputs stay uncontrolled for the auto-save; these only drive the preview).
  const [reminderDay, setReminderDay] = useState<number | null>(contentCycleSchedule?.day ?? null);
  const [cutoffDay,   setCutoffDay]   = useState<number | null>(contentCycleSchedule?.cutoffDay ?? null);
  const parseDay = (v: string) => { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };

  function submitSettings() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (settingsFormRef.current as any)?.requestSubmit();
  }

  function handleToggle() {
    if (!enabled) {
      setShowConfirm(true);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (enabledValueRef.current) (enabledValueRef.current as any).value = 'false';
      setEnabled(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (enableFormRef.current as any)?.requestSubmit();
    }
  }

  function handleConfirm() {
    setShowConfirm(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (enabledValueRef.current) (enabledValueRef.current as any).value = 'true';
    setEnabled(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (enableFormRef.current as any)?.requestSubmit();
  }

  return (
    <>
      {/* ── Settings (auto-save on blur) ───────────────────────────── */}
      <form ref={settingsFormRef} action={updateContentCycleSettings}>
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="channel"  value={channel} />

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">

          {/* instagram_handle */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Instagram handle
            </label>
            <input
              name="instagramHandle"
              type="text"
              defaultValue={instagramHandle ?? ''}
              onBlur={submitSettings}
              placeholder="ivy_thebrand"
              className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* contact_name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Contact name
            </label>
            <input
              name="contactName"
              type="text"
              defaultValue={contactName ?? ''}
              onBlur={submitSettings}
              placeholder="Sally"
              className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* contact_email */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Contact email
            </label>
            <input
              name="contactEmail"
              type="email"
              defaultValue={contactEmail ?? ''}
              onBlur={submitSettings}
              placeholder="client@example.com"
              className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {!contactEmail && (
              <p className="mt-1 text-xs text-amber-600">
                No contact email — the content cycle will hard-fail at runtime without one.
              </p>
            )}
          </div>

          {/* content_cycle_schedule */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Schedule{' '}
              <span className="font-normal text-gray-400">
                (leave blank to use default: day&nbsp;1 at&nbsp;06:00)
              </span>
            </label>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Day of month</span>
                <input
                  name="scheduleDay"
                  type="number"
                  min={1}
                  max={28}
                  defaultValue={contentCycleSchedule?.day ?? ''}
                  onChange={(e) => setReminderDay(parseDay(e.target.value))}
                  onBlur={submitSettings}
                  placeholder="1"
                  className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Hour (0–23)</span>
                <input
                  name="scheduleHour"
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={contentCycleSchedule?.hour ?? ''}
                  onBlur={submitSettings}
                  placeholder="6"
                  className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>
          </div>

          {/* cutoffDay — the auto-run plan-run day */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Plan runs on this day (auto-run){' '}
              <span className="font-normal text-gray-400">— leave blank to keep manual runs</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Day of month</span>
              <input
                name="scheduleCutoffDay"
                type="number"
                min={1}
                max={28}
                defaultValue={contentCycleSchedule?.cutoffDay ?? ''}
                onChange={(e) => setCutoffDay(parseDay(e.target.value))}
                onBlur={submitSettings}
                placeholder="(blank)"
                className="w-20 border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-400">must be after the reminder day</span>
            </div>
          </div>

          {/* "what fires when" readout — derived from the two dates (shared derivation) */}
          <div className="col-span-2">
            <ScheduleReadout reminderDay={reminderDay} cutoffDay={cutoffDay} currentCycle={currentCycle} />
          </div>

          {/* extra_questions */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Extra questions{' '}
              <span className="font-normal text-gray-400">
                (one per line — appended after the 5 base questions)
              </span>
            </label>
            <textarea
              name="extraQuestions"
              defaultValue={(extraQuestions ?? []).join('\n')}
              onBlur={submitSettings}
              rows={3}
              placeholder={'Any particular outfit pairings in mind?\nAny new colourways worth leading on?'}
              className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-300 font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

        </div>
      </form>

      {/* ── Enable toggle — deliberate, visually separated ─────────── */}
      <div className="mt-6 pt-5 border-t border-gray-100">
        <div
          className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-4 transition-colors ${
            enabled
              ? 'bg-green-50 border-green-200'
              : 'bg-gray-50 border-gray-200'
          }`}
        >
          <div>
            <p className={`text-sm font-semibold ${enabled ? 'text-green-800' : 'text-gray-700'}`}>
              {enabled ? 'Content cycle enabled' : 'Content cycle disabled'}
            </p>
            <p className={`mt-0.5 text-xs ${enabled ? 'text-green-600' : 'text-gray-500'}`}>
              {enabled
                ? 'Drafts will be created automatically on schedule and queued for review.'
                : 'Activate to start the scheduled content-request email flow for this client.'}
            </p>
          </div>

          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              enabled
                ? 'bg-green-500 focus:ring-green-500'
                : 'bg-gray-300 focus:ring-gray-400'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200 ease-in-out ${
                enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Hidden form backing the toggle */}
        <form ref={enableFormRef} action={updateContentCycleEnabled}>
          <input type="hidden" name="clientId" value={clientId} />
          <input ref={enabledValueRef} type="hidden" name="enabled" defaultValue="" />
        </form>
      </div>

      {/* ── Confirmation dialog ────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Enable scheduled content emails for {clientName}?
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              This client will start receiving an automatically-drafted content-request email on their schedule.
              Drafts are created for review, not sent automatically.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Enable
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
