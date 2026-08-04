'use client';

/**
 * DraftSurface.tsx — a draft month, in the same shell as a committed one.
 *
 * This is the piece the whole redesign was pointing at. Spec §1.3 named it the single largest
 * work item the design implies, Session A did the structural half (`PlanRoot` forks on viewport
 * FIRST, so a draft month is a branch of a form factor rather than a page that pre-empts one),
 * and this is the other half: the mobile draft branch is now `PlanShell`, with different children.
 *
 *     SURFACE = draft | committed        (the server decides — surface-state.ts)
 *        └── VIEW = day | month | tasks  (the nav pill)
 *              └── the surface's content renders INSIDE the view
 *
 * `DraftPlanView` — 654 lines of standalone page with its own header, its own month pills, its
 * own twelve-entry hard-coded colour object and its own bottom-anchored undo bar — is no longer
 * reachable on a phone. It is still the desktop draft surface, deliberately: `PlanDesktop`'s own
 * redesign is a later session and the shell must not break it in the meantime.
 *
 * ── What the two surfaces genuinely share, and what they cannot ──────────────────────
 *
 * SHARED, as components: the shell, the nav pill, the week strip, the month grid, the compact
 * row, the sheet chrome, the format control, the feedback slot, the add sheet, the move sheet.
 * That list is the argument for the reconciliation — every one of them was about to be built
 * twice.
 *
 * NOT SHARED, and correctly so: the card and the detail sheet. A `DraftBeatView` has no caption,
 * no hook, no script and no checklist, because none of those exists until the month is approved
 * and generation runs. It is a separate type on purpose, and rendering it through the committed
 * card with empty strings is exactly the confusion the draft fence exists to prevent.
 *
 * ── The mic ──────────────────────────────────────────────────────────────────────────
 *
 * On a DRAFT month the mic RESHAPES THE MONTH DIRECTLY — one sentence adds, moves or replaces
 * planned posts and returns a receipt. That is a different consequence from the committed
 * month's, where the same gesture raises proposals the client then approves, and the sheet has
 * to say which. The sheet is the voice sheet (§8).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanData } from '../usePlanData';
import { restoreDayFor, saveNavState } from '../nav-state';
import { navTrace } from '../nav-trace';
import type { DraftBeatView, PostFormat } from '@/lib/types';
import { PlanShell } from './PlanShell';
import type { PlanView } from './NavPill';
import { WeekStrip, type DayMark } from './WeekStrip';
import { MonthGrid } from './MonthGrid';
import { DraftDayPanel } from './DraftDayPanel';
import { DraftDetailSheet } from './DraftDetailSheet';
import { MoveSheet } from './MoveSheet';
import { AddSheet } from './AddSheet';
import { VoiceSheet } from './VoiceSheet';
import { ApprovalSheet, ApprovalPill, useApproval } from './ApprovalSheet';
import { TasksPanel } from './TasksPanel';
import { IdeasPanel } from './IdeasPanel';
import { monthSummary } from '@/lib/draft-rationale';
import { DraftMonthSummary } from './DraftMonthSummary';
import { Feedback } from './Feedback';
import { SummaryChip } from './SummaryChip';
import { ReceiptPanel } from './ReceiptPanel';
import { chipLabel } from './receipt-summary';
import { MonthDaySummary } from './rows';
import { useDraftMonth } from './useDraftMonth';
import { defaultDayFor, monthOf, monthTitle, monthGrid } from './dates';
import { DesktopShell } from './DesktopShell';
import type { RailView } from './Rail';
import { type SurfaceFrame } from './frame';

/**
 * Under this, a month is THIN and says so at the foot of the day (spec §9.2).
 *
 * Not an error state and not dressed as one. Two causes, both real: a client with fewer than
 * DRAFT_MIN_POSTS on record gets a template skeleton, and some months are just small. The day
 * view is invariant to month size — it shows one day whether the month holds two posts or
 * thirty — which is the strongest structural argument for the day-first pattern.
 */
const THIN_MONTH_MAX = 4;

export function DraftSurface({ data, frame = 'mobile' }: { data: PlanData; frame?: SurfaceFrame }) {
  const desktop = frame === 'desktop';
  const draft = data.draft;
  const viewedCycle = data.cycles.find((c) => c.cycleId === data.viewedCycleId);
  const month = viewedCycle?.displayMonth ?? monthOf(data.today);
  const monthName = monthTitle(month).split(' ')[0] ?? '';

  const m = useDraftMonth(data);
  const editable = !!draft?.editable;

  const [view, setView] = useState<PlanView>('day');
  /** The desktop rail's position — a separate enum, because Plan/Tasks and Day/Month/Tasks
   *  navigate different things. */
  const [railView, setRailView] = useState<RailView>('plan');
  // The selection rule (F2) — same as CommittedSurface: a gesture, or a restore of where a
  // gesture last put it. This surface is remounted per cycle (`key={viewedCycleId}`), so a
  // reload restores through the initialiser and the re-anchor covers in-place month moves.
  const [selected, setSelectedRaw] = useState(() => {
    const kept = restoreDayFor(data.viewedCycleId, month);
    navTrace('select mount', kept ? `restored ${kept}` : 'default');
    return kept ?? defaultDayFor(month, data.today, m.beats.map((b) => b.date));
  });
  const setSelected = useCallback((iso: string, why = 'user:tap') => {
    navTrace('select ' + why, iso);
    setSelectedRaw(iso);
  }, []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  /** null = closed. A string = open, answering that question. '' = open, no question. */
  const [voiceFor, setVoiceFor] = useState<string | null>(null);
  /**
   * Every request to take the composer, counted.
   *
   * On the phone `setVoiceFor` both opens the sheet and points it at a question — one act. On
   * desktop the dock is already open, so `setVoiceFor` alone changed a prop the sheet had
   * stopped listening to and the summary's two foot buttons did nothing at all. Bumping this
   * beside it is what makes them live; see VoiceSheet's `focusSignal`.
   */
  const [voiceSignal, setVoiceSignal] = useState(0);
  const askVoice = useCallback((question: string) => {
    setVoiceFor(question);
    setVoiceSignal((n) => n + 1);
  }, []);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const approval = useApproval(data.viewedCycleId);

  // Re-anchor the selection when the MONTH changes, not on every render. Only switchCycle
  // moves the month, so this is user navigation landing; a stored day on the entered month
  // is preferred over the default anchor.
  const [anchoredMonth, setAnchoredMonth] = useState(month);
  if (anchoredMonth !== month) {
    setAnchoredMonth(month);
    const kept = restoreDayFor(data.viewedCycleId, month);
    setSelected(kept ?? defaultDayFor(month, data.today, m.beats.map((b) => b.date)), kept ? 'restore:month-change' : 'user:month-change');
  }

  // Persist the position on every change (see nav-state.ts — the reload nobody pressed).
  useEffect(() => {
    saveNavState({ cycleId: data.viewedCycleId, selected, view });
  }, [data.viewedCycleId, selected, view]);

  const byDate = useMemo(() => {
    const map = new Map<string, DraftBeatView[]>();
    for (const b of m.beats) {
      const a = map.get(b.date) ?? [];
      a.push(b);
      map.set(b.date, a);
    }
    return map;
  }, [m.beats]);

  const beatsOn = useCallback((iso: string) => byDate.get(iso) ?? [], [byDate]);

  /** Every mark on a draft month is a `draft` mark — accent, not chrome. There is no in-flight
   *  state here: nothing is being written until the month is approved. */
  const marksFor = useCallback((iso: string): DayMark[] => beatsOn(iso).map(() => 'draft' as const), [beatsOn]);
  const markFor = useCallback((iso: string): DayMark => (beatsOn(iso).length ? 'draft' : 'none'), [beatsOn]);

  const openBeat = m.beats.find((b) => b.id === openId) ?? null;
  /**
   * Open a beat from a view that owns the WHOLE plan region — Ideas, Tasks.
   *
   * The same rule the committed surface follows: the detail renders into the day column and
   * `region` replaces both columns, so setting the id without returning to the plan changes
   * state and nothing on the screen. Opening a beat is a plan act.
   */
  const openFromRegion = useCallback((beatId: string) => {
    setOpenId(beatId);
    setRailView('plan');
  }, []);
  const moveBeat = m.beats.find((b) => b.id === moveId) ?? null;

  const sorted = useMemo(() => [...data.cycles].sort((a, b) => a.displayMonth.localeCompare(b.displayMonth)), [data.cycles]);
  const idx = sorted.findIndex((c) => c.cycleId === data.viewedCycleId);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const todayInMonth = monthOf(data.today) === month;
  const todayEnabled = todayInMonth || !!data.todayCycleId;
  const goToday = () => {
    if (todayInMonth) setSelected(data.today, 'user:today');
    else if (data.todayCycleId) { navTrace('cycle user:today', data.todayCycleId); void data.switchCycle(data.todayCycleId); }
  };

  const monthBeats = useMemo(
    () => monthGrid(month).filter((c) => c.inMonth).flatMap((c) => beatsOn(c.iso)),
    [month, beatsOn],
  );
  const monthFooter = monthBeats.length === 0
    ? `Nothing drafted across ${monthName} yet.`
    : `${monthBeats.length} planned post${monthBeats.length === 1 ? '' : 's'} across ${monthName}. Tap a day to see it.`;

  /**
   * THE MONTH'S ACCOUNT OF ITSELF, at the head of the day (S1).
   *
   * Computed from the beats' own evidence by the module that already turns that evidence into
   * words for the beat sheet — one derivation, two renderings, so the panel and the sheet cannot
   * state the same fact two ways (S3). Nothing here is narrated and nothing is padded: a section
   * with no evidence behind it is not built at all.
   *
   * THE ASSUMPTIONS LIVE HERE NOW (M4). The day's strip is gone, and `monthSummary` carries the
   * whole set — including the one `firstAnswerable` ranks highest, re-voiced as its question and
   * marked answerable. The surface no longer picks that assumption itself; picking it in two
   * places was how the panel and the strip could have come to disagree about which gap mattered.
   */
  const thin = editable && monthBeats.length > 0 && monthBeats.length <= THIN_MONTH_MAX;

  /**
   * ── D6: A THIN MONTH OPENS ITS OWN ARGUMENT, on desktop only ────────────────────────
   *
   * Two posts on a 1440px screen is the one case where the month column has nothing to say
   * once the calendar has run out of rows, and the panel is where the month's reasoning lives:
   * the mix, what came from her, what we assumed. Opening it fills that column with FACTS
   * rather than with padding, which is the whole of the spec's answer to a thin month.
   *
   * On a full month it opens closed, because thirty posts are their own argument and two are
   * not. On the PHONE it opens closed either way — there the panel heads the day, and starting
   * it expanded would push the day's content down the screen, which is the exact regression
   * §S2 measured and fixed.
   *
   * An initialiser, not an effect: the client can close it and it stays closed.
   */
  const [summaryOpen, setSummaryOpen] = useState(() => desktop && thin);
  const summary = useMemo(
    () => monthSummary(monthBeats, { monthName, editable }),
    [monthBeats, monthName, editable],
  );

  /**
   * The chip's line, derived from the receipt's OWN diff lines — never narrated, and never a
   * number this surface computed for itself. Empty when the application changed nothing and
   * filed nothing, in which case there is no chip at all rather than one reading "0 changes".
   */
  const label = chipLabel(m.receipt);
  // The panel cannot outlive its chip: clearing the receipt while expanded would leave the
  // content region rendering a record that is no longer on screen anywhere.
  const showingReceipt = receiptOpen && !!m.receipt && !!label;

  /**
   * The thin-month acknowledgement, at the FOOT of the day.
   *
   * It goes after the client has read what there is, never before it as a caveat: the same
   * information phrased as an invitation reads as confidence, and phrased as a warning reads as
   * an excuse. There is no second approval button here — the mic and the Generate pill are both
   * already on screen.
   */
  const thinNote = thin ? (
    <p data-testid="thin-month" className="mt-4 px-1 text-[13.5px] leading-normal text-muted">
      {monthBeats.length === 1 ? 'One post so far' : `${monthBeats.length} posts so far`}. Tell us what’s coming up and
      we’ll build it out, or say you’re ready and we’ll write {monthBeats.length === 1 ? 'it' : 'these'}.
    </p>
  ) : undefined;

  const doMove = (beat: DraftBeatView, date: string) => {
    setMoveId(null);
    setOpenId(null);
    void m.move(beat, date);
  };

  const doDelete = (beat: DraftBeatView) => {
    setOpenId(null);
    void m.drop(beat);
  };

  /**
   * ── DESKTOP ──────────────────────────────────────────────────────────────────────────
   *
   * The same month and the same state in a different frame. What the draft month brings with it
   * is its whole provisional skin — the dashed cards, the Draft badge, the Generate pill, the
   * grounded beats and the month summary — because every one of those is CONTENT, and content
   * does not change with the shell.
   *
   * The receipt panel keeps its rule too: it REPLACES the view rather than stacking over it.
   * Here the view it replaces is the month column, which is the region the receipt is about.
   */
  const draftDetailNode = (
    <DraftDetailSheet
      beat={openBeat} editable={editable} busy={m.busy}
      chrome={desktop ? 'panel' : 'sheet'}
      onClose={() => setOpenId(null)}
      onMove={() => { if (openBeat) setMoveId(openBeat.id); }}
      onDelete={() => { if (openBeat) doDelete(openBeat); }}
      onFormat={(f: PostFormat) => { if (openBeat) void m.changeFormat(openBeat, f); }}
    />
  );

  /**
   * Plan a post — one definition, framed by its caller. Sheet on a phone; on desktop it takes
   * the DAY COLUMN's slot, which is DetailSheet's pattern and for DetailSheet's reason: a
   * date-scoped drill-down belongs in the slot that already holds the day. See AddSheet.
   */
  const addNode = (chrome: 'sheet' | 'panel') => (addFor ? (
    <AddSheet
      open date={addFor} pillars={draft?.pillars ?? []} busy={m.busy} chrome={chrome}
      onClose={() => setAddFor(null)}
      onSubmit={async ({ format, subject, pillar }) => (await m.add(addFor, format, pillar ?? '', subject)).ok}
    />
  ) : null);

  // `onIdeas` turns the "6 ideas you gave us in July" line into a way to go and read them.
  // Desktop only: Ideas is a rail destination and the phone has no rail to send anyone to.
  const summaryNode = (
    <DraftMonthSummary
      summary={summary} expanded={summaryOpen} onToggle={() => setSummaryOpen((v) => !v)}
      onAnswer={askVoice}
      {...(editable ? { onShape: () => askVoice('') } : {})}
      {...(desktop ? { onIdeas: () => setRailView('ideas') } : {})}
    />
  );

  if (desktop) {
    return (
      <DesktopShell
        clientName={data.clientName}
        subtitle={monthBeats.length === 1 ? '1 planned post' : `${monthBeats.length} planned posts`}
        view={railView} onView={setRailView}
        tasksCount={0} tasksLate={false}
        ideasCount={data.ideas.length}
        monthLabel={monthTitle(month)}
        onPrevMonth={prev ? () => { navTrace('cycle user:prev-month', prev.cycleId); void data.switchCycle(prev.cycleId); } : undefined}
        onNextMonth={next ? () => { navTrace('cycle user:next-month', next.cycleId); void data.switchCycle(next.cycleId); } : undefined}
        onToday={goToday} todayEnabled={todayEnabled}
        badge={
          <span className="flex min-w-0 items-center gap-2">
            <span data-testid="draft-badge" className="flex-none rounded-full bg-coral-650 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.1em] text-white">
              Draft
            </span>
            <span data-testid="draft-framing" className="min-w-0 truncate text-[13.5px] font-medium text-chrome">
              This is your {monthName} draft
            </span>
          </span>
        }
        headerRight={editable && m.beats.length > 0
          ? <ApprovalPill busy={approval.busy} onClick={() => approval.setOpen(true)} />
          : undefined}
        topSlot={<Feedback
          undo={m.undo} onDismiss={() => m.setUndo(null)} message={data.toast}
          agent={null} agentWorking={m.shaping}
        />}
        {...(railView === 'ideas'
          ? { region: <IdeasPanel data={data} onOpen={openFromRegion} frame="desktop" /> }
          : {})}
        {...(railView === 'tasks'
          ? { region: <TasksPanel data={data} onOpen={() => {}} frame="desktop" /> }
          : {})}
        month={railView !== 'plan' ? null : showingReceipt && m.receipt ? (
          <ReceiptPanel
            receipt={m.receipt} monthName={monthName} editable={editable} rescuing={m.busy}
            onRescue={(id) => void m.addToMonth(id, m.rescueDate())}
            onClear={() => { setReceiptOpen(false); m.setReceipt(null); }}
          />
        ) : (
          <>
            <SummaryChip label={label} expanded={receiptOpen} onToggle={() => setReceiptOpen((v) => !v)} />
            <MonthGrid
              month={month} selected={selected} today={data.today} frame="desktop"
              marksFor={marksFor} onPick={(iso) => setSelected(iso, 'user:grid')}
              footer={monthFooter} lockToMonth
            />
            <div className="flex-none px-[22px] pb-5">{summaryNode}</div>
          </>
        )}
        day={addNode('panel')
            ?? (openBeat
            ? draftDetailNode
            : (
              <DraftDayPanel
                date={selected} today={data.today} frame="desktop"
                beats={beatsOn(selected)}
                editable={editable && data.canEdit(selected)}
                changedIds={m.changedIds}
                onOpen={setOpenId}
                onAdd={() => setAddFor(selected)}
                footer={thinNote}
              />
            ))}
        dock={editable ? (
          <VoiceSheet
            open context="draft" monthName={monthName} busy={m.busy}
            cycleId={data.viewedCycleId} chrome="panel" entry="docked"
            {...(voiceFor ? { question: voiceFor } : {})}
            {...(voiceSignal ? { focusSignal: voiceSignal } : {})}
            onClose={() => setVoiceFor(null)}
            onSubmit={async (text, source) => {
              const r = await m.say(text, source);
              if (!r.ok) return { ok: false as const };
              const lines = r.application?.lines ?? [];
              return {
                ok: true as const,
                message: lines.length ? lines.join('\n')
                  : r.application?.scope === 'evergreen' ? 'Saved to your ideas — nothing on the month changed.'
                  : 'Done — the month view shows what changed.',
              };
            }}
          />
        ) : undefined}
        overlays={<>
          {moveBeat && (
            <MoveSheet
              open onClose={() => setMoveId(null)}
              postDate={moveBeat.date} postTime={null} postHeading={moveBeat.title}
              knownTimes={[]} timeEditable={false}
              canMoveTo={data.canEdit}
              onMove={(d) => doMove(moveBeat, d)}
            />
          )}
          <ApprovalSheet
            open={approval.open} monthLabel={monthTitle(month)} beats={m.beats}
            busy={approval.busy} error={approval.error} chrome="modal"
            onClose={() => approval.setOpen(false)}
            onApprove={() => void approval.approve()}
          />
        </>}
      />
    );
  }

  return (
    <PlanShell
      monthLabel={monthTitle(month)}
      onPrevMonth={prev ? () => { navTrace('cycle user:prev-month', prev.cycleId); void data.switchCycle(prev.cycleId); } : undefined}
      onNextMonth={next ? () => { navTrace('cycle user:next-month', next.cycleId); void data.switchCycle(next.cycleId); } : undefined}
      view={view}
      onView={(v) => { setView(v); setReceiptOpen(false); data.track('view_switched', { view: v, surface: 'draft' }); }}
      // THE MIC'S CONSEQUENCE HERE IS DIRECT: one sentence adds, moves or replaces planned posts
      // and returns a receipt (`POST /api/plan/draft/apply`). On a committed month the same
      // gesture raises proposals the client then approves. Same icon, different consequence, and
      // the sheet is what says which. Absent past the cutoff rather than inert: a mic that
      // refuses is worse than no mic.
      onMic={editable ? () => askVoice('') : undefined}
      micLabel={`Tell us about ${monthName}`}
      onToday={goToday}
      todayEnabled={todayEnabled}
      // THE PILL, in the space the round-3 Week|Month switcher vacated. Rendered only on an
      // editable draft that has something to approve: a Generate control on an empty month, or
      // on one already past its cutoff, is a control that can only refuse.
      headerRight={editable && m.beats.length > 0 ? <ApprovalPill busy={approval.busy} onClick={() => approval.setOpen(true)} /> : undefined}
      badge={
        // The badge carries *provisional*; the line carries *which month*. "Not sent yet" is
        // gone from here as redundant with the badge, and the rest of the framing lives in the
        // voice sheet, where the client is already being asked to speak (spec §2).
        <span className="flex min-w-0 items-center gap-2">
          <span data-testid="draft-badge" className="flex-none rounded-full bg-coral-650 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.1em] text-white">
            Draft
          </span>
          <span data-testid="draft-framing" className="min-w-0 truncate text-[13.5px] font-medium text-chrome">
            This is your {monthName} draft
          </span>
        </span>
      }
      // X5a, same rule as the committed month: while the sheet is open the THREAD owns the
      // agent's voice and its working state, and this bar must not render a second copy over it.
      topSlot={<Feedback
        undo={m.undo} onDismiss={() => m.setUndo(null)} message={data.toast}
        agent={voiceFor !== null ? null : data.agentToast}
        agentWorking={voiceFor === null && (data.agentBusy || m.shaping)}
      />}
      chip={<SummaryChip label={label} expanded={receiptOpen} onToggle={() => setReceiptOpen((v) => !v)} />}
      overlays={<>
        {draftDetailNode}
        {moveBeat && (
          <MoveSheet
            open onClose={() => setMoveId(null)}
            postDate={moveBeat.date} postTime={null} postHeading={moveBeat.title}
            knownTimes={[]} timeEditable={false}
            canMoveTo={data.canEdit}
            onMove={(d) => doMove(moveBeat, d)}
          />
        )}
        {/* The desktop twin two hundred lines up says `chrome="modal"`; this one said nothing
            and took the default. Both are explicit now. */}
        <ApprovalSheet
          open={approval.open} monthLabel={monthTitle(month)} beats={m.beats}
          busy={approval.busy} error={approval.error} chrome="sheet"
          onClose={() => approval.setOpen(false)}
          onApprove={() => void approval.approve()}
        />
        {voiceFor !== null && (
          <VoiceSheet
            open context="draft" monthName={monthName} busy={m.busy} chrome="sheet"
            cycleId={data.viewedCycleId}
            {...(voiceFor ? { question: voiceFor } : {})}
            // The phone gets the signal too. It does not NEED it — a summoned sheet mounts on
            // the same gesture and its mount effect already focuses — but passing it keeps one
            // behaviour across both frames instead of two paths that happen to agree.
            {...(voiceSignal ? { focusSignal: voiceSignal } : {})}
            onClose={() => setVoiceFor(null)}
            // NO interpretation turns on a draft month, and that is not an omission. A reshape
            // here APPLIES directly and returns a receipt — so the agent's turn IS the receipt's
            // own lines, and the conversation continues. The summary chip on the surface still
            // says what moved; there is nothing to consent to after the fact.
            onSubmit={async (text, source) => {
              const r = await m.say(text, source);
              if (!r.ok) return { ok: false as const };
              const lines = r.application?.lines ?? [];
              return {
                ok: true as const,
                message: lines.length ? lines.join('\n')
                  : r.application?.scope === 'evergreen' ? 'Saved to your ideas — nothing on the month changed.'
                  : 'Done — the month view shows what changed.',
              };
            }}
          />
        )}
        {addNode('sheet')}
      </>}
      strip={view === 'day' && !showingReceipt ? (
        <WeekStrip
          selected={selected} today={data.today} month={month}
          markFor={markFor} countFor={(iso) => beatsOn(iso).length}
          onSelect={(iso) => setSelected(iso, 'user:strip')}
        />
      ) : null}
    >
      {/* THE PANEL REPLACES THE VIEW rather than stacking over it. Not a sheet: a sheet implies
          a task to finish and a way out to find, and this is a thing to read. The nav pill stays
          live underneath, so leaving is the same gesture as changing view. */}
      {showingReceipt && m.receipt && (
        <ReceiptPanel
          receipt={m.receipt} monthName={monthName} editable={editable} rescuing={m.busy}
          onRescue={(id) => void m.addToMonth(id, m.rescueDate())}
          onClear={() => {
            setReceiptOpen(false);
            // Clearing the summary NEVER un-marks what changed: "New" is `changedIds`, a
            // different piece of state with a different lifetime (spec §3).
            m.setReceipt(null);
          }}
        />
      )}

      {!showingReceipt && view === 'day' && (
        <DraftDayPanel
          date={selected} today={data.today}
          beats={beatsOn(selected)}
          editable={editable && data.canEdit(selected)}
          changedIds={m.changedIds}
          onOpen={setOpenId}
          onAdd={() => setAddFor(selected)}
          // BOTH PROMPTS OPEN THE SAME SHEET the mic opens, and that is the point of
          // putting them here: the client has just read the reasoning, and the one place to say
          // something about it is the one place they already know.
          summary={summaryNode}
          footer={thinNote}
        />
      )}
      {!showingReceipt && view === 'month' && (
        <MonthGrid
          month={month} selected={selected} today={data.today}
          marksFor={marksFor} onPick={(iso) => setSelected(iso, 'user:grid')} footer={monthFooter} lockToMonth
          summary={
            <MonthDaySummary
              date={selected} noun="planned post" empty="Nothing drafted"
              items={beatsOn(selected).map((b) => ({ id: b.id, title: b.title, format: b.format }))}
              onOpen={setOpenId}
            />
          }
        />
      )}
      {!showingReceipt && view === 'tasks' && <TasksPanel data={data} onOpen={() => {}} />}
    </PlanShell>
  );
}
