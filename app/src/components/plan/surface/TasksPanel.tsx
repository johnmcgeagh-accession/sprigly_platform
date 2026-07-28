'use client';

/**
 * TasksPanel.tsx — the production checklist, as a peer view.
 *
 * Carried over from `PlanMobile`'s `MobileTasks` rather than redesigned: the spec's scope note
 * says the Plan/Tasks checklist is untouched by this brief and carried forward as-is, and
 * mockup 10 is a stub for the same reason. Two things did change, and only two:
 *
 *   - it is a VIEW now, not a mode. Tasks is a sibling of Day and Month in the nav pill, which
 *     is what it always was — round 3 had it in a second navigation system at the bottom while
 *     Week|Month lived in the header, and the pill absorbed both.
 *   - its colours are tokens. The original reached for `text-slate-700`, a literal Tailwind
 *     grey outside the theme; every value here resolves through `--t-*`.
 *
 * The grouping, the buckets and the late rule are `planTasks` and `postAtRisk`, untouched.
 */
import React from 'react';
import type { PlanData } from '../usePlanData';
import { planTasks } from '../derive';
import { postTitle } from '../pieces';
import { FormatTile } from './icons';
import { fromIso, MONTHS_FULL } from './dates';

export function TasksPanel({ data, onOpen }: { data: PlanData; onOpen: (postId: string) => void }) {
  const groups = planTasks(data.posts, data.today);
  const total = groups.overdue.length + groups.next7.length + groups.later.length;
  const sections: [string, string, typeof groups.overdue][] = [
    ['overdue', 'Overdue', groups.overdue],
    ['today', 'Due today', groups.next7.filter((t) => t.due === data.today)],
    ['week', 'This week', groups.next7.filter((t) => t.due !== data.today).concat(groups.later)],
  ];

  return (
    <div data-testid="tasks-panel" className="flex-1 overflow-y-auto px-5 pb-[104px] pt-4 [scrollbar-width:none]">
      {total === 0 && (
        <div className="mx-6 my-10 text-center">
          <span className="mb-2 block text-[22px] font-bold tracking-[-.02em] text-chrome">All caught up</span>
          <span className="text-[13.5px] leading-relaxed text-muted">Every post has what it needs.</span>
        </div>
      )}

      {sections.map(([key, label, items]) => items.length > 0 && (
        <section key={key} className="mb-[18px]">
          <div className="flex items-center gap-2.5 pb-2 pt-1">
            <h3 className={`text-[11px] font-bold uppercase tracking-[.1em] ${key === 'overdue' ? 'text-danger' : key === 'today' ? 'text-chrome' : 'text-muted'}`}>
              {label}
            </h3>
            <span className="rounded-full bg-line/20 px-2 py-px text-[11px] font-bold tabular-nums text-muted">{items.length}</span>
          </div>
          {items.map((t) => (
            <div
              key={t.item.step.id} data-testid="task-row"
              // NO coloured left stripe. It is the most recognisable tell of a templated UI,
              // and the detector flags the inline-style form of it — the Tailwind form is the
              // same pattern with the same problem, so it goes too. Late is carried by the
              // WORD 'Late' in danger, which is a stronger channel than a 3px edge and does not
              // depend on colour vision. The row itself just gets a firmer hairline.
              className={`mb-2 flex min-h-[56px] items-center gap-3 rounded-[14px] border bg-surface px-[13px] py-3 shadow-card ${t.bucket === 'overdue' ? 'border-line/55' : 'border-line/30'}`}
            >
              <button
                type="button" data-testid="task-check" aria-label={`Mark "${t.item.step.label}" done`}
                onClick={() => void data.toggleStep(t.item.post.id, t.item.step.id, true)}
                // 40px hit area around a 24px tick: visually inert, and it clears the floor (X3).
                className="-m-2 flex h-10 w-10 flex-none items-center justify-center p-2"
              >
                <span aria-hidden="true" className="block h-6 w-6 rounded-full border-2 border-line/55 bg-surface" />
              </button>
              <button
                type="button" onClick={() => onOpen(t.item.post.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-[15px] font-semibold text-chrome">{t.item.step.label}</span>
                <span className="mt-0.5 flex items-center gap-1.5 overflow-hidden text-[12.5px] text-muted">
                  <FormatTile format={t.item.post.format} />
                  <span className="truncate">{postTitle(t.item.post)}</span>
                </span>
              </button>
              <span className={`flex-none whitespace-nowrap text-[11px] font-bold tabular-nums ${t.bucket === 'overdue' ? 'text-danger' : 'text-muted'}`}>
                {t.bucket === 'overdue' ? 'Late' : shortDue(t.due)}
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function shortDue(iso: string): string {
  const d = fromIso(iso);
  return `${MONTHS_FULL[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}
