'use client';

import React, { useState } from 'react';

/**
 * The guided intake capture surface (Build 3, Part C). Mobile-first overlay: the BASE + extra
 * questions as a guided form, free notes, a durable "remember for the future" field, and text
 * input always. Voice reuses the SAME transport as the agent route (source:'voice' + sessionId)
 * where a voice capture is wired — this surface is text-first and submits to POST /api/plan/intake.
 *
 * Pre-cutoff: the copy is "brief this month"; post-cutoff: it explains additions go to the plan
 * for approval (the route's classifier does the actual routing — this only sets expectations).
 */
export interface IntakeSubmitPayload {
  answers: Record<string, string>;
  freeNotes: string;
  durableItems: { type: 'idea' | 'next_cycle'; text: string }[];
}

export function IntakeCapture({ questions, prePlanning, busy, monthLabel, onSubmit, onClose }: {
  questions: string[];
  prePlanning: boolean;
  busy: boolean;
  monthLabel: string;
  onSubmit: (p: IntakeSubmitPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeNotes, setFreeNotes] = useState('');
  const [durableText, setDurableText] = useState('');

  const setAnswer = (q: string, v: string) => setAnswers((m) => ({ ...m, [q]: v }));
  const anyContent = Object.values(answers).some((v) => v.trim()) || freeNotes.trim() || durableText.trim();

  const submit = async () => {
    const durableItems = durableText.trim() ? [{ type: 'idea' as const, text: durableText.trim() }] : [];
    const ok = await onSubmit({ answers, freeNotes, durableItems });
    if (ok) { setAnswers({}); setFreeNotes(''); setDurableText(''); }
  };

  const field = 'w-full rounded-xl border border-line bg-surface p-3 text-[15px] leading-relaxed text-slate-700 outline-none focus:border-coral';

  return (
    <div data-testid="intake-overlay" onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(30,42,74,.32)] sm:items-center">
      <div data-testid="intake-panel" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-3xl bg-bg p-5 shadow-[0_-16px_44px_rgba(30,42,74,.18)] sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-[22px] text-coral">Brief {monthLabel}</h2>
          <button data-testid="intake-close" onClick={onClose} aria-label="Close" className="text-[15px] font-bold text-muted hover:text-slate-700">✕</button>
        </div>

        {prePlanning ? (
          <p className="mb-4 text-[13.5px] text-muted">Tell Sprigly what’s happening this month — anything you share shapes the plan. Nothing’s required; skip anything.</p>
        ) : (
          <p data-testid="intake-postcutoff-note" className="mb-4 rounded-xl bg-[#FFF3F0] p-3 text-[13.5px] text-coralDeep">
            This month has generated. Anything you add here goes to your plan as a suggestion to approve — it won’t rewrite what’s there.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {questions.map((q, i) => (
            <label key={i} className="flex flex-col gap-1.5">
              <span className="text-[13.5px] font-semibold text-slate-700">{q}</span>
              <textarea data-testid="intake-answer" rows={2} value={answers[q] ?? ''} onChange={(e) => setAnswer(q, e.target.value)} className={field} />
            </label>
          ))}

          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-semibold text-slate-700">Anything else for this month?</span>
            <textarea data-testid="intake-freenotes" rows={3} value={freeNotes} onChange={(e) => setFreeNotes(e.target.value)} className={field} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-semibold text-slate-700">Anything to remember for the future? <span className="font-normal text-faint">(kept across months)</span></span>
            <textarea data-testid="intake-durable" rows={2} value={durableText} onChange={(e) => setDurableText(e.target.value)} className={field} placeholder="Ideas, plans, things not tied to this month…" />
          </label>
        </div>

        <p className="mt-3 text-[11.5px] text-faint">You can type here anytime; voice notes go to the same place where available.</p>

        <div className="mt-4 flex items-center gap-2">
          <button data-testid="intake-submit" disabled={busy || !anyContent} onClick={submit}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-coral px-4 text-[15px] font-semibold text-white disabled:opacity-45">
            {busy ? 'Sending…' : 'Send to Sprigly'}
          </button>
          <button onClick={onClose} className="text-[14px] font-semibold text-muted hover:text-slate-700">Cancel</button>
        </div>
      </div>
    </div>
  );
}
