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
import React, { useCallback, useMemo, useState } from 'react';
import type { PlanData } from '../usePlanData';
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
import { TasksPanel } from './TasksPanel';
import { firstAnswerable, assumptionPrompt } from '@/lib/draft-rationale';
import { Feedback } from './Feedback';
import { MonthDaySummary } from './rows';
import { useDraftMonth } from './useDraftMonth';
import { defaultDayFor, monthOf, monthTitle, monthGrid } from './dates';

/**
 * Under this, a month is THIN and says so at the foot of the day (spec §9.2).
 *
 * Not an error state and not dressed as one. Two causes, both real: a client with fewer than
 * DRAFT_MIN_POSTS on record gets a template skeleton, and some months are just small. The day
 * view is invariant to month size — it shows one day whether the month holds two posts or
 * thirty — which is the strongest structural argument for the day-first pattern.
 */
const THIN_MONTH_MAX = 4;

export function DraftSurface({ data }: { data: PlanData }) {
  const draft = data.draft;
  const viewedCycle = data.cycles.find((c) => c.cycleId === data.viewedCycleId);
  const month = viewedCycle?.displayMonth ?? monthOf(data.today);
  const monthName = monthTitle(month).split(' ')[0] ?? '';

  const m = useDraftMonth(data);
  const editable = !!draft?.editable;

  const [view, setView] = useState<PlanView>('day');
  const [selected, setSelected] = useState(() => defaultDayFor(month, data.today, m.beats.map((b) => b.date)));
  const [openId, setOpenId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  /** null = closed. A string = open, answering that question. '' = open, no question. */
  const [voiceFor, setVoiceFor] = useState<string | null>(null);

  // Re-anchor the selection when the MONTH changes, not on every render.
  const [anchoredMonth, setAnchoredMonth] = useState(month);
  if (anchoredMonth !== month) {
    setAnchoredMonth(month);
    setSelected(defaultDayFor(month, data.today, m.beats.map((b) => b.date)));
  }

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
  const moveBeat = m.beats.find((b) => b.id === moveId) ?? null;

  const sorted = useMemo(() => [...data.cycles].sort((a, b) => a.displayMonth.localeCompare(b.displayMonth)), [data.cycles]);
  const idx = sorted.findIndex((c) => c.cycleId === data.viewedCycleId);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const todayInMonth = monthOf(data.today) === month;
  const todayEnabled = todayInMonth || !!data.todayCycleId;
  const goToday = () => {
    if (todayInMonth) setSelected(data.today);
    else if (data.todayCycleId) void data.switchCycle(data.todayCycleId);
  };

  const monthBeats = useMemo(
    () => monthGrid(month).filter((c) => c.inMonth).flatMap((c) => beatsOn(c.iso)),
    [month, beatsOn],
  );
  const monthFooter = monthBeats.length === 0
    ? `Nothing drafted across ${monthName} yet.`
    : `${monthBeats.length} planned post${monthBeats.length === 1 ? '' : 's'} across ${monthName}. Tap a day to see it.`;

  /**
   * The thin-month acknowledgement, at the FOOT of the day.
   *
   * It goes after the client has read what there is, never before it as a caveat: the same
   * information phrased as an invitation reads as confidence, and phrased as a warning reads as
   * an excuse. There is no second approval button here — the mic and the Generate pill are both
   * already on screen.
   */
  /**
   * The one assumption worth surfacing, re-voiced as a nudge.
   *
   * The assembler attaches the SAME list to every planned post, so it belongs to the month and
   * is shown once — never repeated on ten cards. `firstAnswerable` drops the ones that state a
   * fact about our data rather than a gap in what we know about their month.
   *
   * Never a caveat. Round 1 headed this an amber "What we assumed" warning box; the same
   * information phrased as an invitation reads as confidence, and phrased as a warning reads as
   * an excuse.
   */
  const assumption = useMemo(() => {
    const seen = new Set<string>();
    for (const b of m.beats) for (const a of b.assumptions) seen.add(a);
    return firstAnswerable([...seen]);
  }, [m.beats]);

  const thin = editable && monthBeats.length > 0 && monthBeats.length <= THIN_MONTH_MAX;
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

  return (
    <PlanShell
      monthLabel={monthTitle(month)}
      onPrevMonth={prev ? () => void data.switchCycle(prev.cycleId) : undefined}
      onNextMonth={next ? () => void data.switchCycle(next.cycleId) : undefined}
      view={view}
      onView={(v) => { setView(v); data.track('view_switched', { view: v, surface: 'draft' }); }}
      // THE MIC'S CONSEQUENCE HERE IS DIRECT: one sentence adds, moves or replaces planned posts
      // and returns a receipt (`POST /api/plan/draft/apply`). On a committed month the same
      // gesture raises proposals the client then approves. Same icon, different consequence, and
      // the sheet is what says which. Absent past the cutoff rather than inert: a mic that
      // refuses is worse than no mic.
      onMic={editable ? () => setVoiceFor('') : undefined}
      micLabel={`Tell us about ${monthName}`}
      onToday={goToday}
      todayEnabled={todayEnabled}
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
      topSlot={<Feedback undo={m.undo} onDismiss={() => m.setUndo(null)} message={data.toast} />}
      overlays={<>
        <DraftDetailSheet
          beat={openBeat} editable={editable} busy={m.busy}
          onClose={() => setOpenId(null)}
          onMove={() => { if (openBeat) setMoveId(openBeat.id); }}
          onDelete={() => { if (openBeat) doDelete(openBeat); }}
          onFormat={(f: PostFormat) => { if (openBeat) void m.changeFormat(openBeat, f); }}
        />
        {moveBeat && (
          <MoveSheet
            open onClose={() => setMoveId(null)}
            postDate={moveBeat.date} postTime={null} postHeading={moveBeat.title}
            knownTimes={[]} timeEditable={false}
            canMoveTo={data.canEdit}
            onMove={(d) => doMove(moveBeat, d)}
          />
        )}
        {voiceFor !== null && (
          <VoiceSheet
            open monthName={monthName} busy={m.busy}
            {...(voiceFor ? { question: voiceFor } : {})}
            onClose={() => setVoiceFor(null)}
            onSubmit={(text, source) => {
              setVoiceFor(null);
              void m.say(text, source);
            }}
          />
        )}
        {addFor && (
          <AddSheet
            open date={addFor} pillars={draft?.pillars ?? []} busy={m.busy}
            onClose={() => setAddFor(null)}
            onSubmit={({ format, subject, pillar }) => {
              setAddFor(null);
              void m.add(addFor, format, pillar ?? '', subject);
            }}
          />
        )}
      </>}
      strip={view === 'day' ? (
        <WeekStrip
          selected={selected} today={data.today} month={month}
          markFor={markFor} countFor={(iso) => beatsOn(iso).length}
          onSelect={setSelected}
        />
      ) : null}
    >
      {view === 'day' && (
        <DraftDayPanel
          date={selected} today={data.today}
          beats={beatsOn(selected)}
          editable={editable && data.canEdit(selected)}
          changedIds={m.changedIds}
          onOpen={setOpenId}
          onAdd={() => setAddFor(selected)}
          nudge={editable && assumption ? {
            question: assumptionPrompt(assumption),
            onAnswer: () => setVoiceFor(assumptionPrompt(assumption)),
          } : undefined}
          footer={thinNote}
        />
      )}
      {view === 'month' && (
        <MonthGrid
          month={month} selected={selected} today={data.today}
          marksFor={marksFor} onPick={setSelected} footer={monthFooter}
          summary={
            <MonthDaySummary
              date={selected} noun="planned post" empty="Nothing drafted"
              items={beatsOn(selected).map((b) => ({ id: b.id, title: b.title, format: b.format }))}
              onOpen={setOpenId}
            />
          }
        />
      )}
      {view === 'tasks' && <TasksPanel data={data} onOpen={() => {}} />}
    </PlanShell>
  );
}
