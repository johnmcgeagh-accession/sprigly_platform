'use client';

/**
 * VoiceSheet.tsx — the one place a client tells us something. (spec §8)
 *
 * ONE SHEET, TWO MODES. A keyboard toggle swaps the microphone and its meter for a text field.
 * Same framing copy, same starters, same submit, same route. The inline "Anything we should
 * know?" textarea that sat on the draft page is gone with `DraftPlanView`: there were two
 * interfaces for one job, and the page's copy and the sheet's copy could disagree.
 *
 * VOICE IS LIVE FROM DAY ONE. Round 2 shipped a disabled mic and an "arrives later" line, which
 * put a large grey dead circle at the optical centre of the one screen whose promise is *talk to
 * your plan*. There is no "later" copy anywhere in this file. `useSpeechInput` already drove the
 * Web Speech API for `IntakeCapture`; using it here is a move, not a build.
 *
 * ── The three states, and why they differ by more than the bars (X6) ─────────────────
 *
 *   idle       the mic is an outline. Nothing is being captured and nothing is being heard.
 *   listening  the mic is FILLED. "Go ahead" / "We can't hear anything yet." The meter flatlines.
 *   speaking   the mic is filled AND haloed. "Listening…" / "Tap the mic when you're done."
 *
 * Round 5.1 found that only the bars and the heading changed between the last two, so the
 * distinction the meter exists to draw was carried by the meter alone. Three channels now:
 * copy, the mic's own treatment, and the meter.
 *
 * ── The starters are tappable, and they are starters (X4, R4) ────────────────────────
 *
 * The mockups rendered three questions as bordered capsules that did nothing — the universal
 * form of a suggestion chip, inert. X4 ruled that a tap must seed the field. A question cannot
 * be seeded: inserting "Anything launching?" as the client's own words is nonsense. So they are
 * phrased as OPENERS the client finishes — which is also what makes them useful, because each
 * one leads into an intent the classifier can actually route.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { MicGlyph, KeyboardGlyph, SendGlyph, CloseGlyph } from './icons';
import { Waveform } from './Waveform';
import { useSpeechInput } from '../useSpeechInput';

/**
 * ONE SHEET, TWO MONTH STATES (round 7, fix 2).
 *
 * The mic means *talk to your plan* on both, and it is the same gesture, the same waveform and the
 * same dual input. What differs is the CONSEQUENCE, and the sheet is what says which — spec §1.2's
 * rule, which the committed month was not honouring: it flashed a line of copy and opened nothing.
 *
 *   draft      the sentence RESHAPES the month directly and returns a receipt.
 *   committed  the sentence raises PROPOSALS the client then approves. The agent applies nothing.
 *
 * The starters differ with it, because the intents differ. A draft month is being shaped — what is
 * launching, what is on, what you want more of. A committed month is being corrected — move this,
 * drop that, rewrite the other.
 */
export type VoiceContext = 'draft' | 'committed';

interface Framing { title: string; blurb: string; placeholder: string; starters: string[] }

const FRAMING: Record<VoiceContext, (monthName: string) => Framing> = {
  draft: (m) => ({
    title: `Tell us about ${m}`,
    blurb: `This is your ${m} draft. Tell us what’s happening and we’ll reshape it — what’s launching, what’s on, what you want more of.`,
    placeholder: 'The Wilderness candle relaunches on the 24th, can we build up to it?',
    // Openers the client finishes, each leading into an intent the classifier routes.
    starters: ['We’re launching ', 'There’s an event on ', 'Can we do more '],
  }),
  committed: (m) => ({
    title: `Tell your plan what to change`,
    blurb: `${m} is written. Say what you want different and we’ll put the change up for you to approve — nothing moves until you say so.`,
    placeholder: 'Move the Thursday post to Friday',
    starters: ['Move the ', 'Take out the ', 'Rewrite the '],
  }),
};

type Mode = 'speak' | 'type';

export function VoiceSheet({
  open, monthName, busy, question, context = 'draft', onClose, onSubmit,
}: {
  open: boolean;
  monthName: string;
  busy: boolean;
  /** Which month state this mic belongs to. It chooses the framing and the starters; the caller
   *  chooses where the words go. Same sheet, same capture, different consequence. */
  context?: VoiceContext;
  /**
   * The assumption being answered, when the sheet was opened from the nudge rather than the mic.
   *
   * It replaces the framing paragraph and NOTHING ELSE. What gets sent is the client's own words
   * alone — the question is context for the person, not for the classifier. Prefixing their
   * answer with our question would put our sentence into `sourceText`, which is the string a
   * card quotes back verbatim under "From what you told us".
   */
  question?: string | undefined;
  onClose: () => void;
  /**
   * Resolves TRUE when the write landed. The sheet closes on true and stays open on false with
   * every word still in the field — a dictated brief can be several hundred of them, and a
   * network failure that also throws them away is the one loss a toast cannot undo.
   */
  onSubmit: (text: string, source: 'web' | 'voice') => Promise<boolean>;
}) {
  const [mode, setMode] = useState<Mode>('speak');
  const [text, setText] = useState('');
  const [loud, setLoud] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // Final transcript chunks append into the SAME field the typed mode edits, so switching modes
  // mid-thought keeps everything already said.
  const speech = useSpeechInput((chunk) => setText((t) => (t ? `${t} ${chunk}` : chunk)));

  // Re-seed each time the sheet opens: a half-typed sentence must not outlive its reason.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setText(''); setMode('speak'); setLoud(false); }
  }

  const listening = speech.state === 'recording';

  // Stop the microphone whenever it stops being the mode, or the sheet closes. A capture that
  // outlives its sheet is the one bug here nobody would see and everybody would feel.
  useEffect(() => { if (!open || mode !== 'speak') speech.stop(); }, [open, mode, speech]);

  if (!open) return null;

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    speech.stop();
    // The transport is what actually happened: if any of this arrived through the microphone,
    // it is voice, even when the client tidied it up by hand afterwards.
    const ok = await onSubmit(value, mode === 'speak' || listening ? 'voice' : 'web');
    // A refusal keeps the sheet, the words and the mode. The failure is reported in the shell's
    // feedback slot, over the sheet, where it can be read without losing what was said.
    if (ok) onClose();
  };

  const useStarter = (s: string) => {
    speech.stop();
    setMode('type');
    setText((t) => (t.trim() ? `${t.trim()} ${s}` : s));
    // Focus at the END: a starter is the beginning of their sentence, not a replacement for it.
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const framing = FRAMING[context](monthName);
  const heading = mode === 'type' ? framing.title
    : listening ? (loud ? 'Listening…' : 'Go ahead')
    : 'Tap the mic and talk';
  const under = mode === 'type' ? 'Same thing, typed.'
    : listening ? (loud ? 'Tap the mic again when you’re done.' : 'We can’t hear anything yet.')
    : 'One sentence is enough.';

  return (
    <Sheet open={open} label={framing.title} testid="voice-sheet" onClose={onClose} hasOwnClose>
      <>
        <div className="flex flex-none items-start gap-3 px-[18px] pb-2 pt-1.5">
          <div className="min-w-0 flex-1">
            <h2 data-testid="voice-heading" className="mb-1 text-[20px] font-bold tracking-[-.025em] text-chrome">{heading}</h2>
            <p data-testid="voice-state" className="text-[13.5px] font-medium text-muted">{under}</p>
          </div>
          <button type="button" data-testid="voice-close" aria-label="Close" onClick={onClose}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-line-soft text-chrome">
            <CloseGlyph className="h-[17px] w-[17px]" />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-[18px] pb-4 [scrollbar-width:none]">
          {/* THE FRAMING COPY LIVES HERE and nowhere else. Round 3 moved it off the page,
              because a 200px block asking the client to say something sat above the month they
              came to read — which inverts the product's own first principle. */}
          <p data-testid="voice-framing" className="pt-1 text-[15px] leading-[1.5] text-chrome">
            {question ?? framing.blurb}
          </p>

          {mode === 'speak' ? (
            <div className="flex flex-1 flex-col items-center justify-center py-6">
              <button
                type="button" data-testid="voice-mic" aria-pressed={listening}
                aria-label={listening ? 'Stop listening' : 'Start listening'}
                disabled={speech.state === 'unsupported'}
                onClick={() => (listening ? speech.stop() : speech.start())}
                className={[
                  'flex h-[96px] w-[96px] items-center justify-center rounded-full transition-all duration-200',
                  listening
                    ? 'bg-coral-650 text-white'
                    : 'bg-surface text-coral-800 ring-2 ring-inset ring-coral-600',
                  // The halo is a state, present only while something is actually being heard —
                  // the third channel X6 asked for, on top of the copy and the meter.
                  loud ? 'shadow-[0_0_0_10px_rgb(var(--t-accent-600,232_112_95)_/_0.18),0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.55)]' : '',
                ].join(' ')}
              >
                <MicGlyph className="h-10 w-10 [stroke-width:1.8]" />
              </button>

              <div className="mt-6 w-full">
                <Waveform active={listening} onLevel={setLoud} />
              </div>

              {text && (
                <p data-testid="voice-transcript" className="mt-4 w-full text-[15px] leading-[1.5] text-chrome">{text}</p>
              )}

              {speech.state === 'unsupported' && (
                <p data-testid="voice-unsupported" className="mt-4 text-center text-[13.5px] leading-normal text-muted">
                  This browser can’t listen. Type it instead — it goes to exactly the same place.
                </p>
              )}
              {speech.state === 'no-permission' && (
                <p data-testid="voice-no-permission" role="alert" className="mt-4 text-center text-[13.5px] leading-normal text-muted">
                  We don’t have access to your microphone. Allow it in your browser settings, or type it instead.
                </p>
              )}
            </div>
          ) : (
            <textarea
              ref={field} data-testid="voice-input" autoFocus value={text} disabled={busy}
              onChange={(e) => setText(e.target.value)}
              placeholder={framing.placeholder}
              className="mt-4 min-h-[220px] w-full flex-1 rounded-[14px] border border-line/55 bg-surface p-3.5 text-[16.5px] leading-[1.45] text-chrome outline-none placeholder:text-muted"
            />
          )}

          <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-[.1em] text-muted">Try starting with</h3>
          <div data-testid="voice-starters" className="flex flex-col gap-1.5">
            {framing.starters.map((s) => (
              // BUTTONS, and they do what their shape promises (X4). A tap moves to typed mode
              // with the opener in the field and the caret after it.
              <button
                key={s} type="button" data-testid="voice-starter" onClick={() => useStarter(s)}
                className="min-h-[44px] rounded-[14px] bg-surface px-3.5 py-2.5 text-left text-[15px] text-chrome ring-1 ring-inset ring-line/55 active:bg-line-soft"
              >
                {s.trim()}…
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-none items-center gap-2 border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-3">
          <button
            type="button" data-testid="voice-mode"
            aria-label={mode === 'speak' ? 'Type instead' : 'Speak instead'}
            onClick={() => setMode((v) => (v === 'speak' ? 'type' : 'speak'))}
            className="flex min-h-[56px] w-[56px] flex-none items-center justify-center rounded-2xl bg-surface text-chrome ring-1 ring-inset ring-line/55"
          >
            {mode === 'speak' ? <KeyboardGlyph className="h-6 w-6" /> : <MicGlyph className="h-6 w-6" />}
          </button>
          {/* The wordless arrow stands — X2, recorded against V3 on the iMessage-send precedent
              and not re-opened. It carries an aria-label, which is the part that matters. */}
          <button
            type="button" data-testid="voice-submit" aria-label="Send this to Sprigly"
            disabled={!text.trim() || busy} onClick={() => void submit()}
            className="flex min-h-[56px] flex-1 items-center justify-center rounded-2xl bg-coral-650 text-white shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)] disabled:bg-line-soft disabled:text-muted disabled:shadow-none"
          >
            <SendGlyph className="h-[26px] w-[26px] [stroke-width:2.2]" />
          </button>
        </div>
      </>
    </Sheet>
  );
}
