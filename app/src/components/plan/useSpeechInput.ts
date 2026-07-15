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
  start(): void; stop(): void;
}
type RecognitionCtor = new () => Recognition;

export type SpeechState = 'idle' | 'recording' | 'unsupported' | 'no-permission' | 'error';

/**
 * Transcribe speech into text via the browser's Web Speech API (no backend needed — there is no
 * server transcribe service to wire). Final transcript chunks are handed to `onChunk`, which the
 * caller appends into the editable input. Degrades gracefully: unsupported browsers report
 * 'unsupported' (caller hides the mic); a denied mic permission reports 'no-permission'.
 */
export function useSpeechInput(onChunk: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const recRef = useRef<Recognition | null>(null);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  const getCtor = (): RecognitionCtor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  };

  useEffect(() => { if (!getCtor()) setState('unsupported'); }, []);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
    setState((s) => (s === 'recording' ? 'idle' : s));
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) { setState('unsupported'); return; }
    try {
      const rec = new Ctor();
      rec.continuous = true; rec.interimResults = false; rec.lang = 'en-GB';
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]; if (r?.isFinal) { const t = r[0]?.transcript?.trim(); if (t) onChunkRef.current(t); }
        }
      };
      rec.onerror = (e) => { setState(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'no-permission' : 'error'); recRef.current = null; };
      rec.onend = () => setState((s) => (s === 'recording' ? 'idle' : s));
      rec.start();
      recRef.current = rec;
      setState('recording');
    } catch { setState('error'); recRef.current = null; }
  }, []);

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  return { state, start, stop, toggle: () => (state === 'recording' ? stop() : start()) };
}
