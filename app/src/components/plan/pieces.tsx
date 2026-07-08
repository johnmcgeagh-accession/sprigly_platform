'use client';

import React from 'react';
import type { PlanPost, PostStepView } from '@/lib/types';
import type { ProposalView } from '@/lib/agent/types';
import type { NoteView } from '@/lib/agent/notes';
import { dueDate, daysBetween, postAtRisk } from '@/lib/checklist';
import {
  ChannelIcon, FormatIcon, FORMAT_LABEL, SparkIcon, NotesIcon, CheckIcon,
} from './icons';

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

/** A human title for a post — the caption's first sentence, else the pillar. No
 *  dedicated title field exists in the backend (recorded delta). */
export function postTitle(p: PlanPost): string {
  const cap = (p.caption || '').trim();
  if (cap && !cap.startsWith('Draft idea')) return cap.split(/(?<=[.!?])\s/)[0]!.slice(0, 90);
  return p.pillar || 'New idea';
}

/** done/total progress ring; amber when a step is overdue, coral when complete. */
export function ProgressRing({ done, total, risk, size = 34 }: { done: number; total: number; risk?: boolean; size?: number }) {
  const r = 11, C = 2 * Math.PI * r, frac = total ? done / total : 0, off = C * (1 - frac);
  const complete = total > 0 && done === total;
  const stroke = complete ? '#E87766' : risk ? '#F59E0B' : '#E87766';
  const num = complete ? 'text-slate-700' : risk ? 'text-amber-deep' : 'text-slate-600';
  return (
    <span data-testid="progress-ring" role="img" aria-label={`${done} of ${total} steps done`}
      className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 34 34" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="17" cy="17" r={r} fill="none" stroke="#ECEAE6" strokeWidth="3" />
        <circle cx="17" cy="17" r={r} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round"
          style={{ strokeDasharray: C.toFixed(1), strokeDashoffset: off.toFixed(1), transition: 'stroke-dashoffset .4s ease' }} />
      </svg>
      <span className={`text-[9.5px] font-extrabold ${num}`}>{done}/{total}</span>
    </span>
  );
}

/** Calendar / feed chip for a post. */
export function PostChip({ post, selected, today, onClick, draggable, onDragStart, onDragEnd }: {
  post: PlanPost; selected?: boolean; today: string; onClick?: () => void;
  draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void;
}) {
  const risk = postAtRisk(post.steps, post.date, today);
  return (
    <div
      data-testid="post-chip" data-post-id={post.id} title={postTitle(post)}
      draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Open “${postTitle(post)}”, ${FORMAT_LABEL[post.format]}` : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={[
        'group relative flex cursor-pointer select-none items-start gap-2 rounded-[10px] border bg-surface px-[9px] py-[7px]',
        'text-[12.5px] font-bold text-slate-700 transition hover:shadow-card',
        selected ? 'border-coral shadow-[0_0_0_3px_rgba(232,119,102,.14)]' : 'border-line hover:border-[#DED9D3]',
      ].join(' ')}
    >
      <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] bg-coral-tint text-coral">
        <ChannelIcon channel={post.channel} className="h-[13px] w-[13px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block overflow-hidden leading-[1.3] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{postTitle(post)}</span>
        <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[.04em] text-muted">{FORMAT_LABEL[post.format]}</span>
      </span>
      {post.status === 'new'
        ? <span className="mt-0.5 flex-none rounded-[4px] border border-coral px-[3px] text-[8.5px] font-extrabold tracking-[.06em] text-slate-700">NEW</span>
        : (risk || post.reviewState === 'preserved_edit_orphan') && <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-coral" />}
    </div>
  );
}

const DUE = { Late: 'Late', Today: 'Today' } as const;
/** One checklist step with a due chip (Late / Today / by-date / Done). */
export function ChecklistItem({ step, scheduledDate, today, onToggle, testid }: {
  step: PostStepView; scheduledDate: string; today: string; onToggle?: (() => void) | undefined; testid?: string | undefined;
}) {
  const due = dueDate(scheduledDate, step.leadDays);
  const diff = daysBetween(today, due);
  const late = !step.done && diff < 0;
  const isToday = !step.done && diff === 0;
  const label = step.done ? 'Done' : late ? DUE.Late : isToday ? DUE.Today : `by ${shortDate(due)}`;
  return (
    <div data-testid={testid ?? 'checklist-item'} className={[
      'flex items-center gap-3 rounded-[13px] border px-[13px] py-3',
      step.done ? 'border-transparent bg-[#F7F6F4]' : late ? 'border-[#F1D6AE] bg-[#FEFAF3]' : 'border-line bg-surface',
    ].join(' ')}>
      <button data-testid="step-toggle" onClick={onToggle} aria-pressed={step.done} aria-label={step.done ? 'Mark not done' : 'Mark done'}
        className={[
          'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] border-2 text-white',
          step.done ? 'border-coral bg-coral' : 'border-[#D9D6D1] bg-surface',
        ].join(' ')}>
        {step.done && <CheckIcon className="h-3 w-3" />}
      </button>
      <span className={`flex-1 text-[14.5px] font-semibold ${step.done ? 'text-muted line-through' : 'text-slate-700'}`}>{step.label}</span>
      <span className={`whitespace-nowrap text-[11.5px] font-extrabold ${late ? 'text-danger' : isToday ? 'text-slate-700' : 'text-muted'}`}>{label}</span>
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
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-coral px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50">
          <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />Approve
        </button>
        <button data-testid="proposal-discard" disabled={busy} onClick={onDiscard} aria-label={`Discard: ${proposal.summary}`}
          className="rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13px] font-bold text-slate-600 hover:border-[#DED9D3] disabled:opacity-50">
          Discard
        </button>
      </div>
    </div>
  );
}

/** A read-only captured note (plan_inputs where source='voice'). */
export function NoteRow({ note }: { note: NoteView }) {
  return (
    <div data-testid="note-row" className="mb-2 flex items-start gap-3 rounded-[12px] bg-[#F7F6F4] px-3.5 py-3 text-[14px] leading-snug text-slate-700">
      <NotesIcon className="mt-0.5 h-[15px] w-[15px] flex-none text-muted" />
      <span>{note.content}</span>
    </div>
  );
}

/**
 * "From your ask, Sprigly took" — renders the agent's REAL turn output: each proposal
 * as an Action row (→ Approvals), plus Sprigly's message (which covers answered
 * questions / captured notes). The mockups' keyword classifier is intentionally NOT
 * ported — this is the actual extraction from /api/plan/agent.
 */
export function ExtractionSummary({ reply }: { reply: { message: string; proposals: ProposalView[] } | null }) {
  if (!reply) return null;
  return (
    <div data-testid="extraction-summary" className="mt-[18px] rounded-[14px] border border-line bg-[#FAF9F7] px-4 py-3.5">
      <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-600">From your ask, Sprigly took</div>
      {reply.proposals.map((p) => (
        <div key={p.id} className="flex items-start gap-2.5 py-1.5 text-[13.5px] font-bold text-slate-700">
          <span className="mt-[-2px] flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg bg-coral-tint text-coral">
            <SparkIcon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">Action<em className="mt-px block whitespace-nowrap overflow-hidden text-ellipsis text-[12px] font-semibold not-italic text-muted">“{p.summary}”</em></span>
          <span className="mt-1 whitespace-nowrap text-[11px] font-bold text-slate-700">→ Approvals</span>
        </div>
      ))}
      {reply.message && <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{reply.message}</p>}
    </div>
  );
}
