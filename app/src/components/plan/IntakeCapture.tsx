'use client';

import React, { useState } from 'react';
import type { PlanIntake, DurableItemView, ExtractedSummary, IntakeResult } from '@/lib/types';

/**
 * Intake capture (Prompt 2). The PRIMARY flow is one freeform box: the client types their whole
 * brief and Sprigly distributes it — into the structured brief (beats on the calendar) and back
 * across the base-question answer slots the generator + admin read. After Send, a feedback moment
 * shows "here's what we took" and invites correction by typing again (append + re-extract).
 *
 * The durable "anything to remember for the future?" input stays a SEPARATE small box — it writes
 * to plan_inputs (a different, cross-cycle lifecycle), so it is kept visually distinct.
 *
 * The old guided STEPPER is retained behind a secondary "guided prompts" link (one release; to be
 * deleted once the freeform flow has survived contact with real clients). The intake route, merge
 * semantics, extraction and beats pipeline are unchanged — this is a front-of-house redesign.
 */
export interface IntakeSubmitPayload {
  answers: Record<string, string>;
  freeNotes: string;
  durableItems: { type: 'idea' | 'next_cycle'; text: string }[];
}

/** Build the submit payload from the GUIDED stepper state (pure, testable). Only NON-EMPTY answers
 *  are sent, so a skipped/blank question is omitted — the additive server merge preserves any prior
 *  saved answer for that question. */
export function buildIntakePayload(questions: string[], answers: Record<string, string>, freeNotes: string, durableText: string): IntakeSubmitPayload {
  const trimmedAnswers: Record<string, string> = {};
  for (const q of questions) { const v = (answers[q] ?? '').trim(); if (v) trimmedAnswers[q] = v; }
  const durableItems = durableText.trim() ? [{ type: 'idea' as const, text: durableText.trim() }] : [];
  return { answers: trimmedAnswers, freeNotes: freeNotes.trim(), durableItems };
}

/** Build the FREEFORM submit payload: the whole brief goes in freeNotes; answers are left empty
 *  and populated server-side by distribution. */
function buildFreeformPayload(text: string, durableText: string): IntakeSubmitPayload {
  const durableItems = durableText.trim() ? [{ type: 'idea' as const, text: durableText.trim() }] : [];
  return { answers: {}, freeNotes: text.trim(), durableItems };
}

type Mode = 'compose' | 'feedback' | 'guided';
type Props = {
  questions: string[];
  prePlanning: boolean;
  busy: boolean;
  monthLabel: string;
  intake: PlanIntake;
  durable: DurableItemView[];
  onSubmit: (p: IntakeSubmitPayload) => Promise<IntakeResult>;
  onClose: () => void;
};

const FIELD = 'w-full rounded-xl border border-line bg-surface p-3 text-[15px] leading-relaxed text-slate-700 outline-none focus:border-coral';

/** Stable overlay + panel chrome (module-level so children never remount on the parent's renders). */
function IntakeChrome({ monthLabel, prePlanning, onClose, children }: {
  monthLabel: string; prePlanning: boolean; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div data-testid="intake-overlay" onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(51,65,85,.32)] sm:items-center">
      <div data-testid="intake-panel" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-[0_-16px_44px_rgba(51,65,85,.18)] sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12.5px] font-bold text-coral">Brief {monthLabel}</span>
          <button data-testid="intake-close" onClick={onClose} aria-label="Close" className="text-[15px] font-bold text-muted hover:text-slate-700">✕</button>
        </div>
        {!prePlanning && (
          <p data-testid="intake-postcutoff-note" className="mb-3 rounded-xl bg-coral-100 p-3 text-[13px] text-coral-800">
            This month has generated. Anything you add here goes to your plan as a suggestion to approve.
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

export function IntakeCapture(props: Props) {
  const { questions, prePlanning, busy, monthLabel, intake, durable, onSubmit, onClose } = props;
  const [mode, setMode] = useState<Mode>('compose');
  // The accumulated brief so far (read-only context on return); new text is added, never re-sent.
  const priorBrief = (intake.freeNotes ?? '').trim();
  const [text, setText] = useState('');
  const [durableText, setDurableText] = useState('');
  const [extracted, setExtracted] = useState<ExtractedSummary | null>(null);

  const send = async (payload: IntakeSubmitPayload) => {
    const r = await onSubmit(payload);
    if (!r.ok) return;
    // Post-cutoff routes to proposals (no brief extracted) — close on the flash message.
    if (r.mode !== 'brief_updated') { onClose(); return; }
    setExtracted(r.extracted ?? { launches: [], dates: [], asks: [] });
    setText('');
    setDurableText('');
    setMode('feedback');
  };

  const chrome = { monthLabel, prePlanning, onClose };

  if (mode === 'guided') {
    return <IntakeChrome {...chrome}><GuidedStepper {...props} onDone={(r) => {
      if (r.mode === 'brief_updated') { setExtracted(r.extracted ?? { launches: [], dates: [], asks: [] }); setMode('feedback'); }
      else onClose();
    }} onBack={() => setMode('compose')} /></IntakeChrome>;
  }

  if (mode === 'feedback' && extracted) {
    const empty = extracted.launches.length === 0 && extracted.dates.length === 0 && extracted.asks.length === 0;
    return (
      <IntakeChrome {...chrome}>
        <h2 className="mb-1 font-serif text-[22px] leading-snug text-slate-700">Here’s what we took from that</h2>
        {empty ? (
          <p data-testid="intake-feedback-empty" className="mb-3 text-[14px] leading-relaxed text-muted">
            Saved to your brief for this month — it’ll shape the plan even though there was nothing dated to place yet.
          </p>
        ) : (
          <div data-testid="intake-feedback" className="mb-3 mt-1 flex flex-col gap-3">
            {extracted.dates.length > 0 && (
              <Section title="On your calendar">
                {extracted.dates.map((d, i) => (
                  <li key={i} className="flex gap-2 text-[14px] text-slate-700"><span className="font-semibold text-coral-800">{d.when}</span><span className="text-muted">·</span><span className="capitalize">{d.label}</span></li>
                ))}
              </Section>
            )}
            {extracted.launches.length > 0 && (
              <Section title="Launches & restocks">{extracted.launches.map((l, i) => <li key={i} className="text-[14px] capitalize text-slate-700">{l}</li>)}</Section>
            )}
            {extracted.asks.length > 0 && (
              <Section title="Also noted">{extracted.asks.map((a, i) => <li key={i} className="text-[14px] capitalize text-slate-700">{a}</li>)}</Section>
            )}
          </div>
        )}
        <p className="mb-2 text-[13px] font-semibold text-muted">Missed something? Add it below — we’ll fold it in.</p>
        <textarea data-testid="intake-followup" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} className={FIELD}
          placeholder="e.g. also a restock of the linen shirt mid-month" />
        <div className="mt-4 flex items-center gap-2">
          <button data-testid="intake-done" onClick={onClose} className="text-[14px] font-semibold text-muted hover:text-slate-700">Done</button>
          <span className="flex-1" />
          <button data-testid="intake-addmore" disabled={busy || !text.trim()} onClick={() => void send(buildFreeformPayload(text, ''))}
            className="inline-flex h-11 items-center rounded-xl bg-coral px-5 text-[15px] font-semibold text-white disabled:opacity-45">
            {busy ? 'Folding in…' : 'Add to brief'}
          </button>
        </div>
      </IntakeChrome>
    );
  }

  // ── compose (primary freeform) ──────────────────────────────────────────────
  return (
    <IntakeChrome {...chrome}>
      <h2 className="mb-1 font-serif text-[22px] leading-snug text-slate-700">Tell us about {monthLabel}</h2>
      <p className="mb-3 text-[13.5px] leading-relaxed text-muted">
        Type it however it comes — launches, key dates, promotions, what to lean into, anything to avoid. Worth a mention:
      </p>
      <ul data-testid="intake-hints" className="mb-3 flex flex-col gap-0.5">
        {questions.map((q, i) => <li key={i} className="text-[12.5px] leading-snug text-faint">· {q}</li>)}
      </ul>

      {priorBrief && (
        <div data-testid="intake-sofar" className="mb-3 rounded-xl border border-line bg-line-soft p-3">
          <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.05em] text-muted">Your brief so far</div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">{priorBrief}</p>
        </div>
      )}

      <textarea data-testid="intake-freeform" autoFocus rows={priorBrief ? 4 : 7} value={text} onChange={(e) => setText(e.target.value)} className={FIELD}
        placeholder={priorBrief ? 'Add anything new for this month…' : `Tell us about ${monthLabel}…`} />

      <div className="mt-4">
        <label className="mb-1 block text-[13px] font-semibold text-slate-700">Anything to remember for the future?</label>
        <p className="mb-1.5 text-[12px] text-muted">Ideas or plans not tied to this month — kept across months.</p>
        <textarea data-testid="intake-durable" rows={2} value={durableText} onChange={(e) => setDurableText(e.target.value)} className={FIELD}
          placeholder="e.g. relaunch the Connie range in the autumn" />
        {durable.length > 0 && (
          <ul data-testid="durable-list" className="mt-2 flex flex-col gap-1">
            {durable.map((d) => <li key={d.id} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-slate-600">{d.content}</li>)}
          </ul>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button data-testid="intake-guided-link" onClick={() => setMode('guided')} className="text-[13px] font-semibold text-muted underline decoration-line underline-offset-2 hover:text-slate-700">
          Prefer step-by-step prompts?
        </button>
        <span className="flex-1" />
        <button data-testid="intake-submit" disabled={busy || (!text.trim() && !durableText.trim())} onClick={() => void send(buildFreeformPayload(text, durableText))}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-coral px-5 text-[15px] font-semibold text-white disabled:opacity-45">
          {busy ? 'Sending…' : 'Send to Sprigly'}
        </button>
      </div>
    </IntakeChrome>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.05em] text-muted">{title}</div>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

// ── Guided stepper (secondary "guided prompts" mode; retained one release) ─────
function GuidedStepper({ questions, prePlanning, busy, intake, durable, onSubmit, onDone, onBack }: Props & {
  onDone: (r: IntakeResult) => void; onBack: () => void;
}) {
  const Q = questions.length;
  const FREE = Q, DURABLE = Q + 1, REVIEW = Q + 2;
  const inputSteps = Q + 2;
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...intake.answers }));
  const [freeNotes, setFreeNotes] = useState(intake.freeNotes ?? '');
  const [durableText, setDurableText] = useState('');
  const [step, setStep] = useState(0);

  const setAnswer = (q: string, v: string) => setAnswers((m) => ({ ...m, [q]: v }));
  const next = () => setStep((s) => Math.min(REVIEW, s + 1));
  const back = () => (step === 0 ? onBack() : setStep((s) => Math.max(0, s - 1)));
  const skip = () => {
    if (step < Q) setAnswer(questions[step]!, '');
    else if (step === FREE) setFreeNotes('');
    else if (step === DURABLE) setDurableText('');
    next();
  };
  const submit = async () => { onDone(await onSubmit(buildIntakePayload(questions, answers, freeNotes, durableText))); };

  const heading = step < Q ? questions[step]! : step === FREE ? 'Anything else for this month?' : step === DURABLE ? 'Anything to remember for the future?' : 'Review your brief';

  return (
    <>
      {step !== REVIEW && (
        <div className="mb-3" data-testid="intake-progress">
          <div className="mb-1 text-[11.5px] font-semibold text-faint">Step {step + 1} of {inputSteps}</div>
          <div className="h-1 w-full rounded-full bg-line"><div className="h-1 rounded-full bg-coral transition-all" style={{ width: `${((step + 1) / inputSteps) * 100}%` }} /></div>
        </div>
      )}
      <h2 className="mb-3 font-serif text-[20px] leading-snug text-slate-700">{heading}</h2>

      {step < Q && (
        <textarea data-testid="intake-answer" autoFocus rows={4} value={answers[questions[step]!] ?? ''} onChange={(e) => setAnswer(questions[step]!, e.target.value)} className={FIELD} />
      )}
      {step === FREE && (
        <textarea data-testid="intake-freenotes" autoFocus rows={5} value={freeNotes} onChange={(e) => setFreeNotes(e.target.value)} className={FIELD} placeholder="Anything at all — we'll weave it in." />
      )}
      {step === DURABLE && (
        <>
          <textarea data-testid="intake-durable" autoFocus rows={3} value={durableText} onChange={(e) => setDurableText(e.target.value)} className={FIELD} placeholder="Ideas or plans not tied to this month — kept across months." />
          {durable.length > 0 && (
            <div className="mt-3" data-testid="durable-list">
              <div className="mb-1 text-[12px] font-semibold text-muted">Remembered for the future</div>
              <ul className="flex flex-col gap-1">
                {durable.map((d) => <li key={d.id} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-slate-600">{d.content}</li>)}
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
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button data-testid="intake-back" onClick={back} className="text-[14px] font-semibold text-muted hover:text-slate-700">{step === 0 ? 'Freeform' : 'Back'}</button>
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
    </>
  );
}
