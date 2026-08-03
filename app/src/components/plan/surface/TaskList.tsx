'use client';

/**
 * TaskList.tsx — a post's own checklist, and the Completed section every task list now has.
 *
 * Two phone-check rulings share one component because they are the same complaint from two ends.
 *
 * P9 — A POST'S TASKS RENDER IN ITS SHEET. They exist on the row (`PlanPost.steps`, batched in by
 * the reader) and the new surface showed them in exactly one place: the Tasks view, which groups
 * every post's steps by due date across the whole month. So "what does THIS post still need" was
 * unanswerable from the post.
 *
 * P8 — A COMPLETED TASK GOES SOMEWHERE. `groupTasks` filters `done`, so ticking one removed the
 * row from existence — on a phone that is indistinguishable from a bug, and it takes with it the
 * one thing a checklist is for, which is the sight of what you have already done. Completed work
 * moves to a section of its own, collapsed, with its count, and it can be un-ticked from there.
 *
 * THE TICK IS NOT COLOUR ALONE. Done is a filled circle with a checkmark inside it AND a
 * struck-through label AND a different section. Round 5.1 recorded the empty-span tick as "not an
 * a11y defect because the label is struck through"; a real checkmark costs one path.
 */
import React, { useState } from 'react';
import type { PostStepView } from '@/lib/types';
import { CheckGlyph, ChevronD, ChevronR } from './icons';
import { dueDate } from '@/lib/checklist';
import { fromIso, MONTHS_FULL } from './dates';

/** 'Oct 3' — short enough for a right-hand column that must not wrap. */
export function shortDue(iso: string): string {
  const d = fromIso(iso);
  return `${MONTHS_FULL[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}

export function TaskRow({
  label, due, done, late, onToggle, editable, meta,
}: {
  label: string;
  due?: string | undefined;
  done: boolean;
  late?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  editable: boolean;
  /** A second line under the label — the Tasks view names the post the step belongs to. */
  meta?: React.ReactNode | undefined;
}) {
  return (
    <div
      data-testid="task-row" data-done={done ? 'true' : undefined}
      className={`mb-2 flex min-h-[56px] items-center gap-3 rounded-[14px] border bg-surface px-[13px] py-3 shadow-card ${late ? 'border-line/55' : 'border-line/30'}`}
    >
      <button
        type="button" data-testid="task-check" role="checkbox" aria-checked={done}
        aria-label={done ? `Mark "${label}" not done` : `Mark "${label}" done`}
        disabled={!editable || !onToggle} onClick={onToggle}
        // 40px hit area around a 24px mark: visually inert, and it clears the floor (X3).
        className="-m-2 flex h-10 w-10 flex-none items-center justify-center p-2 disabled:opacity-50"
      >
        <span aria-hidden="true"
          className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${done ? 'border-coral-650 bg-coral-650 text-white' : 'border-line/55 bg-surface'}`}
        >
          {done && <CheckGlyph className="h-3.5 w-3.5 [stroke-width:3]" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <span className={`block text-[15px] font-semibold ${done ? 'text-muted line-through' : 'text-chrome'}`}>{label}</span>
        {meta}
      </div>
      {due && (
        <span className={`flex-none whitespace-nowrap text-[11px] font-bold tabular-nums ${late ? 'text-danger' : 'text-muted'}`}>
          {late ? 'Late' : shortDue(due)}
        </span>
      )}
    </div>
  );
}

/** The collapsible Completed section. Shared, so the sheet and the Tasks view cannot disagree
 *  about what "done" looks like or where it goes. */
export function CompletedSection({ count, children, className = '' }: { count: number; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <section data-testid="completed-section" className={`pt-1 ${className}`}>
      <button
        type="button" data-testid="completed-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-2 text-left"
      >
        {open ? <ChevronD className="h-4 w-4 text-muted" /> : <ChevronR className="h-4 w-4 text-muted" />}
        <h3 className="text-[11px] font-bold uppercase tracking-[.1em] text-muted">Completed</h3>
        <span className="rounded-full bg-line/20 px-2 py-px text-[11px] font-bold tabular-nums text-muted">{count}</span>
      </button>
      {open && <div data-testid="completed-list">{children}</div>}
    </section>
  );
}

/** One post's checklist, in its detail sheet. */
export function TaskList({
  steps, date, editable, onToggle,
}: {
  steps: PostStepView[];
  /** The post's scheduled date — every step's due date is derived from it and its lead days. */
  date: string;
  editable: boolean;
  onToggle: (stepId: string, done: boolean) => void;
}) {
  const outstanding = steps.filter((s) => !s.done);
  const done = steps.filter((s) => s.done);

  return (
    <section data-testid="sheet-tasks" className="pt-6">
      <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-[.1em] text-muted">
        {outstanding.length === 0 ? 'Nothing left to do' : 'To do'}
      </h3>
      {outstanding.map((s) => (
        <TaskRow
          key={s.id} label={s.label} due={dueDate(date, s.leadDays)} done={false} editable={editable}
          onToggle={() => onToggle(s.id, true)}
        />
      ))}
      <CompletedSection count={done.length}>
        {done.map((s) => (
          <TaskRow
            key={s.id} label={s.label} done editable={editable}
            onToggle={() => onToggle(s.id, false)}
          />
        ))}
      </CompletedSection>
    </section>
  );
}
