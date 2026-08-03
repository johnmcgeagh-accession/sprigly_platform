'use client';

/**
 * TasksPanel.tsx — the production checklist, as a peer view.
 *
 * Carried over from `PlanMobile`'s `MobileTasks` rather than redesigned: the spec's scope note
 * says the Plan/Tasks checklist is untouched by this brief and carried forward as-is, and
 * mockup 10 is a stub for the same reason. Three things have changed, and only three:
 *
 *   - it is a VIEW now, not a mode. Tasks is a sibling of Day and Month in the nav pill, which
 *     is what it always was — round 3 had it in a second navigation system at the bottom while
 *     Week|Month lived in the header, and the pill absorbed both.
 *   - its colours are tokens. The original reached for `text-slate-700`, a literal Tailwind
 *     grey outside the theme; every value here resolves through `--t-*`.
 *   - ROUND 6, P8: a completed task moves to a Completed section instead of ceasing to exist.
 *     `groupTasks` filters `done`, so a tick deleted the row from the screen — indistinguishable
 *     from a bug, and it removes the one thing a checklist is for. The section is collapsed by
 *     default, carries its count, and a task can be un-ticked from it.
 *
 * The grouping, the buckets and the late rule are `planTasks` and `postAtRisk`, untouched.
 */
import React from 'react';
import { scrollPad, type SurfaceFrame } from './frame';
import type { PlanData } from '../usePlanData';
import { planTasks } from '../derive';
import { postTitle } from '../pieces';
import { FormatTile } from './icons';
import { TaskRow, CompletedSection } from './TaskList';
import { dueDate } from '@/lib/checklist';

export function TasksPanel({ data, onOpen, frame = 'mobile' }: { data: PlanData; onOpen: (postId: string) => void; frame?: SurfaceFrame }) {
  const groups = planTasks(data.posts, data.today);
  const total = groups.overdue.length + groups.next7.length + groups.later.length;
  const sections: [string, string, typeof groups.overdue][] = [
    ['overdue', 'Overdue', groups.overdue],
    ['today', 'Due today', groups.next7.filter((t) => t.due === data.today)],
    ['week', 'This week', groups.next7.filter((t) => t.due !== data.today).concat(groups.later)],
  ];

  // Done steps, newest completion first where the timestamp exists. Computed from the same
  // rows planTasks reads, filtered the other way — there is no second source.
  const completed = data.posts
    .flatMap((p) => p.steps.filter((s) => s.done).map((s) => ({ post: p, step: s })))
    .sort((a, b) => (b.step.doneAt ?? '').localeCompare(a.step.doneAt ?? ''));

  /**
   * ── W4: THE SECTIONS FLOW INTO COLUMNS AT WIDTH ────────────────────────────────────
   *
   * A task row is a label, the post it belongs to and a due date. It stops getting better at
   * about 560px, so a single stack in a 1120px region is half a screen of nothing beside a
   * list — and this view used to render in the 420px DAY column, which was worse.
   *
   * CSS multi-column rather than a grid, because the sections are different heights and a grid
   * would align their tops and leave ragged gaps between them. `break-inside-avoid` keeps a
   * section whole; the browser balances the rest.
   */
  const desktop = frame === 'desktop';

  return (
    <div
      data-testid="tasks-panel"
      className={`flex-1 overflow-y-auto pt-3 [scrollbar-width:none] ${scrollPad(frame)} ${
        desktop ? 'px-1 wide:columns-2 wide:gap-7' : 'px-5'
      }`}
    >
      {total === 0 && (
        <div className="mx-6 my-10 text-center">
          <span className="mb-2 block text-[22px] font-bold tracking-[-.02em] text-chrome">
            {completed.length > 0 ? 'All caught up' : 'Nothing to do yet'}
          </span>
          <span className="text-[13.5px] leading-relaxed text-muted">
            {completed.length > 0 ? 'Every post has what it needs.' : 'Steps appear here as posts get their checklists.'}
          </span>
        </div>
      )}

      {sections.map(([key, label, items]) => items.length > 0 && (
        <section key={key} className={`mb-[18px] ${desktop ? 'break-inside-avoid' : ''}`}>
          <div className="flex items-center gap-2.5 pb-2 pt-1">
            <h3 className={`text-[11px] font-bold uppercase tracking-[.1em] ${key === 'overdue' ? 'text-danger' : key === 'today' ? 'text-chrome' : 'text-muted'}`}>
              {label}
            </h3>
            <span className="rounded-full bg-line/20 px-2 py-px text-[11px] font-bold tabular-nums text-muted">{items.length}</span>
          </div>
          {items.map((t) => (
            <TaskRow
              key={t.item.step.id} label={t.item.step.label} due={t.due} done={false}
              late={t.bucket === 'overdue'} editable={data.canEdit(t.item.post.date)}
              onToggle={() => void data.toggleStep(t.item.post.id, t.item.step.id, true)}
              meta={
                <button
                  type="button" onClick={() => onOpen(t.item.post.id)}
                  className="mt-0.5 flex w-full items-center gap-1.5 overflow-hidden text-left text-[12.5px] text-muted"
                >
                  <FormatTile format={t.item.post.format} />
                  <span className="truncate">{postTitle(t.item.post)}</span>
                </button>
              }
            />
          ))}
        </section>
      ))}

      <CompletedSection count={completed.length} className={desktop ? 'break-inside-avoid' : ''}>
        {completed.map(({ post, step }) => (
          <TaskRow
            key={step.id} label={step.label} due={dueDate(post.date, step.leadDays)} done
            editable={data.canEdit(post.date)}
            onToggle={() => void data.toggleStep(post.id, step.id, false)}
          />
        ))}
      </CompletedSection>
    </div>
  );
}
