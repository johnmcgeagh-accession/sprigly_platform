'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from './usePlanData';
import { Scrim, Sheet, SegmentedControl } from './primitives';
import { MonthWheelPicker } from './MonthWheelPicker';
import { PostEditor } from './PostEditor';
import { ProgressRing, postTitle, isUntitled, WeatherHeaderBadge } from './pieces';
import { CalendarPicker } from './pickers';
import { planTasks, lateCount, viewedMonth } from './derive';
import {
  SprigMark, ChevronLeft, ChevronRight, MicIcon, FORMAT_LABEL, TrashIcon, ImageIcon, CalendarIcon, CloseIcon,
} from './icons';
import { postAtRisk, ringOf } from '@/lib/checklist';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); };
function mondayOf(d: Date) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; }
const addDays = (iso: string, n: number) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
const clampIso = (iso: string, lo: string, hi: string) => (iso < lo ? lo : iso > hi ? hi : iso);

/** The day the mobile agenda should land on for a given month: today when today falls in
 *  that month (so you open on the current week), else the month's earliest post, else the
 *  1st. This is what stops the "dumped on the 1st of a stale month" landing — combined
 *  with the week stepper + Today pill so you can always reach the current week. */
function defaultDayFor(year: number, month: number, today: string, posts: PlanPost[]): string {
  const mf = `${year}-${pad(month + 1)}`;
  if (today.startsWith(mf)) return today;
  const inMonth = posts.map((p) => p.date).filter((d) => d.startsWith(mf)).sort();
  return inMonth[0] ?? `${mf}-01`;
}

export function PlanMobile({ data }: { data: PlanData }) {
  const { posts, today } = data;
  const viewedCycle = data.cycles.find((c) => c.cycleId === data.viewedCycleId);
  const { year, month } = viewedMonth(viewedCycle?.displayMonth, posts);
  const monthFirst = `${year}-${pad(month + 1)}`;

  const [mode, setMode] = useState<'plan' | 'tasks'>('plan');
  const [selectedDay, setSelectedDay] = useState<string>(() => defaultDayFor(year, month, today, posts));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const spyLock = useRef(false);
  const spyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafTick = useRef(false);

  const week = useMemo(() => {
    const mon = mondayOf(fromIso(selectedDay));
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return toIso(d); });
  }, [selectedDay]);
  const postsOn = useCallback((iso: string) => posts.filter((p) => p.date === iso), [posts]);
  const hasPosts = (iso: string) => posts.some((p) => p.date === iso);

  const lateN = lateCount(posts, today);
  const editPost = posts.find((p) => p.id === editId) ?? null;
  const movePost = posts.find((p) => p.id === moveId) ?? null;

  // ── scroll-spy: selected day follows the feed (rAF, spy-locked during jumps) ──
  const updateActiveDay = useCallback(() => {
    if (mode !== 'plan' || spyLock.current || !feedRef.current) return;
    const secs = feedRef.current.querySelectorAll<HTMLElement>('[data-day]');
    if (!secs.length) return;
    const marker = feedRef.current.getBoundingClientRect().top + 14;
    let active = secs[0]!;
    secs.forEach((s) => { if (s.getBoundingClientRect().top - marker <= 0) active = s; });
    const ds = active.dataset['day'];
    if (ds && ds !== selectedDay) setSelectedDay(ds);
  }, [mode, selectedDay]);

  const onFeedScroll = () => {
    if (spyLock.current) { if (spyTimer.current) clearTimeout(spyTimer.current); spyTimer.current = setTimeout(() => { spyLock.current = false; }, 140); return; }
    if (rafTick.current) return; rafTick.current = true;
    requestAnimationFrame(() => { rafTick.current = false; updateActiveDay(); });
  };

  // Jump to a day by scrolling the FEED container explicitly (never scrollIntoView).
  const scrollToDay = useCallback((iso: string) => {
    const feed = feedRef.current; if (!feed) return;
    const sec = feed.querySelector<HTMLElement>(`[data-day="${iso}"]`); if (!sec) return;
    const target = Math.max(0, feed.scrollTop + (sec.getBoundingClientRect().top - feed.getBoundingClientRect().top) - 8);
    if (Math.abs(target - feed.scrollTop) < 2) return;
    spyLock.current = true;
    if (spyTimer.current) clearTimeout(spyTimer.current);
    spyTimer.current = setTimeout(() => { spyLock.current = false; }, 700);
    feed.scrollTo({ top: target, behavior: 'smooth' });
  }, []);

  const pickDay = useCallback((iso: string) => { setSelectedDay(iso); if (mode === 'plan') requestAnimationFrame(() => scrollToDay(iso)); }, [mode, scrollToDay]);

  // ── week navigation (fixes "can't move between weeks") ────────────────────────
  // The feed renders one week (selectedDay's Mon–Sun). Stepping ±7 days, clamped to the
  // viewed month, moves the whole surface a week at a time; disabled at the month's edges.
  const firstOfMonth = `${monthFirst}-01`;
  const lastOfMonth = `${monthFirst}-${pad(new Date(year, month + 1, 0).getDate())}`;
  const weekMon = toIso(mondayOf(fromIso(selectedDay)));
  const weekSun = addDays(weekMon, 6);
  const canPrevWeek = weekMon > firstOfMonth;
  const canNextWeek = weekSun < lastOfMonth;
  const stepWeek = (n: number) => pickDay(clampIso(addDays(selectedDay, 7 * n), firstOfMonth, lastOfMonth));

  // On a cycle (month) switch, re-anchor the week view to today (if today is in the new
  // month) or its first day — otherwise switching month left the strip stranded on the old
  // month. Reads posts via a ref so an unrelated post edit never yanks the selection. Keyed
  // on an ACTUAL change of viewedCycleId (not a mount flag) so React StrictMode's double-
  // invoked mount effect can't fire the scroll on load — its 700ms spy-lock would otherwise
  // swallow the user's first scroll. The initial render already lands on the right day (via
  // the useState initializer) with the feed at its natural top.
  const postsRef = useRef(posts); postsRef.current = posts;
  const anchoredCycle = useRef(data.viewedCycleId);
  useEffect(() => {
    if (anchoredCycle.current === data.viewedCycleId) return;   // mount / strict-remount → no-op
    anchoredCycle.current = data.viewedCycleId;
    const d = defaultDayFor(year, month, today, postsRef.current);
    setSelectedDay(d);
    if (mode === 'plan') requestAnimationFrame(() => scrollToDay(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.viewedCycleId]);

  // Mobile "Today" affordance (desktop parity): jump to today when it's in the viewed
  // month, else switch to the cycle that contains today (the effect above then lands on it).
  const todayInMonth = today.startsWith(monthFirst);
  const todayCycle = data.cycles.find((c) => c.displayMonth === today.slice(0, 7));
  const canGoToday = todayInMonth || !!todayCycle;
  const goToday = () => { if (todayInMonth) pickDay(today); else if (todayCycle) void data.switchCycle(todayCycle.cycleId); };

  // Month nav walks the client's sibling cycles; disable (not silently no-op) at the ends.
  const sortedCycles = useMemo(() => [...data.cycles].sort((a, b) => a.displayMonth.localeCompare(b.displayMonth)), [data.cycles]);
  const cycIdx = sortedCycles.findIndex((c) => c.cycleId === data.viewedCycleId);
  const prevCycle = cycIdx > 0 ? sortedCycles[cycIdx - 1] : null;
  const nextCycle = cycIdx >= 0 && cycIdx < sortedCycles.length - 1 ? sortedCycles[cycIdx + 1] : null;

  return (
    <div className="flex h-[100dvh] flex-col bg-bg text-slate-700" data-testid="plan-mobile">
      {/* locked chrome */}
      <div className="z-[4] flex-none bg-bg">
        <div className="px-5 pb-3 pt-1.5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><SprigMark className="h-[26px] w-[26px]" /><span className="text-[20px] font-extrabold tracking-tight text-slate-700">Sprigly</span></div>
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gradient-to-br from-[#F3C6BC] to-coral text-[13px] font-extrabold text-white shadow-[0_2px_8px_rgba(232,119,102,.35)]">{data.clientName.slice(0, 2).toUpperCase()}</div>
          </div>
          <div className="mt-0.5 flex items-center justify-center gap-[18px]">
            <button data-testid="prev-month" aria-label="Previous month" disabled={!prevCycle} onClick={() => prevCycle && data.switchCycle(prevCycle.cycleId)}
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-surface text-slate-700 shadow-card disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <button data-testid="month-label" onClick={() => setPickerOpen(true)} className="flex items-center gap-2 font-serif text-[30px] leading-none text-slate-700">{MONTHS_FULL[month]} {year} <span className="translate-y-0.5 text-sm text-coral">▾</span></button>
            <button data-testid="next-month" aria-label="Next month" disabled={!nextCycle} onClick={() => nextCycle && data.switchCycle(nextCycle.cycleId)}
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-surface text-slate-700 shadow-card disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        {/* week strip — flanked by week steppers so you can move between weeks */}
        <div className="flex items-center gap-0.5 bg-bg px-1.5 pb-1.5 pt-3.5">
          <button data-testid="prev-week" aria-label="Previous week" disabled={!canPrevWeek} onClick={() => stepWeek(-1)}
            className="flex h-9 w-7 flex-none items-center justify-center rounded-full text-slate-600 disabled:opacity-30"><ChevronLeft className="h-[17px] w-[17px]" /></button>
          <div className="grid flex-1 grid-cols-7 gap-1" data-testid="week-strip">
          {week.map((iso, i) => {
            const dt = fromIso(iso); const selD = iso === selectedDay; const isToday = iso === today;
            const count = postsOn(iso).length;
            const label = `${DOW[i]} ${dt.getDate()} ${MONTHS_FULL[month]}, ${count === 0 ? 'no posts' : `${count} post${count === 1 ? '' : 's'}`}`;
            return (
              <button key={iso} data-testid="week-day" data-date={iso} data-selected={selD} aria-pressed={selD} aria-label={label} onClick={() => pickDay(iso)}
                className={`relative flex flex-col items-center gap-1.5 rounded-2xl px-0 pb-2.5 pt-2 ${selD ? 'bg-surface shadow-card' : ''}`}>
                <span aria-hidden="true" className={`text-[11px] font-bold uppercase tracking-[.04em] ${selD ? 'text-slate-700' : 'text-muted'}`}>{DOW[i]}</span>
                <span aria-hidden="true" className={`flex h-[30px] w-[30px] items-center justify-center rounded-full text-[16px] font-bold ${selD ? 'bg-coral text-white' : 'text-slate-700'} ${isToday && !selD ? 'outline outline-2 outline-offset-1 outline-coral-tint' : ''}`}>{dt.getDate()}</span>
                {hasPosts(iso) && <span aria-hidden="true" className={`absolute bottom-1 h-[5px] w-[5px] rounded-full ${selD ? 'bg-slate-700' : 'bg-coral'}`} />}
              </button>
            );
          })}
          </div>
          <button data-testid="next-week" aria-label="Next week" disabled={!canNextWeek} onClick={() => stepWeek(1)}
            className="flex h-9 w-7 flex-none items-center justify-center rounded-full text-slate-600 disabled:opacity-30"><ChevronRight className="h-[17px] w-[17px]" /></button>
        </div>
        {/* Plan / Tasks (with a Today jump, mirroring desktop) */}
        <div className="relative flex justify-center bg-bg py-2.5 pb-1">
          <SegmentedControl<'plan' | 'tasks'> value={mode} label="Plan or Tasks"
            onChange={(m) => { setMode(m); data.track('view_switched', { view: m }); }}
            options={[{ value: 'plan', label: 'Plan' }, { value: 'tasks', label: 'Tasks', dot: lateN > 0 }]} />
          {canGoToday && mode === 'plan' && (
            <button data-testid="today-btn" onClick={goToday}
              className="absolute right-5 top-1/2 -translate-y-1/2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-bold text-slate-600 shadow-card">Today</button>
          )}
        </div>
      </div>

      {/* feed / tasks */}
      <div ref={feedRef} onScroll={onFeedScroll} className="flex-1 overflow-y-auto overflow-x-hidden px-0 pb-[120px] pt-2" data-testid="feed">
        {mode === 'plan'
          ? week.map((iso) => (
            <section key={iso} data-day={iso} className="px-[18px] pb-0.5 pt-3.5" data-testid="day-section">
              <div className={`mx-0.5 mb-2.5 flex items-center gap-2 ${iso === selectedDay ? '[&_.big]:text-slate-700' : ''}`}>
                <span className="big font-serif text-[19px] text-slate-700">{iso === today ? 'Today' : `${DOW[(fromIso(iso).getDay() + 6) % 7]}, ${fromIso(iso).getDate()} ${MON[month]}`}</span>
                <span className="text-[12px] font-semibold text-muted">{postsOn(iso).length ? `${postsOn(iso).length} post${postsOn(iso).length > 1 ? 's' : ''}` : 'Nothing planned'}</span>
                <WeatherHeaderBadge day={data.weather.get(iso)} />
              </div>
              {postsOn(iso).length
                ? postsOn(iso).map((p) => <SwipeCard key={p.id} post={p} data={data} onEdit={() => setEditId(p.id)} onMove={() => setMoveId(p.id)} />)
                : data.canEdit(iso) && <button onClick={() => data.addPost(iso)} data-testid="add-on-day" className="mb-3 w-full rounded-[18px] border border-dashed border-line bg-surface p-4 text-[13px] font-semibold text-muted">＋ Plan a post for this day</button>}
            </section>
          ))
          : <MobileTasks data={data} onOpen={(id) => setEditId(id)} />}
      </div>

      {/* voice FAB (opens the disabled voice overlay) */}
      <button data-testid="voice-fab" onClick={() => setVoiceOpen(true)} aria-label="Speak to your plan"
        className="fixed bottom-[30px] right-[22px] z-20 flex h-[62px] w-[62px] items-center justify-center rounded-full bg-gradient-to-br from-coral-strong to-coral shadow-[0_12px_26px_-6px_rgba(232,119,102,.65)]"><MicIcon className="h-[26px] w-[26px] text-white" /></button>

      {/* month picker */}
      <MonthWheelPicker show={pickerOpen} year={year} month={month} onClose={() => setPickerOpen(false)}
        onDone={(y, m) => { setPickerOpen(false); const c = data.cycles.find((cy) => cy.displayMonth === `${y}-${pad(m + 1)}`); if (c) data.switchCycle(c.cycleId); }} />

      {/* editor sheet (~85%) */}
      <Scrim show={!!editId} onClick={() => setEditId(null)} />
      <Sheet show={!!editId} onClose={() => setEditId(null)} heightClass="h-[85%]" testid="editor-sheet" label="Post editor">
        {editPost && <PostEditor post={editPost} data={data} onClose={() => setEditId(null)} />}
      </Sheet>

      {/* move (date picker) */}
      <Scrim show={!!moveId} onClick={() => setMoveId(null)} />
      <Sheet show={!!moveId} onClose={() => setMoveId(null)} testid="move-sheet" className="px-5 pb-8" label="Move post">
        <h3 className="mb-2 mt-1.5 text-center font-serif text-xl text-slate-700">Move to…</h3>
        {movePost && (
          <div className="flex justify-center pt-1">
            <CalendarPicker value={movePost.date} today={data.today} autoFocus
              onSelect={(iso) => { data.reschedule(movePost.id, iso); setMoveId(null); }} />
          </div>
        )}
      </Sheet>

      {/* voice overlay — renders but disabled this stage */}
      {voiceOpen && (
        <div data-testid="voice-overlay" className="fixed inset-0 z-[60] flex flex-col items-center bg-[radial-gradient(130%_82%_at_50%_24%,#fff,#FFFFFF_60%)]">
          <button onClick={() => setVoiceOpen(false)} aria-label="Close" className="absolute right-[22px] top-14 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-surface text-slate-700 shadow-card"><CloseIcon className="h-4 w-4" /></button>
          <div className="mt-24 px-8 text-center"><div className="text-[12px] font-extrabold uppercase tracking-[.14em] text-slate-700">Voice</div><div className="mt-2 font-serif text-[26px] leading-tight text-slate-700">Speak to your <em className="italic text-coral-heading">plan</em></div></div>
          <div className="flex flex-1 items-center justify-center"><div className="flex h-[98px] w-[98px] items-center justify-center rounded-full bg-gradient-to-br from-coral-strong to-coral opacity-60 shadow-[0_18px_40px_-10px_rgba(232,119,102,.7)]"><MicIcon className="h-[38px] w-[38px] text-white" /></div></div>
          <div className="w-full px-9 pb-24 text-center text-[15px] font-semibold text-muted">Voice arrives in a later stage.</div>
        </div>
      )}
    </div>
  );
}

/* ── swipe card (axis-lock + rubber-band; left Edit/Delete, right Move only) ─── */
const ACT = 156, MAXEXTRA = 32, RB = 0.55;
function resist(t: number): number {
  if (t > ACT) { const o = t - ACT; return ACT + (1 - 1 / (o * RB / MAXEXTRA + 1)) * MAXEXTRA; }
  if (t < -ACT) { const o = -t - ACT; return -(ACT + (1 - 1 / (o * RB / MAXEXTRA + 1)) * MAXEXTRA); }
  return t;
}

/** Keyboard/visible alternative to the swipe gestures — an overflow menu per card. */
// onMove/onDelete are omitted for read-only (past-dated) posts — those items are hidden.
function CardMenu({ onEdit, onMove, onDelete }: { onEdit: () => void; onMove?: (() => void) | undefined; onDelete?: (() => void) | undefined }) {
  const [open, setOpen] = useState(false);
  const item = (label: string, tid: string, fn: () => void, danger: boolean) => (
    <button key={tid} role="menuitem" data-testid={tid} onClick={(e) => { e.stopPropagation(); setOpen(false); fn(); }}
      className={`block w-full px-3.5 py-2 text-left text-[13.5px] font-bold hover:bg-line-soft ${danger ? 'text-danger' : 'text-slate-700'}`}>{label}</button>
  );
  return (
    <div className="relative" data-act>
      <button data-testid="card-menu" aria-label="Post actions" aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[18px] leading-none text-muted hover:bg-line-soft">⋯</button>
      {open && (
        <>
          <div className="fixed inset-0 z-[5]" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div role="menu" data-testid="card-menu-list" className="absolute right-0 top-8 z-[6] w-32 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-sheet">
            {item('Edit', 'menu-edit', onEdit, false)}
            {onMove && item('Move', 'menu-move', onMove, false)}
            {onDelete && item('Delete', 'menu-delete', onDelete, true)}
          </div>
        </>
      )}
    </div>
  );
}

function SwipeCard({ post, data, onEdit, onMove }: { post: PlanPost; data: PlanData; onEdit: () => void; onMove: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const st = useRef({ startX: 0, startY: 0, dx: 0, base: 0, dragging: false, moved: false, axis: '' as '' | 'v' | 'h', pid: -1 });
  const [open, setOpen] = useState<'' | 'L' | 'R'>('');
  const ring = ringOf(post.steps);
  const risk = postAtRisk(post.steps, post.date, data.today);
  // DATE POLICY: past posts are read-only — no Move/Delete affordance (Edit still opens
  // the read-only editor). Editable iff the post is dated today-onward (London).
  const editable = data.canEdit(post.date);

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-act]')) return;
    const c = cardRef.current!; st.current = { ...st.current, startX: e.clientX, startY: e.clientY, dragging: true, moved: false, axis: '', pid: e.pointerId, base: open === 'L' ? ACT : open === 'R' ? -ACT : 0 };
    st.current.dx = st.current.base;
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current; if (!s.dragging) return;
    const rawX = e.clientX - s.startX, rawY = e.clientY - s.startY;
    if (!s.axis) {
      if (Math.abs(rawY) > Math.abs(rawX) && Math.abs(rawY) > 6) s.axis = 'v';
      else if (Math.abs(rawX) > 8) { s.axis = 'h'; cardRef.current!.style.transition = 'none'; try { cardRef.current!.setPointerCapture(s.pid); } catch { /* ignore */ } }
    }
    if (s.axis === 'v') { s.dragging = false; try { cardRef.current!.releasePointerCapture(s.pid); } catch { /* ignore */ } cardRef.current!.style.transition = ''; return; }
    if (s.axis !== 'h') return;
    s.moved = true; s.dx = resist(rawX + s.base);
    cardRef.current!.style.transform = `translateX(${s.dx}px)`;
  };
  const end = () => {
    const s = st.current; const wasH = s.dragging && s.axis === 'h'; s.dragging = false; s.axis = '';
    try { cardRef.current!.releasePointerCapture(s.pid); } catch { /* ignore */ }
    cardRef.current!.style.transition = '';
    if (!wasH) return;
    if (s.dx > 62) { setOpen('L'); cardRef.current!.style.transform = `translateX(${ACT}px)`; }
    else if (s.dx < -62) { setOpen('R'); cardRef.current!.style.transform = `translateX(-${ACT}px)`; }
    else { setOpen(''); cardRef.current!.style.transform = 'translateX(0)'; }
  };
  const close = () => { setOpen(''); if (cardRef.current) cardRef.current.style.transform = 'translateX(0)'; };
  const tap = () => { if (st.current.moved) return; if (open) { close(); return; } onEdit(); };

  return (
    <div className="relative mb-3 overflow-hidden rounded-[20px]" data-testid="swipe-card" data-post-id={post.id}>
      {/* right-side actions (revealed by swiping LEFT) */}
      <div className="absolute inset-y-0 right-0 flex items-stretch">
        <button data-act onClick={() => { onEdit(); close(); }} className="flex w-[78px] flex-col items-center justify-center gap-1.5 bg-slate-700 text-[11px] font-bold text-white"><ImageIcon className="h-5 w-5" />Edit</button>
        {editable && <button data-act onClick={() => { data.removePost(post.id); close(); }} className="flex w-[78px] flex-col items-center justify-center gap-1.5 bg-danger text-[11px] font-bold text-white"><TrashIcon className="h-5 w-5" />Delete</button>}
      </div>
      {/* left-side action (revealed by swiping RIGHT) — Move only (D2/D6), today-onward only */}
      {editable && <div className="absolute inset-y-0 left-0 flex items-stretch">
        <button data-act onClick={() => { onMove(); close(); }} className="flex w-[78px] flex-col items-center justify-center gap-1.5 bg-coral text-[11px] font-bold text-white"><CalendarIcon className="h-5 w-5" />Move</button>
      </div>}
      <div ref={cardRef} data-testid="swipe-surface" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClick={tap}
        className="relative z-[2] rounded-[20px] border border-line bg-surface px-4 pb-3 pt-4 shadow-card [touch-action:pan-y] [will-change:transform] [transition:transform_.28s_cubic-bezier(.22,.61,.36,1)]">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-md bg-coral-tint px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[.06em] text-slate-700">{FORMAT_LABEL[post.format]}</span>
          <span className="ml-auto flex items-center gap-2">
            {ring.total > 0 && <ProgressRing done={ring.done} total={ring.total} risk={risk} size={32} />}
            <CardMenu onEdit={onEdit} onMove={editable ? onMove : undefined} onDelete={editable ? () => data.removePost(post.id) : undefined} />
          </span>
        </div>
        <h4 className="mb-1.5 text-[17px] font-extrabold leading-tight tracking-tight text-slate-700">
          {isUntitled(post) ? <span className="font-semibold italic text-muted">Untitled draft</span> : postTitle(post)}
        </h4>
        <p className="mb-1 text-[13.5px] leading-normal text-slate-600">{post.caption || 'Draft idea. Tell Sprigly what this post should be about.'}</p>
        {post.status === 'new' && <span className="text-[11px] font-bold text-slate-700">NEW</span>}
      </div>
    </div>
  );
}

function MobileTasks({ data, onOpen }: { data: PlanData; onOpen: (id: string) => void }) {
  const groups = planTasks(data.posts, data.today);
  const total = groups.overdue.length + groups.next7.length + groups.later.length;
  const secs: [string, string, typeof groups.overdue][] = [['overdue', 'Overdue', groups.overdue], ['today', 'Due today', groups.next7.filter((t) => t.due === data.today)], ['week', 'This week', groups.next7.filter((t) => t.due !== data.today).concat(groups.later)]];
  return (
    <div data-testid="mobile-tasks">
      {/* Summary card removed (John): redundant with section counts + the rail badge. */}
      <div className="pt-3" />
      {total === 0 && <div className="mx-8 my-11 text-center"><span className="mb-2 block font-serif text-[22px] text-slate-700">All caught up ✨</span><span className="text-[14px] leading-relaxed text-muted">Every post has what it needs.</span></div>}
      {secs.map(([key, label, items]) => items.length > 0 && (
        <div key={key}>
          <div className="flex items-center gap-2.5 px-5 pb-2 pt-4.5"><span className={`text-[12px] font-extrabold uppercase tracking-[.06em] ${key === 'overdue' ? 'text-danger' : key === 'today' ? 'text-slate-700' : 'text-muted'}`}>{label}</span><span className="rounded-full bg-[#ECEAE6] px-2 py-px text-[11px] font-extrabold text-slate-600">{items.length}</span></div>
          {items.map((t) => (
            <div key={t.item.step.id} data-testid="task-row" onClick={() => onOpen(t.item.post.id)}
              className={`mx-[18px] mb-2 flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-[13px] shadow-card ${t.bucket === 'overdue' ? 'border-l-[3px] border-l-amber-500' : ''}`}>
              <button data-testid="task-check" onClick={(e) => { e.stopPropagation(); data.toggleStep(t.item.post.id, t.item.step.id, true); }} aria-label="Mark done" className="h-6 w-6 flex-none rounded-full border-2 border-[#D9D6D1] bg-surface" />
              <div className="min-w-0 flex-1"><div className="text-[14.5px] font-bold text-slate-700">{t.item.step.label}</div><div className="mt-0.5 flex items-center gap-1.5 overflow-hidden text-[12px] text-muted"><span className="flex-none rounded bg-coral-tint px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[.05em] text-slate-700">{FORMAT_LABEL[t.item.post.format]}</span><span className="overflow-hidden text-ellipsis whitespace-nowrap">{postTitle(t.item.post)}</span></div></div>
              <div className={`flex-none whitespace-nowrap text-[11px] font-extrabold ${t.bucket === 'overdue' ? 'text-danger' : 'text-muted'}`}>{t.bucket === 'overdue' ? 'Late' : `${MON[fromIso(t.due).getMonth()]} ${fromIso(t.due).getDate()}`}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
