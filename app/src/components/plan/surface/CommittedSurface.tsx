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
import { voiceContextFor } from '@/lib/surface-state';
import { restoreDayFor, saveNavState } from '../nav-state';
import { navTrace } from '../nav-trace';
import { applyFailureMessage } from './applied-summary';
import { readAndStampVisit, changedDays, type ChangeRow } from './what-changed';
import { PlanShell } from './PlanShell';
import type { PlanView } from './NavPill';
import { WeekStrip, type DayMark } from './WeekStrip';
import { MonthGrid } from './MonthGrid';
import { DayPanel } from './DayPanel';
import { TasksPanel } from './TasksPanel';
import { IdeasPanel } from './IdeasPanel';
import { DetailSheet } from './DetailSheet';
import { MoveSheet } from './MoveSheet';
import { AddSheet } from './AddSheet';
import { VoiceSheet } from './VoiceSheet';
import { Feedback, type UndoState } from './Feedback';
import { MonthDaySummary, rowsFromPosts } from './rows';
import { defaultDayFor, monthOf, monthTitle, monthGrid, shortDate } from './dates';
import { isPostOnTheWay } from '@/lib/generation-state';
import { monthFooterParts } from '@/lib/month-footer';
import { orphanPosts } from '@/lib/cycle-nav';
import { lateCount } from '../derive';
import { cardText } from './card-text';
import { DesktopShell } from './DesktopShell';
import type { RailView } from './Rail';
import { ringedPredicate } from './ringed-days';
import { type SurfaceFrame } from './frame';

export function CommittedSurface({ data, frame = 'mobile' }: { data: PlanData; frame?: SurfaceFrame }) {
  const desktop = frame === 'desktop';
  const viewedCycle = data.cycles.find((c) => c.cycleId === data.viewedCycleId);
  const month = viewedCycle?.displayMonth ?? monthOf(data.today);

  const [view, setView] = useState<PlanView>('day');
  /** The DESKTOP rail's position. A separate piece of state from `view` on purpose: the two
   *  navigate different things (Day/Month/Tasks against Plan/Tasks), and collapsing them into
   *  one enum would mean a client switching form factor mid-session lands somewhere the other
   *  shell has no word for. */
  const [railView, setRailView] = useState<RailView>('plan');
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
  /**
   * Open a post from a view that owns the WHOLE plan region — Tasks, Ideas.
   *
   * It has to return to the plan as well as set the id, and that is not a nicety. The detail
   * panel renders into the DAY column, and `region` replaces both columns; without the second
   * half of this, tapping a post from Tasks set the state and changed nothing on the screen —
   * a control that visibly does nothing. Ideas' tap-through found it (W6), and Tasks had shipped
   * with it in W4.
   *
   * Returning to the plan is also the right answer rather than the convenient one: opening a
   * post is a PLAN act, and this is where every other route into a post already lands.
   */
  const openFromRegion = useCallback((postId: string) => {
    setOpenId(postId);
    setRailView('plan');
  }, []);
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
   * ── WHAT CHANGED, after a background apply (F4) ──────────────────────────────────────
   *
   * ONE piece of state: the cards this apply touched. They carry the changed treatment until
   * the client leaves the month, which is the honest lifetime — a receipt belongs to the month
   * it happened on.
   *
   * THE CHIP IS GONE (X5b, operator ruling). It counted what had just applied ("2 added") in a
   * bar above the calendar, and tapping it REPLACED the calendar with a list of the calendar.
   * Three surfaces answered one question — the chip, its panel, and the marked cards underneath
   * — over a thread that had already said "Done — 2 changes are in" in the client's own
   * conversation. This is the same ruling that took the "What changed" header row last round
   * (G6), applied to the last member of the family: the change is ON the calendar, and the
   * calendar is what shows it.
   */
  const [changedIds, setChangedIds] = useState<readonly string[]>([]);

  /**
   * D5 — the days an OPEN interpretation turn names, reported up by the thread and read here.
   * Empty on every other state, so the rings appear with the turn and leave with it; there is
   * nothing to clear on apply, discard or supersede because the thread recomputes the set.
   */
  const [openChangeItems, setOpenChangeItems] = useState<readonly InterpretedItem[]>([]);
  const ringed = useMemo(() => ringedPredicate(openChangeItems), [openChangeItems]);

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
    setChangedIds([]);
    setRecentChanges([]); setSeenDays(new Set());
  }

  /**
   * Run the apply in the background (F4). Sequential inside `applyChanges` — the ordering is
   * load-bearing (a hook proposal resolves the post its add wrote). When it settles: the changed
   * cards are marked on the calendar behind the sheet, and the returned report becomes the
   * thread's confirmation turn INSIDE it. A failure goes to
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
    if (r.applied.length) setChangedIds((cur) => [...new Set([...cur, ...r.changedPostIds])]);
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
   *  a RING, so the exception reads as a different shape and not a different hue.
   *
   *  A BANKED post takes the ring too (X2c), and that is deliberate rather than an oversight:
   *  the ring says *no words on this one yet*, which is true of both. The difference between
   *  "coming" and "waiting for your changes to refresh" is a sentence with a date in it, and a
   *  5px dot cannot carry a sentence — the card and the sheet do, where the client can read it. */
  /** A DECLINED post takes the ring too, and for the reason stated just above rather than a new
   *  one: the ring says *no words on this one yet*, which is true of it. Without this it drew a
   *  FILLED dot — status 'new' falls to the else branch — so the grid showed a finished post on
   *  a day holding a blank one. The difference between "coming", "waiting for your changes" and
   *  "waiting on your answer" is again a sentence, and the footer, the card and the sheet carry
   *  it; a 5px dot still cannot. */
  /** A RETIRED post takes the ring for the reason stated two comments up rather than a new one:
   *  the ring says *no words on this one yet*, which is true of it and permanent. Without this
   *  it drew a FILLED dot — 'generation_expired' falls to the else branch exactly as 'new' did
   *  — so the grid showed a finished post on a day holding a blank one. Applying the existing
   *  rule to a new status, not revising the rule. */
  const marksFor = useCallback(
    (iso: string): DayMark[] => postsOn(iso).map((p) => (
      p.status === 'generating' || p.status === 'generation_failed' || p.status === 'generation_expired' || p.ungrounded === true ? 'onway' : 'committed'
    )),
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
  // The month footer counts what is genuinely BEING WRITTEN. A banked post is not, so it is not
  // in this number — "3 are still being written" over a post nothing is touching is the same
  // untruth the card state exists to remove.
  const inFlight = monthPosts.filter((p) => isPostOnTheWay(p)).length;

  /**
   * ── THE MONTH SAYS WHEN IT IS WAITING ON THE CLIENT ────────────────────────────────
   *
   * A declined launch beat asks its question on its own card, which is no use to a client who
   * never opens that card. On ivy-t's September that is three posts of twenty-seven, findable
   * only by opening each one — a question nobody opens is the same dead end one layer up.
   *
   * The COUNT is unchanged and deliberately so: a declined post exists and is scheduled, it
   * simply has no words yet, so it belongs in "27 posts across September" exactly as a banked
   * one does. Only the clause after it is state-aware, which is the rule this sentence already
   * followed for posts in flight.
   *
   * The clause is a CONTROL, because it replaces the surface's only "tap a day" instruction and
   * would otherwise name a problem with no route to it. It goes to the first waiting post, in
   * date order, and opens it — landing on the question rather than near it.
   */
  const waitingPosts = monthPosts.filter((p) => p.ungrounded === true);
  const foot = monthFooterParts({
    total: monthPosts.length,
    monthWord: monthTitle(month).split(' ')[0] ?? '',
    inFlight,
    waiting: waitingPosts.length,
  });
  const firstWaiting = waitingPosts[0];
  const monthFooter = !foot.ask || !firstWaiting ? foot.before : (
    <>
      {foot.before}
      <button
        type="button" data-testid="month-waiting"
        onClick={() => { setSelected(firstWaiting.date, 'user:waiting-footer'); setOpenId(firstWaiting.id); }}
        className="rounded-[6px] font-semibold text-coral-800 underline decoration-coral-800/40 underline-offset-2"
      >
        {foot.ask}
      </button>
      {foot.after}
    </>
  );

  const outside = useMemo(
    () => orphanPosts(data.posts, data.cycles.map((c) => c.displayMonth)),
    [data.posts, data.cycles],
  );

  /**
   * THE OVERLAYS, once. Both shells render the same set — the detail view, the conversation and
   * the two pickers — because they ARE the same components; only the frame around the first two
   * differs (Panel.tsx). Naming them here rather than inlining them twice is what stops the two
   * form factors drifting apart one prop at a time.
   *
   * On DESKTOP the detail and the conversation are lifted OUT of this set and placed in the
   * shell's own regions — the detail into the day column, the conversation into the dock — so
   * what is left here is genuinely still a sheet on both: move and add.
   */
  const voiceNode = (
    <VoiceSheet
      // DOCKED on desktop: always open, panel chrome, and it reports the days an open turn
      // names so the grid can ring them. On a phone it is a sheet the mic summons.
      {...(desktop
        ? { open: true, chrome: 'panel' as const, entry: 'docked' as const, onOpenChanges: setOpenChangeItems }
        // `chrome: 'sheet'` was IMPLICIT here until the default was removed — the branch named
        // the desktop frame and let the phone's fall out of the component. That asymmetry is
        // what made the whole class of bug invisible: the half that mattered read as deliberate
        // because the other half was silent.
        // The framing follows the SURFACE, not a post count read here. `voiceContextFor` is the
        // projection of the one surface decision (surface-state.ts) — so the composer, the grid
        // and the rail cannot come to different conclusions about whether this month has
        // anything in it.
        : { open: voiceOpen, chrome: 'sheet' as const })} context={voiceContextFor(data.surfaceKind)} monthName={monthTitle(month).split(' ')[0] ?? ''}
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
          // X2a: the allowance would not cover this. It becomes its own turn in the thread.
          ...(reply.capNotice ? { capNotice: reply.capNotice } : {}),
        };
      }}
      /**
       * X2d — THE UPSELL, and the whole of it.
       *
       * The moment the agent says "you've none left this month" is the moment the client
       * most wants more, so the offer sits on that turn and nowhere else. It records the
       * interest and says a person will be in touch. There is deliberately no price, no
       * plan change and no payment flow: shipping those would mean shipping a number
       * nobody has set, and the fact worth capturing — that this client wanted N more
       * changes on this date — is available today.
       */
      onWantMore={async (notice) => {
        try {
          const r = await fetch('/api/plan/upsell-interest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cycleId: data.viewedCycleId, changesWanted: notice.needed }),
          });
          return r.ok;
        } catch { return false; }   // nothing was filed, so nothing claims it was
      }}
      // F4, threaded: the apply runs in the background and the settled report becomes the
      // confirmation turn; chip + highlights land outside the sheet either way.
      onApply={runApply}
      onDiscard={(ids) => void data.discardChanges(ids)}
      isPending={(id) => data.proposals.some((p) => p.id === id)}
    />
  );

  const detailNode = (
    <DetailSheet
      post={openPost} data={data} rationale={openPost?.rationale ?? ''}
      chrome={desktop ? 'panel' : 'sheet'}
      onClose={() => setOpenId(null)}
      onMove={() => { if (openPost) setMoveId(openPost.id); }}
      onDelete={() => { if (openPost) doDelete(openPost); }}
    />
  );

  /**
   * Plan a post — ONE definition, framed by its caller.
   *
   * `overlays` is the one slot both shells share, so a component that does not opt into a frame
   * gets the phone's by default. This one had no `chrome` prop at all and rendered as the
   * mobile bottom sheet across the whole desktop window: at 2560 a 2524px subject field and an
   * "Add it" bar the width of the screen.
   *
   * On desktop it takes the DAY COLUMN's slot, which is DetailSheet's pattern and for
   * DetailSheet's reason — a date-scoped drill-down belongs in the slot that already holds the
   * day. Naming the frame at the call site rather than inside keeps that a decision the shell
   * makes, which is what every other gated surface here does.
   */
  const addNode = (chrome: 'sheet' | 'panel') => (addFor ? (
    <AddSheet
      open date={addFor} pillars={null} busy={data.busy} chrome={chrome}
      onClose={() => setAddFor(null)}
      onSubmit={({ format, subject }) => data.addShapedPost(addFor, format, subject)}
    />
  ) : null);

  const moveNode = movePost ? (
    <MoveSheet
      // Unlike the other overlays this one is not re-declared per shell — one node, used by
      // both — so the frame is read off `desktop` here rather than named at two call sites.
      open chrome={desktop ? 'modal' : 'sheet'} onClose={() => setMoveId(null)}
      postDate={movePost.date} postTime={movePost.postingTime ?? null}
      postHeading={cardText(movePost).heading}
      knownTimes={knownTimes}
      canMoveTo={data.canEdit}
      onMove={(d, t) => doMove(movePost, d, t)}
    />
  ) : null;

  const pickerNodes = <>{addNode('sheet')}{moveNode}</>;

  const overlayNodes = <>{detailNode}{voiceNode}{pickerNodes}</>;

  /**
   * ── DESKTOP ──────────────────────────────────────────────────────────────────────────
   *
   * The same month, the same state, the same components — a different frame. Three things are
   * genuinely different, and each is the spec's:
   *
   *   THE DETAIL PANEL TAKES THE DAY COLUMN'S SLOT. It is a drill-down of the day, not a third
   *   column, so opening a post reflows nothing and the conversation never yields its edge.
   *   THE CONVERSATION IS DOCKED, always open, `entry="docked"` so it does not take focus from
   *   a page nobody asked it to interrupt.
   *   THE GRID RINGS what an open turn names (D5).
   */
  if (desktop) {
    return (
      <DesktopShell
        clientName={data.clientName}
        subtitle={monthPosts.length === 1 ? '1 post this month' : `${monthPosts.length} posts this month`}
        view={railView} onView={setRailView}
        tasksCount={lateCount(data.posts, data.today)} tasksLate={lateCount(data.posts, data.today) > 0}
        ideasCount={data.ideas.length}
        monthLabel={monthTitle(month)}
        onPrevMonth={prev ? () => { navTrace('cycle user:prev-month', prev.cycleId); void data.switchCycle(prev.cycleId); } : undefined}
        onNextMonth={next ? () => { navTrace('cycle user:next-month', next.cycleId); void data.switchCycle(next.cycleId); } : undefined}
        onToday={goToday} todayEnabled={todayEnabled}
        topSlot={<Feedback
          frame="desktop"
          undo={undo} onDismiss={() => setUndo(null)} message={data.toast}
          agent={null} agentWorking={false}
        />}
        {...(railView === 'ideas'
          ? { region: <IdeasPanel data={data} onOpen={openFromRegion} frame="desktop" /> }
          : {})}
        {...(railView === 'tasks'
          ? { region: <TasksPanel data={data} onOpen={openFromRegion} frame="desktop" /> }
          : {})}
        month={railView !== 'plan' ? null : (
          <MonthGrid
            month={month} selected={selected} today={data.today} frame="desktop"
            marksFor={marksFor} changedFor={dayChanged} ringedFor={ringed}
            onPick={pickFromGrid} footer={monthFooter} lockToMonth
          />
        )}
        day={addNode('panel')
            ?? (openPost
            ? detailNode
            : (
              <DayPanel
                date={selected} today={data.today} frame="desktop"
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
            ))}
        dock={data.readOnly ? undefined : voiceNode}
        overlays={moveNode}
      />
    );
  }

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
      /**
       * ONE feedback channel, at the top (round 6, P10). `data.toast` used to render in a second
       * bar at the bottom of the page, over the nav pill; it comes here instead.
       *
       * ── X5a: THE SECOND THINKING INDICATOR ─────────────────────────────────────────
       *
       * With the sheet open this bar rendered a SECOND "Sprigly is thinking" over the thread's
       * own dots — z-40 against the sheet's z-31, so it sat under the wordmark, above the
       * conversation, saying what the conversation was already saying.
       *
       * `ask({ silent })` does not cover it, and could not: `silent` gates the two RESULT
       * renderings only — `setFlashView('approvals')` (usePlanData.ts:661) and
       * `agentFlash(r.message)` (usePlanData.ts:662). The busy state is a different thing:
       * `setAgentBusy(true)` at usePlanData.ts:623 runs unconditionally, before `opts` is
       * consulted at all, and it MUST — the sheet's own in-thread dots are driven by exactly
       * that flag (`busy={data.agentBusy}` below). Suppressing it in the hook would put the
       * thread's indicator out too.
       *
       * So the rule belongs here, where the two surfaces are: while the thread is open it owns
       * the agent's voice entirely, and this bar carries only what is genuinely about the plan
       * behind it. Structural rather than a flag every future caller has to remember.
       */
      topSlot={<Feedback
        frame="mobile"
        undo={undo} onDismiss={() => setUndo(null)} message={data.toast}
        agent={voiceOpen ? null : data.agentToast} agentWorking={!voiceOpen && data.agentBusy}
      />}
      // No `chip` and no `badge`. Both header surfaces that reported changes are gone by ruling
      // (G6 took the "What changed" row; X5b takes the applied chip and its panel), so a
      // committed month's chrome is the month, the strip and the day.
      overlays={overlayNodes}
      strip={view === 'day' ? (
        <WeekStrip
          selected={selected} today={data.today} month={month}
          markFor={markFor} countFor={(iso) => postsOn(iso).length}
          changedFor={dayChanged}
          onSelect={(iso) => setSelected(iso, 'user:strip')}
        />
      ) : null}
    >
      {view === 'day' && (
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
      {view === 'month' && (
        <MonthGrid
          month={month} selected={selected} today={data.today}
          // lockToMonth: the grid's padding cells are another month's days, and picking one is
          // the jump (round 4). Leaving the month is the ‹ › arrows' job — they refetch.
          marksFor={marksFor} changedFor={dayChanged} onPick={pickFromGrid} footer={monthFooter} lockToMonth
          summary={<MonthDaySummary date={selected} items={rowsFromPosts(postsOn(selected), timeOf)} onOpen={setOpenId} />}
        />
      )}
      {view === 'tasks' && <TasksPanel data={data} onOpen={setOpenId} />}
    </PlanShell>
  );
}
