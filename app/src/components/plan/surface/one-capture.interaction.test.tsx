/**
 * @vitest-environment jsdom
 *
 * one-capture.interaction.test.tsx — the voice sheet takes the microphone ONCE.
 *
 * ── The evidence this exists for ─────────────────────────────────────────────────────
 *
 * An operator screen recording: the sheet showing "Listening…" with a FLATLINE meter while they
 * spoke for many seconds, and no words ever arriving.
 *
 * The flatline is the tell, and it is why "the recogniser died" was not the whole answer. If
 * only recognition had failed, the analyser — a completely independent `getUserMedia` stream —
 * would still have been drawing bars off their voice. Both were silent. Two consumers, both
 * dead, is not two coincidences: it is one audio session with two claimants.
 *
 * The sheet opened THREE captures on one tap:
 *
 *   1. `useSpeechInput.prime()`  — a `getUserMedia` warm-up, added by the PREVIOUS fix
 *   2. `SpeechRecognition`       — the one that matters
 *   3. `Waveform`                — a second `getUserMedia` for the analyser, live alongside (2)
 *
 * Chromium tolerates that. WebKit arbitrates a single audio session per page, so (3) interrupts
 * (2), and (1) meant (2) was already starting on top of a stream that had not finished
 * releasing. The previous fix, correctly, stopped recognition being constructed on top of
 * closing recognition — and introduced a `getUserMedia` on top of starting recognition one layer
 * down.
 *
 * These tests count acquisitions. They are the guard that the count stays at one, because the
 * fault has now been reintroduced once by a fix aimed at it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { VoiceSheet } from './VoiceSheet';
import { canRunTwoCaptures } from './audio-contention';

/** Every `getUserMedia` call anywhere in the tree, whoever made it. */
const gum = { calls: 0, live: 0 };

class FakeRecognition {
  static live: FakeRecognition | null = null;
  static built = 0;
  continuous = false; interimResults = false; lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  started = false;
  constructor() { FakeRecognition.built += 1; }
  start() { this.started = true; FakeRecognition.live = this; this.onstart?.(); this.onaudiostart?.(); }
  stop() { this.started = false; this.onend?.(); }
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } });
  }
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function setUA(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: /iPhone|iPad/.test(ua) ? 5 : 0, configurable: true });
}

function open(over: Partial<React.ComponentProps<typeof VoiceSheet>> = {}) {
  const onSubmit = vi.fn(async () => ({ ok: true as const }));
  const onClose = vi.fn();
  render(<VoiceSheet open monthName="October" cycleId="cyc-1" busy={false} onClose={onClose} onSubmit={onSubmit} {...over} />);
  return { onSubmit, onClose };
}

beforeEach(() => {
  gum.calls = 0; gum.live = 0;
  // The conversation sheet loads its thread over fetch; an empty history is the baseline.
  // Deliberately NOT counted against the capture budget — it is a network read, not audio.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ conversationId: null, turns: [] }) })));
  FakeRecognition.live = null; FakeRecognition.built = 0;
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        gum.calls += 1; gum.live += 1;
        return { getTracks: () => [{ stop: () => { gum.live -= 1; } }] } as unknown as MediaStream;
      }),
    },
  });
  setUA(IPHONE);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

// C2: the sheet no longer opens listening — every case here TAPS the mic first, which is
// the gesture that starts a capture now. The counting is the point and is unchanged.
describe('on iPhone — one audio session, one claimant', () => {
  it('TAPPING THE MIC TAKES getUserMedia ZERO TIMES', async () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    // Let any stray promise chain settle: a capture deferred into a microtask is still a capture.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(gum.calls, 'the sheet must not open a second capture on WebKit').toBe(0);
    expect(FakeRecognition.built).toBe(1);
    expect(FakeRecognition.live!.started).toBe(true);
  });

  it('the meter runs in ACTIVITY mode, off the recogniser’s own events', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    expect(screen.getByTestId('waveform').getAttribute('data-source')).toBe('activity');
  });

  it('speaking moves it and silence flatlines it — the meter’s one job survives the change', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    const rec = FakeRecognition.live!;
    const bars = () => Array.from(screen.getByTestId('waveform').children).map((b) => (b as HTMLElement).style.height);

    expect(new Set(bars()).size, 'silent = every bar identical').toBe(1);
    act(() => { rec.onspeechstart?.(); });
    act(() => { /* one frame of the rAF wave */ });
    // The wave is driven by rAF, which jsdom runs; a paint may not have landed yet, so assert
    // the state that produces it rather than the pixels.
    expect(screen.getByTestId('waveform').getAttribute('data-active')).toBe('true');
    act(() => { rec.onspeechend?.(); });
    expect(new Set(bars()).size).toBe(1);
  });

  it('and a spoken phrase still lands — the point of all of it', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th'); });
    // Words land in the COMPOSER now — the one field keyboard and voice share.
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value).toBe('The candle relaunches on the 24th');
  });
});

describe('on Chromium — the real analyser is kept', () => {
  beforeEach(() => setUA(CHROME));

  it('uses the analyser, and opens exactly ONE stream for it', async () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('waveform').getAttribute('data-source')).toBe('analyser');
    // One — the meter's. The hook takes none: the priming warm-up is gone everywhere, not just
    // where it was fatal, because it bought nothing that `permissions.query` does not.
    expect(gum.calls).toBe(1);
  });
});

describe('the contention predicate is an ALLOW-list', () => {
  it('says no to every WebKit surface a client can reach', () => {
    for (const ua of [
      IPHONE,
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      // An in-app browser: a client opening the link from Instagram gets a WKWebView.
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0',
    ]) expect(canRunTwoCaptures(ua, 5), ua.slice(0, 40)).toBe(false);
  });

  it('an iPad reporting itself as a Mac is still an iPad', () => {
    const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
    expect(canRunTwoCaptures(IPADOS, 5)).toBe(false);
  });

  it('says no to anything it does not recognise, rather than assuming', () => {
    expect(canRunTwoCaptures('SomeNewBrowser/1.0', 0)).toBe(false);
    expect(canRunTwoCaptures('', 0)).toBe(false);
  });

  it('says yes only to Chromium, which is where coexistence is established', () => {
    expect(canRunTwoCaptures(CHROME, 0)).toBe(true);
    expect(canRunTwoCaptures('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131 Safari/537.36 Edg/131', 0)).toBe(true);
  });
});

describe('"Listening…" now requires a capture that actually opened', () => {
  it('a session that starts but never opens audio is ADMITTED, not claimed as listening', () => {
    vi.useFakeTimers();
    try {
      // The bug, exactly: `onstart` fires — we are "recording" — but `onaudiostart` never does,
      // because the audio session went elsewhere. The old sheet printed "Listening…" over this
      // for as long as the client kept talking.
      const orig = FakeRecognition.prototype.start;
      FakeRecognition.prototype.start = function patched(this: FakeRecognition) {
        this.started = true; FakeRecognition.live = this; this.onstart?.();   // no onaudiostart
      };
      open();
      fireEvent.click(screen.getByTestId('voice-mic'));
      // The three-state heading is gone; the composer's status line carries the same honesty.
      expect(screen.getByTestId('voice-state').textContent).toContain('Go ahead');   // grace: not yet
      act(() => { vi.advanceTimersByTime(3000); });
      const state = screen.getByTestId('voice-state');
      expect(state.textContent).toContain('lost the microphone');
      expect(state.textContent).toContain('nothing is reaching us');
      expect(state.getAttribute('role')).toBe('alert');
      FakeRecognition.prototype.start = orig;
    } finally { vi.useRealTimers(); }
  });

  it('an ordinary pause between utterances does NOT trip it', () => {
    vi.useFakeTimers();
    try {
      open();
      fireEvent.click(screen.getByTestId('voice-mic'));
      const rec = FakeRecognition.live!;
      act(() => { rec.onaudioend?.(); });                 // WebKit does this between phrases
      act(() => { vi.advanceTimersByTime(1200); });       // inside the grace
      act(() => { rec.onaudiostart?.(); });               // and picks straight back up
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.getByTestId('voice-state').textContent).toContain('Go ahead');
    } finally { vi.useRealTimers(); }
  });
});
