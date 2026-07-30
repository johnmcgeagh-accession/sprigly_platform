/**
 * @vitest-environment jsdom
 *
 * voice-sheet.interaction.test.tsx — the CAPTURE pipeline, on the conversation sheet.
 *
 * The Web Speech API is stubbed with a recogniser this file controls, so a "spoken" chunk is a
 * real path through `useSpeechInput` rather than a mocked hook. The thread-flow coverage lives
 * in conversation-sheet.interaction.test.tsx; this file keeps the microphone honest — the
 * one-capture rules, the source attribution, the refusal states — none of which the layout
 * change was allowed to touch.
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
  onaudiostart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;
  static built = 0;
  constructor() { FakeRecognition.built += 1; }
  start() { this.started = true; FakeRecognition.live = this; this.onstart?.(); this.onaudiostart?.(); }
  stop() { this.started = false; this.onend?.(); }
  say(text: string) { this.hear(text, true); }
  /** The real API's shape: interims arrive while speech is in progress, finals at the end. */
  hear(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal, 0: { transcript: text } } } });
  }
}

const speechSupported = () => { (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition; };

function open(over: Partial<React.ComponentProps<typeof VoiceSheet>> = {}) {
  const onSubmit = vi.fn(async () => ({ ok: true as const, message: 'ok' }));
  const onClose = vi.fn();
  render(<VoiceSheet open monthName="October" cycleId="cyc-1" busy={false} onClose={onClose} onSubmit={onSubmit} {...over} />);
  return { onSubmit, onClose };
}

const composer = () => screen.getByTestId('voice-input') as HTMLTextAreaElement;

beforeEach(() => {
  FakeRecognition.live = null;
  speechSupported();
  window.sessionStorage.clear();
  // The thread loads over fetch; an empty history is the deterministic baseline here.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ conversationId: null, turns: [] }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

/**
 * ── THE SHEET OPENS ON THE KEYBOARD (C2, operator ruling) ────────────────────────────
 *
 * This reverses round 8's "it listens the moment it opens". Opening a live microphone on
 * sight is a decision made FOR the client, and the wrong one on a sheet that is now a chat:
 * a text panel with focus, and a mic you TAP. The capture rules underneath are unchanged —
 * one session, synchronous start on the tap's own task, released on close.
 */
describe('the microphone is a TAP control on a keyboard-first composer', () => {
  it('does NOT open listening — the composer has focus and the mic is idle', () => {
    open();
    expect(FakeRecognition.live).toBeNull();
    expect(screen.getByTestId('voice-mic').getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(composer());
  });

  it('the mic entry point behaves the same — both entries open a chat', () => {
    open({ entry: 'mic' });
    expect(FakeRecognition.live).toBeNull();
    expect(document.activeElement).toBe(composer());
  });

  it('TAPPING it starts listening, and tapping again stops', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    expect(FakeRecognition.live).not.toBeNull();
    expect(FakeRecognition.live!.started).toBe(true);
    expect(screen.getByTestId('voice-mic').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('voice-state').textContent).toContain('Go ahead');

    fireEvent.click(screen.getByTestId('voice-mic'));
    expect(FakeRecognition.live!.started).toBe(false);
  });

  it('INTERIM RESULTS ARE ON — a live meter cannot be driven by an end-of-sentence event', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    expect(FakeRecognition.live!.interimResults).toBe(true);
  });

  it('an interim streams as a preview and is NOT written into the field; the final is', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.hear('the candle relaunches', false); });
    expect(screen.getByTestId('voice-partial').textContent).toBe('the candle relaunches');
    expect(composer().value).toBe('');                     // the client's own typing is safe

    act(() => { FakeRecognition.live!.hear('The candle relaunches on the 24th.', true); });
    expect(composer().value).toBe('The candle relaunches on the 24th.');
    expect(screen.queryByTestId('voice-partial')).toBeNull();
  });

  it('takes the microphone ONCE, not once per render', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    const built = FakeRecognition.built;
    act(() => { FakeRecognition.live!.say('anything'); });
    expect(FakeRecognition.built).toBe(built);
  });

  it('releases it when the sheet closes', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    const rec = FakeRecognition.live!;
    fireEvent.click(screen.getByTestId('voice-close'));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(rec.started).toBe(false);
  });

  it('the meter strip renders inline while capturing, and leaves when it stops', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    expect(screen.getByTestId('waveform').getAttribute('data-active')).toBe('true');
    fireEvent.click(screen.getByTestId('voice-mic'));      // stop
    expect(screen.queryByTestId('waveform')).toBeNull();   // the strip is FOR the capture
  });
});

describe('capture lands in the one composer', () => {
  it('a spoken phrase lands in the composer field — keyboard and voice are one flow', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('The Wilderness candle relaunches on the 24th'); });
    expect(composer().value).toBe('The Wilderness candle relaunches on the 24th');
  });

  it('two phrases join with a space rather than replacing each other', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th.'); });
    act(() => { FakeRecognition.live!.say('Can we build up to it?'); });
    expect(composer().value).toBe('The candle relaunches on the 24th. Can we build up to it?');
  });

  it('SUBMITS AS VOICE when any of it came through the microphone (gap 8)', async () => {
    const { onSubmit } = open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('More product this month'); });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
    expect(onSubmit).toHaveBeenCalledWith('More product this month', 'voice', null, []);
  });

  it('and as WEB when it was typed — even on a mic-opened sheet', async () => {
    const { onSubmit } = open();
    fireEvent.change(composer(), { target: { value: 'More product this month' } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
    expect(onSubmit).toHaveBeenCalledWith('More product this month', 'web', null, []);
  });

  it('an unsupported browser says what to do instead, beside the control', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    open();
    expect(screen.getByTestId('voice-state').textContent).toContain('Type it instead');
    expect((screen.getByTestId('voice-mic') as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toMatch(/arrives later|coming soon|not yet available/i);
  });

  it('a refused microphone reports itself as an alert rather than failing silently', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.onerror?.({ error: 'not-allowed' }); });
    const state = screen.getByTestId('voice-state');
    expect(state.textContent).toContain('microphone');
    expect(state.getAttribute('role')).toBe('alert');
  });
});

describe('submitting', () => {
  it('refuses an empty send rather than posting nothing', () => {
    const { onSubmit } = open();
    expect((screen.getByTestId('voice-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('voice-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('the wordless arrow carries its name for a screen reader (X2 stands)', () => {
    open();
    expect(screen.getByTestId('voice-submit').getAttribute('aria-label')).toBe('Send this to Sprigly');
  });

  it('is inert while a write is in flight', () => {
    const { onSubmit } = open({ busy: true });
    fireEvent.change(composer(), { target: { value: 'anything' } });
    fireEvent.click(screen.getByTestId('voice-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter sends; Shift+Enter stays a newline', async () => {
    const { onSubmit } = open({ entry: 'type' });
    fireEvent.change(composer(), { target: { value: 'move the Thursday post' } });
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(composer(), { key: 'Enter' }); });
    expect(onSubmit).toHaveBeenCalledWith('move the Thursday post', 'web', null, []);
  });
});

describe('framing and identity', () => {
  it('the sheet is titled for its context, so a screen reader hears which one it is', () => {
    open({ context: 'committed' });
    expect(screen.getByTestId('voice-sheet').getAttribute('aria-label')).toBe('Talk to your plan');
    cleanup();
    speechSupported();
    open({ context: 'draft' });
    expect(screen.getByTestId('voice-sheet').getAttribute('aria-label')).toBe('Tell us about October');
  });

  it('the placeholders keep the one example each context is allowed', () => {
    open({ context: 'committed' });
    expect(composer().placeholder).toBe('Move the Thursday post to Friday');
    cleanup();
    speechSupported();
    open({ context: 'draft' });
    expect(composer().placeholder).toContain('relaunches on the 24th');
  });

  it('no starters, and no invitation to try starting with anything (round 8, fix 6 stands)', () => {
    for (const context of ['draft', 'committed'] as const) {
      open({ context });
      expect(screen.queryAllByTestId('voice-starter')).toHaveLength(0);
      expect(document.body.textContent).not.toMatch(/try starting with/i);
      cleanup();
      speechSupported();
    }
  });
});
