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
 *
 * ── F4 CLOSED IT BY SUBTRACTION ──────────────────────────────────────────────────────
 *
 * The meter is deleted, so consumer (3) no longer exists on ANY platform — and with it
 * `audio-contention.ts`, whose whole subject was whether a browser may hold two captures at
 * once. That is not a question this surface asks any more. The count these tests guard is now
 * ZERO everywhere: the sheet takes no `getUserMedia` at all, and `SpeechRecognition` is the one
 * claimant. The tests stay, because a count that is structurally right is exactly the kind that
 * a future convenience re-opens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { VoiceSheet } from './VoiceSheet';

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

  it('there is no meter to be a second claimant — F4 deleted it', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    expect(screen.queryByTestId('waveform')).toBeNull();
    expect(gum.calls).toBe(0);
  });

  it('and a spoken phrase still lands — the point of all of it', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th'); });
    // Words land in the COMPOSER now — the one field keyboard and voice share.
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value).toBe('The candle relaunches on the 24th');
  });
});

describe('on Chromium — where a second capture was ALLOWED, there is still none', () => {
  beforeEach(() => setUA(CHROME));

  it('opens NO stream at all: the analyser went with the meter (F4)', async () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Chromium tolerated two, which is why the meter survived here after WebKit lost it. The
    // ruling deletes the meter outright, so the count is zero on the platform that could
    // afford one — and the contention predicate that arbitrated it is gone with it.
    expect(screen.queryByTestId('waveform')).toBeNull();
    expect(gum.calls).toBe(0);
    expect(FakeRecognition.built).toBe(1);
  });

  it('and a spoken phrase lands in the composer here too', () => {
    open();
    fireEvent.click(screen.getByTestId('voice-mic'));
    act(() => { FakeRecognition.live!.say('The candle relaunches on the 24th'); });
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value).toBe('The candle relaunches on the 24th');
  });
});
