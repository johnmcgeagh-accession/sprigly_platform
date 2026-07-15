'use client';

import React, { useEffect, useState } from 'react';
import { useAutosave } from './useAutosave';
import type { PlanPost, PostStepView } from '@/lib/types';
import type { ProposalView } from '@/lib/agent/types';
import type { NoteView } from '@/lib/agent/notes';
import { dueDate, daysBetween, postAtRisk } from '@/lib/checklist';
import { bucketWeatherIcon, weatherTooltip, tempTone, type WeatherDay, type TempTone } from '@/lib/weather';
import {
  ChannelIcon, FormatIcon, FORMAT_LABEL, SparkIcon, NotesIcon, CheckIcon, WeatherGlyph, type WeatherGlyphKind,
} from './icons';
import { DISABLED_PRIMARY } from './primitives';

/** Shared temp-tone → colour + glyph. `hot`/`scorcher` tint the label amber (AA-safe
 *  amber-deep #7A5200, 6.9:1 on white); `cold` a calm slate-blue (sky-800, 7.4:1); else
 *  the muted default. A scorcher on an otherwise-sunny day also swaps to the hot-sun
 *  glyph (tinted to match) so the icon itself reads "heat". Quiet accent, never an alert. */
function weatherTreatment(day: WeatherDay): { glyph: WeatherGlyphKind; tone: TempTone; tempCls: string; iconCls: string } {
  const icon = bucketWeatherIcon(day.weatherCode);
  const tone = tempTone(day.tempMaxC);
  const glyph: WeatherGlyphKind = tone === 'scorcher' && icon === 'sun' ? 'hot-sun' : icon;
  const tempCls = tone === 'scorcher' || tone === 'hot' ? 'text-amber-deep' : tone === 'cold' ? 'text-sky-800' : 'text-muted';
  // The icon stays muted (it carries condition, not temperature) EXCEPT the hot-sun,
  // which is amber so the scorcher reads as one coherent heat accent.
  const iconCls = glyph === 'hot-sun' ? 'text-amber-deep' : 'text-muted';
  return { glyph, tone, tempCls, iconCls };
}

/** Desktop calendar-cell weather: a compact icon + temp label top-right of the cell.
 *  Reverses the earlier icon-only decision (§18) — during a heatwave an icon alone can't
 *  communicate heat (DECISIONS §22). Glyph aria-hidden; the full detail stays in the
 *  native tooltip ("32° · clear"). Renders nothing with no forecast (out-of-window/no data). */
export function WeatherCellIcon({ day }: { day: WeatherDay | undefined }) {
  if (!day) return null;
  const icon = bucketWeatherIcon(day.weatherCode);
  const { glyph, tone, tempCls, iconCls } = weatherTreatment(day);
  return (
    <span title={weatherTooltip(day)} data-testid="weather-icon" data-weather={icon} data-tone={tone} data-glyph={glyph}
      className="flex shrink-0 items-center gap-[3px] leading-none">
      <WeatherGlyph icon={glyph} className={`h-[14px] w-[14px] ${iconCls}`} />
      <span data-testid="weather-temp" className={`text-[11px] font-semibold tabular-nums ${tempCls}`}>{Math.round(day.tempMaxC)}°</span>
    </span>
  );
}

/** Mobile agenda day-header weather: icon + temp, right-aligned, with ONE accessible
 *  label for the pair (the glyph and the temp text are decorative). Same temp formatting
 *  and hot/cold tone treatment as the desktop cell. Nothing when no forecast for the day. */
export function WeatherHeaderBadge({ day }: { day: WeatherDay | undefined }) {
  if (!day) return null;
  const icon = bucketWeatherIcon(day.weatherCode);
  const { glyph, tone, tempCls, iconCls } = weatherTreatment(day);
  return (
    <span data-testid="weather-badge" data-tone={tone} role="img" aria-label={`Weather: ${weatherTooltip(day)}`}
      className="ml-auto flex items-center gap-1">
      <WeatherGlyph icon={glyph} className={`h-[15px] w-[15px] ${iconCls}`} />
      <span aria-hidden="true" className={`text-[12.5px] font-semibold tabular-nums ${tempCls}`}>{Math.round(day.tempMaxC)}°</span>
    </span>
  );
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return `${DAY[(dt.getDay() + 6) % 7]} ${d}`;
}
export function monthDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return `${DAY[(dt.getDay() + 6) % 7]} ${MON[m! - 1]} ${d}`;
}

/** True when a post has no real caption yet (a draft idea). */
export function isUntitled(p: PlanPost): boolean {
  const cap = (p.caption || '').trim();
  return !cap || cap.startsWith('Draft idea');
}

/** A human title for a post — the caption's first sentence. No dedicated title field
 *  exists in the backend (recorded delta). Untitled drafts return 'Untitled' (chips
 *  render the fuller "Untitled — tap to draft" affordance themselves). */
export function postTitle(p: PlanPost): string {
  const cap = (p.caption || '').trim();
  if (cap && !cap.startsWith('Draft idea')) return cap.split(/(?<=[.!?])\s/)[0]!.slice(0, 90);
  return 'Untitled';
}

/** done/total progress ring; amber when a step is overdue, coral when complete. */
export function ProgressRing({ done, total, risk, size = 34 }: { done: number; total: number; risk?: boolean; size?: number }) {
  const r = 11, C = 2 * Math.PI * r, frac = total ? done / total : 0, off = C * (1 - frac);
  const complete = total > 0 && done === total;
  const stroke = complete ? '#E8705F' : risk ? '#C4523F' : '#E8705F';
  const num = complete ? 'text-slate-700' : risk ? 'text-amber-deep' : 'text-slate-600';
  return (
    <span data-testid="progress-ring" role="img" aria-label={`${done} of ${total} steps done`}
      className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 34 34" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="17" cy="17" r={r} fill="none" stroke="#8F9296" strokeWidth="3" />
        <circle cx="17" cy="17" r={r} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round"
          style={{ strokeDasharray: C.toFixed(1), strokeDashoffset: off.toFixed(1), transition: 'stroke-dashoffset .4s ease' }} />
      </svg>
      <span className={`text-[9.5px] font-extrabold ${num}`}>{done}/{total}</span>
    </span>
  );
}

/** Calendar / feed chip for a post. */
export function PostChip({ post, selected, today, onClick, draggable, onDragStart, onDragEnd, pending }: {
  post: PlanPost; selected?: boolean; today: string; onClick?: () => void;
  draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; pending?: boolean;
}) {
  const risk = postAtRisk(post.steps, post.date, today);
  return (
    <div
      data-testid="post-chip" data-post-id={post.id} data-pending={pending ? '1' : undefined} title={postTitle(post)}
      draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Open “${postTitle(post)}”, ${FORMAT_LABEL[post.format]}` : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={[
        'group relative flex cursor-pointer select-none items-start gap-2 rounded-[10px] border bg-surface px-[9px] py-[7px]',
        'text-[12.5px] font-bold text-slate-700 transition hover:shadow-card',
        selected ? 'border-coral shadow-[0_0_0_3px_rgba(232,119,102,.14)]' : 'border-line hover:border-line',
        pending ? 'opacity-70' : '',   // subtle pending state while the move reconciles
      ].join(' ')}
    >
      <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] bg-coral-tint text-coral">
        <ChannelIcon channel={post.channel} className="h-[13px] w-[13px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block overflow-hidden leading-[1.3] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {isUntitled(post) ? <span className="font-semibold italic text-muted">Untitled draft</span> : postTitle(post)}
        </span>
        <span className="mt-0.5 block text-[11px] font-bold uppercase tracking-[.04em] text-muted">{FORMAT_LABEL[post.format]}</span>
      </span>
      {post.status === 'new'
        ? <span className="mt-0.5 flex-none rounded-[4px] border border-coral px-[3px] text-[8.5px] font-extrabold tracking-[.06em] text-slate-700">NEW</span>
        : (risk || post.reviewState === 'preserved_edit_orphan') && <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-coral" />}
    </div>
  );
}

const DUE = { Late: 'Late', Today: 'Today' } as const;
/** One checklist step with a due chip (Late / Today / by-date / Done). The label is
 *  inline-editable when `onRename` is given (autosave on blur/idle → step_renamed);
 *  read-only cycles pass neither handler and get static text. */
export function ChecklistItem({ step, scheduledDate, today, onToggle, onRename, testid }: {
  step: PostStepView; scheduledDate: string; today: string;
  onToggle?: (() => void) | undefined; onRename?: ((label: string) => void) | undefined; testid?: string | undefined;
}) {
  const due = dueDate(scheduledDate, step.leadDays);
  const diff = daysBetween(today, due);
  const late = !step.done && diff < 0;
  const isToday = !step.done && diff === 0;
  const dueLabel = step.done ? 'Done' : late ? DUE.Late : isToday ? DUE.Today : `by ${shortDate(due)}`;

  const [label, setLabel] = useState(step.label);
  useEffect(() => { setLabel(step.label); }, [step.label]); // resync when the server value changes
  const auto = useAutosave(label, step.label, (v) => onRename?.(v), !!onRename);

  return (
    <div data-testid={testid ?? 'checklist-item'} className={[
      'flex items-center gap-3 rounded-[13px] border px-[13px] py-3',
      step.done ? 'border-transparent bg-line-soft' : late ? 'border-coral-600 bg-coral-100' : 'border-line bg-surface',
    ].join(' ')}>
      <button data-testid="step-toggle" onClick={onToggle} disabled={!onToggle} aria-pressed={step.done} aria-label={step.done ? 'Mark not done' : 'Mark done'}
        className={[
          'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] border-2 text-white',
          step.done ? 'border-coral bg-coral' : 'border-line bg-surface',
        ].join(' ')}>
        {step.done && <CheckIcon className="h-3 w-3" />}
      </button>
      {onRename ? (
        <input
          data-testid="step-label" value={label} aria-label={`Step label: ${step.label}`}
          onChange={(e) => setLabel(e.target.value)} onBlur={auto.flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === 'Escape') { setLabel(step.label); e.currentTarget.blur(); }
          }}
          className={`-mx-1 min-w-0 flex-1 rounded bg-transparent px-1 text-[14.5px] font-semibold outline-none focus:bg-white focus:ring-1 focus:ring-coral ${step.done ? 'text-muted line-through' : 'text-slate-700'}`}
        />
      ) : (
        <span className={`flex-1 text-[14.5px] font-semibold ${step.done ? 'text-muted line-through' : 'text-slate-700'}`}>{step.label}</span>
      )}
      <span className={`whitespace-nowrap text-[11.5px] font-extrabold ${late ? 'text-danger' : isToday ? 'text-slate-700' : 'text-muted'}`}>{dueLabel}</span>
    </div>
  );
}

/** An agent proposal awaiting approval. */
export function ProposalCard({ proposal, onApprove, onDiscard, busy }: {
  proposal: ProposalView; onApprove: () => void; onDiscard: () => void; busy?: boolean;
}) {
  return (
    <div data-testid="proposal-card" data-proposal-id={proposal.id}
      className="mb-[9px] flex items-center gap-3.5 rounded-[14px] border border-line bg-surface p-4 shadow-card">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-coral-tint text-coral">
        <SparkIcon className="h-[18px] w-[18px]" />
      </span>
      <div className="flex-1 text-[14.5px] font-bold leading-snug text-slate-700">{proposal.summary}</div>
      <div className="flex flex-none gap-2">
        <button data-testid="proposal-approve" disabled={busy} onClick={onApprove} aria-label={`Approve: ${proposal.summary}`}
          className={`inline-flex items-center gap-1.5 rounded-[10px] bg-coral px-4 py-2.5 text-[13px] font-extrabold text-white ${DISABLED_PRIMARY}`}>
          <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />Approve
        </button>
        <button data-testid="proposal-discard" disabled={busy} onClick={onDiscard} aria-label={`Discard: ${proposal.summary}`}
          className="rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13px] font-bold text-slate-600 hover:border-line disabled:opacity-50">
          Discard
        </button>
      </div>
    </div>
  );
}

/** A read-only captured note (plan_inputs where source='voice'). */
export function NoteRow({ note }: { note: NoteView }) {
  return (
    <div data-testid="note-row" className="mb-2 flex items-start gap-3 rounded-[12px] bg-line-soft px-3.5 py-3 text-[14px] leading-snug text-slate-700">
      <NotesIcon className="mt-0.5 h-[15px] w-[15px] flex-none text-muted" />
      <span>{note.content}</span>
    </div>
  );
}

/** Strip markdown bullet markers so the agent message renders as clean prose. */
function cleanProse(msg: string): string {
  return msg.split('\n').map((l) => l.replace(/^\s*[•\-*]\s+/, '').trim()).filter(Boolean).join('\n');
}

/**
 * "From your ask, Sprigly took" — renders the agent's REAL turn output: each proposal
 * as an action row with an INLINE Approve / Discard (same endpoints + ledger/cap as the
 * Approvals view), plus Sprigly's message as clean prose. When `onDecide` is given the
 * rows are actionable; approving swaps the row to "Applied ✓" and the caller refreshes
 * the plan + rail counts.
 */
export function ExtractionSummary({ reply, onDecide, busy }: {
  reply: { message: string; proposals: ProposalView[] } | null;
  onDecide?: ((id: string, action: 'approve' | 'reject') => Promise<boolean>) | undefined;
  busy?: boolean | undefined;
}) {
  const [status, setStatus] = useState<Record<string, 'applied' | 'discarded'>>({});
  const [pending, setPending] = useState<string | null>(null);

  if (!reply) return null;
  const message = cleanProse(reply.message);

  const decide = async (id: string, action: 'approve' | 'reject') => {
    if (!onDecide || pending) return;
    setPending(id);
    // Only mark the row resolved when it actually applied — a `blocked` approve (ordering
    // dependency not yet met) returns false and keeps the row approvable.
    try { const ok = await onDecide(id, action); if (ok) setStatus((s) => ({ ...s, [id]: action === 'approve' ? 'applied' : 'discarded' })); }
    finally { setPending(null); }
  };
  const anyBusy = pending !== null || !!busy;

  return (
    <div data-testid="extraction-summary" className="mt-[18px] rounded-[14px] border border-line bg-line-soft px-4 py-3.5">
      <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-600">From your ask, Sprigly took</div>
      {reply.proposals.map((p) => {
        const st = status[p.id];
        return (
          <div key={p.id} data-testid="extraction-row" data-proposal-id={p.id} className="flex items-start gap-2.5 border-t border-line/60 py-2.5 text-[13.5px] font-bold text-slate-700 first:border-t-0">
            <span className="mt-[-1px] flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg bg-coral-tint text-coral">
              <SparkIcon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 leading-snug">{p.summary}</span>
            {st === 'applied' ? (
              <span data-testid="extraction-applied" className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-extrabold text-slate-700"><CheckIcon className="h-3.5 w-3.5 text-coral" aria-hidden="true" />Applied</span>
            ) : st === 'discarded' ? (
              <span data-testid="extraction-discarded" className="mt-0.5 whitespace-nowrap text-[12px] font-bold text-muted">Discarded</span>
            ) : onDecide ? (
              <span className="flex flex-none gap-1.5">
                <button data-testid="extraction-approve" disabled={anyBusy} onClick={() => decide(p.id, 'approve')} aria-label={`Approve: ${p.summary}`}
                  className={`inline-flex items-center gap-1 rounded-[9px] bg-coral px-3 py-1.5 text-[12px] font-extrabold text-white ${DISABLED_PRIMARY}`}><CheckIcon className="h-3 w-3" aria-hidden="true" />Approve</button>
                <button data-testid="extraction-discard" disabled={anyBusy} onClick={() => decide(p.id, 'reject')} aria-label={`Discard: ${p.summary}`}
                  className="rounded-[9px] border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:border-line disabled:opacity-50">Discard</button>
              </span>
            ) : (
              <span className="mt-1 whitespace-nowrap text-[11px] font-bold text-slate-700">→ Approvals</span>
            )}
          </div>
        );
      })}
      {message && <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{message}</p>}
    </div>
  );
}
