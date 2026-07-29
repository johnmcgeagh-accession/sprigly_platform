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
  started = false;
  start() { this.started = true; FakeRecognition.live = this; }
  stop() { this.started = false; this.onend?.(); }
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

  it('opens listening-ready, not listening — a sheet must not take the mic on sight', () => {
    open();
    expect(screen.getByTestId('voice-heading').textContent).toBe('Tap the mic and talk');
    expect(screen.getByTestId('voice-mic').getAttribute('aria-pressed')).toBe('false');
    expect(FakeRecognition.live).toBeNull();
  });
});

describe('silent and speaking differ by more than the bars (X6)', () => {
  it('listening-but-silent says so in the COPY, and the mic is filled without a halo', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));

    expect(screen.getByTestId('voice-heading').textContent).toBe('Go ahead');
    expect(screen.getByTestId('voice-state').textContent).toBe('We can’t hear anything yet.');
    const mic = screen.getByTestId('voice-mic');
    expect(mic.className).toContain('bg-coral-650');
    expect(mic.className).not.toContain('shadow-[0_0_0_10px');
  });

  it('the idle mic is an OUTLINE — three states, three treatments', () => {
    open();
    const mic = screen.getByTestId('voice-mic');
    expect(mic.className).toContain('ring-coral-600');
    expect(mic.className).not.toContain('bg-coral-650');
  });

  it('the meter runs only while capturing', () => {
    open();
    expect(screen.getByTestId('waveform').getAttribute('data-active')).toBeNull();
    fireEvent.click(screen.getByTestId('voice-mic'));
    expect(screen.getByTestId('waveform').getAttribute('data-active')).toBe('true');
  });
});

describe('capture', () => {
  it('a spoken phrase lands in the same field the typed mode edits', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('The Wilderness candle relaunches on the 24th'); });

    expect(screen.getByTestId('voice-transcript').textContent).toBe('The Wilderness candle relaunches on the 24th');

    // Switching mode mid-thought keeps everything already said.
    fireEvent.click(screen.getByTestId('voice-mode'));
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value)
      .toBe('The Wilderness candle relaunches on the 24th');
  });

  it('two phrases join with a space rather than replacing each other', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th.'); });
    act(() => { FakeRecognition.live!.say('Can we build up to it?'); });
    expect(screen.getByTestId('voice-transcript').textContent)
      .toBe('The candle relaunches on the 24th. Can we build up to it?');
  });

  it('SUBMITS AS VOICE when it came through the microphone (gap 8)', () => {
    const { onSubmit } = open();
    fireEvent.click(screen.getByTestId('voice-mic'));
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
    fireEvent.click(screen.getByTestId('voice-mic'));
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
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.onerror?.({ error: 'not-allowed' }); });
    expect(screen.getByTestId('voice-no-permission').textContent).toContain('microphone');
  });
});

describe('the starters are tappable, and they are starters (X4, R4)', () => {
  it('a tap seeds the FIELD and switches to typed mode with the caret at the end', async () => {
    open();
    fireEvent.click(screen.getAllByTestId('voice-starter')[0]!);

    const field = screen.getByTestId('voice-input') as HTMLTextAreaElement;
    expect(field.value).toBe('We’re launching ');
    // The caret is placed on the next frame, after the field has mounted.
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    // A starter is the beginning of THEIR sentence, so the caret goes after it.
    expect(field.selectionStart).toBe(field.value.length);
    expect(document.activeElement).toBe(field);
  });

  it('every starter is a button — nothing here is a capsule that does nothing', () => {
    open();
    const starters = screen.getAllByTestId('voice-starter');
    expect(starters).toHaveLength(3);
    for (const s of starters) expect(s.tagName).toBe('BUTTON');
  });

  it('a starter appends rather than replacing what has already been said', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('Quiet start this month.'); });
    fireEvent.click(screen.getAllByTestId('voice-starter')[2]!);

    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value)
      .toBe('Quiet start this month. Can we do more ');
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
  it('the DRAFT framing shapes the month, and its starters lead into shaping intents', () => {
    open({ context: 'draft' });
    expect(screen.getByTestId('voice-framing').textContent).toContain('we’ll reshape it');
    expect(screen.getAllByTestId('voice-starter').map((n) => n.textContent))
      .toEqual(['We’re launching…', 'There’s an event on…', 'Can we do more…']);
  });

  it('the COMMITTED framing says nothing moves until they say so, and offers correcting verbs', () => {
    open({ context: 'committed' });
    const blurb = screen.getByTestId('voice-framing').textContent ?? '';
    // The consequence is the whole reason the sheet exists on this month: the agent APPLIES
    // NOTHING here, and the copy must not imply the month has already changed.
    expect(blurb).toContain('October is written');
    expect(blurb).toContain('approve');
    expect(blurb).toContain('nothing moves until you say so');
    expect(screen.getAllByTestId('voice-starter').map((n) => n.textContent))
      .toEqual(['Move the…', 'Take out the…', 'Rewrite the…']);
  });

  it('but the CAPTURE is identical — same mic, same meter, same dual input, same submit', () => {
    for (const context of ['draft', 'committed'] as const) {
      const { onSubmit } = open({ context });
      expect(screen.getByTestId('voice-mic')).toBeTruthy();
      expect(screen.getByTestId('waveform')).toBeTruthy();
      expect(screen.getByTestId('voice-mode')).toBeTruthy();

      fireEvent.click(screen.getByTestId('voice-mic'));
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
