'use client';

/**
 * VoiceSheet.tsx — the one place a client tells us something. (spec §8)
 *
 * ONE SHEET, TWO MODES. A keyboard toggle swaps the microphone and its meter for a text field.
 * Same framing copy, same submit, same route. The inline "Anything we should know?" textarea
 * that sat on the draft page is gone with `DraftPlanView`: there were two interfaces for one
 * job, and the page's copy and the sheet's copy could disagree.
 *
 * ── Round 8: it listens the moment it opens ──────────────────────────────────────────
 *
 * The sheet used to open idle and wait to be tapped. Two taps to say one sentence, on a surface
 * whose whole promise is *talk to your plan* — and the second tap was the one that intermittently
 * did nothing (the cause, and its fix, are written out in `useSpeechInput`). Opening now starts
 * listening, and the sheet says which of the three things is true — listening, still asking for
 * the microphone, or refused — rather than sitting silently in whichever one it is.
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
 * ── The starters are gone (round 8, fix 6) ───────────────────────────────────────────
 *
 * "Try starting with" offered three openers the client tapped to seed the field. X4 built them
 * because the mockups' inert suggestion capsules were worse. The re-check removed the category:
 * they sat under the microphone as a list of homework on a sheet that had just told the client
 * one sentence is enough, and every one of them switched the sheet out of the mode it opens in.
 * A surface that starts listening does not also need to suggest what to say. The `starters` field
 * is off `Framing` entirely rather than emptied, so nothing can quietly grow them back.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { MicGlyph, KeyboardGlyph, SendGlyph, CloseGlyph } from './icons';
import { Waveform } from './Waveform';
import { AgentSays } from './AgentVoice';
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
 * The framing differs with it, because the intents differ. A draft month is being shaped — what
 * is launching, what is on, what you want more of. A committed month is being corrected — move
 * this, drop that, rewrite the other. The blurb and the placeholder carry that; the starters
 * that used to are gone (fix 6).
 */
export type VoiceContext = 'draft' | 'committed';

interface Framing { title: string; blurb: string; placeholder: string }

const FRAMING: Record<VoiceContext, (monthName: string) => Framing> = {
  draft: (m) => ({
    title: `Tell us about ${m}`,
    blurb: `This is your ${m} draft. Tell us what’s happening and we’ll reshape it — what’s launching, what’s on, what you want more of.`,
    placeholder: 'The Wilderness candle relaunches on the 24th, can we build up to it?',
  }),
  committed: (m) => ({
    title: `Tell your plan what to change`,
    blurb: `${m} is written. Say what you want different and we’ll put the change up for you to approve — nothing moves until you say so.`,
    placeholder: 'Move the Thursday post to Friday',
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
  const starting = speech.state === 'starting';
  const { start: startSpeech, stop: stopSpeech } = speech;

  // ── Fix 5: the sheet listens as soon as it exists ────────────────────────────────────
  // Not on a tap. The client came here to talk, and a microphone that waits to be pressed makes
  // them do the same thing twice. It also stops whenever speaking stops being the mode or the
  // sheet closes: a capture that outlives its sheet is the one bug here nobody would see and
  // everybody would feel.
  //
  // The dependency list is the two stable callbacks, NOT the `speech` object — that is a fresh
  // literal on every render, so depending on it re-ran this effect constantly and made "did we
  // already start?" impossible to reason about.
  useEffect(() => {
    if (open && mode === 'speak') startSpeech();
    else stopSpeech();
  }, [open, mode, startSpeech, stopSpeech]);

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

  const framing = FRAMING[context](monthName);

  // ── What the sheet says it is doing ──────────────────────────────────────────────────
  // Every state below is named. The one the re-check caught was the unnamed one: the sheet open,
  // the microphone not running, and nothing on screen admitting it — which read as "listening"
  // to anyone who did not know better, and lost the sentence they said into it.
  const heading = mode === 'type' ? framing.title
    : speech.state === 'no-permission' ? 'We need the microphone'
    : speech.state === 'unsupported' ? 'This browser can’t listen'
    : speech.state === 'error' ? 'The microphone stopped'
    : starting ? 'Getting the mic…'
    : listening ? (loud ? 'Listening…' : 'Go ahead')
    : 'Tap the mic and talk';
  const under = mode === 'type' ? 'Same thing, typed.'
    : speech.state === 'no-permission' ? 'Allow it in your browser settings, or type it instead.'
    : speech.state === 'unsupported' ? 'Type it instead — it goes to exactly the same place.'
    : speech.state === 'error' ? 'Tap the mic to pick it up again, or type it instead.'
    : starting ? 'One moment.'
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
                onClick={() => (listening || starting ? speech.stop() : speech.start())}
                className={[
                  'flex h-[96px] w-[96px] items-center justify-center rounded-full transition-all duration-200',
                  listening
                    ? 'bg-coral-650 text-white'
                    // Reaching for the microphone is its own look: filled at the light tier, so
                    // it is visibly not idle and visibly not yet live.
                    : starting
                      ? 'bg-coral-100 text-coral-800 ring-2 ring-inset ring-coral-600'
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

              {/* THE TRANSCRIPT IS THE AGENT'S REGISTER (fix 7). It used to be body copy, one
                  size off the framing paragraph above it — so what the client had just said and
                  what we had said to them looked like the same voice. It is the same block the
                  toasts and the reshape use, so "this is Sprigly hearing you" looks the same
                  wherever it happens. Working while the mic is still open: the words so far are
                  not the whole sentence. */}
              {(text || listening || starting) && (
                <AgentSays
                  testid="voice-transcript" className="mt-4 w-full"
                  working={listening || starting}
                  label={text ? 'What we heard' : 'Listening'}
                >
                  {text || undefined}
                </AgentSays>
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
              {speech.state === 'error' && (
                // Named rather than silent. This state existed before and rendered NOTHING, which
                // is how a microphone that failed to start looked exactly like one waiting to be
                // tapped — the intermittent no-start, as the client experienced it.
                <p data-testid="voice-error" role="alert" className="mt-4 text-center text-[13.5px] leading-normal text-muted">
                  The microphone stopped before we could listen. Tap it to try again, or type it instead.
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
