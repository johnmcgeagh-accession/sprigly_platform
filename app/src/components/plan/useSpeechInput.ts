'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { micTrace } from './mic-trace';

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
  /** The audio capture opened. THE signal that the microphone is genuinely live. */
  onaudiostart?: (() => void) | null;
  onaudioend?: (() => void) | null;
  /** Speech detected / stopped. What the synthetic meter is driven from. */
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  start(): void; stop(): void; abort?(): void;
}
type RecognitionCtor = new () => Recognition;

export type SpeechState = 'idle' | 'starting' | 'recording' | 'unsupported' | 'no-permission' | 'error';

/**
 * Transcribe speech into text via the browser's Web Speech API.
 *
 * ── ONE CAPTURE. THE WHOLE FILE IS ABOUT THAT. ───────────────────────────────────────
 *
 * The previous fix made this hook correct about recognition-versus-recognition and, in doing
 * so, introduced the fault it was trying to cure. It called `getUserMedia` to warm the
 * permission before starting recognition:
 *
 *     if (!canPrime()) { spawn(); return; }
 *     void prime().then((ok) => { if (ok && wantRef.current) spawn(); });
 *
 * Two things wrong with that on iOS Safari, and both are structural rather than probabilistic:
 *
 * 1. **A SECOND CAPTURE.** `prime()` opened a `getUserMedia` stream and stopped its tracks —
 *    but a WebKit audio session is torn down asynchronously, so `rec.start()` fired while the
 *    priming session was still releasing. That is exactly the class of race the last fix
 *    identified for recognition-vs-recognition; it was reintroduced one layer down, between a
 *    different pair of consumers. And the meter opens a THIRD (`Waveform.tsx`), which on iOS
 *    is live at the same time as recognition.
 *
 * 2. **THE GESTURE CHAIN WAS BROKEN.** `spawn()` ran inside a `.then()` — a microtask after an
 *    `await`. WebKit's transient user activation does not survive that. On a first, cold open,
 *    where the permission prompt is still needed, recognition therefore asked for a microphone
 *    from a context that no longer counted as user-initiated.
 *
 * So: no `getUserMedia` here at all, and `rec.start()` runs SYNCHRONOUSLY inside `start()`, in
 * the same task as the gesture that called it. Permission state is read through
 * `navigator.permissions` where available, which is a query and not an acquisition.
 *
 * ── What survives from the last fix, because it was right ────────────────────────────
 *
 * A session is never constructed on top of one that has not fired `onend` (`pendingRef` holds
 * the intent and `onend` replays it); a session iOS ends on its own is picked back up
 * (`wantRef`); `no-speech` and `aborted` are not failures.
 *
 * ── What it reports upward, and why it is not just a boolean ─────────────────────────
 *
 * `audioLive` — `onaudiostart` fired and `onaudioend` has not. This is the only honest answer
 * to "is the microphone actually open", and the UI had no access to it: it was inferring from
 * `state === 'recording'`, which only means we asked.
 *
 * `speaking` — `onspeechstart`/`onspeechend`/`onresult`. Kept as an honest capture fact; the
 * meter it used to drive is deleted (F4), and with it the `pulse` counter, which existed only to
 * give an animation something to tick on and re-rendered the sheet several times a second for it.
 *
 * `partial` — the words the engine has heard and not finalised. It is no longer a preview
 * rendered beside the field: the sheet writes it INTO the field (`VoiceSheet`), which is what
 * makes a stopped capture keep its tail instead of losing it. See `onresult` below.
 */
export function useSpeechInput(onChunk: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  /** The capture is genuinely open — `onaudiostart` seen, `onaudioend` not yet. */
  const [audioLive, setAudioLive] = useState(false);
  /** The recogniser is hearing speech right now. */
  const [speaking, setSpeaking] = useState(false);
  /** The words the engine has heard but not finalised — the live preview the composer shows
   *  while the client is still talking. Replaced by each interim, cleared by the final. */
  const [partial, setPartial] = useState('');

  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const pendingRef = useRef(false);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  /**
   * ── Why `onresult` drives `speaking`, and why the pulses used to WAIT (F7b → C2) ─────
   *
   * The one-pipeline fix specified a meter driven by the recogniser's own events and wired
   * `speaking` to `onspeechstart`/`onspeechend` alone. iOS WebKit does not reliably fire
   * either — words arrive through `onresult` while `speaking` stays false forever — so on
   * exactly the platform the activity meter exists for, the bars never moved.
   *
   * F7b fixed the FLAG by marking `speaking` on `onresult`. It did not fix the TIMING, and the
   * operator's video is the timing: the bars sat still while they talked and only twitched
   * when they stopped. The cause is one line — `interimResults = false`. With interims off, a
   * `SpeechRecognition` fires `onresult` ONCE PER UTTERANCE, at the end, when the engine has
   * finalised the phrase. Every pulse the meter had was therefore a report that a sentence had
   * already finished. A live meter cannot be driven by an end-of-sentence event.
   *
   * So interims are ON now. They arrive continuously while speech is in progress — several a
   * second — which is what a meter needs, and they are what streams the transcript into the
   * composer as the client talks. Only FINAL results are appended to the text (see `onresult`);
   * interims move the bars, stream the preview, and are discarded.
   *
   * A result IS speech detected — stronger evidence than `onspeechstart`, which merely claims
   * it. A decay timer clears `speaking` after RESULT_SPEECH_MS of no further signs of life;
   * `onspeechend` still clears immediately where it exists; real silence still flatlines,
   * because silence produces no results of either kind.
   */
  const speakDecay = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Shorter than the old 2s: interims arrive several times a second, so a gap this long
   *  already means the client has stopped. Long enough to ride out the pause between words. */
  const RESULT_SPEECH_MS = 900;
  const markSpeaking = useCallback(() => {
    setSpeaking(true);
    if (speakDecay.current) clearTimeout(speakDecay.current);
    speakDecay.current = setTimeout(() => setSpeaking(false), RESULT_SPEECH_MS);
  }, []);
  const clearSpeaking = useCallback(() => {
    if (speakDecay.current) { clearTimeout(speakDecay.current); speakDecay.current = null; }
    setSpeaking(false);
    setPartial('');   // nothing is being heard, so there is no preview to show
  }, []);

  const getCtor = (): RecognitionCtor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  };

  useEffect(() => { if (!getCtor()) { micTrace('rec:unsupported'); setState('unsupported'); } }, []);

  /**
   * Read the permission WITHOUT taking the microphone.
   *
   * `permissions.query` is a query: no audio session, no capture, no user-activation spend. It
   * is the whole reason the old `getUserMedia` warm-up can go — the only thing that call bought
   * us was the ability to say "denied" out loud, and this says it for free. Not universally
   * supported (and Firefox does not expose `microphone` at all), so a null answer means
   * "unknown", never "denied".
   */
  const readPermission = useCallback(async (): Promise<'granted' | 'denied' | 'prompt' | null> => {
    try {
      const p = (navigator as unknown as { permissions?: { query(d: { name: string }): Promise<{ state: string }> } }).permissions;
      if (!p?.query) return null;
      const r = await p.query({ name: 'microphone' });
      return (r.state as 'granted' | 'denied' | 'prompt') ?? null;
    } catch { return null; }
  }, []);

  const spawn = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) { setState('unsupported'); return; }
    try {
      const rec = new Ctor();
      // INTERIMS ON (C2). Off, `onresult` fires once per utterance AT THE END — so every pulse
      // the meter had was a report that a sentence was already over, and the bars only moved
      // when the client stopped talking. Interims arrive while speech is in progress, which is
      // what a live meter and a streaming transcript both need. Only FINALS are kept.
      rec.continuous = true; rec.interimResults = true; rec.lang = 'en-GB';

      rec.onstart = () => { micTrace('rec:start'); if (wantRef.current) setState('recording'); };
      // The capture is open. Not "we asked for it" — open.
      rec.onaudiostart = () => { micTrace('rec:audiostart'); setAudioLive(true); if (wantRef.current) setState('recording'); };
      rec.onaudioend = () => { micTrace('rec:audioend'); setAudioLive(false); clearSpeaking(); };
      rec.onspeechstart = () => { micTrace('rec:speechstart'); markSpeaking(); };
      rec.onspeechend = () => { micTrace('rec:speechend'); clearSpeaking(); };

      rec.onresult = (e) => {
        // A result proves the session is live whatever `onstart` did — AND it is speech
        // detected, on engines that never fire onspeechstart (F7b).
        if (wantRef.current) setState((s) => (s === 'starting' ? 'recording' : s));
        markSpeaking();
        /**
         * FINALS are appended; INTERIMS replace each other and are reported through `partial`.
         *
         * THE CONSUMER CHANGED, AND IT IS THE WHOLE OF F4's RELIABILITY HALF. `partial` used to
         * be rendered as a preview beside the composer and discarded, so words could only reach
         * the field through a FINAL — and a final is not guaranteed to arrive. `stop()` on iOS
         * tears the session down without flushing a part-recognised utterance; `onend` restarts
         * a session WebKit ended by itself and the tail goes with it; `clearSpeaking` below
         * wipes `partial` on `speechend` and `audioend`. Each of those lost a sentence the
         * client had watched appear. The sheet now writes `partial` into the field itself, so
         * what has been heard is already where it is going.
         */
        let got = 0;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r?.[0]?.transcript?.trim();
          if (!t) continue;
          if (r?.isFinal) { got += t.length; onChunkRef.current(t); }
          else interim = interim ? `${interim} ${t}` : t;
        }
        setPartial(got ? '' : interim);   // a final consumed it — the preview's job is done
        micTrace('rec:result', got ? `${got} chars` : `interim ${interim.length}`);
      };

      rec.onerror = (e) => {
        micTrace('rec:error', e.error);
        const denied = e.error === 'not-allowed' || e.error === 'service-not-allowed';
        // 'no-speech' and 'aborted' are ordinary: a silence, or our own stop. Treating them as
        // failures is what made a client pausing to think look like a broken microphone.
        if (denied) { wantRef.current = false; pendingRef.current = false; setState('no-permission'); }
        else if (e.error !== 'no-speech' && e.error !== 'aborted') setState('error');
      };

      rec.onend = () => {
        micTrace('rec:end', wantRef.current ? 'wanted → restart' : 'done');
        recRef.current = null;
        setAudioLive(false); clearSpeaking();
        if (pendingRef.current || wantRef.current) {
          pendingRef.current = false;
          if (wantRef.current) { spawn(); return; }
        }
        setState((s) => (s === 'recording' || s === 'starting' ? 'idle' : s));
      };

      micTrace('rec:construct');
      rec.start();
      recRef.current = rec;
      setState((s) => (s === 'recording' ? s : 'starting'));
    } catch (err) {
      // Constructed but refused to start — almost always a previous session still closing.
      // Keep the intent; the live instance's `onend` replays it.
      micTrace('rec:start-threw', (err as Error)?.name ?? 'error');
      recRef.current = null;
      if (wantRef.current) pendingRef.current = true; else setState('error');
    }
  }, [markSpeaking, clearSpeaking]);

  /**
   * Begin listening. **Synchronous on the gesture's own task** — nothing is awaited before
   * `rec.start()`, because WebKit's user activation does not survive an await and the cold-start
   * permission prompt depends on it.
   */
  const start = useCallback(() => {
    if (!getCtor()) { setState('unsupported'); return; }
    micTrace('hook:start', recRef.current ? 'a session is still open' : 'clear');
    wantRef.current = true;
    setState((s) => (s === 'recording' ? s : 'starting'));
    if (recRef.current) { pendingRef.current = true; try { recRef.current.stop(); } catch { /* noop */ } return; }
    spawn();
    // Off the critical path, purely so a denial can be NAMED rather than sat in. This runs
    // after the start above and can never delay it.
    void readPermission().then((p) => {
      if (p) micTrace('perm:query', p);
      if (p === 'denied') { wantRef.current = false; setState('no-permission'); }
    });
  }, [spawn, readPermission]);

  const stop = useCallback(() => {
    micTrace('hook:stop');
    wantRef.current = false;
    pendingRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    // NOT nulled: the instance must live until its own `onend`, or the next start lands on a
    // session WebKit has not released.
    clearSpeaking();
    setState((s) => (s === 'recording' || s === 'starting' ? 'idle' : s));
  }, [clearSpeaking]);

  useEffect(() => () => {
    wantRef.current = false; pendingRef.current = false;
    try { recRef.current?.stop(); } catch { /* noop */ }
  }, []);

  const listening = state === 'recording' || state === 'starting';
  return { state, listening, audioLive, speaking, partial, start, stop, toggle: () => (listening ? stop() : start()) };
}
