'use client';

import { useState, useTransition } from 'react';
import { saveIntake, confirmIntake, type IntakeActionResult } from './intake-actions';
import type { IntakeJson, BusinessContextNote } from '@sprigly/engine';

// tsconfig lib:["ES2022"] has no DOM — access element value via this cast.
// Also guards against null currentTarget when hydration errors leave events broken.
function val(e: { currentTarget: unknown }): string {
  const target = e.currentTarget as { value?: string } | null;
  return target?.value ?? '';
}

function defaultIntake(): IntakeJson {
  return {
    planContent:     { answers: {}, freeNotes: '' },
    businessContext: [],
    otherChannel:    {},
    source:          'manual',
    capturedAt:      '',
  };
}

/**
 * Normalise a stored intake into a fully-formed one.
 *
 * `existingIntake ?? defaultIntake()` was NOT enough. `??` only fires on null, and the
 * approval arc writes an intake_json that is a NON-NULL object carrying only
 * `draftApplications`: draft-apply.ts persistReceipt spreads receipts onto whatever is
 * already there, which for a draft-flow cycle is nothing. That object reached
 * `intake.planContent.answers` and threw, taking the WHOLE admin client page down with it —
 * including the OAuth section, which is how a missing Gmail connection became unfixable.
 * (uat: earl-of-east cycle 040d6a1a, whose intake_json's only top-level key is
 * `draftApplications`.)
 *
 * IntakeJson types every field as required, but the column is jsonb cast to it — the type
 * describes what the planning arc writes, not what the table can hold. So this normalises
 * FIELD BY FIELD: whatever is stored survives, and only genuinely absent fields default.
 * The defaults are empty (no answers, no notes) — which is the honest state for a cycle
 * that never had an intake, not an invention of content.
 */
function normaliseIntake(existing: IntakeJson | null): IntakeJson {
  const d = defaultIntake();
  if (!existing) return d;
  const e = existing as Partial<IntakeJson>;
  return {
    planContent: {
      answers:   e.planContent?.answers   ?? d.planContent.answers,
      freeNotes: e.planContent?.freeNotes ?? d.planContent.freeNotes,
    },
    businessContext: Array.isArray(e.businessContext) ? e.businessContext : d.businessContext,
    otherChannel:    e.otherChannel ?? d.otherChannel,
    source:          e.source     ?? d.source,
    capturedAt:      e.capturedAt ?? d.capturedAt,
  };
}

/** True when this cycle has a real captured intake, as opposed to a normalised empty one. */
export function hasCapturedIntake(existing: IntakeJson | null): boolean {
  const pc = (existing as Partial<IntakeJson> | null)?.planContent;
  if (!pc) return false;
  return Object.keys(pc.answers ?? {}).length > 0 || (pc.freeNotes ?? '').trim().length > 0;
}

interface Props {
  cycleId:        string;
  cycleMonth:     string;
  cycleStatus:    string;
  clientId:       string;
  channel:        string;
  questions:      readonly string[];   // derived once via questionsForChannel — base + channel extras
  existingIntake: IntakeJson | null;
}

export function IntakePanel({
  cycleId, cycleMonth, cycleStatus, clientId, channel,
  questions, existingIntake,
}: Props) {
  // Normalise to a fully-formed object so all downstream accesses are non-optional.
  // Field-wise, not `?? default` — see normaliseIntake.
  const intake     = normaliseIntake(existingIntake);
  const captured   = hasCapturedIntake(existingIntake);
  const allQuestions = questions;

  const [answers, setAnswers] = useState<Record<string, string>>(
    intake.planContent.answers,
  );
  const [freeNotes, setFreeNotes]         = useState<string>(intake.planContent.freeNotes);
  const [businessContext, setBusinessContext] = useState<BusinessContextNote[]>(
    intake.businessContext,
  );
  const [newContextNote, setNewContextNote] = useState<string>('');
  const [otherChannel, setOtherChannel]     = useState<string>(
    intake.otherChannel['general']?.[0] ?? '',
  );

  const [isSaving,     startSaveTransition]    = useTransition();
  const [isConfirming, startConfirmTransition] = useTransition();
  const [saveResult,    setSaveResult]    = useState<IntakeActionResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<IntakeActionResult | null>(null);

  const isConfirmed = cycleStatus === 'intake_confirmed';
  const isReadOnly  = isConfirmed;

  function buildFormData(): FormData {
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
        setConfirmResult({ ok: false, message: `Save failed: ${saveRes.message ?? 'unknown error'}` });
        return;
      }
      const result = await confirmIntake(buildFormData());
      setConfirmResult(result);
    });
  }

  function handleAddContextNote() {
    const trimmed = newContextNote.trim();
    if (!trimmed) return;
    setBusinessContext((prev) => [
      ...prev,
      { note: trimmed, capturedAt: new Date().toISOString() },
    ]);
    setNewContextNote('');
  }

  function handleRemoveContextNote(idx: number) {
    setBusinessContext((prev) => prev.filter((_, i) => i !== idx));
  }

  const fieldCls = [
    'w-full text-sm border rounded px-3 py-2 text-gray-800 resize-y',
    'focus:outline-none focus:border-blue-400',
    'disabled:bg-gray-50 disabled:text-gray-400 disabled:resize-none',
    isReadOnly ? 'border-gray-100 bg-gray-50' : 'border-gray-200',
  ].join(' ');

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
        {/* Honest about the absence rather than showing blank fields as though something
            had been captured. The form stays usable — this is where an admin enters it. */}
        {!captured && (
          <p data-testid="no-intake-answers" className="text-xs text-gray-500 italic mb-3">
            No intake answers for this cycle — nothing has been captured yet.
          </p>
        )}
        <div className="space-y-4">
          {allQuestions.map((q, i) => (
            <div key={i}>
              <label className="block text-xs text-gray-600 mb-1">
                {i + 1}. {q}
              </label>
              <textarea
                value={answers[q] ?? ''}
                onChange={(e) => { const v = val(e); setAnswers((prev) => ({ ...prev, [q]: v })); }}
                rows={2}
                disabled={isReadOnly}
                className={fieldCls}
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
              className={fieldCls}
              placeholder="Anything else worth noting for this month's plan…"
            />
          </div>
        </div>
      </div>

      {/* ── Business context ─────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Business context
          <span className="ml-1 normal-case font-normal text-gray-400">— durable client facts</span>
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
                    onClick={() => handleRemoveContextNote(i)}
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
              onKeyDown={(e) => {
                const key = (e as unknown as { key: string }).key;
                if (key === 'Enter') { e.preventDefault(); handleAddContextNote(); }
              }}
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-2 text-gray-800 focus:outline-none focus:border-blue-400"
              placeholder="Add a durable fact about this client…"
            />
            <button
              type="button"
              onClick={handleAddContextNote}
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
          Notes about other channels mentioned during intake — parked for future use.
        </p>
        <textarea
          value={otherChannel}
          onChange={(e) => setOtherChannel(val(e))}
          rows={2}
          disabled={isReadOnly}
          className={fieldCls}
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

          {saveResult?.ok === true && confirmResult === null && (
            <p className="text-xs text-green-600">Draft saved.</p>
          )}
          {saveResult !== null && saveResult.ok === false && (
            <p className="text-xs text-red-600">{saveResult.message ?? 'Save failed.'}</p>
          )}
          {confirmResult !== null && confirmResult.ok === false && (
            <p className="text-xs text-red-600">{confirmResult.message ?? 'Confirm failed.'}</p>
          )}
        </div>
      )}
    </div>
  );
}
