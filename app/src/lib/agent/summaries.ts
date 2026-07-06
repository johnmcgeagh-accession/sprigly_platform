/**
 * agent/summaries.ts — human-readable before→after proposal summaries that quote
 * the user's own phrasing as the reason (pure).
 */
import type { PlanPost } from '../types';
import { fmtDate, postTitle } from './selectors';

const ask = (reason?: string | null) => (reason ? ` (you asked: “${reason.trim()}”)` : '');
type PostLike = Pick<PlanPost, 'caption' | 'pillar' | 'date'>;

export function moveSummary(post: PostLike, toDate: string, reason?: string | null): string {
  return `Move “${postTitle(post)}” from ${fmtDate(post.date)} → ${fmtDate(toDate)}${ask(reason)}`;
}
export function deleteSummary(post: PostLike, reason?: string | null): string {
  return `Remove “${postTitle(post)}” scheduled ${fmtDate(post.date)}${ask(reason)}`;
}
export function rewriteSummary(post: PostLike, reason?: string | null): string {
  return `Rewrite the caption for “${postTitle(post)}” (${fmtDate(post.date)})${ask(reason)}`;
}
export function addSummary(date: string, reason?: string | null): string {
  return `Add a new post on ${fmtDate(date)}${ask(reason)}`;
}
