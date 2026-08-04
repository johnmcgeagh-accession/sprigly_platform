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
import { useCallback, useState } from 'react';
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

  /** One write, its result folded into the shared draft state, and its failure said out loud. */
  const write = useCallback(async (url: string, body: unknown): Promise<DraftWrite> => {
    setBusy(true);
    try {
      const r = await post(url, body);
      if (!r.ok) { data.flash(r.message ?? GENERIC_FAIL); return r; }
      if (r.beats) setBeats(r.beats);
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
    async (text: string, source: 'web' | 'voice' = 'web') => {
      // `shaping` is separate from `busy` on purpose. `busy` is true for a move and a drop too,
      // and those are the client's own edits landing — showing "Sprigly is working" over them
      // would credit the agent with something it did not do. This is the reshape and nothing
      // else, which is what the shell renders the agent's dots from (round 8, fix 7).
      setShaping(true);
      try { return await write('/api/plan/draft/apply', { op: 'text', text, source }); }
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
