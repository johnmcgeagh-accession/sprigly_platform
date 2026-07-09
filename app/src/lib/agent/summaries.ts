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

/** "a" vs "an" by the following word's sound (Instagram / email both take "an"). */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
/** Display the channel as a proper noun. */
const channelLabel = (channel: string) => (channel === 'instagram' ? 'Instagram' : channel);

export function addSummary(date: string, reason?: string | null, instruction?: string | null, channel?: string | null): string {
  // Grammatical article + capitalised channel: "Add an Instagram post…", "Add a post…".
  const kind = channel ? `${article(channel)} ${channelLabel(channel)} post` : 'a post';
  if (instruction && instruction.trim()) return `Add ${kind} on ${fmtDate(date)} — “${instruction.trim()}”`;
  return `Add ${kind === 'a post' ? 'a new post' : kind} on ${fmtDate(date)}${ask(reason)}`;
}
