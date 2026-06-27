'use client';

import { useState, useTransition } from 'react';
import { saveIntake, confirmIntake, type IntakeActionResult } from './intake-actions';
import type { IntakeJson, BusinessContextNote } from '@sprigly/engine';

// tsconfig lib:["ES2022"] has no DOM — access element value via this cast.
function val(e: { currentTarget: unknown }): string {
  return (e.currentTarget as unknown as { value: string }).value;
}

interface Props {
  cycleId:        string;
  cycleMonth:     string;
  cycleStatus:    string;
  clientId:       string;
  channel:        string;
  baseQuestions:  readonly string[];
  extraQuestions: string[];
  existingIntake: IntakeJson | null;
}

export function IntakePanel({
  cycleId, cycleMonth, cycleStatus, clientId, channel,
  baseQuestions, extraQuestions, existingIntake,
}: Props) {
  const allQuestions = [...baseQuestions, ...extraQuestions];

  const [answers, setAnswers] = useState<Record<string, string>>(
    existingIntake?.planContent.answers ?? {},
  );
  const [freeNotes, setFreeNotes]     = useState(existingIntake?.planContent.freeNotes ?? '');
  const [businessContext, setBusinessContext] = useState<BusinessContextNote[]>(
    existingIntake?.businessContext ?? [],
  );
  const [newContextNote, setNewContextNote] = useState('');
  const [otherChannel, setOtherChannel]     = useState(
    existingIntake?.otherChannel?.['general']?.[0] ?? '',
  );

  const [isSaving,    startSaveTransition]    = useTransition();
  const [isConfirming, startConfirmTransition] = useTransition();
  const [saveResult,    setSaveResult]    = useState<IntakeActionResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<IntakeActionResult | null>(null);

  const isConfirmed = cycleStatus === 'intake_confirmed';
  const isReadOnly  = isConfirmed;

  function buildFormData() {
    const fd = new FormData();
    fd.set('cycleId',         cycleId);
    fd.set('clientId',        clientId);
    fd.set('answers',         JSON.stringify(answers));
    fd.set('freeNotes',       freeNotes);
    fd.set('businessContext', JSON.stringify(businessContext));
    fd.set('otherChannel',    otherChannel);
    return fd;
  }

  function handleSave() {
    setSaveResult(null);
    startSaveTransition(async () => {
      const result = await saveIntake(buildFormData());
      setSaveResult(result);
    });
  }

  function handleConfirm() {
    setConfirmResult(null);
    startConfirmTransition(async () => {
      const saveRes = await saveIntake(buildFormData());
      if (!saveRes.ok) {
        setConfirmResult({ ok: false, message: `Save failed: ${saveRes.message}` });
        return;
      }
      const result = await confirmIntake(buildFormData());
      setConfirmResult(result);
    });
  }

  function addContextNote() {
    const trimmed = newContextNote.trim();
    if (!trimmed) return;
    setBusinessContext((prev) => [
      ...prev,
      { note: trimmed, capturedAt: new Date().toISOString() },
    ]);
    setNewContextNote('');
  }

  const textareaClass = `w-full text-sm border rounded px-3 py-2 text-gray-800 resize-y focus:outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400 ${
    isReadOnly ? 'border-gray-100 bg-gray-50' : 'border-gray-200'
  }`;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Intake for <span className="font-mono">{cycleMonth}</span>
          {' · '}{channel}
          {' · '}
          <span className="font-mono">{cycleStatus}</span>
        </p>
        {isConfirmed && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
            intake confirmed
          </span>
        )}
      </div>

      {/* ── Plan content ─────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Plan content — answers for this month
        </h4>
        <div className="space-y-4">
          {allQuestions.map((q, i) => (
            <div key={q}>
              <label className="block text-xs text-gray-600 mb-1">
                {i + 1}. {q}
              </label>
              <textarea
                value={answers[q] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q]: val(e) }))}
                rows={2}
                disabled={isReadOnly}
                className={textareaClass}
                placeholder="Leave blank to skip…"
              />
            </div>
          ))}

          <div>
            <label className="block text-xs text-gray-600 mb-1">Free notes</label>
            <textarea
              value={freeNotes}
              onChange={(e) => setFreeNotes(val(e))}
              rows={3}
              disabled={isReadOnly}
              className={textareaClass}
              placeholder="Anything else worth noting for this month's plan…"
            />
          </div>
        </div>
      </div>

      {/* ── Business context ─────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Business context
          <span className="ml-1 normal-case font-normal text-gray-400">— durable facts about this client</span>
        </h4>
        <p className="text-xs text-gray-400 mb-3">
          These accumulate over time and are passed to the planning worker on every cycle.
        </p>

        {businessContext.length > 0 && (
          <ul className="space-y-2 mb-3">
            {businessContext.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm bg-gray-50 rounded px-3 py-2">
                <span className="flex-1 text-gray-700">{n.note}</span>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => setBusinessContext((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 text-gray-300 hover:text-gray-500 text-xs leading-none mt-0.5"
                    aria-label="Remove note"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!isReadOnly && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newContextNote}
              onChange={(e) => setNewContextNote(val(e))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addContextNote(); } }}
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-2 text-gray-800 focus:outline-none focus:border-blue-400"
              placeholder="Add a durable fact about this client…"
            />
            <button
              type="button"
              onClick={addContextNote}
              className="px-3 py-2 text-xs font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* ── Other channel notes ──────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Other channel notes
          <span className="ml-1 normal-case font-normal text-gray-400">— optional</span>
        </h4>
        <p className="text-xs text-gray-400 mb-2">
          Notes about channels not being planned this cycle — parked for future use.
        </p>
        <textarea
          value={otherChannel}
          onChange={(e) => setOtherChannel(val(e))}
          rows={2}
          disabled={isReadOnly}
          className={textareaClass}
          placeholder="e.g. Sally mentioned wanting to launch LinkedIn in Q3…"
        />
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      {!isReadOnly && (
        <div className="pt-4 border-t border-gray-100 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isConfirming}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSaving || isConfirming}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConfirming ? 'Confirming…' : 'Mark intake complete →'}
            </button>
          </div>

          {saveResult?.ok && !confirmResult && (
            <p className="text-xs text-green-600">Draft saved.</p>
          )}
          {saveResult && !saveResult.ok && (
            <p className="text-xs text-red-600">{saveResult.message}</p>
          )}
          {confirmResult && !confirmResult.ok && (
            <p className="text-xs text-red-600">{confirmResult.message}</p>
          )}
        </div>
      )}

      {/* Integration note for future writers (dev-only) */}
      <p className="text-xs text-gray-300 italic">
        Future writers: email-reply capture and voice-note ingest will write to the same{' '}
        <span className="font-mono">intake_json</span> shape with{' '}
        <span className="font-mono">source: &apos;email&apos;</span> or{' '}
        <span className="font-mono">&apos;voice&apos;</span>. Manual entry is{' '}
        <span className="font-mono">source: &apos;manual&apos;</span>.
      </p>
    </div>
  );
}
