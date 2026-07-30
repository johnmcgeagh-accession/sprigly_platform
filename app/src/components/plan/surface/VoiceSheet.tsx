'use client';

/**
 * VoiceSheet.tsx — the conversation sheet. One thread, one composer, one month.
 *
 * ── The model ────────────────────────────────────────────────────────────────────────
 *
 * The sheet used to be a state machine of PHASES — capture, interpreting, consent — each
 * REPLACING the last, so a question from the agent was a dead end (nothing left to answer
 * with) and a reply lived nowhere once the phase moved on. It is now a THREAD:
 *
 *   CLIENT turns          right-aligned bubbles — the transcript of what they said or typed,
 *                         appearing on submit.
 *   AGENT turns           the AgentVoice register, left — born as the three-dot working state
 *                         and FILLING with content as the turn resolves. The panel grows to
 *                         fit; it is never a full-height empty field.
 *   INTERPRETATION turns  the itemised understood-changes as an agent turn with Apply /
 *                         Discard inline ON the turn (InterpretationTurn). A question from the
 *                         agent is just a turn — the composer answers it. The dead end is gone
 *                         by construction, because the composer never unmounts.
 *
 * The thread is PERSISTED per cycle (GET /api/plan/conversation — conversations /
 * agent_messages, the tables every turn already wrote), so it survives a close, a reload and a
 * fresh magic-link open; and it is SENT with every turn (bounded window, threadForParser), so
 * "move it back" resolves against the previous exchange.
 *
 * ── What stays ───────────────────────────────────────────────────────────────────────
 *
 * The machinery beneath is untouched: the recognition pipeline (useSpeechInput — one capture,
 * synchronous start on the gesture's task), extraction, interpretation derivation (lineFor),
 * apply/discard (F4: background, quiet, changedPostIds), receipts. The surface reorganises
 * around it.
 *
 * ── Status ───────────────────────────────────────────────────────────────────────────
 *
 * ONE working indicator: the working turn's dots. The old three-state heading and its copy
 * collapse into a single composer status line for the MICROPHONE's honest states (getting /
 * listening / lost / refused / unsupported) — those are facts about the capture, not about the
 * agent, and they live beside the control they describe.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { MicGlyph, SendGlyph, CloseGlyph } from './icons';
import { Waveform } from './Waveform';
import { AgentSays } from './AgentVoice';
import { InterpretationTurn, type InterpretationStatus } from './Interpretation';
import { agentLines } from './agent-prose';
import type { InterpretedItem } from '@/lib/agent/types';
import type { ConversationTurn } from '@/lib/agent/conversation';
import { useSpeechInput } from '../useSpeechInput';
import { MicTracePanel } from '../MicTracePanel';

export type VoiceContext = 'draft' | 'committed';

/**
 * What a submitted sentence produced. `items` → an interpretation turn; `message` → an agent
 * text turn (a query answer, a draft receipt's lines). `{ok:false}` keeps the composer's words —
 * a dictated brief lost to a network error is the one loss a toast cannot undo.
 */
export type VoiceOutcome =
  | { ok: false }
  | { ok: true; items?: readonly InterpretedItem[]; message?: string; conversationId?: string | null };

/** What an apply settled to — the confirmation turn's own sentence. */
export interface ApplyReport { text: string }

interface Framing { title: string; blurb: string; placeholder: string }

const FRAMING: Record<VoiceContext, (monthName: string) => Framing> = {
  draft: (m) => ({
    title: `Tell us about ${m}`,
    // The framing is the agent's FIRST TURN in an empty conversation, not chrome: the sheet
    // opens as a conversation already in progress, with the agent having spoken first.
    blurb: `This is your ${m} draft. Tell me what’s happening and I’ll reshape it — what’s launching, what’s on, what you want more of.`,
    placeholder: 'The Wilderness candle relaunches on the 24th…',
  }),
  committed: (m) => ({
    title: `Talk to your plan`,
    blurb: `${m} is written. Say what you want different — I’ll show you exactly what I’ll change before anything moves.`,
    placeholder: 'Move the Thursday post to Friday',
  }),
};

/** How long `onaudioend` is tolerated before the composer stops claiming to be listening.
 *  WebKit fires it between utterances, so this has to outlast an ordinary pause. */
const AUDIO_GRACE_MS = 2500;

/** One turn of the on-screen thread. Persisted turns carry a server id; live ones a local key. */
type ThreadTurn =
  | { key: string; kind: 'user'; text: string }
  | { key: string; kind: 'agent'; text?: string | undefined; working?: boolean }
  | { key: string; kind: 'interpretation'; items: InterpretedItem[]; status: InterpretationStatus };

let localKey = 0;
const nextKey = () => `local-${++localKey}`;

export function VoiceSheet({
  open, monthName, busy, question, context = 'draft', cycleId, entry = 'mic',
  onClose, onSubmit, onApply, onDiscard, isPending,
}: {
  open: boolean;
  monthName: string;
  busy: boolean;
  /** Which month state this thread belongs to — chooses the framing turn and the placeholder. */
  context?: VoiceContext;
  /** The month on screen — the thread is per-cycle, and this names which. */
  cycleId: string;
  /** How the sheet was opened. The mic entry starts listening on the gesture's own task; the
   *  typed entry focuses the composer instead. Same sheet, same thread either way. */
  entry?: 'mic' | 'type';
  /** The assumption being answered, when opened from the nudge. It arrives as the agent's next
   *  turn — a question in the thread, answered through the composer like any other. */
  question?: string | undefined;
  onClose: () => void;
  /** `conversationId` is THIS session's — the caller sends it so every turn, and the parser's
   *  context window with it, belongs to the conversation the client is having now. */
  onSubmit: (text: string, source: 'web' | 'voice', conversationId: string | null) => Promise<VoiceOutcome>;
  /** Apply the turn's changes — F4: fire the background work and resolve with the settled
   *  outcome, which becomes the confirmation turn. The sheet does not block on it. The turn's
   *  own items ride along so the caller can compose its chip and failure copy from them — a
   *  reopened thread's turn has no in-memory reply to read them from. */
  onApply?: ((proposalIds: string[], items: readonly InterpretedItem[]) => Promise<ApplyReport>) | undefined;
  onDiscard?: ((proposalIds: string[]) => void) | undefined;
  /** Is this proposal still pending? A reopened interpretation turn is actionable only while
   *  its proposals are — the pending list is the caller's (usePlanData) to know. */
  isPending?: ((proposalId: string) => boolean) | undefined;
}) {
  const [text, setText] = useState('');
  const [loud, setLoud] = useState(false);
  const [turns, setTurns] = useState<ThreadTurn[]>([]);
  /** THIS session's conversation. Sent with every turn, so the context window is the session. */
  const conversationId = useRef<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  /** Any part of the CURRENT composer text arrived through the microphone. The transport is
   *  what actually happened — typed words on a mic-opened sheet are still 'web'. */
  const heard = useRef(false);

  const speech = useSpeechInput((chunk) => { heard.current = true; setText((t) => (t ? `${t} ${chunk}` : chunk)); });
  const listening = speech.state === 'recording';
  const starting = speech.state === 'starting';
  const { start: startSpeech, stop: stopSpeech } = speech;

  const framing = FRAMING[context](monthName);

  /** Map a persisted turn into the on-screen shape. An assistant turn that carried items is an
   *  interpretation turn — actionable only while its proposals are still pending. */
  const fromServer = (t: ConversationTurn): ThreadTurn => {
    if (t.role === 'user') return { key: t.id, kind: 'user', text: t.content };
    if (t.items?.length) {
      const anyPending = t.items.some((i) => i.kind === 'change' && (isPending?.(i.proposalId) ?? false));
      return { key: t.id, kind: 'interpretation', items: t.items, status: anyPending ? 'open' : 'resolved' };
    }
    return { key: t.id, kind: 'agent', text: t.content };
  };

  // ── Open: reset, then load the month's thread ────────────────────────────────────────
  const historyLoaded = useRef(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(''); setLoud(false); setTurns([]); heard.current = false;
      historyLoaded.current = false; conversationId.current = null;   // a new open is a new session
    }
  }

  /**
   * ── ONE SESSION PER OPEN (operator ruling, round 2) ──────────────────────────────────
   *
   * Opening the sheet STARTS a conversation rather than loading the month's. Round 1 made the
   * thread per-cycle and everlasting, so a client arrived at every exchange the month had ever
   * had and had to scroll past it to say one sentence — and the parser's context window was
   * that same list, so a reference from three weeks ago competed with what they had just said.
   *
   * The session's id is carried on every turn (`onSubmit`), which makes it the context window
   * too: "move it back" resolves against THIS conversation and nothing older. Prior
   * conversations stay stored under their own rows; they are simply not asked for.
   */
  useEffect(() => {
    if (!open || historyLoaded.current) return;
    historyLoaded.current = true;
    let cancelled = false;
    // The framing speaks FIRST and immediately — it does not wait on the network, because a
    // sheet that opens blank while a request settles is a sheet that opens broken.
    setTurns([
      { key: 'framing', kind: 'agent', text: framing.blurb },
      ...(question ? [{ key: 'question', kind: 'agent' as const, text: question }] : []),
    ]);
    (async () => {
      try {
        const r = await fetch('/api/plan/conversation', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cycleId }),
        });
        if (!r.ok || cancelled) return;
        const d = (await r.json()) as { conversationId: string | null };
        if (!cancelled && d.conversationId) conversationId.current = d.conversationId;
      } catch { /* no id → the first turn opens one server-side; the session is still one */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one session per open, per cycle
  }, [open, cycleId]);

  // ── The composer's mic — the same one-capture pipeline, demoted to a control ─────────
  // `useLayoutEffect` and a synchronous start remain load-bearing: WebKit's user activation
  // does not survive a later task, and the cold-start permission prompt depends on it.
  useLayoutEffect(() => {
    if (open && entry === 'mic') startSpeech();
    else if (!open) stopSpeech();
  }, [open, entry, startSpeech, stopSpeech]);

  // The typed entry point opens with the keyboard, not the microphone.
  useEffect(() => {
    if (open && entry === 'type') field.current?.focus({ preventScroll: true });
  }, [open, entry]);

  // Honest capture state, held behind the grace (unchanged from the one-pipeline fix).
  const [audioOk, setAudioOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (speech.audioLive) { setAudioOk(true); return; }
    if (!listening) { setAudioOk(null); return; }
    const t = setTimeout(() => setAudioOk(false), AUDIO_GRACE_MS);
    return () => clearTimeout(t);
  }, [speech.audioLive, listening]);
  const stalled = listening && audioOk === false && !starting;

  // ── The thread follows its newest turn ───────────────────────────────────────────────
  const turnCount = turns.length;
  useEffect(() => {
    if (!open || !turnCount) return;
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Optional-called: jsdom has no scrollIntoView, and a missing scroll is not a failure.
    threadEnd.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
  }, [open, turnCount]);

  if (!open) return null;

  const append = (...t: ThreadTurn[]) => setTurns((cur) => [...cur, ...t]);
  const replaceTurn = (key: string, next: ThreadTurn) =>
    setTurns((cur) => cur.map((t) => (t.key === key ? next : t)));
  const patchInterpretation = (key: string, status: InterpretationStatus, items?: InterpretedItem[]) =>
    setTurns((cur) => cur.map((t) =>
      t.key === key && t.kind === 'interpretation' ? { ...t, status, ...(items ? { items } : {}) } : t));

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    speech.stop();
    setText('');
    // The client's turn lands NOW, and the agent's begins as dots — the working state is a
    // turn being born, not a separate status line.
    const workingKey = nextKey();
    append(
      { key: nextKey(), kind: 'user', text: value },
      { key: workingKey, kind: 'agent', working: true },
    );
    const wasHeard = heard.current;
    heard.current = false;
    const out = await onSubmit(value, wasHeard ? 'voice' : 'web', conversationId.current);
    // The server echoes the conversation it used; hold it so the rest of the session lands in
    // the same one even if the open-time POST never answered.
    if (out.ok && out.conversationId) conversationId.current = out.conversationId;
    if (!out.ok) {
      // A refusal keeps the WORDS — back into the composer, with their transport — and the
      // thread stays honest: the working turn is removed rather than filled with something
      // that didn't happen. The failure itself is reported by the caller's channel.
      setTurns((cur) => cur.filter((t) => t.key !== workingKey));
      setText(value);
      heard.current = wasHeard;
      return;
    }
    if (out.items && out.items.length) {
      replaceTurn(workingKey, { key: workingKey, kind: 'interpretation', items: [...out.items], status: 'open' });
    } else {
      replaceTurn(workingKey, {
        key: workingKey, kind: 'agent',
        text: out.message || 'I didn’t catch anything to change there. Try again, or type it.',
      });
    }
  };

  /** Apply a turn's changes: F4 background. The turn shows the one working indicator; the
   *  settled outcome arrives as the NEXT agent turn. The sheet can be closed mid-apply — the
   *  caller owns the background work and the plan surface's chip lands either way. */
  const applyTurn = (key: string, items: InterpretedItem[]) => {
    const ids = items
      .filter((i): i is Extract<InterpretedItem, { kind: 'change' }> => i.kind === 'change')
      .filter((i) => isPending?.(i.proposalId) ?? true)
      .map((i) => i.proposalId);
    if (!ids.length || !onApply) return;
    patchInterpretation(key, 'applying');
    void onApply(ids, items).then((report) => {
      patchInterpretation(key, 'resolved');
      append({ key: nextKey(), kind: 'agent', text: report.text });
    });
  };

  const discardTurn = (key: string, items: InterpretedItem[]) => {
    const ids = items
      .filter((i): i is Extract<InterpretedItem, { kind: 'change' }> => i.kind === 'change')
      .map((i) => i.proposalId);
    onDiscard?.(ids);
    patchInterpretation(key, 'discarded');
  };

  const dropItem = (key: string, items: InterpretedItem[], proposalId: string) => {
    onDiscard?.([proposalId]);
    const rest = items.filter((i) => !(i.kind === 'change' && i.proposalId === proposalId));
    patchInterpretation(key, rest.some((i) => i.kind === 'change') ? 'open' : 'resolved', rest);
  };

  // ── The composer's status line: the MICROPHONE's facts, beside its control ───────────
  const micLine =
    speech.state === 'unsupported' ? 'This browser can’t listen. Type it instead — same place.'
    : speech.state === 'no-permission' ? 'We don’t have your microphone. Allow it in your browser settings, or type.'
    : speech.state === 'error' ? 'The microphone stopped. Tap it to pick it up, or type.'
    : stalled ? 'We’ve lost the microphone — nothing is reaching us. Tap it, or type.'
    : starting ? 'Getting the mic…'
    : listening ? (loud ? 'Listening…' : 'Go ahead — one sentence is enough.')
    : null;
  const micAlert = speech.state === 'no-permission' || speech.state === 'error' || stalled;

  const lastAgentIdx = turns.reduce((acc, t, i) => (t.kind !== 'user' ? i : acc), -1);

  return (
    <Sheet open={open} label={framing.title} testid="voice-sheet" onClose={onClose} hasOwnClose>
      <>
        <div className="flex flex-none items-center gap-3 px-[18px] pb-2 pt-1">
          <h2 data-testid="voice-heading" className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-.02em] text-chrome">
            {framing.title}
          </h2>
          <button type="button" data-testid="voice-close" aria-label="Close" onClick={onClose}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-line-soft text-chrome">
            <CloseGlyph className="h-[17px] w-[17px]" />
          </button>
        </div>

        {/* ── THE THREAD ──────────────────────────────────────────────────────────────── */}
        <div data-testid="thread" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[18px] pb-3 pt-1 [scrollbar-width:none]">
          {turns.map((t, i) => {
            if (t.kind === 'user') {
              return (
                <div key={t.key} data-testid="turn-user"
                  className="ml-8 self-end rounded-[16px] rounded-br-[6px] bg-line-soft px-3.5 py-2.5 text-[15px] leading-[1.45] text-chrome">
                  {t.text}
                </div>
              );
            }
            if (t.kind === 'interpretation') {
              return (
                <InterpretationTurn
                  key={t.key} items={t.items} status={t.status} busy={busy}
                  live={i === lastAgentIdx}
                  onApply={() => applyTurn(t.key, t.items)}
                  onDiscard={() => discardTurn(t.key, t.items)}
                  {...(onDiscard ? { onDropItem: (id: string) => dropItem(t.key, t.items, id) } : {})}
                />
              );
            }
            // A plain agent turn: dots while working, structured lines once it has words.
            const lines = t.text ? agentLines(t.text) : [];
            return (
              <AgentSays key={t.key} testid="turn-agent" working={!!t.working} live={i === lastAgentIdx} className="mr-8 self-stretch">
                {lines.length === 0 ? undefined
                  : lines.length === 1 ? lines[0]!.text
                  : lines.map((l, j) => (
                    <span key={j} data-testid="turn-line" className={`block ${l.header ? `font-semibold${j > 0 ? ' mt-1.5' : ''}` : ''}`}>
                      {l.text}
                    </span>
                  ))}
              </AgentSays>
            );
          })}
          <div ref={threadEnd} aria-hidden="true" />
        </div>

        {/* ── THE COMPOSER ────────────────────────────────────────────────────────────── */}
        <div className="flex-none border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-2.5">
          {micLine && (
            <p data-testid="voice-state" {...(micAlert ? { role: 'alert' as const } : {})}
              className="mb-1.5 text-[12.5px] font-medium text-muted">
              {micLine}
            </p>
          )}
          {/* The meter, inline: proof the capture is live, exactly where the words will land.
              Same pipeline rules as ever (audio-contention.ts) — no second capture on WebKit. */}
          {(listening || starting) && (
            <div className="mb-1.5">
              <Waveform active={listening} onLevel={setLoud} speaking={speech.speaking} pulse={speech.pulse} />
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button" data-testid="voice-mic" aria-pressed={listening}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              disabled={speech.state === 'unsupported'}
              onClick={() => (listening || starting ? speech.stop() : speech.start())}
              className={[
                'flex h-[48px] w-[48px] flex-none items-center justify-center rounded-2xl transition-all duration-200',
                listening ? 'bg-coral-650 text-white' :
                starting ? 'bg-coral-100 text-coral-800 ring-2 ring-inset ring-coral-600'
                  : 'bg-surface text-coral-800 ring-2 ring-inset ring-coral-600 disabled:text-muted disabled:ring-line/55',
                loud ? 'shadow-[0_0_0_6px_rgb(var(--t-accent-600,232_112_95)_/_0.18)]' : '',
              ].join(' ')}
            >
              <MicGlyph className="h-6 w-6 [stroke-width:1.8]" />
            </button>
            <textarea
              ref={field} data-testid="voice-input" value={text} disabled={busy} rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
              placeholder={framing.placeholder}
              aria-label="Message your plan"
              className="max-h-[120px] min-h-[48px] min-w-0 flex-1 resize-none rounded-2xl border border-line/55 bg-surface px-3.5 py-3 text-[16.5px] leading-[1.45] text-chrome outline-none placeholder:text-muted"
            />
            <button
              type="button" data-testid="voice-submit" aria-label="Send this to Sprigly"
              disabled={!text.trim() || busy} onClick={() => void submit()}
              className="flex h-[48px] w-[48px] flex-none items-center justify-center rounded-2xl bg-coral-650 text-white disabled:bg-line-soft disabled:text-muted"
            >
              <SendGlyph className="h-[22px] w-[22px] [stroke-width:2.2]" />
            </button>
          </div>
        </div>
        {/* Renders nothing unless the operator armed `?mic=trace` for this tab. */}
        <MicTracePanel />
      </>
    </Sheet>
  );
}
