'use client';

/**
 * CommittedSurface.tsx — a committed month, in the new shell.
 *
 * This owns the state the shell deliberately does not: which day is selected, which view is
 * up, and which post's sheet is open. The shell owns the frame; this owns the month.
 *
 * ── What this replaces, and what went with it ────────────────────────────────────────
 *
 * `PlanMobile`'s week feed and its scroll-spy (`data-day`, `updateActiveDay`, `onFeedScroll`,
 * `scrollToDay`, `spyLock`, `rafTick`, the `anchoredCycle` StrictMode guard) are all gone —
 * the strip selects and the panel renders one day, so there is nothing for them to referee.
 * The global "Add to your plan" button is gone (the per-day slot is the only add affordance).
 * The month wheel picker is gone (the ‹ › arrows are the one lateral mechanism, and the month
 * grid covers longer jumps). The account chip is gone (G5).
 *
 * ── The microphone ───────────────────────────────────────────────────────────────────
 *
 * On a COMMITTED month the mic means *talk to your plan* and runs the existing post-cutoff
 * agent path (`POST /api/plan/agent` → `runPlanAgentTurn`), which raises proposals the client
 * then approves — it applies nothing itself. Same icon and same gesture as the draft month's
 * mic, different consequence, and the surface has to say which; the sheet that says it is
 * Session B's, so this build wires the FAB to the existing agent surface rather than inventing
 * a half of it. On a read-only cycle `data.ask` returns null, so the mic is ABSENT rather than
 * disabled: offering one that refuses is worse than offering none.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanData } from '../usePlanData';
import type { PlanPost } from '@/lib/types';
import type { InterpretedItem } from '@/lib/agent/types';
import { restoreDayFor, saveNavState } from '../nav-state';
import { navTrace } from '../nav-trace';
import { SummaryChip } from './SummaryChip';
import { appliedChipLabel, applyFailureMessage } from './applied-summary';
import { lineFor } from './Interpretation';
import { readAndStampVisit, changedDays, type ChangeRow } from './what-changed';
import { PlanShell } from './PlanShell';
import type { PlanView } from './NavPill';
import { WeekStrip, type DayMark } from './WeekStrip';
import { MonthGrid } from './MonthGrid';
import { DayPanel } from './DayPanel';
import { TasksPanel } from './TasksPanel';
import { DetailSheet } from './DetailSheet';
import { MoveSheet } from './MoveSheet';
import { AddSheet } from './AddSheet';
import { VoiceSheet } from './VoiceSheet';
import { Feedback, type UndoState } from './Feedback';
import { MonthDaySummary, rowsFromPosts } from './rows';
import { defaultDayFor, monthOf, monthTitle, monthGrid, shortDate } from './dates';
import { isOnTheWay } from '@/lib/generation-state';
import { orphanPosts } from '@/lib/cycle-nav';
import { lateCount } from '../derive';
import { cardText } from './card-text';

export function CommittedSurface({ data }: { data: PlanData }) {
  const viewedCycle = data.cycles.find((c) => c.cycleId === data.viewedCycleId);
  const month = viewedCycle?.displayMonth ?? monthOf(data.today);

  const [view, setView] = useState<PlanView>('day');
  /**
   * THE SELECTION RULE (F2): `selected` changes on a GESTURE, or on a restore of where a
   * gesture last put it. Nothing else. The initialiser prefers the tab's stored position
   * (`nav-state.ts`) so a reload nobody pressed — iOS Safari evicting a backgrounded tab,
   * pull-to-refresh — puts the operator back on the day they were standing on rather than
   * wherever `defaultDayFor` anchors. A stored day is honoured only on its own cycle+month.
   */
  const [selected, setSelectedRaw] = useState(() => {
    const kept = restoreDayFor(data.viewedCycleId, month);
    navTrace('select mount', kept ? `restored ${kept}` : 'default');
    return kept ?? defaultDayFor(month, data.today, data.calendarPosts.map((p) => p.date));
  });
  /** Every selection change names its mover, so the `?nav=trace` log can convict one. */
  const setSelected = useCallback((iso: string, why: string) => {
    navTrace('select ' + why, iso);
    setSelectedRaw(iso);
  }, []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  /** The day the add sheet is open for, or null. Held as a DATE rather than a boolean so the
   *  sheet cannot be open for one day while the panel shows another. */
  const [addFor, setAddFor] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // Read at apply-settle time, which can be long after the tap — a ref, not the state.
  const voiceOpenRef = React.useRef(false);
  voiceOpenRef.current = voiceOpen;

  /**
   * ── THE WHAT-CHANGED TREATMENT, after a background apply (F4) ─────────────────────────
   *
   * Apply closes the sheet immediately; the application runs behind it; and when it settles,
   * the SAME treatment the draft month uses lands here: a summary chip in the shell's chip
   * slot, and highlights on the cards that changed. Two pieces of state with two lifetimes,
   * exactly as spec §3 rules for the draft month — clearing the chip never un-marks a card.
   * Both reset on a month switch: a receipt belongs to the month it happened on.
   */
  const [appliedChip, setAppliedChip] = useState<{ label: string; lines: Extract<InterpretedItem, { kind: 'change' }>[] } | null>(null);
  const [chipOpen, setChipOpen] = useState(false);
  const [changedIds, setChangedIds] = useState<readonly string[]>([]);

  /**
   * ── WHAT-CHANGED VISIBILITY ──────────────────────────────────────────────────────────
   *
   * The DAY DOTS ARE THE WHOLE TREATMENT (operator ruling, round 4). A day holding posts
   * changed since the LAST VISIT (localStorage stamp, what-changed.ts) carries an accent
   * second dot, and the mark decays as each marked day is viewed.
   *
   * The header row that listed the same receipts in words is GONE, and its removal is the
   * ruling rather than a tidy-up. Two surfaces answered one question: a pill counting the
   * changes and a panel naming them, over dots already marking the days they happened on —
   * so the month header carried a number the calendar underneath was already showing, and
   * tapping it replaced the plan with a list of the plan. One changed-surface, on the
   * calendar, where the change actually is.
   *
   * The ledger read stays: it is what the dots are computed FROM.
   */
  const [recentChanges, setRecentChanges] = useState<ChangeRow[]>([]);
  const [seenDays, setSeenDays] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const prev = readAndStampVisit(data.viewedCycleId, new Date().toISOString());
    if (!prev) return;                              // a first visit has no "since" to mark against
    (async () => {
      try {
        const r = await fetch(`/api/plan/changes?cycleId=${encodeURIComponent(data.viewedCycleId)}&since=${encodeURIComponent(prev)}`);
        if (!r.ok) return;
        const d = (await r.json()) as { changes?: ChangeRow[] };
        if (!cancelled && d.changes?.length) setRecentChanges(d.changes);
      } catch { /* the marks are decoration over the ledger — absence is not an error */ }
    })();
    return () => { cancelled = true; };
  }, [data.viewedCycleId]);
  // Decay on view: the day the client is standing on stops being news.
  useEffect(() => {
    setSeenDays((cur) => (cur.has(selected) ? cur : new Set([...cur, selected])));
  }, [selected]);
  const changedDaySet = useMemo(() => changedDays(recentChanges, seenDays), [recentChanges, seenDays]);
  const dayChanged = useCallback((iso: string) => changedDaySet.has(iso), [changedDaySet]);

  // Re-anchor the selection when the MONTH changes, not on every render: switching to October
  // while standing on 3 September has to move, and an unrelated post edit must not. The month
  // only ever changes through switchCycle — a gesture — so this is user navigation landing,
  // not a background move; it still prefers the stored day when the client is returning to a
  // month they had a position on.
  const [anchoredMonth, setAnchoredMonth] = useState(month);
  if (anchoredMonth !== month) {
    setAnchoredMonth(month);
    const kept = restoreDayFor(data.viewedCycleId, month);
    setSelected(kept ?? defaultDayFor(month, data.today, data.calendarPosts.map((p) => p.date)), kept ? 'restore:month-change' : 'user:month-change');
    // The what-changed treatment belongs to the month it happened on — and so do the marks.
    setAppliedChip(null); setChipOpen(false); setChangedIds([]);
    setRecentChanges([]); setSeenDays(new Set());
  }

  /**
   * Run the apply in the background (F4). Sequential inside `applyChanges` — the ordering is
   * load-bearing (a hook proposal resolves the post its add wrote). When it settles: the chip +
   * highlights land for what applied (the post-apply confirmation OUTSIDE the sheet, unchanged),
   * and the returned report becomes the thread's confirmation turn INSIDE it. A failure goes to
   * the one feedback channel only when the sheet is closed at settle time — with it open, the
   * confirmation turn is the report, and a second banner over the thread would be the secondary
   * status bar the redesign removes.
   *
   * The items come FROM THE TURN (the sheet passes them), not from `agentReply` — a reopened
   * thread's interpretation has no in-memory reply to read.
   */
  const runApply = async (
    ids: string[], items: readonly InterpretedItem[], conversationId: string | null,
  ): Promise<{ text: string }> => {
    const lines = items
      .filter((i): i is Extract<InterpretedItem, { kind: 'change' }> => i.kind === 'change' && ids.includes(i.proposalId));
    const r = await data.applyChanges(ids);
    const appliedLines = lines.filter((l) => r.applied.includes(l.proposalId));
    if (r.applied.length) {
      setAppliedChip({ label: appliedChipLabel(appliedLines), lines: appliedLines });
      setChangedIds((cur) => [...new Set([...cur, ...r.changedPostIds])]);
    }
    /**
     * WHAT DIDN'T APPLY, PAIRED WITH WHY (G3). The failure list is joined to the interpretation
     * the client consented to, so the report names the line they read rather than an id — and
     * carries the guard's own sentence for each, which is the half that used to die in the
     * database. A failure with no matching line still counts: it is the vanished item.
     */
    const failures = r.failures
      .map((f) => {
        const change = lines.find((l) => l.proposalId === f.proposalId);
        return change ? { change, reason: f.reason, retryable: f.retryable } : null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    const failureText = failures.length ? applyFailureMessage(failures, r.applied.length) : null;
    if (failureText && !voiceOpenRef.current) setUndo({ message: failureText });
    const text = failureText
      ?? (r.applied.length === 1 ? 'Done — your plan is updated.' : `Done — ${r.applied.length} changes are in.`);

    /**
     * THE CONFIRMATION BECOMES A TURN, on the server (G1/G3).
     *
     * Two things depend on it. The sentence survives a remount inside the session, which it
     * never did — Apply is background work in the browser, so its report lived only in React
     * state. And a REFUSED change is written back as a pending intent, which is what turns
     * "Tell me another date and I'll put it in" from a promise into a mechanism: without it the
     * proposal is consumed and the next utterance — "the 30th then" — has no referent at all.
     *
     * Best effort, deliberately: the client has already read the report on screen, so a write
     * that fails must not change what they were told.
     */
    if (conversationId) {
      const refusedIds = failures.filter((f) => !f.retryable).map((f) => f.change.proposalId);
      void fetch('/api/plan/conversation/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, text, refusedProposalIds: refusedIds }),
      }).catch(() => {});
    }
    return { text };
  };

  // Persist the position on every change — including the anchor's own placement, so an
  // eviction right after a month switch still restores the month the client chose.
  useEffect(() => {
    saveNavState({ cycleId: data.viewedCycleId, selected, view });
  }, [data.viewedCycleId, selected, view]);

  const byDate = useMemo(() => {
    const m = new Map<string, PlanPost[]>();
    for (const p of data.calendarPosts) {
      const a = m.get(p.date) ?? [];
      a.push(p);
      m.set(p.date, a);
    }
    return m;
  }, [data.calendarPosts]);

  const postsOn = useCallback((iso: string) => byDate.get(iso) ?? [], [byDate]);

  /** One mark per post. A committed month's marks are `chrome`; a post still being written is
   *  a RING, so the exception reads as a different shape and not a different hue. */
  const marksFor = useCallback(
    (iso: string): DayMark[] => postsOn(iso).map((p) => (isOnTheWay(p.status) ? 'onway' : 'committed')),
    [postsOn],
  );
  const markFor = useCallback((iso: string): DayMark => marksFor(iso)[0] ?? 'none', [marksFor]);

  const timeOf = useCallback((p: PlanPost) => p.postingTime ?? '', []);

  // A post opened from any view — including one dated in another month and shown here by date.
  const openPost = data.calendarPosts.find((p) => p.id === openId) ?? null;
  const movePost = data.calendarPosts.find((p) => p.id === moveId) ?? null;

  /** The client's OWN posting labels, from the posts already loaded. Not a config read: nothing
   *  surfaces client_planning_config.posting_times, and offering values from a contract's
   *  documentation as if they were theirs is what the mockups did. */
  const knownTimes = useMemo(
    () => [...new Set(data.calendarPosts.map((p) => p.postingTime).filter((t): t is string => !!t))],
    [data.calendarPosts],
  );

  /**
   * Move, and say where it went (gap 11).
   *
   * A cross-month move works — the route gates on date, not on month — but nothing named the
   * destination, so a 31 October post moved to 3 November simply vanished from the month the
   * client was looking at. The snackbar names the date, and names the MONTH when the move
   * crossed one, which is precisely when the post leaves the screen.
   */
  const doMove = (post: PlanPost, toDate: string, toTime: string) => {
    const fromDate = post.date;
    const fromTime = post.postingTime ?? '';
    setMoveId(null);
    setOpenId(null);
    data.reschedule(post.id, toDate, toTime);
    const crossed = monthOf(toDate) !== monthOf(fromDate);
    setUndo({
      message: crossed
        ? `Moved to ${shortDate(toDate)} — that’s in ${monthTitle(monthOf(toDate)).split(' ')[0]}.`
        : `Moved to ${shortDate(toDate)}.`,
      // Undo is ONE slot over ONE mutation: put the date and the time back. There is no
      // inverse of anything larger, and offering one would be offering something imaginary.
      onUndo: () => data.reschedule(post.id, fromDate, fromTime),
    });
  };

  const doDelete = (post: PlanPost) => {
    setOpenId(null);
    void data.removePost(post.id);
    // No undo: DELETE is a soft delete server-side, but no route un-deletes, so an Undo here
    // would be a button that cannot do what it says. The statement stands without one.
    setUndo({ message: 'Removed it.' });
  };

  // ‹ › walk the client's sibling cycles. Disabled (not silently absent) at either end.
  const sorted = useMemo(() => [...data.cycles].sort((a, b) => a.displayMonth.localeCompare(b.displayMonth)), [data.cycles]);
  const idx = sorted.findIndex((c) => c.cycleId === data.viewedCycleId);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const todayInMonth = monthOf(data.today) === month;
  const todayEnabled = todayInMonth || !!data.todayCycleId;
  const goToday = () => {
    // On the month view Today selects in place rather than leaving the grid — the same P6
    // reasoning as a day tap: a control that also changes view is two acts wearing one label.
    if (todayInMonth) { setSelected(data.today, 'user:today'); if (view === 'day') setView('day'); }
    else if (data.todayCycleId) { navTrace('cycle user:today', data.todayCycleId); void data.switchCycle(data.todayCycleId); }
  };

  /** ROUND 6, P6: the grid STAYS the view. A tap selects the day and the summary beneath the
   *  grid renders it; Day view is reached through the nav pill. Nothing is fetched, and the
   *  selection is shared, so switching to Day afterwards lands where you were reading. */
  const pickFromGrid = (iso: string) => setSelected(iso, 'user:grid');

  const monthPosts = useMemo(
    () => monthGrid(month).filter((c) => c.inMonth).flatMap((c) => postsOn(c.iso)),
    [month, postsOn],
  );
  const inFlight = monthPosts.filter((p) => isOnTheWay(p.status)).length;
  const monthFooter = monthPosts.length === 0
    ? `Nothing planned across ${monthTitle(month).split(' ')[0]} yet.`
    : `${monthPosts.length} post${monthPosts.length === 1 ? '' : 's'} across ${monthTitle(month).split(' ')[0]}.`
      + (inFlight === 0 ? ' Tap a day to open it.' : inFlight === 1 ? ' One is still being written.' : ` ${inFlight} are still being written.`);

  const outside = useMemo(
    () => orphanPosts(data.posts, data.cycles.map((c) => c.displayMonth)),
    [data.posts, data.cycles],
  );

  return (
    <PlanShell
      monthLabel={monthTitle(month)}
      onPrevMonth={prev ? () => { navTrace('cycle user:prev-month', prev.cycleId); void data.switchCycle(prev.cycleId); } : undefined}
      onNextMonth={next ? () => { navTrace('cycle user:next-month', next.cycleId); void data.switchCycle(next.cycleId); } : undefined}
      view={view}
      onView={(v) => { setView(v); data.track('view_switched', { view: v }); }}
      // ONE VOICE INTERFACE (round 7, fix 2). The mic opens the SAME sheet as the draft month's
      // — same waveform, same dual input, same starters-that-are-openers — with the framing and
      // the submit target that belong to a committed month. Session A wired this to a line of
      // `flash()` copy and nothing else, which is the one thing spec §1.2 said not to do: the
      // gesture is always *talk to your plan*, and the SHEET is what says which consequence it
      // has. `data.ask` is gated on readOnly upstream, so the mic is absent rather than inert.
      onMic={data.readOnly ? undefined : () => setVoiceOpen(true)}
      micLabel="Talk to your plan"
      tasksDot={lateCount(data.posts, data.today) > 0}
      onToday={goToday}
      todayEnabled={todayEnabled}
      // ONE feedback channel, at the top (round 6, P10). `data.toast` used to render in a second
      // bar at the bottom of the page, over the nav pill; it comes here instead.
      topSlot={<Feedback undo={undo} onDismiss={() => setUndo(null)} message={data.toast} agent={data.agentToast} agentWorking={data.agentBusy} />}
      // The what-changed chip (F4) — the draft month's spec-§3 treatment, on the committed
      // month. Never grows; tapping toggles the itemised panel; absent until an apply lands.
      chip={appliedChip ? <SummaryChip label={appliedChip.label} expanded={chipOpen} onToggle={() => setChipOpen((o) => !o)} /> : undefined}
      // No `badge`. The "What changed" pill that used to live here is gone by ruling — the day
      // dots are the sole changed-surface, and a committed month's state row is empty again.
      overlays={<>
        <DetailSheet
          post={openPost} data={data} rationale={openPost?.rationale ?? ''}
          onClose={() => setOpenId(null)}
          onMove={() => { if (openPost) setMoveId(openPost.id); }}
          onDelete={() => { if (openPost) doDelete(openPost); }}
        />
        {/* ROUND 6, P1 — the add slot opens this instead of creating an empty post. A committed
            month needs no pillar: `addGeneratingPost` files a new idea under "New idea" rather
            than asking the client to categorise something they have not written yet. */}
        <VoiceSheet
          open={voiceOpen} context="committed" monthName={monthTitle(month).split(' ')[0] ?? ''}
          cycleId={data.viewedCycleId}
          busy={data.agentBusy}
          onClose={() => setVoiceOpen(false)}
          // The reply renders as thread turns — `silent` keeps the out-of-sheet copies
          // (agentFlash, the Approvals flash) from doubling it over the thread. A pure query's
          // answer rides back as `message` and becomes an agent turn: the dead-end is gone.
          onSubmit={async (text, source, conversationId, pendingProposalIds) => {
            const reply = await data.ask(text, null, source, { silent: true, conversationId, pendingProposalIds });
            if (!reply) return { ok: false as const };   // refused or errored — the composer keeps the words
            return {
              ok: true as const, items: reply.items,
              ...(reply.message ? { message: reply.message } : {}),
              ...(reply.conversationId ? { conversationId: reply.conversationId } : {}),
              ...(reply.supersededProposalIds ? { supersededProposalIds: reply.supersededProposalIds } : {}),
            };
          }}
          // F4, threaded: the apply runs in the background and the settled report becomes the
          // confirmation turn; chip + highlights land outside the sheet either way.
          onApply={runApply}
          onDiscard={(ids) => void data.discardChanges(ids)}
          isPending={(id) => data.proposals.some((p) => p.id === id)}
        />
        {addFor && (
          <AddSheet
            open date={addFor} pillars={null} busy={data.busy}
            onClose={() => setAddFor(null)}
            onSubmit={({ format, subject }) => data.addShapedPost(addFor, format, subject)}
          />
        )}
        {movePost && (
          <MoveSheet
            open onClose={() => setMoveId(null)}
            postDate={movePost.date} postTime={movePost.postingTime ?? null}
            postHeading={cardText(movePost).heading}
            knownTimes={knownTimes}
            canMoveTo={data.canEdit}
            onMove={(d, t) => doMove(movePost, d, t)}
          />
        )}
      </>}
      strip={view === 'day' ? (
        <WeekStrip
          selected={selected} today={data.today} month={month}
          markFor={markFor} countFor={(iso) => postsOn(iso).length}
          changedFor={dayChanged}
          onSelect={(iso) => setSelected(iso, 'user:strip')}
        />
      ) : null}
    >
      {/* The chip's expanded panel REPLACES the view (the draft receipt's pattern): the lines
          the client consented to, confirmed. Clearing it keeps the card highlights — different
          state, different lifetime. */}
      {chipOpen && appliedChip && (
        <div data-testid="applied-panel" className="flex-1 overflow-y-auto px-5 pb-[104px] pt-2.5 [scrollbar-width:none]">
          <h2 className="mb-3 text-[22px] font-bold tracking-[-.02em] text-chrome">What changed</h2>
          <ul className="flex flex-col gap-2">
            {appliedChip.lines.map((item) => {
              const { verb, title, tail } = lineFor(item);
              return (
                <li key={item.proposalId} data-testid="applied-line" className="text-[14.5px] leading-[1.45] text-chrome">
                  <span className="font-semibold">{verb}</span>
                  {title ? <span> “{title}”</span> : null}
                  {tail ? <span className="font-semibold"> {tail}</span> : null}
                </li>
              );
            })}
          </ul>
          <button
            type="button" data-testid="applied-clear"
            onClick={() => { setChipOpen(false); setAppliedChip(null); }}
            className="mt-4 min-h-[44px] text-[13.5px] font-semibold text-muted"
          >
            Clear this summary
          </button>
        </div>
      )}
      {!chipOpen && view === 'day' && (
        <DayPanel
          date={selected} today={data.today}
          posts={postsOn(selected)}
          beats={data.beatsOn(selected)}
          canAdd={data.canEdit(selected)}
          changedIds={changedIds}
          onOpen={setOpenId}
          onAdd={() => setAddFor(selected)}
          onBeat={data.flash}
          outside={outside}
          timeOf={timeOf}
          weather={data.weather.get(selected)}
        />
      )}
      {!chipOpen && view === 'month' && (
        <MonthGrid
          month={month} selected={selected} today={data.today}
          // lockToMonth: the grid's padding cells are another month's days, and picking one is
          // the jump (round 4). Leaving the month is the ‹ › arrows' job — they refetch.
          marksFor={marksFor} changedFor={dayChanged} onPick={pickFromGrid} footer={monthFooter} lockToMonth
          summary={<MonthDaySummary date={selected} items={rowsFromPosts(postsOn(selected), timeOf)} onOpen={setOpenId} />}
        />
      )}
      {!chipOpen && view === 'tasks' && <TasksPanel data={data} onOpen={setOpenId} />}
    </PlanShell>
  );
}
