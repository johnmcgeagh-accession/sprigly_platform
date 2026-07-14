'use client';

import React, { useState } from 'react';
import type { PlanIntake, DurableItemView } from '@/lib/types';

/**
 * The guided intake capture STEPPER (Build 5, FIX 4). Mobile-first, one question per screen:
 * the 5 BASE + extra questions, then "Anything else?" (freeNotes), then "Anything to remember?"
 * (durable, with the read-only remembered list beneath, FIX 1), then a REVIEW screen (every
 * answer, tappable to edit) with the single Send. Submission is ONE POST at review — no per-step
 * server writes. Pre-fill (FIX 1) applies per step from the cycle's saved intake; returning
 * users start at step 1 with their saved answers visible (review shows everything at once).
 * In-progress answers live in client state so an accidental dismissal doesn't lose typing.
 */
export interface IntakeSubmitPayload {
  answers: Record<string, string>;
  freeNotes: string;
  durableItems: { type: 'idea' | 'next_cycle'; text: string }[];
}

/** Build the submit payload from stepper state (pure, testable). Only NON-EMPTY answers are
 *  sent, so a skipped/blank question is omitted — and the additive server merge then preserves
 *  any prior saved answer for that question. */
export function buildIntakePayload(questions: string[], answers: Record<string, string>, freeNotes: string, durableText: string): IntakeSubmitPayload {
  const trimmedAnswers: Record<string, string> = {};
  for (const q of questions) { const v = (answers[q] ?? '').trim(); if (v) trimmedAnswers[q] = v; }
  const durableItems = durableText.trim() ? [{ type: 'idea' as const, text: durableText.trim() }] : [];
  return { answers: trimmedAnswers, freeNotes: freeNotes.trim(), durableItems };
}

export function IntakeCapture({ questions, prePlanning, busy, monthLabel, intake, durable, onSubmit, onClose }: {
  questions: string[];
  prePlanning: boolean;
  busy: boolean;
  monthLabel: string;
  intake: PlanIntake;
  durable: DurableItemView[];
  onSubmit: (p: IntakeSubmitPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const Q = questions.length;
  const FREE = Q, DURABLE = Q + 1, REVIEW = Q + 2;   // step indices
  const inputSteps = Q + 2;                           // questions + freeNotes + durable (review is the finale)

  // Pre-filled state (FIX 1) — lives in client state through the whole session.
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...intake.answers }));
  const [freeNotes, setFreeNotes] = useState(intake.freeNotes ?? '');
  const [durableText, setDurableText] = useState('');
  const [step, setStep] = useState(0);

  const setAnswer = (q: string, v: string) => setAnswers((m) => ({ ...m, [q]: v }));
  const next = () => setStep((s) => Math.min(REVIEW, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const skip = () => {
    if (step < Q) setAnswer(questions[step]!, '');   // no answer for this step (prior save preserved by the additive merge)
    else if (step === FREE) setFreeNotes('');
    else if (step === DURABLE) setDurableText('');
    next();
  };

  const submit = async () => { await onSubmit(buildIntakePayload(questions, answers, freeNotes, durableText)); };

  const field = 'w-full rounded-xl border border-line bg-surface p-3 text-[15px] leading-relaxed text-slate-700 outline-none focus:border-coral';
  const heading = step < Q ? questions[step]! : step === FREE ? 'Anything else for this month?' : step === DURABLE ? 'Anything to remember for the future?' : `Review your brief`;

  return (
    <div data-testid="intake-overlay" onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(30,42,74,.32)] sm:items-center">
      <div data-testid="intake-panel" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-[0_-16px_44px_rgba(30,42,74,.18)] sm:rounded-3xl">

        {/* header + progress */}
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12.5px] font-bold text-coral">Brief {monthLabel}</span>
          <button data-testid="intake-close" onClick={onClose} aria-label="Close" className="text-[15px] font-bold text-muted hover:text-slate-700">✕</button>
        </div>
        {step !== REVIEW && (
          <div className="mb-3" data-testid="intake-progress">
            <div className="mb-1 text-[11.5px] font-semibold text-faint">Step {step + 1} of {inputSteps}</div>
            <div className="h-1 w-full rounded-full bg-line"><div className="h-1 rounded-full bg-coral transition-all" style={{ width: `${((step + 1) / inputSteps) * 100}%` }} /></div>
          </div>
        )}

        {!prePlanning && step === 0 && (
          <p data-testid="intake-postcutoff-note" className="mb-3 rounded-xl bg-coral-100 p-3 text-[13px] text-coral-800">
            This month has generated. Anything you add here goes to your plan as a suggestion to approve.
          </p>
        )}

        <h2 className="mb-3 font-serif text-[20px] leading-snug text-slate-700">{heading}</h2>

        {/* ── body per step ── */}
        {step < Q && (
          <textarea data-testid="intake-answer" autoFocus rows={4} value={answers[questions[step]!] ?? ''} onChange={(e) => setAnswer(questions[step]!, e.target.value)} className={field} />
        )}
        {step === FREE && (
          <textarea data-testid="intake-freenotes" autoFocus rows={5} value={freeNotes} onChange={(e) => setFreeNotes(e.target.value)} className={field} placeholder="Anything at all — we'll weave it in." />
        )}
        {step === DURABLE && (
          <>
            <textarea data-testid="intake-durable" autoFocus rows={3} value={durableText} onChange={(e) => setDurableText(e.target.value)} className={field} placeholder="Ideas or plans not tied to this month — kept across months." />
            {durable.length > 0 && (
              <div className="mt-3" data-testid="durable-list">
                <div className="mb-1 text-[12px] font-semibold text-muted">Remembered for the future</div>
                <ul className="flex flex-col gap-1">
                  {durable.map((d) => (
                    <li key={d.id} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-slate-600">{d.content}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {step === REVIEW && (
          <div className="flex flex-col gap-2" data-testid="intake-review">
            {questions.map((q, i) => (
              <button key={i} data-testid="review-row" onClick={() => setStep(i)} className="rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-coral">
                <div className="text-[12px] font-semibold text-muted">{q}</div>
                <div className={`text-[14px] ${answers[q]?.trim() ? 'text-slate-700' : 'italic text-faint'}`}>{answers[q]?.trim() || 'Skipped'}</div>
              </button>
            ))}
            <button data-testid="review-row" onClick={() => setStep(FREE)} className="rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-coral">
              <div className="text-[12px] font-semibold text-muted">Anything else for this month?</div>
              <div className={`text-[14px] ${freeNotes.trim() ? 'text-slate-700' : 'italic text-faint'}`}>{freeNotes.trim() || 'Skipped'}</div>
            </button>
            <button data-testid="review-row" onClick={() => setStep(DURABLE)} className="rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-coral">
              <div className="text-[12px] font-semibold text-muted">To remember for the future</div>
              <div className={`text-[14px] ${durableText.trim() ? 'text-slate-700' : 'italic text-faint'}`}>{durableText.trim() || (prePlanning ? '—' : '—')}</div>
            </button>
          </div>
        )}

        {/* ── actions ── */}
        <div className="mt-4 flex items-center gap-2">
          {step > 0 && <button data-testid="intake-back" onClick={back} className="text-[14px] font-semibold text-muted hover:text-slate-700">Back</button>}
          <span className="flex-1" />
          {step !== REVIEW ? (
            <>
              <button data-testid="intake-skip" onClick={skip} className="text-[14px] font-semibold text-muted hover:text-slate-700">Skip</button>
              <button data-testid="intake-next" onClick={next} className="inline-flex h-10 items-center rounded-xl bg-coral px-4 text-[15px] font-semibold text-white">
                {step === DURABLE ? 'Review' : 'Next'}
              </button>
            </>
          ) : (
            <button data-testid="intake-submit" disabled={busy} onClick={submit} className="inline-flex h-11 items-center gap-2 rounded-xl bg-coral px-5 text-[15px] font-semibold text-white disabled:opacity-45">
              {busy ? 'Sending…' : 'Send to Sprigly'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
