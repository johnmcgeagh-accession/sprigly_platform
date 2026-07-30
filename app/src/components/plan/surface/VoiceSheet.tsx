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
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { MicGlyph, KeyboardGlyph, SendGlyph, CloseGlyph } from './icons';
import { Waveform } from './Waveform';
import { AgentSays } from './AgentVoice';
import { Interpretation } from './Interpretation';
import type { InterpretedItem } from '@/lib/agent/types';
import { useSpeechInput } from '../useSpeechInput';
import { MicTracePanel } from '../MicTracePanel';

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

/**
 * What a submitted sentence produced.
 *
 * `items` present and non-empty → the sheet shows the interpretation and waits. Absent → it
 * closes, because the write has already happened.
 */
export type VoiceOutcome = { ok: false } | { ok: true; items?: readonly InterpretedItem[] };

interface Framing { title: string; blurb: string; placeholder: string }

const FRAMING: Record<VoiceContext, (monthName: string) => Framing> = {
  draft: (m) => ({
    title: `Tell us about ${m}`,
    blurb: `This is your ${m} draft. Tell us what’s happening and we’ll reshape it — what’s launching, what’s on, what you want more of.`,
    placeholder: 'The Wilderness candle relaunches on the 24th, can we build up to it?',
  }),
  committed: (m) => ({
    title: `Tell your plan what to change`,
    // The blurb describes the flow the sheet actually walks. It used to promise the client we
    // would "put the change up for you to approve", which was true of a desktop review queue and
    // false of the only surface most of them will ever open. What it says now is what happens:
    // we work out what you meant, show it, and change nothing until you say Apply.
    blurb: `${m} is written. Say what you want different — I’ll show you exactly what I’ll change before anything moves.`,
    placeholder: 'Move the Thursday post to Friday',
  }),
};

type Mode = 'speak' | 'type';

/** How long `onaudioend` is tolerated before the sheet stops claiming to be listening. WebKit
 *  fires it between utterances, so this has to outlast an ordinary pause between sentences. */
const AUDIO_GRACE_MS = 2500;

export function VoiceSheet({
  open, monthName, busy, question, context = 'draft', onClose, onSubmit, onApply, onDiscard,
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
   * What happened to the sentence.
   *
   * `{ok:false}` keeps the sheet, the words and the mode — a dictated brief can be several
   * hundred words, and a network failure that also throws them away is the one loss a toast
   * cannot undo.
   *
   * `{ok:true, items}` moves the sheet into its SECOND phase: the interpretation, which the
   * client applies or discards without leaving. `{ok:true}` with no items closes, which is the
   * DRAFT month's shape — a reshape there applies directly and returns a receipt, so there is
   * nothing to consent to after the fact.
   */
  onSubmit: (text: string, source: 'web' | 'voice') => Promise<VoiceOutcome>;
  /**
   * Apply the interpretation. Resolves true when the plan actually changed, and the sheet closes
   * into the standard what-changed treatment — which is then confirming what these very lines
   * promised, rather than reporting something the client has not seen before.
   */
  onApply?: ((proposalIds: string[]) => Promise<boolean>) | undefined;
  /** Throw the whole interpretation away. Nothing is applied. */
  onDiscard?: ((proposalIds: string[]) => Promise<void>) | undefined;
}) {
  const [mode, setMode] = useState<Mode>('speak');
  const [text, setText] = useState('');
  const [loud, setLoud] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  /**
   * TWO PHASES, ONE SHEET.
   *
   *   capture       the mic and the field. What they want to say.
   *   interpreting  the agent is extracting. Dots, in its own register.
   *   consent       the itemised interpretation, with Apply and Discard.
   *
   * They are phases of one sheet rather than two sheets because the client has not finished the
   * thought yet. Closing on send and reporting the result somewhere else is what stranded the
   * changes: the report pointed at Approvals, which does not exist on a phone.
   */
  const [phase, setPhase] = useState<'capture' | 'interpreting'>('capture');
  const [items, setItems] = useState<InterpretedItem[]>([]);
  const [applyBusy, setApplyBusy] = useState(false);

  // Final transcript chunks append into the SAME field the typed mode edits, so switching modes
  // mid-thought keeps everything already said.
  const speech = useSpeechInput((chunk) => setText((t) => (t ? `${t} ${chunk}` : chunk)));

  // Re-seed each time the sheet opens: a half-typed sentence must not outlive its reason.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setText(''); setMode('speak'); setLoud(false); setPhase('capture'); setItems([]); setApplyBusy(false); }
  }

  const listening = speech.state === 'recording';
  const starting = speech.state === 'starting';
  const { start: startSpeech, stop: stopSpeech } = speech;

  // ── The lie the screen recording caught ──────────────────────────────────────────────
  // `state === 'recording'` means WE ASKED. `audioLive` means the capture actually opened
  // (`onaudiostart` fired, `onaudioend` has not). The sheet was reading the first and printing
  // "Listening…", which is how the operator came to talk into a dead microphone for many
  // seconds with a flatline meter and a heading that said everything was fine.
  //
  // Held for a moment before it is believed: WebKit fires `onaudioend` at the end of every
  // utterance, and treating that instant as "not listening" would strobe the heading between
  // every phrase. The grace is long enough to cover the gap and short enough that a genuinely
  // dead capture is admitted while the client is still standing there.
  // Three states, not two: `null` is "we have not waited long enough to say". Starting at
  // `false` would flash the failure copy in the ordinary gap between `onstart` and
  // `onaudiostart`, which is a lie in the opposite direction.
  const [audioOk, setAudioOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (speech.audioLive) { setAudioOk(true); return; }
    if (!listening) { setAudioOk(null); return; }
    const t = setTimeout(() => setAudioOk(false), AUDIO_GRACE_MS);
    return () => clearTimeout(t);
  }, [speech.audioLive, listening]);
  /** Listening, and nothing has told us the capture is dead. */
  const capturing = listening && audioOk !== false;
  /** Listening, and the capture never opened — or opened and went away. Named, because it used
   *  to be indistinguishable from listening, which is the whole of the reported bug. */
  const stalled = listening && audioOk === false && !starting;

  // ── Fix 5: the sheet listens as soon as it exists ────────────────────────────────────
  // Not on a tap. The client came here to talk, and a microphone that waits to be pressed makes
  // them do the same thing twice. It also stops whenever speaking stops being the mode or the
  // sheet closes: a capture that outlives its sheet is the one bug here nobody would see and
  // everybody would feel.
  //
  // The dependency list is the two stable callbacks, NOT the `speech` object — that is a fresh
  // literal on every render, so depending on it re-ran this effect constantly and made "did we
  // already start?" impossible to reason about.
  //
  // ── Round 9: useLayoutEffect, and it is not a preference ─────────────────────────────
  // `useEffect` is scheduled AFTER paint, in a later task than the tap that opened the sheet.
  // WebKit's transient user activation does not survive that gap, and on a cold open — the
  // first time a client ever speaks, when the permission prompt is still needed — recognition
  // was therefore asking for the microphone from a context that no longer counted as
  // user-initiated. `useLayoutEffect` runs synchronously in the same task as the state update
  // that mounted this sheet, which for a discrete event like a click is still the gesture's
  // own task. `start()` is now synchronous all the way to `rec.start()` for the same reason.
  useLayoutEffect(() => {
    if (open && mode === 'speak') startSpeech();
    else stopSpeech();
  }, [open, mode, startSpeech, stopSpeech]);

  if (!open) return null;

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    speech.stop();
    // Phase two starts NOW, before the round trip: the client has just spoken and the sheet has
    // to show it is thinking about it rather than sitting on their words.
    setPhase('interpreting');
    // The transport is what actually happened: if any of this arrived through the microphone,
    // it is voice, even when the client tidied it up by hand afterwards.
    const out = await onSubmit(value, mode === 'speak' || listening ? 'voice' : 'web');
    // A refusal keeps the sheet, the words and the mode. The failure is reported in the shell's
    // feedback slot, over the sheet, where it can be read without losing what was said.
    if (!out.ok) { setPhase('capture'); return; }
    // No items → the write already happened (a draft month reshapes directly). Nothing to
    // consent to after the fact, so the sheet gets out of the way.
    if (!out.items) { onClose(); return; }
    setItems([...out.items]);
  };

  /** Apply what the list promised, then leave. */
  const apply = async () => {
    const ids = items.filter((i) => i.kind === 'change').map((i) => (i as { proposalId: string }).proposalId);
    if (!ids.length || !onApply) return;
    setApplyBusy(true);
    try { if (await onApply(ids)) onClose(); }
    finally { setApplyBusy(false); }
  };

  const discard = async () => {
    const ids = items.filter((i) => i.kind === 'change').map((i) => (i as { proposalId: string }).proposalId);
    setApplyBusy(true);
    try { await onDiscard?.(ids); }
    finally { setApplyBusy(false); onClose(); }
  };

  /** Leave one line out. The row IS a proposal, so dropping it is a reject on that row alone. */
  const dropItem = (proposalId: string) => {
    setItems((cur) => cur.filter((i) => !(i.kind === 'change' && i.proposalId === proposalId)));
    void onDiscard?.([proposalId]);
  };

  const framing = FRAMING[context](monthName);

  // ── What the sheet says it is doing ──────────────────────────────────────────────────
  // Every state below is named. The one the re-check caught was the unnamed one: the sheet open,
  // the microphone not running, and nothing on screen admitting it — which read as "listening"
  // to anyone who did not know better, and lost the sentence they said into it.
  /** In consent, the capture states are irrelevant — the microphone is already off. */
  const consenting = phase === 'interpreting';
  const heading = consenting ? (items.length ? 'Here’s what I understood' : 'Working it out…')
    : mode === 'type' ? framing.title
    : speech.state === 'no-permission' ? 'We need the microphone'
    : speech.state === 'unsupported' ? 'This browser can’t listen'
    : speech.state === 'error' ? 'The microphone stopped'
    : starting ? 'Getting the mic…'
    : stalled ? 'We’ve lost the microphone'
    : capturing ? (loud ? 'Listening…' : 'Go ahead')
    : 'Tap the mic and talk';
  const under = consenting
    ? (items.length ? 'Check it, then apply. Nothing has changed yet.' : 'One moment.')
    : mode === 'type' ? 'Same thing, typed.'
    : speech.state === 'no-permission' ? 'Allow it in your browser settings, or type it instead.'
    : speech.state === 'unsupported' ? 'Type it instead — it goes to exactly the same place.'
    : speech.state === 'error' ? 'Tap the mic to pick it up again, or type it instead.'
    : starting ? 'One moment.'
    // Said out loud rather than sat in. Whatever we do next, the client needs to stop talking
    // into something that is not recording them.
    : stalled ? 'Nothing is reaching us. Tap the mic to pick it up, or type it instead.'
    : capturing ? (loud ? 'Tap the mic again when you’re done.' : 'We can’t hear anything yet.')
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

        {/* ── PHASE TWO: consent ─────────────────────────────────────────────────────────
            The interpretation replaces the capture UI rather than sitting under it. The mic is
            off, the field is irrelevant, and the only question left is whether the list is
            right. Leaving the mic on screen beside it would offer two different next actions
            for one moment. */}
        {consenting ? (
          <div className="flex min-h-0 flex-1 flex-col px-[18px] pb-4 pt-1">
            <Interpretation
              items={items}
              applying={!items.length}
              busy={applyBusy || busy}
              onApply={() => void apply()}
              onDiscard={() => void discard()}
              {...(onDiscard ? { onDropItem: dropItem } : {})}
            />
          </div>
        ) : (
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
                {/* `speaking` + `pulse` are the recogniser's OWN events. Passing them is what
                    lets the meter run without a second `getUserMedia` on any browser that
                    arbitrates one audio session — see Waveform.tsx and audio-contention.ts. */}
                <Waveform active={listening} onLevel={setLoud} speaking={speech.speaking} pulse={speech.pulse} />
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
                  // A transcript APPENDS. Announcing it atomically would re-read everything said
                  // so far after every phrase.
                  grows
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

        )}

        {/* The send row belongs to capture only — consent has its own Apply / Discard. */}
        {!consenting && (
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
        )}
        {/* Renders nothing unless the operator armed `?mic=trace` for this tab. It sits inside
            the sheet because that is where the microphone is, and it is fixed to the viewport
            so it survives the sheet's own scrolling. */}
        <MicTracePanel />
      </>
    </Sheet>
  );
}
