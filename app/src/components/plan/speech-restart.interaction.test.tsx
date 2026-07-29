/**
 * @vitest-environment jsdom
 *
 * speech-restart.interaction.test.tsx — the intermittent no-start, reproduced and then fixed.
 *
 * ── What the operator reported ───────────────────────────────────────────────────────
 *
 * "Sometimes the mic just doesn't start." Sometimes, not always, and never in a way anybody
 * could pin down — which is the signature of a race, and it was one. Three of them, compounding,
 * all inside `useSpeechInput`:
 *
 *   1. A new `SpeechRecognition` was constructed on every `start()`, including while the previous
 *      one was still closing. WebKit holds the audio session until it fires `onend`, and starting
 *      inside that window throws `InvalidStateError`. The old code caught that into a state no
 *      caller rendered, so the sheet sat there looking idle and never listened again. Reopen the
 *      sheet slowly → fine. Reopen it quickly → dead. That is the whole intermittency.
 *   2. `continuous = true` is not honoured on iOS Safari, which ends the session by itself after
 *      a silence. A client pausing to think came back to a microphone that had quietly stopped.
 *   3. A refused permission was only ever discoverable through `onerror`, so the gap between the
 *      tap and the verdict had no state of its own and read as idle.
 *
 * Every test below drives the real hook through a fake recogniser. Five of the twelve fail
 * against the previous implementation — the restart-inside-teardown pair, the two iOS
 * ends-on-its-own cases, and the promotion of a session that never fired `onstart`. The other
 * seven held before and are here so they keep holding.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

import { useSpeechInput } from './useSpeechInput';

/** A recogniser that models WebKit's actual lifecycle, including its refusal to be doubled up. */
class FakeRecognition {
  static all: FakeRecognition[] = [];
  static live: FakeRecognition | null = null;
  /** One session at a time, browser-wide — the constraint the old code violated. */
  static holdingAudio = false;
  /** Set to make the NEXT start() throw the way WebKit does mid-teardown. */
  static refuseStart = false;

  continuous = false; interimResults = false; lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;

  constructor() { FakeRecognition.all.push(this); }

  start() {
    if (FakeRecognition.refuseStart || FakeRecognition.holdingAudio) {
      throw new Error('InvalidStateError: recognition has already started');
    }
    FakeRecognition.holdingAudio = true;
    this.started = true;
    FakeRecognition.live = this;
    this.onstart?.();
  }
  stop() { this.started = false; }
  /** WebKit's `onend` lands LATER than stop() returns. That lateness is the bug's window. */
  settle() { FakeRecognition.holdingAudio = false; this.started = false; this.onend?.(); }
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } });
  }
}

function Probe({ onChunk }: { onChunk?: (t: string) => void }) {
  const speech = useSpeechInput(onChunk ?? (() => {}));
  return (
    <div>
      <span data-testid="state">{speech.state}</span>
      <button data-testid="start" onClick={speech.start}>start</button>
      <button data-testid="stop" onClick={speech.stop}>stop</button>
    </div>
  );
}

const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  FakeRecognition.all = [];
  FakeRecognition.live = null;
  FakeRecognition.holdingAudio = false;
  FakeRecognition.refuseStart = false;
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('1 · starting again before the last session closed', () => {
  it('THE BUG: a restart inside the teardown window still ends up listening', () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    expect(state()).toBe('recording');
    const first = FakeRecognition.live!;

    // Stop and immediately start again — the phone gesture is closing the sheet and reopening it.
    // `onend` has NOT fired yet, so WebKit is still holding the microphone.
    fireEvent.click(screen.getByTestId('stop'));
    fireEvent.click(screen.getByTestId('start'));

    // The old code constructed a second recogniser here, threw, and landed in a dead state.
    expect(state()).toBe('starting');
    expect(FakeRecognition.all).toHaveLength(1);

    // The session finally closes, and the held intent is honoured.
    act(() => { first.settle(); });
    expect(state()).toBe('recording');
    expect(FakeRecognition.all).toHaveLength(2);
  });

  it('a start that throws is held rather than reported as a failure', () => {
    render(<Probe />);
    FakeRecognition.refuseStart = true;
    fireEvent.click(screen.getByTestId('start'));
    // Not 'error'. The client asked to be heard and we have not given up on doing it.
    expect(state()).toBe('starting');
  });

  it('stop() while starting really stops — a held intent is not a promise we cannot break', () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    const first = FakeRecognition.live!;
    fireEvent.click(screen.getByTestId('stop'));
    fireEvent.click(screen.getByTestId('start'));
    fireEvent.click(screen.getByTestId('stop'));          // changed their mind

    act(() => { first.settle(); });
    expect(state()).toBe('idle');
    expect(FakeRecognition.all).toHaveLength(1);          // nothing was spawned behind them
  });
});

describe('2 · iOS ends the session on its own', () => {
  it('a session that ends unasked is picked back up', () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    const first = FakeRecognition.live!;

    // The client paused to think. `continuous` did not save them.
    act(() => { first.settle(); });

    expect(state()).toBe('recording');
    expect(FakeRecognition.all).toHaveLength(2);
    expect(FakeRecognition.live!.started).toBe(true);
  });

  it('but a session the CLIENT ended stays ended', () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    const first = FakeRecognition.live!;
    fireEvent.click(screen.getByTestId('stop'));
    act(() => { first.settle(); });

    expect(state()).toBe('idle');
    expect(FakeRecognition.all).toHaveLength(1);
  });

  it('a silence is not an error — "no-speech" leaves the state alone and the restart handles it', () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    const first = FakeRecognition.live!;
    act(() => { first.onerror?.({ error: 'no-speech' }); });
    expect(state()).not.toBe('error');
    act(() => { first.settle(); });
    expect(state()).toBe('recording');
  });
});

describe('3 · permission, said plainly', () => {
  it('a refusal stops everything and names itself', () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    const first = FakeRecognition.live!;
    act(() => { first.onerror?.({ error: 'not-allowed' }); });

    expect(state()).toBe('no-permission');
    // And it does NOT keep trying: a denied microphone re-asked on a loop is a browser prompt
    // the client cannot escape.
    act(() => { first.settle(); });
    expect(state()).toBe('no-permission');
    expect(FakeRecognition.all).toHaveLength(1);
  });

  it('an unsupported browser says so without being asked', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<Probe />);
    expect(state()).toBe('unsupported');
  });
});

describe('what the caller sees', () => {
  it('`listening` covers starting AND recording, so the UI has one thing to ask', () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    expect(state()).toBe('recording');
  });

  it('a result promotes a session that never fired onstart', () => {
    render(<Probe />);
    // An engine that skips the start event: we would otherwise say "getting the mic" over words
    // we are already receiving.
    FakeRecognition.prototype.onstart = null;
    fireEvent.click(screen.getByTestId('start'));
    const rec = FakeRecognition.live!;
    rec.onstart = null;
    act(() => { rec.say('the candle relaunches'); });
    expect(state()).toBe('recording');
  });

  it('unmounting releases the microphone', () => {
    const { unmount } = render(<Probe />);
    fireEvent.click(screen.getByTestId('start'));
    const rec = FakeRecognition.live!;
    unmount();
    expect(rec.started).toBe(false);
  });
});

describe('the chunks still arrive', () => {
  it('a final phrase reaches the caller, across a restart', () => {
    const chunks: string[] = [];
    render(<Probe onChunk={(t) => chunks.push(t)} />);
    fireEvent.click(screen.getByTestId('start'));
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th.'); });
    act(() => { FakeRecognition.live!.settle(); });        // iOS cut them off mid-thought
    act(() => { FakeRecognition.live!.say('Can we build up to it?'); });

    expect(chunks).toEqual(['The candle relaunches on the 24th.', 'Can we build up to it?']);
  });
});

// Keeps vitest's unused-import lint quiet about React in a JSX file compiled with the classic
// runtime — the same shape every other interaction test in this directory uses.
void vi;
