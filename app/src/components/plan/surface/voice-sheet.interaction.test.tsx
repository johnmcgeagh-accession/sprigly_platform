/**
 * @vitest-environment jsdom
 *
 * voice-sheet.interaction.test.tsx — one sheet, two modes, driven.
 *
 * The Web Speech API is stubbed with a recogniser this file controls, so a "spoken" chunk is a
 * real path through `useSpeechInput` rather than a mocked hook. jsdom has no `AudioContext` and
 * no `getUserMedia`, which is itself worth testing: the meter must degrade to flat bars and the
 * TRANSCRIPT must keep working, because they are deliberately independent consumers of the
 * microphone and only one of them is load-bearing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { VoiceSheet } from './VoiceSheet';

/** A stand-in for the browser's SpeechRecognition, with a handle to feed it transcripts. */
class FakeRecognition {
  static live: FakeRecognition | null = null;
  continuous = false; interimResults = false; lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  /** WebKit fires this when the capture actually OPENS. The sheet now requires it before it
   *  will claim to be listening — see VoiceSheet's `audioOk`. A fake without it models a
   *  browser that says "recording" and never records, which is the bug, not the baseline. */
  onaudiostart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  /** The real API fires this when the session actually opens. The hook waits for it before it
   *  claims to be listening, so the fake has to have it or "getting the mic" never resolves. */
  onstart: (() => void) | null = null;
  started = false;
  /** How many sessions this browser has been asked for. The no-start bug was a SECOND one
   *  constructed on top of a first that had not finished closing. */
  static built = 0;
  constructor() { FakeRecognition.built += 1; }
  start() { this.started = true; FakeRecognition.live = this; this.onstart?.(); this.onaudiostart?.(); }
  stop() { this.started = false; this.onend?.(); }
  /** WebKit ends a session on its own after a silence, `continuous` or not. */
  endOnItsOwn() { this.started = false; this.onend?.(); }
  /** What the browser hands back when it has heard a whole phrase. */
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } });
  }
}

const speechSupported = () => { (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition; };

function open(over: Partial<React.ComponentProps<typeof VoiceSheet>> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<VoiceSheet open monthName="October" busy={false} onClose={onClose} onSubmit={onSubmit} {...over} />);
  return { onSubmit, onClose };
}

beforeEach(() => { FakeRecognition.live = null; speechSupported(); });
afterEach(() => {
  cleanup();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('the sheet is the one place the framing copy lives', () => {
  it('carries the month framing, and no “arrives later” anywhere', () => {
    open();
    expect(screen.getByTestId('voice-framing').textContent).toContain('This is your October draft');
    expect(document.body.textContent).not.toMatch(/arrives later|coming soon|not yet available/i);
  });

  /**
   * ── The one assertion round 8 reverses ─────────────────────────────────────────────
   * This used to read "opens listening-ready, not listening — a sheet must not take the mic on
   * sight", and it was the right rule for a sheet that could be opened by accident. It is the
   * wrong rule for THIS one: it is reached only by tapping a microphone, it says "talk to your
   * plan" on the way in, and making the client tap a second mic to be heard is asking them to
   * do the same thing twice. Fix 5 inverts it, and this is the line that inverts.
   */
  it('OPENS LISTENING — the client tapped a mic to get here', () => {
    open();
    expect(screen.getByTestId('voice-mic').getAttribute('aria-pressed')).toBe('true');
    expect(FakeRecognition.live).not.toBeNull();
    expect(FakeRecognition.live!.started).toBe(true);
    expect(screen.getByTestId('voice-heading').textContent).toBe('Go ahead');
  });

  it('takes the microphone ONCE, not once per render', () => {
    open();
    const built = FakeRecognition.built;
    // A re-render for any reason must not spawn a second session on top of the first — the
    // shape of the intermittent no-start.
    act(() => { FakeRecognition.live!.say('anything'); });
    expect(FakeRecognition.built).toBe(built);
  });

  it('releases it when the sheet closes', () => {
    const { onClose } = open();
    const rec = FakeRecognition.live!;
    fireEvent.click(screen.getByTestId('voice-close'));
    expect(onClose).toHaveBeenCalled();
    cleanup();                          // the sheet unmounts
    expect(rec.started).toBe(false);
  });
});

describe('silent and speaking differ by more than the bars (X6)', () => {
  it('listening-but-silent says so in the COPY, and the mic is filled without a halo', () => {
    open();
    expect(screen.getByTestId('voice-heading').textContent).toBe('Go ahead');
    expect(screen.getByTestId('voice-state').textContent).toBe('We can’t hear anything yet.');
    const mic = screen.getByTestId('voice-mic');
    expect(mic.className).toContain('bg-coral-650');
    expect(mic.className).not.toContain('shadow-[0_0_0_10px');
  });

  it('the idle mic is an OUTLINE — the treatments still differ, they are just reached by tapping OFF', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));      // stop
    const mic = screen.getByTestId('voice-mic');
    expect(mic.className).toContain('ring-coral-600');
    expect(mic.className).not.toContain('bg-coral-650');
    expect(screen.getByTestId('voice-heading').textContent).toBe('Tap the mic and talk');
  });

  it('the meter runs only while capturing', () => {
    open();
    expect(screen.getByTestId('waveform').getAttribute('data-active')).toBe('true');
    fireEvent.click(screen.getByTestId('voice-mic'));      // stop
    expect(screen.getByTestId('waveform').getAttribute('data-active')).toBeNull();
  });
});

describe('capture', () => {
  it('a spoken phrase lands in the same field the typed mode edits', () => {
    open();
    act(() => { FakeRecognition.live!.say('The Wilderness candle relaunches on the 24th'); });

    expect(screen.getByTestId('voice-transcript').textContent).toBe('The Wilderness candle relaunches on the 24th');

    // Switching mode mid-thought keeps everything already said.
    fireEvent.click(screen.getByTestId('voice-mode'));
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value)
      .toBe('The Wilderness candle relaunches on the 24th');
  });

  it('the transcript is an APPEND-ONLY live region, not an atomic one', () => {
    open();
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th.'); });
    const block = screen.getByTestId('voice-transcript');
    expect(block.getAttribute('aria-live')).toBe('polite');
    // Atomic here would re-read everything said so far after every phrase — three sentences
    // dictated means hearing the first one four times.
    expect(block.getAttribute('aria-atomic')).toBe('false');
  });

  it('two phrases join with a space rather than replacing each other', () => {
    open();
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th.'); });
    act(() => { FakeRecognition.live!.say('Can we build up to it?'); });
    expect(screen.getByTestId('voice-transcript').textContent)
      .toBe('The candle relaunches on the 24th. Can we build up to it?');
  });

  it('SUBMITS AS VOICE when it came through the microphone (gap 8)', () => {
    const { onSubmit } = open();
    act(() => { FakeRecognition.live!.say('More product this month'); });
    fireEvent.click(screen.getByTestId('voice-submit'));

    expect(onSubmit).toHaveBeenCalledWith('More product this month', 'voice');
  });

  it('and as WEB when it was typed', () => {
    const { onSubmit } = open();
    fireEvent.click(screen.getByTestId('voice-mode'));
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'More product this month' } });
    fireEvent.click(screen.getByTestId('voice-submit'));

    expect(onSubmit).toHaveBeenCalledWith('More product this month', 'web');
  });

  it('stops the microphone when the mode changes — a capture must not outlive its sheet', () => {
    open();
    const rec = FakeRecognition.live!;
    expect(rec.started).toBe(true);

    fireEvent.click(screen.getByTestId('voice-mode'));
    expect(rec.started).toBe(false);
  });

  it('an unsupported browser says what to do instead, and never that voice is coming later', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    open();
    expect(screen.getByTestId('voice-unsupported').textContent).toContain('Type it instead');
    expect((screen.getByTestId('voice-mic') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a refused microphone reports itself rather than failing silently', () => {
    open();
    act(() => { FakeRecognition.live!.onerror?.({ error: 'not-allowed' }); });
    expect(screen.getByTestId('voice-no-permission').textContent).toContain('microphone');
  });
});

describe('the starters are gone (round 8, fix 6)', () => {
  /**
   * X4 built these, and X4 was right about the mockups: three bordered capsules that did
   * nothing were worse than nothing. The re-check removed the category rather than the
   * implementation. On a sheet that now opens listening and says "one sentence is enough",
   * a list of three openers is homework — and tapping one switched the client out of the mode
   * they had just been put into, to finish OUR sentence rather than say theirs.
   */
  it('no starter, no capsule, and no invitation to try starting with anything', () => {
    for (const context of ['draft', 'committed'] as const) {
      open({ context });
      expect(screen.queryAllByTestId('voice-starter')).toHaveLength(0);
      expect(screen.queryByTestId('voice-starters')).toBeNull();
      expect(document.body.textContent).not.toMatch(/try starting with/i);
      cleanup();
    }
  });
});

describe('submitting', () => {
  it('refuses an empty send rather than posting nothing', () => {
    const { onSubmit } = open();
    expect((screen.getByTestId('voice-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('voice-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('the wordless arrow carries its name for a screen reader (X2 stands, V3 recorded)', () => {
    open();
    expect(screen.getByTestId('voice-submit').getAttribute('aria-label')).toBe('Send this to Sprigly');
  });

  it('is inert while a write is in flight', () => {
    const { onSubmit } = open({ busy: true });
    fireEvent.click(screen.getByTestId('voice-mode'));
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'anything' } });
    fireEvent.click(screen.getByTestId('voice-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('answering an assumption', () => {
  it('shows the QUESTION in place of the framing, and sends only the client’s words', () => {
    const { onSubmit } = open({ question: 'We’ve assumed nothing’s launching this month — anything coming up?' });
    expect(screen.getByTestId('voice-framing').textContent)
      .toBe('We’ve assumed nothing’s launching this month — anything coming up?');

    fireEvent.click(screen.getByTestId('voice-mode'));
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'The candle, on the 24th' } });
    fireEvent.click(screen.getByTestId('voice-submit'));

    // OUR sentence never enters sourceText — that string is what a card quotes back verbatim.
    expect(onSubmit).toHaveBeenCalledWith('The candle, on the 24th', 'web');
  });
});

describe('one sheet, two month states (round 7, fix 2)', () => {
  it('the DRAFT framing says the month reshapes, and its placeholder leads into a shaping intent', () => {
    open({ context: 'draft' });
    expect(screen.getByTestId('voice-framing').textContent).toContain('we’ll reshape it');
    fireEvent.click(screen.getByTestId('voice-mode'));
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).placeholder)
      .toContain('relaunches on the 24th');
  });

  it('the COMMITTED framing says nothing moves until they say so, and offers correcting verbs', () => {
    open({ context: 'committed' });
    const blurb = screen.getByTestId('voice-framing').textContent ?? '';
    // The consequence is the whole reason the sheet exists on this month: the agent APPLIES
    // NOTHING here, and the copy must not imply the month has already changed.
    expect(blurb).toContain('October is written');
    // NOT "approve". The blurb used to promise a desktop review queue to a client on a phone;
    // it now describes the flow the sheet walks — see the interpretation phase.
    expect(blurb).not.toMatch(/approv/i);
    expect(blurb).toContain('before anything moves');
    // The correcting verbs now live in the placeholder — the one example left, and the only
    // place a suggestion belongs on a sheet that is already listening.
    fireEvent.click(screen.getByTestId('voice-mode'));
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).placeholder)
      .toBe('Move the Thursday post to Friday');
  });

  it('but the CAPTURE is identical — same mic, same meter, same dual input, same submit', () => {
    for (const context of ['draft', 'committed'] as const) {
      const { onSubmit } = open({ context });
      expect(screen.getByTestId('voice-mic')).toBeTruthy();
      expect(screen.getByTestId('waveform')).toBeTruthy();
      expect(screen.getByTestId('voice-mode')).toBeTruthy();

      act(() => { FakeRecognition.live!.say('move the Thursday post'); });
      fireEvent.click(screen.getByTestId('voice-submit'));
      expect(onSubmit).toHaveBeenCalledWith('move the Thursday post', 'voice');
      cleanup();
    }
  });

  it('the sheet is titled for its context, so a screen reader hears which one it is', () => {
    open({ context: 'committed' });
    expect(screen.getByTestId('voice-sheet').getAttribute('aria-label')).toBe('Tell your plan what to change');
    cleanup();
    open({ context: 'draft' });
    expect(screen.getByTestId('voice-sheet').getAttribute('aria-label')).toBe('Tell us about October');
  });
});
