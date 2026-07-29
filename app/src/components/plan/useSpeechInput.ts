'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal Web Speech API shapes (not in the TS DOM lib). */
interface SpeechResultAlt { transcript: string }
interface SpeechResult { isFinal: boolean; 0: SpeechResultAlt }
interface SpeechEvent { resultIndex: number; results: { length: number; [i: number]: SpeechResult } }
interface SpeechErrEvent { error: string }
interface Recognition {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: SpeechErrEvent) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  start(): void; stop(): void; abort?(): void;
}
type RecognitionCtor = new () => Recognition;

/**
 * `starting` is new and is the whole point of this rewrite: the gap between asking for the
 * microphone and holding it is real, it is where the failures live, and it used to be reported
 * as `idle` — indistinguishable from "you have not tapped anything yet".
 */
export type SpeechState = 'idle' | 'starting' | 'recording' | 'unsupported' | 'no-permission' | 'error';

/**
 * Transcribe speech into text via the browser's Web Speech API (there is no server transcribe
 * service to wire). Final chunks are handed to `onChunk`, which the caller appends into the
 * editable input.
 *
 * ── The intermittent no-start, and what it actually was ──────────────────────────────
 *
 * The operator's report was that the mic sometimes just does not begin. Three causes, all in
 * this file, and they compound:
 *
 * 1. **A new `SpeechRecognition` was constructed on every `start()` while the previous one was
 *    still tearing down.** `stop()` nulled `recRef` and set `idle` synchronously, but WebKit
 *    holds the audio session until it fires `onend` — tens to hundreds of milliseconds later,
 *    and longer when the page has just been backgrounded. Constructing and starting inside that
 *    window throws `InvalidStateError`. The old `start()` caught it into `setState('error')` —
 *    and no caller rendered anything for `error`. The sheet sat there looking idle, forever.
 *    That is the bug, exactly: reopen the sheet slowly and it works, reopen it quickly and it
 *    does not. `pendingRef` now holds the intent across the teardown and `onend` fulfils it.
 *
 * 2. **`continuous = true` is not honoured on iOS Safari.** It ends the session on its own after
 *    a short silence, so a client pausing to think came back to a dead microphone with no
 *    indication anything had changed. `wantRef` records that the client still intends to be
 *    heard, and a session that ends without being asked to is restarted.
 *
 * 3. **Permission was only ever requested implicitly, by `rec.start()`.** WebKit resolves that
 *    prompt asynchronously and reports refusal through `onerror` — so between the tap and the
 *    verdict there was nothing to show and no way to tell "deciding" from "denied". `prime()`
 *    asks `getUserMedia` directly, which both surfaces the state and warms the permission so the
 *    NEXT start is instant.
 *
 * Degrades as before: no constructor → 'unsupported'; a refusal → 'no-permission'.
 */
export function useSpeechInput(onChunk: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const recRef = useRef<Recognition | null>(null);
  /** The client wants to be heard. Survives a session ending on its own; cleared only by stop(). */
  const wantRef = useRef(false);
  /** A start requested while the previous session was still closing, replayed from `onend`. */
  const pendingRef = useRef(false);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  const getCtor = (): RecognitionCtor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  };

  useEffect(() => { if (!getCtor()) setState('unsupported'); }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    pendingRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    // NOT nulled here. The instance must live until its own `onend` — dropping the reference is
    // what let a second instance be constructed on top of a session WebKit had not released.
    setState((s) => (s === 'recording' || s === 'starting' ? 'idle' : s));
  }, []);

  /** Build and start a session. Assumes nothing is live; only `begin` calls it. */
  const spawn = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) { setState('unsupported'); return; }
    try {
      const rec = new Ctor();
      rec.continuous = true; rec.interimResults = false; rec.lang = 'en-GB';
      rec.onstart = () => { if (wantRef.current) setState('recording'); };
      rec.onresult = (e) => {
        // A result is proof the session is live, whatever `onstart` did or did not do. Cheap
        // insurance against an engine that skips the start event and leaves us saying "getting
        // the mic" over words we are already receiving.
        if (wantRef.current) setState((s) => (s === 'starting' ? 'recording' : s));
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]; if (r?.isFinal) { const t = r[0]?.transcript?.trim(); if (t) onChunkRef.current(t); }
        }
      };
      rec.onerror = (e) => {
        const denied = e.error === 'not-allowed' || e.error === 'service-not-allowed';
        // 'no-speech' and 'aborted' are not failures — WebKit raises them for an ordinary silence
        // or an ordinary stop, and treating them as errors is what made the mic look broken when
        // somebody simply paused. The `onend` that follows decides whether to resume.
        if (denied) { wantRef.current = false; pendingRef.current = false; setState('no-permission'); }
        else if (e.error !== 'no-speech' && e.error !== 'aborted') setState('error');
      };
      rec.onend = () => {
        recRef.current = null;
        // The session ended. Either we owe somebody a start we could not honour earlier, or the
        // client is still talking and iOS ended it under them. Both mean: go again.
        if (pendingRef.current || wantRef.current) {
          pendingRef.current = false;
          if (wantRef.current) { spawn(); return; }
        }
        setState((s) => (s === 'recording' || s === 'starting' ? 'idle' : s));
      };
      rec.start();
      recRef.current = rec;
      setState((s) => (s === 'recording' ? s : 'starting'));
    } catch {
      // Constructed but refused to start — almost always because a previous session is still
      // closing. Keep the intent; the live instance's `onend` will replay it.
      recRef.current = null;
      if (wantRef.current) pendingRef.current = true; else setState('error');
    }
  }, []);

  /**
   * Ask for the microphone directly and HOLD the grant.
   *
   * Two things this buys. It separates "deciding" from "denied", which `rec.start()` alone could
   * not — the prompt resolves out of band and only surfaces through `onerror`. And once granted,
   * the permission is warm for the rest of the session, so opening the sheet a second time starts
   * listening with no prompt and no pause. The track is released immediately: the grant persists,
   * and holding a live stream we do not read would keep the recording indicator lit.
   */
  const prime = useCallback(async (): Promise<boolean> => {
    const md = navigator.mediaDevices!;
    try {
      const stream = await md.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      setState('no-permission');
      return false;
    }
  }, []);

  const canPrime = (): boolean =>
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  /**
   * Begin listening. Safe to call while a previous session is still closing — the intent is held
   * and replayed rather than thrown at a busy audio session.
   */
  const start = useCallback(() => {
    if (!getCtor()) { setState('unsupported'); return; }
    wantRef.current = true;
    setState((s) => (s === 'recording' ? s : 'starting'));
    if (recRef.current) { pendingRef.current = true; try { recRef.current.stop(); } catch { /* noop */ } return; }
    // Where `getUserMedia` exists we ask it first, so "deciding" and "denied" are tellable apart
    // and the grant is warm for next time. Where it does not (an older engine, and jsdom), going
    // straight to `rec.start()` is the ONLY path — and it stays synchronous, so nothing about
    // starting depends on a microtask that a caller cannot see.
    if (!canPrime()) { spawn(); return; }
    void prime().then((ok) => { if (ok && wantRef.current) spawn(); });
  }, [prime, spawn]);

  useEffect(() => () => {
    wantRef.current = false; pendingRef.current = false;
    try { recRef.current?.stop(); } catch { /* noop */ }
  }, []);

  const listening = state === 'recording' || state === 'starting';
  return { state, listening, start, stop, toggle: () => (listening ? stop() : start()) };
}
