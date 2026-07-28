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
import React, { useCallback, useMemo, useState } from 'react';
import type { PlanData } from '../usePlanData';
import type { PlanPost } from '@/lib/types';
import { PlanShell } from './PlanShell';
import type { PlanView } from './NavPill';
import { WeekStrip, type DayMark } from './WeekStrip';
import { MonthGrid } from './MonthGrid';
import { DayPanel } from './DayPanel';
import { TasksPanel } from './TasksPanel';
import { DetailSheet } from './DetailSheet';
import { MoveSheet } from './MoveSheet';
import { Snackbar, type UndoState } from './Snackbar';
import { defaultDayFor, monthOf, monthTitle, monthGrid, shortDate } from './dates';
import { isOnTheWay } from '@/lib/generation-state';
import { orphanPosts } from '@/lib/cycle-nav';
import { lateCount } from '../derive';
import { cardText } from './card-text';

export function CommittedSurface({ data }: { data: PlanData }) {
  const viewedCycle = data.cycles.find((c) => c.cycleId === data.viewedCycleId);
  const month = viewedCycle?.displayMonth ?? monthOf(data.today);

  const [view, setView] = useState<PlanView>('day');
  const [selected, setSelected] = useState(() => defaultDayFor(month, data.today, data.calendarPosts.map((p) => p.date)));
  const [openId, setOpenId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  // Re-anchor the selection when the MONTH changes, not on every render: switching to October
  // while standing on 3 September has to move, and an unrelated post edit must not.
  const [anchoredMonth, setAnchoredMonth] = useState(month);
  if (anchoredMonth !== month) {
    setAnchoredMonth(month);
    setSelected(defaultDayFor(month, data.today, data.calendarPosts.map((p) => p.date)));
  }

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
    if (todayInMonth) { setSelected(data.today); setView('day'); }
    else if (data.todayCycleId) void data.switchCycle(data.todayCycleId);
  };

  /** THE GRID IS A PICKER (§1.5): a tap sets the day, flips to Day, and the strip re-anchors
   *  because it derives its week from `selected`. Nothing is fetched. */
  const pickFromGrid = (iso: string) => { setSelected(iso); setView('day'); };

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
      onPrevMonth={prev ? () => void data.switchCycle(prev.cycleId) : undefined}
      onNextMonth={next ? () => void data.switchCycle(next.cycleId) : undefined}
      view={view}
      onView={(v) => { setView(v); data.track('view_switched', { view: v }); }}
      // The agent path is the mic's consequence on a committed month. `data.ask` is gated on
      // readOnly upstream; this build opens the existing agent surface rather than a new sheet.
      onMic={data.readOnly ? undefined : () => { setView('day'); data.flash('Talk to your plan — say what you’d like changed.'); }}
      micLabel="Talk to your plan"
      tasksDot={lateCount(data.posts, data.today) > 0}
      onToday={goToday}
      todayEnabled={todayEnabled}
      topSlot={<Snackbar state={undo} onDismiss={() => setUndo(null)} />}
      overlays={<>
        <DetailSheet
          post={openPost} data={data} rationale={openPost?.rationale ?? ''}
          onClose={() => setOpenId(null)}
          onMove={() => { if (openPost) setMoveId(openPost.id); }}
          onDelete={() => { if (openPost) doDelete(openPost); }}
        />
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
          onSelect={setSelected}
        />
      ) : null}
    >
      {view === 'day' && (
        <DayPanel
          date={selected} today={data.today}
          posts={postsOn(selected)}
          beats={data.beatsOn(selected)}
          canAdd={data.canEdit(selected)}
          onOpen={setOpenId}
          onAdd={() => void data.addPost(selected)}
          onBeat={data.flash}
          outside={outside}
          timeOf={timeOf}
          weather={data.weather.get(selected)}
        />
      )}
      {view === 'month' && (
        <MonthGrid month={month} selected={selected} today={data.today} marksFor={marksFor} onPick={pickFromGrid} footer={monthFooter} />
      )}
      {view === 'tasks' && <TasksPanel data={data} onOpen={setOpenId} />}
    </PlanShell>
  );
}
