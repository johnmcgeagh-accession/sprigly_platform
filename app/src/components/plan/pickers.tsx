'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, CheckIcon, FormatIcon, FORMAT_LABEL,
} from './icons';

// ── date helpers (Europe/London-agnostic; pure calendar math on ISO strings) ──
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parseIso(s: string) { const [y, m, d] = s.split('-').map(Number); return { y: y!, m: m! - 1, d: d! }; }
function addDays(iso: string, n: number): string {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(y, m, d); dt.setDate(dt.getDate() + n);
  return isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function longLabel(dt: Date): string {
  return `${WEEKDAYS[dt.getDay()]}, ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
/** "Wed 8 Jul 2026" — the trigger's compact display. */
export function prettyDate(iso: string): string {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(y, m, d);
  return `${WEEKDAYS[dt.getDay()]!.slice(0, 3)} ${d} ${MONTHS[m]!.slice(0, 3)} ${y}`;
}

/** Close a popover on outside-click / Escape, returning focus to the trigger on Escape. */
function useDismiss(open: boolean, close: () => void, wrapRef: React.RefObject<HTMLElement | null>, triggerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true); };
  }, [open, close, wrapRef, triggerRef]);
}

// ── Branded calendar (shared by the desktop date field + mobile Move sheet) ──────
/**
 * A month grid in the plan calendar's own language: serif month heading, chevron
 * month-nav, Mon–Su grid, muted out-of-month days, a coral circle on the selected day,
 * a ring on today. Keyboard: arrows move the focused day (shifting month at the edges),
 * Home/End jump to the week ends, PageUp/Down change month, Enter/Space select.
 */
export function CalendarPicker({ value, today, onSelect, autoFocus }: {
  value: string; today: string; onSelect: (iso: string) => void; autoFocus?: boolean;
}) {
  const sel = parseIso(value);
  const [view, setView] = useState({ y: sel.y, m: sel.m });
  const [focus, setFocus] = useState(value);
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(!!autoFocus);

  // Keep the visible month in step with the focused day (arrowing past a month edge).
  useEffect(() => { const f = parseIso(focus); if (f.y !== view.y || f.m !== view.m) setView({ y: f.y, m: f.m }); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a keyboard move (or autoFocus on open), put DOM focus on the focused day.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
  });

  const shiftMonth = (n: number) => setView((v) => { const dt = new Date(v.y, v.m + n, 1); return { y: dt.getFullYear(), m: dt.getMonth() }; });

  const weeks = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-start
    const start = new Date(view.y, view.m, 1 - lead);
    const days = Array.from({ length: 42 }, (_, i) => { const dt = new Date(start); dt.setDate(start.getDate() + i); return dt; });
    return Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  }, [view]);

  const onKey = (e: React.KeyboardEvent) => {
    let next: string | null = null;
    switch (e.key) {
      case 'ArrowLeft':  next = addDays(focus, -1); break;
      case 'ArrowRight': next = addDays(focus, 1); break;
      case 'ArrowUp':    next = addDays(focus, -7); break;
      case 'ArrowDown':  next = addDays(focus, 7); break;
      case 'Home':       next = addDays(focus, -(((new Date(parseIso(focus).y, parseIso(focus).m, parseIso(focus).d).getDay() + 6) % 7))); break;
      case 'End':        next = addDays(focus, 6 - (((new Date(parseIso(focus).y, parseIso(focus).m, parseIso(focus).d).getDay() + 6) % 7))); break;
      case 'PageUp':     e.preventDefault(); shiftMonth(-1); return;
      case 'PageDown':   e.preventDefault(); shiftMonth(1); return;
      case 'Enter': case ' ': e.preventDefault(); onSelect(focus); return;
      default: return;
    }
    e.preventDefault(); moveFocus.current = true; setFocus(next);
  };

  return (
    <div className="w-[264px]" data-testid="calendar-picker">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <button type="button" aria-label="Previous month" data-testid="cal-prev" onClick={() => shiftMonth(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-line-soft"><ChevronLeft className="h-4 w-4" /></button>
        <span aria-live="polite" className="font-serif text-[17px] text-slate-700">{MONTHS[view.m]} {view.y}</span>
        <button type="button" aria-label="Next month" data-testid="cal-next" onClick={() => shiftMonth(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-line-soft"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div aria-hidden="true" className="mb-1 grid grid-cols-7">
        {DOW.map((d) => <span key={d} className="text-center text-[10.5px] font-extrabold uppercase tracking-[.04em] text-muted">{d}</span>)}
      </div>
      <div ref={gridRef} role="grid" aria-label="Choose a date" onKeyDown={onKey}>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" className="grid grid-cols-7">
            {week.map((dt) => {
              const d = isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
              const inMonth = dt.getMonth() === view.m;
              const isSel = d === value;
              const isToday = d === today;
              const isPast = d < today;   // DATE POLICY: can't schedule/move into the past
              return (
                <div key={d} role="gridcell" className="flex items-center justify-center py-0.5">
                  <button type="button" data-date={d} data-testid="day-cell" disabled={isPast}
                    tabIndex={d === focus ? 0 : -1}
                    aria-current={isToday ? 'date' : undefined}
                    aria-disabled={isPast || undefined}
                    aria-label={`${longLabel(dt)}${isSel ? ', selected' : ''}${isPast ? ', unavailable (past)' : ''}`}
                    onClick={() => { if (!isPast) onSelect(d); }} onFocus={() => setFocus(d)}
                    className={[
                      'flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold outline-none transition-colors',
                      isPast ? 'cursor-not-allowed text-muted/40'
                        : isSel ? 'bg-coral text-white'
                        : inMonth ? 'text-slate-700 hover:bg-coral-tint' : 'text-muted hover:bg-line-soft',
                      !isSel && isToday ? 'ring-1 ring-coral ring-offset-1' : '',
                    ].join(' ')}>{dt.getDate()}</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Desktop "Scheduled date" — a branded trigger button that opens the CalendarPicker in
 *  a popover (replaces the OS-native <input type=date>). */
export function DateField({ value, today, disabled, onSelect }: {
  value: string; today: string; disabled?: boolean; onSelect: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), wrapRef, triggerRef);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button ref={triggerRef} type="button" data-testid="editor-date" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-label={`Scheduled date: ${prettyDate(value)}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-[13px] border border-line bg-surface px-[15px] py-3 text-[14.5px] font-semibold text-slate-700 outline-none hover:border-line focus-visible:border-coral disabled:opacity-60">
        <CalendarIcon className="h-4 w-4 text-slate-600" />
        <span>{prettyDate(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a date" data-testid="date-popover"
          className="absolute left-0 z-[20] mt-2 rounded-2xl border border-line bg-surface p-3 shadow-card">
          <CalendarPicker value={value} today={today} autoFocus
            onSelect={(iso) => { onSelect(iso); setOpen(false); triggerRef.current?.focus(); }} />
        </div>
      )}
    </div>
  );
}

// ── Format dropdown (styled; replaces the native <select>) ───────────────────────
// Email is intentionally excluded from the flow (the email workflow isn't built yet):
// no post can be switched TO email. Existing email posts still render their chip.
const FORMAT_OPTIONS = [
  { value: 'reel', label: 'Reel' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'single', label: 'Single image' },
] as const;

export function FormatDropdown({ value, disabled, onChange }: {
  value: string; disabled?: boolean; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), wrapRef, triggerRef);

  // Focus the selected (or first) option when the menu opens.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
      ?? listRef.current?.querySelector<HTMLElement>('[role="option"]');
    el?.focus();
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const idx = opts.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(idx + 1, opts.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); opts[Math.max(idx - 1, 0)]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); opts[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); opts[opts.length - 1]?.focus(); }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button ref={triggerRef} type="button" data-testid="format-select" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={`Post format: ${FORMAT_LABEL[value]}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-line-soft px-[11px] py-[6px] text-[13px] font-extrabold text-slate-700 outline-none hover:border-line focus-visible:border-coral">
        <FormatIcon format={value} className="h-[15px] w-[15px] text-coral" />
        {FORMAT_LABEL[value]}
        <ChevronDown className="h-3 w-3 text-muted" />
      </button>
      {open && (
        <div ref={listRef} role="listbox" aria-label="Post format" data-testid="format-menu" onKeyDown={onListKey}
          className="absolute left-0 z-[20] mt-1.5 min-w-[184px] rounded-xl border border-line bg-surface p-1.5 shadow-card">
          {FORMAT_OPTIONS.map((o) => {
            const isSel = o.value === value;
            return (
              <button key={o.value} type="button" role="option" aria-selected={isSel} data-selected={isSel}
                data-testid={`format-option-${o.value}`} tabIndex={-1}
                onClick={() => { setOpen(false); triggerRef.current?.focus(); if (o.value !== value) onChange(o.value); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-bold outline-none ${isSel ? 'bg-coral-tint text-slate-700' : 'text-slate-700 hover:bg-line-soft focus-visible:bg-line-soft'}`}>
                <FormatIcon format={o.value} className="h-[15px] w-[15px] text-coral" />
                <span className="flex-1">{o.label}</span>
                {isSel && <CheckIcon className="h-3.5 w-3.5 text-coral" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
