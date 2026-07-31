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
import { capAnnouncement } from '@sprigly/engine/ai-change-cap';
import { InterpretationTurn, type InterpretationStatus } from './Interpretation';
import { agentLines } from './agent-prose';
import type { CapNotice, InterpretedItem } from '@/lib/agent/types';
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
  | {
      ok: true; items?: readonly InterpretedItem[]; message?: string; conversationId?: string | null;
      /** Pending proposals this turn AMENDED (C3) — their turns are marked superseded. */
      supersededProposalIds?: readonly string[];
      /** The monthly change allowance would not cover this request (X2a). It becomes a turn of
       *  its own AFTER the interpretation, because the two are different things: one is what
       *  the client can apply, the other is what we are telling them about it. */
      capNotice?: CapNotice;
    };

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
  | { key: string; kind: 'interpretation'; items: InterpretedItem[]; status: InterpretationStatus }
  /**
   * THE CAP, AS A TURN (X2a/d). It carries the sentence the agent said and the one affordance
   * for wanting more — which is the whole of the commercial surface: a tap that records the
   * interest, and a line saying somebody will be in touch. No price, no plan change, no flow.
   */
  | { key: string; kind: 'cap'; notice: CapNotice; text: string; asked: boolean };

let localKey = 0;
const nextKey = () => `local-${++localKey}`;

export function VoiceSheet({
  open, monthName, busy, question, context = 'draft', cycleId, entry = 'mic',
  onClose, onSubmit, onApply, onDiscard, onWantMore, isPending,
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
  onSubmit: (
    text: string, source: 'web' | 'voice', conversationId: string | null,
    /** The proposals of the interpretation turn still OPEN on screen — the referent an
     *  ambiguous correction amends (C3). Empty when nothing is pending. */
    pendingProposalIds: string[],
  ) => Promise<VoiceOutcome>;
  /** Apply the turn's changes — F4: fire the background work and resolve with the settled
   *  outcome, which becomes the confirmation turn. The sheet does not block on it. The turn's
   *  own items ride along so the caller can compose its chip and failure copy from them — a
   *  reopened thread's turn has no in-memory reply to read them from. */
  onApply?: ((
    proposalIds: string[], items: readonly InterpretedItem[],
    /** THIS session's conversation, so the settled report can be written back into it as a turn
     *  — which is what makes the rescue it offers resolvable on the next utterance (G1/G3). */
    conversationId: string | null,
  ) => Promise<ApplyReport>) | undefined;
  onDiscard?: ((proposalIds: string[]) => void) | undefined;
  /** Record that the client wants more changes this month (X2d). Resolves true when the
   *  interest was stored. Absent → the affordance is not offered at all, which is the honest
   *  behaviour on a surface with nowhere to record it. */
  onWantMore?: ((notice: CapNotice) => Promise<boolean>) | undefined;
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

  /**
   * ── THE SHEET OPENS ON THE KEYBOARD, NOT THE MICROPHONE (C2, operator ruling) ────────
   *
   * This reverses round 8's fix 5 ("it listens the moment it opens"), and the reversal is the
   * point: opening a live microphone on sight is a decision made FOR the client, and it is the
   * wrong one on a sheet that is now a chat. Claude's own composer is the reference — a text
   * panel with focus, and a mic you TAP when you want it.
   *
   * `stopSpeech` on close is unchanged and still load-bearing: a capture that outlives its
   * sheet is the one bug here nobody would see and everybody would feel.
   *
   * `start()` is still synchronous on the gesture's own task (`useSpeechInput`), which is what
   * the cold-start permission prompt depends on — the tap IS the gesture now, so the
   * `useLayoutEffect` that existed to keep the OPEN gesture's activation alive is no longer
   * needed for it.
   */
  useEffect(() => {
    if (!open) stopSpeech();
  }, [open, stopSpeech]);

  // Focus the composer on open — both entry points, because both open a chat.
  useEffect(() => {
    if (open) field.current?.focus({ preventScroll: true });
  }, [open]);

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
    // THE OPEN INTERPRETATION IS THE REFERENT (C3): its proposals ride along so a correction
    // with no target of its own — "instead of a single image make it a reel" — amends it
    // rather than landing beside it as a second, contradictory change.
    const openIds = turns.flatMap((t) => (t.kind === 'interpretation' && t.status === 'open'
      ? t.items.filter((i): i is Extract<InterpretedItem, { kind: 'change' }> => i.kind === 'change').map((i) => i.proposalId)
      : []));
    const out = await onSubmit(value, wasHeard ? 'voice' : 'web', conversationId.current, openIds);
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
    // An AMENDED turn is marked before the new one lands, so the two versions are never both
    // applicable — and the old one stays visible, because the thread is the record.
    if (out.supersededProposalIds?.length) {
      const gone = new Set(out.supersededProposalIds);
      setTurns((cur) => cur.map((t) => (
        t.kind === 'interpretation' && t.status === 'open'
          && t.items.some((i) => i.kind === 'change' && gone.has(i.proposalId))
          ? { ...t, status: 'superseded' as const }
          : t
      )));
    }
    if (out.items && out.items.length) {
      replaceTurn(workingKey, { key: workingKey, kind: 'interpretation', items: [...out.items], status: 'open' });
    } else {
      replaceTurn(workingKey, {
        key: workingKey, kind: 'agent',
        text: out.message || 'I didn’t catch anything to change there. Try again, or type it.',
      });
    }
    /**
     * THE CAP NOTICE IS ITS OWN TURN, and it has to be.
     *
     * A request that exceeds the allowance still produces changes, so the turn above becomes an
     * INTERPRETATION — which renders items and drops `message` entirely. The announcement would
     * have vanished in exactly the case it exists for. It lands after, as the agent's next
     * sentence, which is also how it reads: here is what you asked for, and here is what I have
     * to tell you about it.
     */
    if (out.capNotice) {
      append({ key: nextKey(), kind: 'cap', notice: out.capNotice, text: capAnnouncement(out.capNotice), asked: false });
    }
  };

  /** Record the interest, then say so on the turn itself. A failure leaves the offer standing
   *  rather than claiming something was filed that was not. */
  const wantMore = async (key: string, notice: CapNotice) => {
    if (!onWantMore) return;
    if (await onWantMore(notice)) {
      setTurns((cur) => cur.map((t) => (t.key === key && t.kind === 'cap' ? { ...t, asked: true } : t)));
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
    void onApply(ids, items, conversationId.current).then((report) => {
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
            if (t.kind === 'cap') {
              return (
                <AgentSays key={t.key} testid="turn-cap" live={i === lastAgentIdx} className="mr-8 self-stretch">
                  <span className="block">{t.text}</span>
                  {t.asked ? (
                    <span data-testid="want-more-sent" className="mt-2.5 block text-[13.5px] font-semibold text-muted">
                      Noted — we’ll be in touch about it.
                    </span>
                  ) : onWantMore ? (
                    <button
                      type="button" data-testid="want-more"
                      onClick={() => void wantMore(t.key, t.notice)}
                      className="mt-2.5 min-h-[44px] rounded-full border border-line/55 bg-surface px-4 text-[13.5px] font-bold text-coral-800"
                    >
                      Need more this month?
                    </button>
                  ) : null}
                </AgentSays>
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

        {/* ── THE COMPOSER (C2) ────────────────────────────────────────────────────────
            A FULL-WIDTH TEXT PANEL with the controls beneath it, rather than a field
            squeezed between two 48px buttons. At 320px that row left the field 176px —
            about four words — on a surface whose whole promise is "say what you want".
            The panel is the subject; the mic and the send are its tools. */}
        <div className="flex-none border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-2.5">
          {micLine && (
            <p data-testid="voice-state" {...(micAlert ? { role: 'alert' as const } : {})}
              className="mb-1.5 text-[12.5px] font-medium text-muted">
              {micLine}
            </p>
          )}
          {/* The meter, inline: proof the capture is live, exactly where the words will land.
              Same pipeline rules as ever (audio-contention.ts) — no second capture on WebKit.
              It pulses off INTERIM results now, so it moves WHILE the client speaks rather
              than reporting a sentence that has already ended (C2, useSpeechInput). */}
          {(listening || starting) && (
            <div className="mb-1.5">
              <Waveform active={listening} onLevel={setLoud} speaking={speech.speaking} pulse={speech.pulse} />
            </div>
          )}
          <textarea
            ref={field} data-testid="voice-input" value={text} disabled={busy} rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            placeholder={framing.placeholder}
            aria-label="Message your plan"
            className="max-h-[160px] min-h-[64px] w-full resize-none rounded-2xl border border-line/55 bg-surface px-3.5 py-3 text-[16.5px] leading-[1.45] text-chrome outline-none placeholder:text-muted"
          />
          {/* THE LIVE TRANSCRIPT, streaming. Interims are what the engine has heard and not
              finalised — shown under the field rather than written into it, so the client's
              own typing is never overwritten by a guess the engine is about to revise. */}
          {speech.partial && (
            <p data-testid="voice-partial" aria-hidden="true" className="mt-1 px-1 text-[14px] italic leading-[1.4] text-muted">
              {speech.partial}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button" data-testid="voice-mic" aria-pressed={listening}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              disabled={speech.state === 'unsupported'}
              onClick={() => (listening || starting ? speech.stop() : speech.start())}
              className={[
                'flex min-h-[44px] flex-none items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-all duration-200',
                listening ? 'bg-coral-650 text-white' :
                starting ? 'bg-coral-100 text-coral-800 ring-1 ring-inset ring-coral-600'
                  : 'bg-line-soft text-coral-800 disabled:text-muted',
                loud ? 'shadow-[0_0_0_6px_rgb(var(--t-accent-600,232_112_95)_/_0.18)]' : '',
              ].join(' ')}
            >
              <MicGlyph className="h-5 w-5 [stroke-width:1.8]" />
              {listening ? 'Stop' : 'Speak'}
            </button>
            <span className="flex-1" />
            <button
              type="button" data-testid="voice-submit" aria-label="Send this to Sprigly"
              disabled={!text.trim() || busy} onClick={() => void submit()}
              className="flex h-[44px] w-[44px] flex-none items-center justify-center rounded-full bg-coral-650 text-white disabled:bg-line-soft disabled:text-muted"
            >
              <SendGlyph className="h-[20px] w-[20px] [stroke-width:2.2]" />
            </button>
          </div>
        </div>
        {/* Renders nothing unless the operator armed `?mic=trace` for this tab. */}
        <MicTracePanel />
      </>
    </Sheet>
  );
}
