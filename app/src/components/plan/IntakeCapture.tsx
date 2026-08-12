'use client';

import React, { useState } from 'react';
import type { PlanIntake, DurableItemView, ExtractedSummary, IntakeResult } from '@/lib/types';
import type { BriefPreview } from '@sprigly/engine';   // type-only — erased at build
import { useLivePreview } from './useLivePreview';
import { useSpeechInput } from './useSpeechInput';
import { MicIcon } from './icons';

/**
 * Planning workspace (Phase 1). A wide two-column surface over the calendar: LEFT is one
 * conversational input (type or speak), RIGHT is a live preview that mirrors the brief as it's
 * typed — a cheap Haiku pass (never writes the DB). "Create Content Calendar" runs the unchanged
 * commit path (freeNotes merge → Sonnet extraction → answers distribution → beats), and the live
 * panel reconciles into the confirmed summary. Memory surfaces only via the single follow-up
 * (which may connect a durable) and a "· from <month>" provenance tag on durable-sourced items —
 * there is no memory card. The guided stepper is kept behind the (?) popover.
 */
export interface IntakeSubmitPayload {
  answers: Record<string, string>;
  freeNotes: string;
  durableItems: { type: 'idea' | 'next_cycle'; text: string }[];
}

/** Guided-stepper payload (pure/testable): only NON-EMPTY answers are sent; the server merge
 *  preserves prior saves for skipped questions. */
export function buildIntakePayload(questions: string[], answers: Record<string, string>, freeNotes: string, durableText: string): IntakeSubmitPayload {
  const trimmedAnswers: Record<string, string> = {};
  for (const q of questions) { const v = (answers[q] ?? '').trim(); if (v) trimmedAnswers[q] = v; }
  const durableItems = durableText.trim() ? [{ type: 'idea' as const, text: durableText.trim() }] : [];
  return { answers: trimmedAnswers, freeNotes: freeNotes.trim(), durableItems };
}

/** Freeform/workspace payload: the whole brief is freeNotes; answers are distributed server-side. */
function buildFreeformPayload(text: string, durableText: string): IntakeSubmitPayload {
  const durableItems = durableText.trim() ? [{ type: 'idea' as const, text: durableText.trim() }] : [];
  return { answers: {}, freeNotes: text.trim(), durableItems };
}

const PLACEHOLDER = [
  'Big launch on the 25th — build up to it all week',
  'A sale the last weekend of the month',
  'Lean into the story behind how it’s made',
  'Quieter start, then push hard from mid-month',
].join('\n');

const FIELD = 'w-full rounded-xl border border-line bg-surface p-3 text-[15px] leading-relaxed text-slate-700 outline-none focus:border-coral';

type Mode = 'workspace' | 'guided';
type Props = {
  questions: string[];
  /** The cycle on screen. Sent with the live preview so the SERVER can resolve which month this
   *  brief is for — the same fact `monthLabel` renders, derived once rather than twice. */
  cycleId: string;
  prePlanning: boolean;
  busy: boolean;
  monthLabel: string;
  intake: PlanIntake;
  /**
   * What the last extraction took from the SAVED brief, or null when nothing is stored.
   *
   * This is the preview panel's cold-start source. `live.preview` only ever exists because the
   * client is typing right now, so on a reload the panel had nothing to say and said the
   * empty-state line — "As you type, I'll gather it here" — over a month we had already read,
   * extracted and turned into beats. That sentence, next to a composer that also looked empty,
   * is the whole reason a returning client concluded their brief had been lost.
   */
  savedExtraction: ExtractedSummary | null;
  durable: DurableItemView[];
  cutoffLabel: string | null;   // e.g. "18 July" — the auto-run date; null → neutral confirmation
  onSubmit: (p: IntakeSubmitPayload) => Promise<IntakeResult>;
  onClose: () => void;
};

/**
 * Stable overlay + panel chrome (module-level so children never remount on the parent's renders).
 *
 * ── THE HEADING IS OUTSIDE THE SCROLLER, AND THAT IS THE WHOLE FIX ───────────────────
 *
 * Reported from iOS Safari: the sheet opens past its own heading — "Let's plan September 2026
 * together" not visible, the subhead clipped mid-line — and scrolling UP reveals it. That it is
 * reachable by scrolling is what identifies the fault: the content is laid out correctly and
 * the container is simply scrolled, which is a different thing from the shell's fault in
 * `a733137` (laid out below the visible area, not reachable at all).
 *
 * WHAT DID NOT CAUSE IT. The obvious reading is the composer's `autoFocus` dragging itself into
 * view and taking the heading with it. Measured in WebKit at 390×659, 390×560 and 390×480: the
 * panel reports `scrollTop: 0` in every case with the textarea focused — including 390×480,
 * where the textarea's bottom edge is 68px past the panel's. WebKit does not scroll an ancestor
 * for a focused element whose top is already in view, so the focus never moves this panel.
 * Removing the focus would have cost the client the thing they came to do and fixed nothing.
 *
 * WHAT DOES. The software keyboard, which no headless run has. On the device `autoFocus` opens
 * it, iOS shrinks the VISUAL viewport by roughly 300px, and the UA then scrolls the caret back
 * into what is left — through the nearest scrollable ancestor, which was this panel. The heading
 * is 65px at the top of it and is what gets spent. That is why this class keeps being reported
 * from a phone and keeps not reproducing in the suite.
 *
 * So the fix does not argue with the scroll. The heading LEAVES the scroller: the panel is now a
 * flex column that clips, holding a `flex-none` header and a scrolling body, and nothing that
 * scrolls the body — the keyboard, a focus, a thumb — can reach the heading at all. It holds
 * without knowing which of them did it.
 *
 * `flex-none` on the header is load-bearing for the reason `030d11e` records for its spacer: in
 * a flex column a bare div is `flex-shrink: 1`, so the header would be the first thing squeezed
 * out and this would be the same bug by another route. `min-h-0` on the body is the other half —
 * a flex item's `min-height: auto` refuses to shrink below its content, so without it the body
 * would grow past the panel and the panel's `overflow-hidden` would CLIP it, which is worse than
 * what was reported: unreachable rather than merely scrolled past.
 *
 * The body is a BLOCK scroller, deliberately — not `flex flex-col`. Per `030d11e`'s measured
 * table, WebKit will not let a flex-column scroller's end padding create overflow, so `pb-5`
 * here only works because this is a block. Adding `flex` to it reopens that.
 *
 * ── AND THE PANEL IS THE SMALL VIEWPORT ──────────────────────────────────────────────
 *
 * `max-h-[94vh]` was the last `vh` left on a mobile surface. On iOS `vh` is the LARGE viewport —
 * the height with the toolbar minimised — so on an iPhone 13 with the toolbar drawn this asked
 * for a 793px sheet inside a 659px visible strip, and the bottom ~185px of it (which is where
 * "Save brief" lives) sat below what the client can see. `svh` is the height with chrome at its
 * largest and is never behind it; the reasoning is written out in full on `PlanShell`, and the
 * ruling there applies to any element sized against the phone's viewport, not only that one.
 *
 * Stated honestly: this is a correctness fix on its own terms, NOT a proven contributor to the
 * reported symptom. It cannot hide the heading — `items-end` anchors the sheet's bottom, so a
 * wrong max-height spends the bottom of the sheet, not the top. It is fixed here because it is
 * the same mistake in the same file, and finding it twice is how it stays found.
 */
function IntakeChrome({ wide, header, onClose, children }: {
  wide?: boolean;
  /** Rendered ABOVE the scroller and outside it. Anything here is always on screen. */
  header?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div data-testid="intake-overlay" onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(51,65,85,.32)] p-0 sm:items-center sm:p-4">
      <div data-testid="intake-panel" onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[94svh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-[0_-16px_44px_rgba(51,65,85,.18)] sm:rounded-3xl ${wide ? 'max-w-[900px]' : 'max-w-[560px]'}`}>
        {header && (
          <div data-testid="intake-header" className="flex-none px-5 pt-5 sm:px-7 sm:pt-7">{header}</div>
        )}
        <div data-testid="intake-body"
          className={`min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-7 sm:pb-7 ${header ? '' : 'pt-5 sm:pt-7'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function IntakeCapture(props: Props) {
  const { questions, cycleId, prePlanning, busy, monthLabel, intake, savedExtraction, durable, cutoffLabel, onSubmit, onClose } = props;
  const [mode, setMode] = useState<Mode>('workspace');
  /**
   * SEEDED WITH THE SAVED BRIEF, and that is the whole of the reload fix.
   *
   * `intake.freeNotes` has always arrived here — page.tsx reads intake_json, GET /api/plan
   * re-reads it on every month switch, and `PlanRoot` passes it in. This composer was the one
   * thing that ignored it, so a client who saved a brief and came back was shown an empty box
   * over a populated column and had no reason to believe anything had been kept.
   *
   * What they did next is why this is a data-integrity fault rather than a cosmetic one: they
   * retyped the month. The pre-cutoff merge APPENDS, so the second telling did not replace the
   * first — it doubled it, and the extractor was handed the same September twice.
   *
   * A lazy initialiser, not an effect: the sheet is conditionally mounted (`data.intakeOpen &&`)
   * so it gets a fresh mount each time it opens, and the seed is read once at that mount. An
   * effect syncing `intake` → `text` would fight the client's caret every time `refreshPlan`
   * returned a new object for the same brief.
   *
   * An EMPTY brief still seeds to '', so a first-time client sees the placeholder examples
   * exactly as before — the empty state is unchanged, not special-cased.
   */
  const [text, setText] = useState(intake.freeNotes ?? '');
  const [durableText, setDurableText] = useState('');
  const [confirmed, setConfirmed] = useState<ExtractedSummary | null>(null);
  const [committedOnce, setCommittedOnce] = useState(false);
  const [dismissedFollowUp, setDismissedFollowUp] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);

  const live = useLivePreview(cycleId);
  const speech = useSpeechInput((chunk) => onType((t) => (t ? `${t} ${chunk}` : chunk)));

  // Typing (or a transcript chunk) updates the input, reverts any confirmed state back to live,
  // and re-arms the debounced preview.
  const onType = (next: string | ((t: string) => string)) => {
    setText((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      live.schedule(v);
      return v;
    });
    if (confirmed) setConfirmed(null);
  };

  const create = async () => {
    const r = await onSubmit(buildFreeformPayload(text, durableText));
    if (!r.ok) return;
    if (r.mode !== 'brief_updated') { onClose(); return; }   // post-cutoff routed to proposals
    setConfirmed(r.extracted ?? { launches: [], dates: [], asks: [] });
    setCommittedOnce(true);
    setText(''); setDurableText('');
  };

  if (mode === 'guided') {
    return <IntakeChrome onClose={onClose}>
      <GuidedStepper {...props} onDone={(r) => {
        if (r.mode === 'brief_updated') { setConfirmed(r.extracted ?? { launches: [], dates: [], asks: [] }); setCommittedOnce(true); setMode('workspace'); }
        else onClose();
      }} onBack={() => setMode('workspace')} />
    </IntakeChrome>;
  }

  const priorBrief = (intake.freeNotes ?? '').trim();
  const followUp = live.preview?.followUp && live.preview.followUp !== dismissedFollowUp ? live.preview.followUp : null;
  // Post-save confirmation: a real cutoff date when the client has one, else the neutral copy.
  const savedMsg = cutoffLabel
    ? `Saved — your content calendar will be created on ${cutoffLabel}. Add or adjust anything until then; after that, changes go to your plan for approval.`
    : 'Saved — we’ll build your month from this.';
  /**
   * THE RECEIPT for a brief saved in an EARLIER session.
   *
   * It replaces "Continuing your {month} brief — add anything new below.", which was written for
   * a composer that opened empty and read, beside one, as incidental grey chrome. The client's
   * question on returning is not "am I continuing?" — it is "did that save?", and the old line
   * never answered it. Answering it in the first word is the whole job.
   *
   * Same register as the refusal copy (lib/refusals.ts): state what happened to their words,
   * then what to do, then what happens next. No thanks, no exclamation, nothing that sounds
   * like reassurance in place of information.
   *
   * "below" is load-bearing and only true because of the seed — the brief IS in the box under
   * this line now. If the seed is ever reverted, this sentence becomes a lie.
   */
  const briefReceipt = cutoffLabel
    ? `Saved. Your ${monthLabel} brief is below — edit it or add to it, then save again. We’ll build the month from it on ${cutoffLabel}.`
    : `Saved. Your ${monthLabel} brief is below — edit it or add to it, then save again. We’ll build the month from it.`;

  return (
    <IntakeChrome wide onClose={onClose} header={
      // The title, the subhead and the two controls. All four are things the client must be
      // able to see at any scroll position — the heading because it names the MONTH they are
      // briefing, and ✕ because a sheet whose close button can scroll away is a trap.
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[26px] leading-tight text-slate-700">Let’s plan {monthLabel} together</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">Tell me what’s happening this month. Type naturally or speak aloud — I’ll organise it as we go.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button data-testid="intake-hints-toggle" onClick={() => setShowHints((s) => !s)} aria-label="Prompts and options"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-line text-[14px] font-bold text-muted hover:border-coral hover:text-coral">?</button>
          <button data-testid="intake-close" onClick={onClose} aria-label="Close" className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[16px] font-bold text-muted hover:text-slate-700">✕</button>
        </div>
      </div>
    }>
      {committedOnce && prePlanning && (
        <p data-testid="intake-saved-note" className="mb-4 rounded-xl bg-coral-100 px-3.5 py-3 text-[13.5px] leading-relaxed text-coral-800">{savedMsg}</p>
      )}

      {!prePlanning && (
        <p data-testid="intake-postcutoff-note" className="mb-4 rounded-xl bg-coral-100 p-3 text-[13px] text-coral-800">
          This month has generated. Anything you add here goes to your plan as a suggestion to approve.
        </p>
      )}

      {showHints && (
        <div data-testid="intake-hints" className="mb-4 rounded-xl border border-line bg-line-soft p-3.5">
          <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[.05em] text-muted">Not sure where to start? Things worth a mention</div>
          <ul className="mb-2 flex flex-col gap-0.5">{questions.map((q, i) => <li key={i} className="text-[12.5px] leading-snug text-slate-600">· {q}</li>)}</ul>
          <button data-testid="intake-guided-link" onClick={() => setMode('guided')} className="text-[12.5px] font-semibold text-coral underline decoration-line underline-offset-2">Prefer step-by-step prompts?</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
        {/* LEFT — the one input */}
        <div className="flex flex-col">
          {committedOnce && priorBrief === '' ? null : priorBrief && (
            <div data-testid="intake-brief-receipt" className="mb-2 text-[12.5px] text-muted">{briefReceipt}</div>
          )}
          <textarea data-testid="intake-input" autoFocus rows={9} value={text}
            onChange={(e) => onType(e.target.value)} className={`${FIELD} min-h-[220px] resize-none`}
            placeholder={PLACEHOLDER} />

          <div className="mt-2.5 flex items-center gap-3">
            {speech.state !== 'unsupported' ? (
              <button data-testid="intake-mic" onClick={speech.toggle}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] font-semibold transition ${speech.state === 'recording' ? 'border-coral bg-coral-100 text-coral-800 pr-pulse' : 'border-line text-muted hover:border-coral hover:text-coral'}`}>
                <MicIcon className="h-[15px] w-[15px]" />
                {speech.state === 'recording' ? 'Listening… tap to stop' : 'Talk through the month'}
              </button>
            ) : (
              <span data-testid="intake-mic-unsupported" className="text-[12.5px] text-faint">Voice input isn’t supported in this browser — type instead.</span>
            )}
            {speech.state === 'no-permission' && <span className="text-[12.5px] text-danger">Mic access is blocked — type instead.</span>}
            {live.loading && <span className="text-[12px] text-faint">organising…</span>}
          </div>

          {followUp && (
            <div data-testid="intake-followup" className="mt-3 flex items-start gap-2 rounded-xl border border-coral-100 bg-coral-100/40 px-3 py-2.5">
              <span className="mt-0.5 flex-1 text-[13.5px] leading-snug text-slate-700">{followUp}</span>
              <button data-testid="intake-followup-dismiss" onClick={() => setDismissedFollowUp(followUp)} aria-label="Dismiss" className="flex-none text-[13px] font-bold text-muted hover:text-slate-700">✕</button>
            </div>
          )}

          <div className="mt-5">
            <label className="mb-1 block text-[13px] font-semibold text-slate-700">Not this month?</label>
            <p className="mb-1.5 text-[12px] text-muted">Anything worth remembering for a future campaign — kept across months.</p>
            <textarea data-testid="intake-durable" rows={2} value={durableText} onChange={(e) => setDurableText(e.target.value)} className={FIELD}
              placeholder="e.g. an idea to revisit in a future campaign" />
          </div>

          <div className="mt-5 flex items-center gap-2">
            <span className="flex-1 text-[12px] text-faint">{committedOnce ? 'Folded into your plan. Keep typing to add more.' : 'You can always change this later.'}</span>
            <button data-testid="intake-create" disabled={busy} onClick={() => void create()}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-coral px-5 text-[15px] font-semibold text-white disabled:opacity-45">
              {busy ? 'Saving…' : !prePlanning ? 'Send to Sprigly' : committedOnce ? 'Add to brief' : 'Save brief'}
            </button>
          </div>
        </div>

        {/* RIGHT — live preview / confirmed summary / the saved brief's own reading */}
        <PreviewPanel preview={confirmed ? null : live.preview} confirmed={confirmed} saved={savedExtraction} prePlanning={prePlanning} />
      </div>
    </IntakeChrome>
  );
}

// ── Right column: live preview → confirmed summary → the saved brief ──────────
/**
 * THREE sources, in priority order, and the order is the argument.
 *
 *   `confirmed` — this session just saved. The freshest thing that exists; it also carries the
 *                 post-cutoff "sent for approval" framing, so it must outrank the rest.
 *   `preview`   — the client is typing NOW. Live and unsaved, and more current than any stored
 *                 reading of an earlier brief.
 *   `saved`     — nothing is happening in this session, so what we hold is what we last read
 *                 from the stored brief. This is the case a reload lands in.
 *
 * `saved` is last because it is the oldest, and present at all because without it the panel
 * asserted — to a client whose September was already extracted into beats — that it had heard
 * nothing. It is a projection of a persisted `structured_brief` (brief-summary.ts): no model
 * call happens on mount, and none should be added here.
 */
function PreviewPanel({ preview, confirmed, saved, prePlanning }: { preview: BriefPreview | null; confirmed: ExtractedSummary | null; saved: ExtractedSummary | null; prePlanning: boolean }) {
  if (confirmed) {
    const empty = confirmed.launches.length === 0 && confirmed.dates.length === 0 && confirmed.asks.length === 0;
    return (
      <aside data-testid="intake-confirmed" className="rounded-2xl border border-line bg-line-soft p-4">
        <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-coral-800">{prePlanning ? 'On your calendar' : 'Sent for approval'}</div>
        {empty ? (
          <p className="text-[13px] leading-relaxed text-muted">Saved — we’ll build a baseline plan you can shape.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {confirmed.dates.length > 0 && <PGroup title="Dates">{confirmed.dates.map((d, i) => <PLine key={i} left={d.when} text={d.label} />)}</PGroup>}
            {confirmed.launches.length > 0 && <PGroup title="Launches & restocks">{confirmed.launches.map((l, i) => <PLine key={i} text={l} />)}</PGroup>}
            {confirmed.asks.length > 0 && <PGroup title="Also noted">{confirmed.asks.map((a, i) => <PLine key={i} text={a} />)}</PGroup>}
          </div>
        )}
      </aside>
    );
  }

  const has = preview && (preview.campaigns.length || preview.themes.length || preview.products.length || preview.dates.length || preview.availability.length || preview.ideas.length);

  // Nothing live, but a brief IS on file: show what we took from it. Headed in the past tense —
  // this is a record of a completed reading, not a running one, and the difference is the whole
  // reassurance the panel is here to give.
  if (!has && saved) {
    return (
      <aside data-testid="intake-saved-extraction" className="rounded-2xl border border-line bg-line-soft p-4">
        <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-coral-800">From your saved brief</div>
        <div className="flex flex-col gap-3">
          {saved.dates.length > 0 && <PGroup title="Dates">{saved.dates.map((d, i) => <PLine key={i} left={d.when} text={d.label} />)}</PGroup>}
          {saved.launches.length > 0 && <PGroup title="Launches & restocks">{saved.launches.map((l, i) => <PLine key={i} text={l} />)}</PGroup>}
          {saved.asks.length > 0 && <PGroup title="Also noted">{saved.asks.map((a, i) => <PLine key={i} text={a} />)}</PGroup>}
        </div>
      </aside>
    );
  }

  return (
    <aside data-testid="intake-preview" className="rounded-2xl border border-line bg-line-soft p-4">
      <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">What I’m hearing</div>
      {!has ? (
        <p className="text-[13px] leading-relaxed text-faint">As you type, I’ll gather it here — campaigns, dates, products, ideas.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {preview!.campaigns.length > 0 && <PGroup title="Campaigns">{preview!.campaigns.map((it, i) => <PLine key={i} text={it.text} from={it.from} />)}</PGroup>}
          {preview!.dates.length > 0 && <PGroup title="Key dates">{preview!.dates.map((d, i) => <PLine key={i} left={d.when} text={d.what} from={d.from} />)}</PGroup>}
          {preview!.products.length > 0 && <PGroup title="Products">{preview!.products.map((it, i) => <PLine key={i} text={it.text} from={it.from} />)}</PGroup>}
          {preview!.themes.length > 0 && <PGroup title="Themes">{preview!.themes.map((it, i) => <PLine key={i} text={it.text} from={it.from} />)}</PGroup>}
          {preview!.availability.length > 0 && <PGroup title="Availability">{preview!.availability.map((it, i) => <PLine key={i} text={it.text} from={it.from} />)}</PGroup>}
          {preview!.ideas.length > 0 && <PGroup title="Ideas">{preview!.ideas.map((it, i) => <PLine key={i} text={it.text} from={it.from} />)}</PGroup>}
        </div>
      )}
    </aside>
  );
}

function PGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted">{title}</div>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}
function PLine({ text, left, from }: { text: string; left?: string; from?: string | null | undefined }) {
  return (
    <li className="pr-item-in flex gap-1.5 text-[13.5px] leading-snug text-slate-700">
      {left && <span className="font-semibold text-coral-800">{left}</span>}
      <span className="capitalize">{text}</span>
      {from && <span className="text-[11.5px] font-normal text-faint">· from {from}</span>}
    </li>
  );
}

// ── Guided stepper (secondary, behind the (?) popover; retained one release) ───
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
  const skip = () => { if (step < Q) setAnswer(questions[step]!, ''); else if (step === FREE) setFreeNotes(''); else if (step === DURABLE) setDurableText(''); next(); };
  const submit = async () => { onDone(await onSubmit(buildIntakePayload(questions, answers, freeNotes, durableText))); };
  const heading = step < Q ? questions[step]! : step === FREE ? 'Anything else for this month?' : step === DURABLE ? 'Anything to remember for the future?' : 'Review your brief';

  return (
    <>
      {!prePlanning && (
        <p data-testid="intake-postcutoff-note" className="mb-3 rounded-xl bg-coral-100 p-3 text-[13px] text-coral-800">This month has generated. Anything you add here goes to your plan as a suggestion to approve.</p>
      )}
      {step !== REVIEW && (
        <div className="mb-3" data-testid="intake-progress">
          <div className="mb-1 text-[11.5px] font-semibold text-faint">Step {step + 1} of {inputSteps}</div>
          <div className="h-1 w-full rounded-full bg-line"><div className="h-1 rounded-full bg-coral transition-all" style={{ width: `${((step + 1) / inputSteps) * 100}%` }} /></div>
        </div>
      )}
      <h2 className="mb-3 font-serif text-[20px] leading-snug text-slate-700">{heading}</h2>
      {step < Q && <textarea data-testid="intake-answer" autoFocus rows={4} value={answers[questions[step]!] ?? ''} onChange={(e) => setAnswer(questions[step]!, e.target.value)} className={FIELD} />}
      {step === FREE && <textarea data-testid="intake-freenotes" autoFocus rows={5} value={freeNotes} onChange={(e) => setFreeNotes(e.target.value)} className={FIELD} placeholder="Anything at all — we'll weave it in." />}
      {step === DURABLE && (
        <>
          <textarea data-testid="intake-durable" autoFocus rows={3} value={durableText} onChange={(e) => setDurableText(e.target.value)} className={FIELD} placeholder="Ideas or plans not tied to this month — kept across months." />
          {durable.length > 0 && (
            <div className="mt-3" data-testid="durable-list">
              <div className="mb-1 text-[12px] font-semibold text-muted">Remembered for the future</div>
              <ul className="flex flex-col gap-1">{durable.map((d) => <li key={d.id} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-slate-600">{d.content}</li>)}</ul>
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
        <button data-testid="intake-back" onClick={back} className="text-[14px] font-semibold text-muted hover:text-slate-700">{step === 0 ? 'Back to workspace' : 'Back'}</button>
        <span className="flex-1" />
        {step !== REVIEW ? (
          <>
            <button data-testid="intake-skip" onClick={skip} className="text-[14px] font-semibold text-muted hover:text-slate-700">Skip</button>
            <button data-testid="intake-next" onClick={next} className="inline-flex h-10 items-center rounded-xl bg-coral px-4 text-[15px] font-semibold text-white">{step === DURABLE ? 'Review' : 'Next'}</button>
          </>
        ) : (
          <button data-testid="intake-submit" disabled={busy} onClick={submit} className="inline-flex h-11 items-center gap-2 rounded-xl bg-coral px-5 text-[15px] font-semibold text-white disabled:opacity-45">{busy ? 'Sending…' : 'Send to Sprigly'}</button>
        )}
      </div>
    </>
  );
}
