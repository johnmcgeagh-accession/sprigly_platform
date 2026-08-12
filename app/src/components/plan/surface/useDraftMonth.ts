'use client';

/**
 * useDraftMonth.ts — everything a draft month can be told to do, in one place.
 *
 * `DraftPlan.tsx` held these four fetches and `DraftPlanView.tsx` held the state they feed. That
 * split was fine while the draft surface was one standalone page; it is not fine now that the
 * draft month renders inside the same shell as the committed one, because the shell's views
 * (day, month, tasks) all need the same beats and the same receipt.
 *
 * ── Where the beats live ─────────────────────────────────────────────────────────────
 *
 * NOT here. `usePlanData` already holds `draft` and re-loads it on every month switch, following
 * the server's surface decision (`followServerSurface`). Keeping a second copy in this hook would
 * mean two answers to "what is in this month" and a stale one after a switch — which is the exact
 * class of bug `draft-mode-not-rendering.md` records. So every mutation writes back through
 * `data.setDraft`, and the surface renders `data.draft.beats`.
 *
 * What this hook DOES own is the transient state around them: the receipt on screen, the
 * highlight marks, one undo slot, and whether a write is in flight. All of it is in-memory and
 * gone on reload, deliberately (spec §1.2).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftBeatView } from '@/lib/types';
import type { PlanData } from '../usePlanData';
import type { DraftReceipt } from '../DraftPlanView';
import type { UndoState } from './Feedback';

/** What every draft write returns. `dropped` rides back on a drop so undo can restore the
 *  whole beat rather than re-adding a husk (the seven subjectless beats in cycle 040d6a1a). */
interface DraftWrite {
  ok: boolean;
  beats?: DraftBeatView[];
  dropped?: Record<string, unknown>;
  application?: DraftReceipt;
  message?: string;
  /** The conversation the server actually used. Echoed back so the session can hold it and
   *  the NEXT turn lands in the same thread — which is the whole of the parser's memory. */
  conversationId?: string | null;
}

const NETWORK_FAIL = 'We couldn’t reach the server. Check your connection and try again.';
const GENERIC_FAIL = 'That didn’t work. Try again?';

async function post(url: string, body: unknown): Promise<DraftWrite> {
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = (await res.json()) as DraftWrite;
    if (!res.ok || !json.ok) return { ok: false, message: json.message ?? GENERIC_FAIL };
    return json;
  } catch {
    // A network failure must read as a network failure, not as a rejected edit — the client
    // should try again, not conclude that we refused them.
    return { ok: false, message: NETWORK_FAIL };
  }
}

export function useDraftMonth(data: PlanData) {
  const beats = data.draft?.beats ?? [];
  const receipts = data.draft?.receipts ?? [];

  const [receipt, setReceipt] = useState<DraftReceipt | null>(receipts[0] ?? null);
  // The "New" marks. In memory, gone on reload — a persisted seen-state would be a lot of
  // machinery for a highlight that has done its job by the time the client looks away. They are
  // INDEPENDENT of the receipt: clearing the summary never un-marks what changed (spec §3).
  const [changedIds, setChangedIds] = useState<string[]>(receipts[0]?.changedIds ?? []);
  const [busy, setBusy] = useState(false);
  /** A reshape is running: the ONE thing on this surface the agent is doing rather than us. */
  const [shaping, setShaping] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);

  /**
   * A RECEIPT THAT ARRIVES AFTER MOUNT STILL HAS TO REACH THE CLIENT.
   *
   * `receipt` is seeded from `receipts[0]` once, at mount, which was enough while every
   * receipt on this surface was produced by a write this hook itself made — `write()` sets it
   * directly on the way back. The wizard is not one of those: it submits through
   * `usePlanData`, which folds the new receipt onto the FRONT of `draft.receipts`, and this
   * hook was already mounted and never looked again.
   *
   * That gap did not show while the sheet stayed open until the work finished, because the
   * sheet was the thing reporting. It closes on submit now, so this is where the answer has
   * to land — including the unhappy ones: a rollup whose segments failed to classify or apply
   * is a receipt like any other, and dropping it would leave a brief that silently did nothing.
   *
   * Keyed on the receipt's ID, not on the array: `usePlanData` replaces `draft` on every fold,
   * so an identity check would re-fire on beats-only updates and resurrect a receipt the
   * client had just cleared.
   */
  const latestReceiptId = receipts[0]?.id ?? null;
  const seenReceiptId = useRef(latestReceiptId);
  useEffect(() => {
    if (latestReceiptId === seenReceiptId.current) return;
    seenReceiptId.current = latestReceiptId;
    const next = receipts[0] ?? null;
    // A question answers rather than changes, and does not become the surface's receipt —
    // the same rule `write()` applies below, stated once per entry point.
    if (next && next.scope !== 'question') {
      setReceipt(next);
      setChangedIds(next.changedIds ?? []);
    }
  }, [latestReceiptId, receipts]);

  const setBeats = useCallback((next: DraftBeatView[]) => {
    data.setDraft((d) => (d ? { ...d, beats: next } : d));
  }, [data]);

  /**
   * OPTIMISTIC-FIRST, for the reversible ops (round 7, fix 3).
   *
   * A move, a format change and a drop each touch one beat and can each be put back exactly, so
   * the card changes NOW and the write follows. `say()` and `addToMonth()` are deliberately NOT
   * optimistic: a reshape is a model call whose result is a receipt nobody can predict, and
   * pretending otherwise would mean drawing a month we invented.
   *
   * The rollback restores the WHOLE list rather than un-applying the patch. The server returns
   * the authoritative beats on success, so the only thing the client should ever hold is a list
   * it was given — a hand-computed inverse is a second source for the same fact and drifts.
   */
  const optimistic = useCallback(async (next: DraftBeatView[], run: () => Promise<DraftWrite>): Promise<DraftWrite> => {
    const before = data.draft?.beats ?? [];
    setBeats(next);
    const r = await run();
    if (!r.ok) setBeats(before);
    return r;
  }, [data.draft, setBeats]);

  /**
   * One write, its result folded into the shared draft state, and its failure said out loud.
   *
   * ── EVERY WRITE NAMES THE MONTH IT IS FOR ────────────────────────────────────────────
   *
   * These posts carried no cycle at all, so the routes fell back to `session.cycleId` — the
   * month the magic link was minted for, which is only the month on screen until the client
   * uses the switcher. A question asked on November was answered about November and returned
   * SEPTEMBER's beats, which is what emptied the month; an added beat landed in September
   * outright. `viewedCycleId` is the one the surface is rendering and the one the server must
   * be told about, so it goes on every body from a single place rather than per call site.
   */
  const write = useCallback(async (url: string, body: unknown): Promise<DraftWrite> => {
    setBusy(true);
    try {
      const r = await post(url, { ...(body as Record<string, unknown>), cycleId: data.viewedCycleId });
      if (!r.ok) { data.flash(r.message ?? GENERIC_FAIL); return r; }
      /**
       * ABSENT AND EMPTY ARE DIFFERENT ANSWERS.
       *
       * `[]` is truthy, so `if (r.beats)` treated "this month has no beats" and "this response
       * carries no beats" identically and cleared the month for both. That is what turned the
       * wrong-cycle read above into a visibly empty November rather than a stale one — and it
       * would do the same to any future response that legitimately omits the key.
       *
       * A response that OMITS `beats` is saying nothing about them, so we keep what we hold.
       * A response that sends `[]` is asserting the month is empty, and we believe it.
       */
      if (Array.isArray(r.beats)) setBeats(r.beats);
      // A QUESTION does not become the surface's receipt. A receipt is a record of what changed
      // and offers a review of it; an answer changed nothing, and its place is the thread where
      // it was asked. Promoting it would put "What changed" over a list of things that didn't.
      if (r.application && r.application.scope !== 'question') {
        setReceipt(r.application);
        setChangedIds(r.application.changedIds ?? []);
      }
      return r;
    } finally { setBusy(false); }
  }, [data, setBeats]);
  // `data.viewedCycleId` rides in on `data`, which is already the dependency — named here so
  // the reason it must not be dropped from that list is written down.

  const move = useCallback(async (beat: DraftBeatView, date: string) => {
    const from = beat.date;
    const r = await optimistic(
      beats.map((b) => (b.id === beat.id ? { ...b, date } : b)),
      () => write('/api/plan/draft', { op: 'move', postId: beat.id, date }),
    );
    if (!r.ok) return;
    setUndo({
      message: `Moved to ${short(date)}.`,
      onUndo: () => { void write('/api/plan/draft', { op: 'move', postId: beat.id, date: from }); },
    });
  }, [write, optimistic, beats]);

  const changeFormat = useCallback(async (beat: DraftBeatView, format: string) => {
    const from = beat.format;
    const r = await optimistic(
      beats.map((b) => (b.id === beat.id ? { ...b, format: format as DraftBeatView['format'] } : b)),
      () => write('/api/plan/draft', { op: 'format', postId: beat.id, format }),
    );
    if (!r.ok) return;
    setUndo({
      message: 'Format changed.',
      onUndo: () => { void write('/api/plan/draft', { op: 'format', postId: beat.id, format: from }); },
    });
  }, [write, optimistic, beats]);

  const drop = useCallback(async (beat: DraftBeatView) => {
    const r = await optimistic(
      beats.filter((b) => b.id !== beat.id),
      () => write('/api/plan/draft', { op: 'drop', postId: beat.id }),
    );
    if (!r.ok) return;
    // RESTORE, not re-add. The drop hands back the whole row; putting that back keeps the
    // title, the evidence, the position and the assumptions. Rebuilding it from
    // {date, format, pillar} turned a launch beat into a subjectless husk.
    const dropped = r.dropped;
    setUndo({
      message: 'Post removed.',
      ...(dropped ? { onUndo: () => { void write('/api/plan/draft', { op: 'restore', beat: dropped }); } } : {}),
    });
  }, [write, optimistic, beats]);

  const add = useCallback(
    async (date: string, format: string, pillar: string, subject: string) =>
      write('/api/plan/draft', { op: 'add', date, format, pillar, ...(subject ? { subject } : {}) }),
    [write],
  );

  /**
   * One sentence in, a reshaped month and a receipt out. The north-star path.
   *
   * `source` is gap 8: the route took `{op, text}` and nothing else, so from the day the voice
   * sheet shipped every spoken reshape would have been recorded as typed — and the one
   * measurement that says whether talking to the plan works would have had to be retrofitted
   * against rows that no longer carried the answer.
   */
  const say = useCallback(
    async (text: string, source: 'web' | 'voice' = 'web', conversationId: string | null = null) => {
      // `shaping` is separate from `busy` on purpose. `busy` is true for a move and a drop too,
      // and those are the client's own edits landing — showing "Sprigly is working" over them
      // would credit the agent with something it did not do. This is the reshape and nothing
      // else, which is what the shell renders the agent's dots from (round 8, fix 7).
      setShaping(true);
      // `conversationId` names the session this sentence belongs to. Null on the first turn of
      // a session — the server opens one and echoes it back, and the sheet holds it from there.
      try { return await write('/api/plan/draft/apply', { op: 'text', text, source, conversationId }); }
      finally { setShaping(false); }
    },
    [write],
  );

  /** Promote a filed idea into this month — the rescue tap on a rollup's idea line. */
  const addToMonth = useCallback(
    async (planInputId: string, date: string) => write('/api/plan/draft/apply', { op: 'add_to_month', planInputId, date }),
    [write],
  );

  /**
   * Where a rescued idea lands: the first day of this month the client can still edit.
   * Deterministic and near, so the beat is visible immediately and can be moved from there —
   * better than inventing a date deep in the month that they then have to hunt for.
   */
  const rescueDate = useCallback(
    () => [...beats].map((b) => b.date).sort()[0] ?? data.today,
    [beats, data.today],
  );

  return {
    beats, busy, shaping, receipt, changedIds, undo,
    setUndo, setReceipt, setChangedIds,
    move, changeFormat, drop, add, say, addToMonth, rescueDate,
  };
}

export type DraftMonth = ReturnType<typeof useDraftMonth>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '22 Oct'. Local to this file rather than imported from dates.ts, which builds a Date — the
 *  message only ever names a date the client just picked, so the string form is enough. */
function short(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`.trim();
}
