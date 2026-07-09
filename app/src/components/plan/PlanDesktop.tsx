'use client';

import React, { useMemo, useState } from 'react';
import type { PlanData } from './usePlanData';
import { Drawer, Scrim, Sheet, DISABLED_PRIMARY } from './primitives';
import { PostEditor } from './PostEditor';
import { PostChip, ProposalCard, NoteRow, ExtractionSummary, monthDayLabel, postTitle, WeatherCellIcon } from './pieces';
import { planTasks, lateCount, viewedMonth } from './derive';
import {
  SprigMark, ChevronLeft, ChevronRight, CalendarIcon, TimelineIcon, TasksIcon, ApprovalsIcon,
  NotesIcon, MicIcon, SendIcon, SparkIcon, FormatIcon, FORMAT_LABEL,
} from './icons';

type View = 'calendar' | 'timeline' | 'tasks' | 'approvals' | 'notes';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');

export function PlanDesktop({ data }: { data: PlanData }) {
  const [view, setView] = useState<View>('calendar');
  const [selId, setSelId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [agentText, setAgentText] = useState('');

  const { posts, cycles, proposals, notes, today } = data;
  const cyclesByMonth = useMemo(() => [...cycles].sort((a, b) => a.displayMonth.localeCompare(b.displayMonth)), [cycles]);
  const viewedCycle = cycles.find((c) => c.cycleId === data.viewedCycleId);
  const { year, month } = viewedMonth(viewedCycle?.displayMonth, posts);
  const idx = cyclesByMonth.findIndex((c) => c.cycleId === data.viewedCycleId);
  const prevCycle = idx > 0 ? cyclesByMonth[idx - 1] : null;
  const nextCycle = idx >= 0 && idx < cyclesByMonth.length - 1 ? cyclesByMonth[idx + 1] : null;

  const lateN = lateCount(posts, today);
  const sel = posts.find((p) => p.id === selId) ?? null;
  const select = (id: string) => { setSelId(id); setDrawerOpen(true); };

  const iso = (day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

  // Agent submit: clear the input only on a successful turn (preserve it on failure).
  const submitAsk = async () => { if (!agentText.trim()) return; const r = await data.ask(agentText, selId); if (r) setAgentText(''); };

  const railBtn = (v: View, label: string, Icon: React.FC<{ className?: string }>, count: number, warn?: boolean, dot?: boolean) => (
    <button
      data-testid={`nav-${v}`} onClick={() => { setView(v); data.track('view_switched', { view: v }); }} title={label}
      className={[
        'relative flex w-full items-center gap-[11px] rounded-xl px-3 py-[11px] text-left text-[14.5px] font-bold',
        railCollapsed ? 'justify-center px-0' : '',
        view === v ? 'bg-coral-tint text-coral-on-tint' : 'text-slate-600 hover:bg-line-soft',
      ].join(' ')}
    >
      <Icon className={`h-[19px] w-[19px] flex-none ${view === v ? 'text-coral' : 'text-muted'}`} />
      {!railCollapsed && <span className="flex-1">{label}</span>}
      {!railCollapsed && count > 0 && (
        <span className={`ml-auto rounded-full px-2 py-px text-[11px] font-extrabold ${warn ? 'bg-amber-tint text-amber-deep' : view === v ? 'bg-white text-slate-600' : 'bg-[#ECEAE6] text-slate-600'}`}>{warn ? `${count} late` : count}</span>
      )}
      {railCollapsed && dot && count > 0 && <span className="absolute right-2 top-1.5 h-[7px] w-[7px] rounded-full bg-coral" />}
    </button>
  );

  return (
    <div className="flex h-screen flex-col bg-bg text-slate-700" data-testid="plan-desktop">
      {/* topbar */}
      <header className="flex h-[66px] flex-none items-center justify-between border-b border-line bg-surface px-7">
        <div className="flex items-center gap-2.5"><SprigMark className="h-[26px] w-[26px]" /><span className="text-[22px] font-extrabold tracking-tight text-coral-heading">Sprigly</span></div>
        <span className="text-[12.5px] font-semibold text-muted">Plan workspace</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* main */}
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-none items-center gap-3 px-[34px] pb-2 pt-5">
            {view === 'calendar' && (
              <div className="mr-0.5 flex items-center gap-1.5">
                <button data-testid="prev-month" disabled={!prevCycle} onClick={() => prevCycle && data.switchCycle(prevCycle.cycleId)} aria-label="Previous month"
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-line bg-surface text-slate-700 shadow-card disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-[15px] w-[15px]" /></button>
                <button data-testid="next-month" disabled={!nextCycle} onClick={() => nextCycle && data.switchCycle(nextCycle.cycleId)} aria-label="Next month"
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-line bg-surface text-slate-700 shadow-card disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-[15px] w-[15px]" /></button>
              </div>
            )}
            <span className="font-serif text-[26px] text-slate-700">
              {view === 'calendar' ? `${MONTHS[month]} ${year}` : view === 'timeline' ? 'Timeline' : view === 'tasks' ? 'Tasks' : view === 'approvals' ? 'Approvals' : 'Notes'}
            </span>
            {/* Calendar drops the post count — it's already in the rail badge + summary card. */}
            {view !== 'calendar' && (
              <span className="text-[13px] font-bold text-muted">
                {view === 'timeline' ? 'Oldest first · coral line marks today' : view === 'tasks' ? 'What to create, worked back from each date' : view === 'approvals' ? 'Sprigly suggested these — approve to apply, or discard' : 'Things you’ve said that shape future planning'}
              </span>
            )}
            <span className="flex-1" />
            {view === 'calendar' && (
              <button data-testid="today-btn" onClick={() => data.switchCycle(data.homeCycleId)} className="rounded-full border border-line bg-surface px-[15px] py-[7px] text-[12.5px] font-bold text-slate-600 shadow-card">Today</button>
            )}
          </div>

          {/* pb clears the fixed FAB (bottom-[34px] + 60px tall) so the last calendar row
              never sits under it, even at 900px-height viewports. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-[34px] pb-28 pt-2" data-testid="plan-body">
            {view === 'calendar' && <CalendarView data={data} year={year} month={month} selId={selId} onSelect={select} />}
            {view === 'timeline' && <TimelineView data={data} selId={selId} onSelect={select} />}
            {view === 'tasks' && <TasksView data={data} onSelect={select} />}
            {view === 'approvals' && <ApprovalsView data={data} />}
            {view === 'notes' && <NotesView data={data} />}
          </div>
        </main>

        {/* right rail */}
        <aside data-testid="rail" className={`order-2 flex flex-none flex-col gap-1.5 overflow-hidden border-l border-line bg-surface px-3.5 py-[18px] transition-[width] duration-300 ease-sheet ${railCollapsed ? 'w-[72px] px-3' : 'w-[224px]'}`}>
          <div className="mb-2.5 flex min-h-[40px] items-center justify-between gap-2">
            {!railCollapsed && <div className="font-serif text-[19px] leading-tight text-slate-700">{data.clientName} · <em className="not-italic text-slate-700">{MONTHS[month]}</em></div>}
            <button data-testid="rail-toggle" onClick={() => setRailCollapsed((c) => !c)} aria-label="Collapse menu"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] border border-line bg-surface text-slate-600 shadow-card">
              <ChevronRight className={`h-[17px] w-[17px] transition-transform duration-300 ${railCollapsed ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {!railCollapsed && <div className="mb-2.5 border-b border-line px-2 pb-3.5 text-[11.5px] font-semibold leading-snug text-muted">{posts.length} posts · opened from your link, no password needed</div>}
          <nav className="flex flex-col gap-1">
            <div className={data.flashView === 'approvals' && view !== 'approvals' ? '' : ''}>{railBtn('calendar', 'Calendar', CalendarIcon, posts.length, false, false)}</div>
            {railBtn('timeline', 'Timeline', TimelineIcon, 0)}
            {railBtn('tasks', 'Tasks', TasksIcon, lateN, true, true)}
            <div className={data.flashView === 'approvals' ? 'pr-flash rounded-xl' : ''}>{railBtn('approvals', 'Approvals', ApprovalsIcon, proposals.length, false, true)}</div>
            {railBtn('notes', 'Notes', NotesIcon, notes.length, false, true)}
          </nav>
          <div className="my-3 h-px bg-line" />
          {/* CTA (John's pick B): deep AA-safe coral fill + white — white on #C24C34 = 4.80.
              coral-cta is the ONLY coral allowed under white text, button fills only (§15). */}
          {!data.readOnly && (
            <button data-testid="add-post" onClick={() => data.addPost(iso(Math.min(new Date(year, month + 1, 0).getDate(), 15)))}
              className={`flex w-full items-center gap-2.5 rounded-xl bg-coral-cta px-3 py-[11px] text-[14px] font-extrabold text-white shadow-coral hover:brightness-105 ${railCollapsed ? 'justify-center px-0' : ''}`}>
              <span className="text-[17px] font-extrabold text-white">+</span>{!railCollapsed && <span>Add a post</span>}
            </button>
          )}
          {/* One true line: the session edits its home cycle (unlimited, until the cycle
              month ends); sibling cycles open read-only. See design/DECISIONS.md §14. */}
          {!railCollapsed && (
            <div className="mt-auto p-2 text-[12px] leading-relaxed text-muted">
              {data.readOnly
                ? 'Shared plan · read-only preview'
                : `Shared plan · unlimited edits until ${new Date(year, month + 1, 0).getDate()} ${MONTHS[month]!.slice(0, 3)}`}
            </div>
          )}
        </aside>
      </div>

      {/* agent FAB */}
      <button data-testid="agent-fab" onClick={() => setAgentOpen(true)}
        className="fixed bottom-[34px] z-40 flex h-[60px] items-center gap-[11px] rounded-full bg-slate-700 pl-[18px] pr-[22px] text-[15px] font-extrabold text-white shadow-[0_16px_34px_-10px_rgba(51,65,85,.55)]"
        style={{ right: (railCollapsed ? 72 : 224) + 22 }}>
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-coral"><SparkIcon className="h-[19px] w-[19px] text-white" /></span>
        Talk to your plan
        {proposals.length > 0 && <span className="ml-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11.5px] font-extrabold text-[#3A2A05]">{proposals.length}</span>}
      </button>

      {/* editor drawer */}
      <Scrim show={drawerOpen} soft onClick={() => setDrawerOpen(false)} />
      <Drawer show={drawerOpen} onClose={() => setDrawerOpen(false)} label="Post editor">
        {sel && <PostEditor post={sel} data={data} onClose={() => setDrawerOpen(false)} />}
      </Drawer>

      {/* agent sheet */}
      <Scrim show={agentOpen} onClick={() => setAgentOpen(false)} />
      <Sheet show={agentOpen} onClose={() => setAgentOpen(false)} testid="agent-sheet" labelledBy="agent-sheet-title">
        <div className="mx-auto max-h-[82vh] w-full max-w-[940px] overflow-y-auto px-9 pb-9 pt-2">
          <div className="mb-1 mt-1.5"><div className="text-[11px] font-extrabold uppercase tracking-[.14em] text-muted">Plan agent</div><div id="agent-sheet-title" className="font-serif text-[27px] text-slate-700">Talk to your <em className="italic text-coral-heading">plan</em></div></div>
          <p className="mb-5 mt-1 max-w-[560px] text-[14px] font-semibold leading-snug text-muted">Ask in plain English. Sprigly proposes the change and <b className="text-slate-700">nothing happens until you approve it</b>.</p>
          <div className="flex items-center gap-2.5 rounded-2xl border-[1.5px] border-line bg-surface py-2 pl-[18px] pr-2 focus-within:border-coral">
            {/* The container owns the focus indicator (focus-within:border-coral). The inner
                input suppresses its own focus outline — including the global
                `input:focus-visible` outline in globals.css, which is UNLAYERED and so needs
                `!important` to beat — so there's a single coral frame, not two nested ones. */}
            <input data-testid="agent-input" value={agentText} onChange={(e) => setAgentText(e.target.value)} aria-label="Ask Sprigly to change your plan"
              onKeyDown={(e) => { if (e.key === 'Enter') void submitAsk(); }} disabled={data.agentBusy}
              placeholder="Move the Tuesday post to Friday…" className="flex-1 bg-transparent py-2 text-[15.5px] text-slate-700 outline-none focus-visible:!outline-none disabled:opacity-60" />
            <button data-testid="agent-mic" disabled title="Voice arrives in a later stage" aria-label="Voice arrives in a later stage"
              className="flex h-[46px] w-[46px] flex-none cursor-not-allowed items-center justify-center rounded-xl bg-line-soft text-muted opacity-60"><MicIcon className="h-5 w-5" /></button>
            {/* Disabled-because-empty → the shared neutral treatment (§25). While BUSY the
                button stays coral so its white "thinking" spinner is legible (a grey fill
                would swallow it) — so the neutral classes apply only when not busy. */}
            <button data-testid="agent-send" disabled={!agentText.trim() || data.agentBusy} onClick={() => void submitAsk()}
              className={`flex h-[46px] flex-none items-center justify-center gap-2 rounded-xl bg-coral-cta px-[18px] text-[14px] font-extrabold text-white shadow-coral ${data.agentBusy ? '' : DISABLED_PRIMARY}`}>
              {data.agentBusy
                ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />Sprigly is thinking…</>
                : <><SendIcon className="h-[18px] w-[18px]" />Ask Sprigly</>}
            </button>
          </div>
          {data.agentError && <div data-testid="agent-error" role="alert" className="mt-3 text-[13px] font-semibold text-danger">{data.agentError}</div>}
          {data.agentBusy ? (
            <div data-testid="agent-thinking" role="status" aria-live="polite" className="mt-[18px] rounded-[14px] border border-line bg-[#FAF9F7] px-4 py-3.5">
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-600"><SparkIcon className="h-4 w-4 animate-pulse text-coral" aria-hidden="true" />Sprigly is thinking…</div>
              <div className="mt-3 space-y-2" aria-hidden="true">
                <div className="h-3 w-3/4 animate-pulse rounded bg-line-soft" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-line-soft" />
              </div>
            </div>
          ) : (
            <ExtractionSummary reply={data.agentReply} onDecide={data.decide} busy={!!data.proposalBusy} />
          )}
          <div className="mt-4 text-[12.5px] font-semibold text-muted">Suggestions land in <b className="text-slate-700">Approvals</b> in the menu — nothing changes until you approve it there.</div>
        </div>
      </Sheet>
    </div>
  );
}

/* ── views ─────────────────────────────────────────────────────────────────── */

function CalendarView({ data, year, month, selId, onSelect }: { data: PlanData; year: number; month: number; selId: string | null; onSelect: (id: string) => void }) {
  const [over, setOver] = useState<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(year, month + 1, 0).getDate();
  const isoOf = (day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
  const postsOn = (day: number) => data.posts.filter((p) => p.date === isoOf(day));

  return (
    <>
      <div className="sticky top-0 z-[3] grid grid-cols-7 gap-3 bg-bg px-1 pb-3 pt-1.5">
        {DOW.map((d) => <span key={d} className="pl-0.5 text-[11px] font-extrabold uppercase tracking-[.1em] text-muted">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-3" data-testid="calendar-grid">
        {lead > 0 && (
          <div className="flex items-center rounded-2xl border border-line bg-surface p-4 shadow-card" style={{ gridColumn: `span ${lead}` }} data-testid="month-summary">
            <div className="font-serif text-[19px] text-slate-700">{data.posts.length} posts planned</div>
          </div>
        )}
        {Array.from({ length: dim }, (_, i) => i + 1).map((day) => {
          const d = new Date(year, month, day);
          const wknd = (d.getDay() + 6) % 7 >= 5;
          const isToday = isoOf(day) === data.today;
          const dayPosts = postsOn(day);
          return (
            <div key={day} data-testid="calendar-cell" data-date={isoOf(day)}
              onDragOver={(e) => { if (!data.readOnly && dragId) { e.preventDefault(); setOver(day); } }}
              onDragLeave={() => setOver((o) => (o === day ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (dragId && !data.readOnly) data.reschedule(dragId, isoOf(day)); setOver(null); setDragId(null); }}
              className={[
                'flex min-h-[148px] flex-col gap-[7px] rounded-2xl border p-[11px] transition',
                isToday ? 'border-coral shadow-[0_0_0_3px_#FCE9E5]' : over === day ? 'border-coral bg-[#FFF7F5] shadow-[0_0_0_3px_#FCE9E5]' : 'border-line bg-surface',
              ].join(' ')}>
              <div className="flex items-start justify-between gap-1">
                <span className={`px-[3px] py-px text-[13px] font-extrabold ${isToday ? 'text-slate-700' : wknd ? 'text-muted' : 'text-slate-600'}`}>{day}</span>
                <WeatherCellIcon day={data.weather.get(isoOf(day))} />
              </div>
              <div className="flex flex-col gap-1.5">
                {dayPosts.map((p) => (
                  <PostChip key={p.id} post={p} today={data.today} selected={p.id === selId} onClick={() => onSelect(p.id)}
                    draggable={!data.readOnly} onDragStart={() => setDragId(p.id)} onDragEnd={() => { setDragId(null); setOver(null); }} />
                ))}
              </div>
              {!data.readOnly && dayPosts.length === 0 && (
                <button data-testid="add-on-day" onClick={() => data.addPost(isoOf(day))} aria-label={`Add a post on ${isoOf(day)}`}
                  className="mt-auto rounded-[9px] border-[1.5px] border-dashed border-[#C9C3BB] py-0.5 text-center text-[15px] font-bold text-muted hover:border-[#EFC9BF] hover:bg-[#FFF9F7] hover:text-coral">＋</button>
              )}
            </div>
          );
        })}
      </div>
      {!data.readOnly && <div className="mx-1 mb-0.5 mt-4 text-[12.5px] font-semibold text-muted">Drag any post to another day to reschedule it.</div>}
    </>
  );
}

function TimelineView({ data, selId, onSelect }: { data: PlanData; selId: string | null; onSelect: (id: string) => void }) {
  const ordered = [...data.posts].sort((a, b) => a.date.localeCompare(b.date));
  let todayPlaced = false;
  return (
    <div className="relative isolate mx-auto max-w-[900px] py-1.5" data-testid="timeline">
      {/* connector: negative z-index inside the isolated timeline so it sits BEHIND the
          dots and cards (it's absolutely positioned, which otherwise paints above the
          static siblings). Dots have an opaque fill and sit above it. */}
      <span className="absolute bottom-[30px] left-[19px] top-[26px] -z-10 w-0.5 bg-line" />
      {ordered.map((p) => {
        const past = p.date <= data.today;
        const divider = !todayPlaced && p.date > data.today ? (todayPlaced = true, true) : false;
        return (
          <React.Fragment key={p.id}>
            {divider && <div className="relative z-10 grid grid-cols-[40px_1fr] items-center gap-[18px] py-2"><span className="justify-self-center bg-bg px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[.1em] text-slate-700">Today</span><span className="h-0.5 rounded bg-coral opacity-50" /></div>}
            <div data-testid="timeline-item" onClick={() => onSelect(p.id)} className="relative z-10 grid cursor-pointer grid-cols-[40px_1fr] gap-[18px] py-1.5">
              <span className={`mx-auto mt-3.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-coral ${past ? 'bg-coral' : 'bg-surface'}`} />
              <div className={`rounded-2xl border px-4 py-[11px] transition ${p.id === selId ? 'border-line bg-surface shadow-card' : 'border-transparent hover:border-line hover:bg-surface hover:shadow-card'}`}>
                <div className="flex items-center gap-2.5"><span className="font-serif text-[19px] text-slate-700">{monthDayLabel(p.date)}</span>
                  {p.status === 'new' ? <span className="rounded-[5px] bg-coral-tint px-1.5 py-px text-[9px] font-extrabold tracking-[.06em] text-slate-700">NEW</span> : p.status === 'edited' && <span className="rounded-[5px] border border-line px-1.5 py-px text-[9px] font-bold tracking-[.06em] text-muted">EDITED</span>}
                </div>
                <div className="my-[7px] flex items-center gap-2 text-[14px] font-bold"><FormatIcon format={p.format} className="h-4 w-4 text-slate-600" /><span className="text-slate-700">{FORMAT_LABEL[p.format]}</span><span className="text-[#CFCBC5]">·</span><span className="font-semibold text-muted">{postTitle(p)}</span></div>
                <div className="overflow-hidden text-[15.5px] leading-relaxed text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{p.caption || 'Draft idea — tell Sprigly what this post should be about.'}</div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function TasksView({ data, onSelect }: { data: PlanData; onSelect: (id: string) => void }) {
  const groups = planTasks(data.posts, data.today);
  const total = groups.overdue.length + groups.next7.length + groups.later.length;
  const sections: [string, string, typeof groups.overdue][] = [
    ['overdue', 'Overdue', groups.overdue], ['week', 'Next 7 days', groups.next7], ['later', 'Later', groups.later],
  ];
  return (
    <div className="mx-auto max-w-[820px]" data-testid="tasks-board">
      {/* Summary card removed (John): redundant with the section counts + rail badge. */}
      {sections.map(([key, label, items]) => items.length > 0 && (
        <div key={key}>
          <div className="flex items-center gap-2.5 px-1 pb-2.5 pt-5"><span className={`text-[12px] font-extrabold uppercase tracking-[.06em] ${key === 'overdue' ? 'text-danger' : key === 'week' ? 'text-slate-700' : 'text-muted'}`}>{label}</span><span className={`rounded-full px-2 py-px text-[11px] font-extrabold ${key === 'overdue' ? 'bg-[#F7E1D7] text-danger' : 'bg-[#ECEAE6] text-slate-600'}`}>{items.length}</span></div>
          {items.map((t) => (
            <div key={t.item.step.id} data-testid="task-row" onClick={() => onSelect(t.item.post.id)}
              className={`mb-2 flex cursor-pointer items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-[13px] shadow-card ${t.bucket === 'overdue' ? 'border-l-[3px] border-l-amber-500' : ''}`}>
              <button data-testid="task-check" onClick={(e) => { e.stopPropagation(); data.toggleStep(t.item.post.id, t.item.step.id, true); }} aria-label="Mark done"
                className="h-[22px] w-[22px] flex-none rounded-full border-2 border-[#D9D6D1] bg-surface hover:border-coral" />
              <div className="flex-1 text-[14.5px] font-bold text-slate-700">{t.item.step.label}<small className="mt-0.5 block font-semibold text-muted"><span className="mr-1.5 rounded-md bg-line-soft px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.05em] text-slate-600">{FORMAT_LABEL[t.item.post.format]}</span>{postTitle(t.item.post)}</small></div>
              <div className={`whitespace-nowrap text-[11.5px] font-extrabold ${t.bucket === 'overdue' ? 'text-danger' : 'text-muted'}`}>{t.bucket === 'overdue' ? 'Late' : `by ${monthDayLabel(t.due).replace(/ \w+ /, ' ')}`}</div>
            </div>
          ))}
        </div>
      ))}
      {total === 0 && <div className="rounded-xl border border-dashed border-line p-4 text-[13.5px] text-muted" data-testid="tasks-empty">All caught up — every post has what it needs.</div>}
    </div>
  );
}

function RetryPane({ testid, label, onRetry }: { testid: string; label: string; onRetry: () => void }) {
  return (
    <div data-testid={testid} role="alert" className="rounded-xl border border-line bg-surface p-4 text-[13.5px] text-slate-600 shadow-card">
      {label} <button onClick={onRetry} className="font-extrabold text-slate-700 underline">Retry</button>
    </div>
  );
}

function ApprovalsView({ data }: { data: PlanData }) {
  return (
    <div className="mx-auto max-w-[820px]" data-testid="approvals-view">
      {data.loadError === 'proposals'
        ? <RetryPane testid="approvals-error" label="Couldn’t load your approvals." onRetry={() => data.refreshProposals()} />
        : data.proposals.length > 0
          ? data.proposals.map((p) => <ProposalCard key={p.id} proposal={p} busy={data.proposalBusy === p.id} onApprove={() => data.decide(p.id, 'approve')} onDiscard={() => data.decide(p.id, 'reject')} />)
          : <div className="rounded-xl border border-dashed border-line p-3.5 text-[13.5px] text-muted" data-testid="approvals-empty">Nothing waiting. Ask Sprigly for a change — talk to your plan — and it’ll appear here for you to approve.</div>}
    </div>
  );
}

function NotesView({ data }: { data: PlanData }) {
  return (
    <div className="mx-auto max-w-[820px]" data-testid="notes-view">
      {data.loadError === 'notes'
        ? <RetryPane testid="notes-error" label="Couldn’t load your notes." onRetry={() => data.refreshNotes()} />
        : data.notes.length > 0
          ? data.notes.map((n) => <NoteRow key={n.id} note={n} />)
          : <div className="rounded-xl border border-dashed border-line p-3.5 text-[13.5px] text-muted" data-testid="notes-empty">No notes yet. When you tell Sprigly things like “make Fridays more personal”, they’re captured here.</div>}
    </div>
  );
}
