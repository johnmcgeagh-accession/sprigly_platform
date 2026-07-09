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

const FORMAT_LABEL: Record<string, string> = { reel: 'reel', carousel: 'carousel', single: 'single image', email: 'email' };
export function formatSummary(post: PostLike & { format?: string }, format: string, reason?: string | null): string {
  return `Change “${postTitle(post)}” (${fmtDate(post.date)}) to a ${FORMAT_LABEL[format] ?? format}${ask(reason)}`;
}

/** "a" vs "an" by the following word's sound. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * Add-post summary. The FORMAT is always stated explicitly (reel / carousel / single
 * image). When the format was DEFAULTED (no signal in the ask), a visible, correctable
 * hint is appended so the client sees and can change the default before approving —
 * "…(say 'reel' or 'carousel' if you'd prefer)". (§24)
 */
export function addSummary(date: string, format: string, formatInferred: boolean, reason?: string | null, instruction?: string | null): string {
  const label = FORMAT_LABEL[format] ?? format;            // 'reel' | 'carousel' | 'single image'
  const head = `Add ${article(label)} ${label} on ${fmtDate(date)}`;
  const base = instruction && instruction.trim() ? `${head} — “${instruction.trim()}”` : `${head}${ask(reason)}`;
  return formatInferred ? base : `${base} (say “reel” or “carousel” if you’d prefer)`;
}

/** "Generate hooks for <target>" — target is the post title (existing) or the new
 *  reel/carousel being created in the same ask. */
export function generateHookSummary(target: string, reason?: string | null): string {
  return `Generate hooks for ${target}${ask(reason)}`;
}
