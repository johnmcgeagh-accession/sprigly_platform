import type { PlanPost, PostStepView } from '@/lib/types';
import { groupTasks } from '@/lib/checklist';

/** A not-done step carried with its post, for the Tasks board. */
export interface TaskEntry { done: boolean; leadDays: number; scheduledDate: string; post: PlanPost; step: PostStepView }

/** Bucket every outstanding step across the plan (overdue / next7 / later). */
export function planTasks(posts: PlanPost[], today: string) {
  const items: TaskEntry[] = posts.flatMap((p) => p.steps.map((s) => ({
    done: s.done, leadDays: s.leadDays, scheduledDate: p.date, post: p, step: s,
  })));
  return groupTasks(items, today);
}

export function lateCount(posts: PlanPost[], today: string): number {
  return planTasks(posts, today).overdue.length;
}

export function doneStepCount(posts: PlanPost[]): number {
  return posts.reduce((n, p) => n + p.steps.filter((s) => s.done).length, 0);
}
export function totalStepCount(posts: PlanPost[]): number {
  return posts.reduce((n, p) => n + p.steps.length, 0);
}

/** Viewed year/month from a cycle's displayMonth ('YYYY-MM'), else the earliest post. */
export function viewedMonth(displayMonth: string | undefined, posts: PlanPost[]): { year: number; month: number } {
  const src = displayMonth ?? posts.map((p) => p.date).sort()[0]?.slice(0, 7);
  if (src) { const [y, m] = src.split('-').map(Number); return { year: y!, month: m! - 1 }; }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}
