/**
 * agent-classify.ts — the plan-level agent bar's DETERMINISTIC classifier. app/ has
 * no Bedrock/model-client, and most bar commands ("move this to Friday", "change the
 * reel to a carousel") are STRUCTURAL, not AI rewrites — so this is a pure pattern
 * router, no model call. It mirrors the SHAPE of the engine's extract pattern (free
 * text → a discriminated intent) without the model hop.
 *
 * Structural intent → apply via the Phase 2 mutation endpoints (sync, free, uncounted).
 * Rewrite intent    → the Phase 3 shape job (async, counted against the AI limit).
 * Ambiguous rewrite with no resolvable target → 'clarify' (gentle, no spend), which is
 * safer than silently firing an unbounded plan-wide rewrite. Anything with a rewrite
 * verb but unclear structure still lands on the validated rewrite path.
 */
import type { PlanPost, PostFormat } from './types';

export type StructuralAction =
  | { type: 'patch';  postId: string; patch: { date?: string; format?: PostFormat } }
  | { type: 'delete'; postId: string };

export type AgentPlan =
  | { kind: 'structural'; actions: StructuralAction[];                     summary: string }
  | { kind: 'rewrite';    targetPostIds: string[]; instruction: string;    summary: string }
  | { kind: 'add';        date: string; caption?: string;                  summary: string }
  | { kind: 'clarify';    summary: string };

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const FORMAT_WORDS: Record<string, PostFormat> = {
  reel: 'reel', reels: 'reel', video: 'reel',
  carousel: 'carousel', carousels: 'carousel', gallery: 'carousel',
  single: 'single', image: 'single', photo: 'single', 'single-image': 'single',
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s: string): Date => { const [y, m, dd] = s.split('-').map(Number); return new Date(y || 2026, (m || 1) - 1, dd || 1); };

/** Date of weekday `dow` (0=Sun) in the same Monday-anchored week as `d`. */
function weekdayInSameWeek(d: Date, dow: number): Date {
  const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const r = new Date(monday); r.setDate(monday.getDate() + ((dow + 6) % 7));
  return r;
}

/** Resolve which posts an instruction refers to. Handles: all/them/every; a weekday;
 *  a day number ("the 5th"); a pillar keyword; and "this/it/selected" (via selectedId). */
function resolveTargets(text: string, posts: PlanPost[], selectedId?: string): PlanPost[] {
  const t = text.toLowerCase();

  if (/\b(all|them all|everything|every post|all of them|all posts|the whole plan|each post|the plan)\b/.test(t)) return posts;

  // Weekday ("the tuesday post", "tuesday's post")
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const hits = posts.filter((p) => parseISO(p.date).getDay() === dow);
      if (hits.length) return hits;
    }
  }

  // Day number ("the 5th", "on the 12th", "post on the 3rd")
  const dayM = t.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayM) {
    const day = Number(dayM[1] ?? 0);
    const hits = posts.filter((p) => parseISO(p.date).getDate() === day);
    if (hits.length) return hits;
  }

  // "this / it / selected / this post" → the currently-selected post
  if (selectedId && /\b(this|it|that|selected|this post|the selected)\b/.test(t)) {
    const sel = posts.find((p) => p.id === selectedId);
    if (sel) return [sel];
  }

  // Pillar keyword ("the product posts", "styling posts")
  const pillarWords = Array.from(new Set(
    posts.map((p) => p.pillar.toLowerCase().split(/\s+/)[0] ?? '').filter((w) => w.length >= 3),
  ));
  for (const w of pillarWords) {
    if (new RegExp(`\\b${w}\\b`).test(t)) {
      const hits = posts.filter((p) => p.pillar.toLowerCase().startsWith(w));
      if (hits.length) return hits;
    }
  }

  // Format word ("the reel", "the carousel") — last, so "make IT a carousel" still
  // resolves via the selected-post rule above rather than by the format noun.
  for (const [w, fmt] of Object.entries(FORMAT_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) {
      const hits = posts.filter((p) => p.format === fmt);
      if (hits.length) return hits;
    }
  }

  return [];
}

/** Parse an explicit destination date after "to …": ISO, day number, or a weekday
 *  (resolved relative to `anchor` — the source post's week). Returns 'YYYY-MM-DD'. */
function parseDestDate(text: string, anchor: Date): string | null {
  const isoM = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM) return isoM[0] ?? null;

  const afterTo = text.toLowerCase().split(/\bto\b/).slice(1).join(' ') || text.toLowerCase();

  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(afterTo)) return iso(weekdayInSameWeek(anchor, dow));
  }
  const dayM = afterTo.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dayM) {
    const day = Number(dayM[1] ?? 0);
    if (day >= 1 && day <= 31) { const d = new Date(anchor); d.setDate(day); return iso(d); }
  }
  return null;
}

const list = (ps: PlanPost[]) => (ps.length === 1 ? 'that post' : `${ps.length} posts`);

/** Classify a free-text plan-bar instruction. Pure — no DB, no model. */
export function classifyAgentInstruction(instruction: string, posts: PlanPost[], selectedId?: string): AgentPlan {
  const raw = instruction.trim();
  const t = raw.toLowerCase();
  if (!t) return { kind: 'clarify', summary: 'Tell me what you’d like to change.' };

  const hasFormat  = Object.keys(FORMAT_WORDS).some((w) => new RegExp(`\\b${w}\\b`).test(t));
  const moveVerb   = /\b(move|reschedule|shift|push|bump|put)\b/.test(t);
  const addVerb    = /\b(add|create|new)\b.*\bpost\b/.test(t) || /\badd a post\b/.test(t);
  const deleteVerb = /\b(remove|delete|drop|take out|get rid of|bin)\b/.test(t);
  const rewriteVerb = /\b(rewrite|reword|make|write|soften|warm|warmer|softer|shorter|longer|punchier|tighten|tone|voice|rephrase|less|more|emoji|casual|formal|friendlier|about)\b/.test(t);

  // 1) ADD — a blank draft (structural, free); "about X" adds an AI caption (counted).
  if (addVerb) {
    const anchor = posts[0] ? parseISO(posts[0].date) : new Date();
    const date = parseDestDate(t, anchor) ?? iso(anchor);
    const aboutM = raw.match(/\babout\b\s+(.+)$/i);
    const caption = aboutM && aboutM[1] ? aboutM[1].trim().replace(/[.?!]+$/, '') : undefined;
    return caption
      ? { kind: 'add', date, caption, summary: `Adding a post about ${caption}…` }
      : { kind: 'add', date, summary: 'Added a blank draft — tell Sprigly what it’s about to write the caption.' };
  }

  // 2) DELETE (structural)
  if (deleteVerb) {
    const targets = resolveTargets(t, posts, selectedId);
    if (!targets.length) return { kind: 'clarify', summary: 'Which post should I remove? Try “remove the Tuesday post”.' };
    return { kind: 'structural', actions: targets.map((p) => ({ type: 'delete' as const, postId: p.id })), summary: `Removed ${list(targets)}.` };
  }

  // 3) MOVE (structural) — needs both a target post and a destination date.
  if (moveVerb || (/\bto\b/.test(t) && !hasFormat)) {
    const beforeTo = t.split(/\bto\b/)[0] ?? t;
    const targets = resolveTargets(beforeTo, posts, selectedId);
    if (targets.length) {
      const actions: StructuralAction[] = [];
      for (const p of targets) {
        const dest = parseDestDate(t, parseISO(p.date));
        if (dest) actions.push({ type: 'patch', postId: p.id, patch: { date: dest } });
      }
      if (actions.length) return { kind: 'structural', actions, summary: `Moved ${list(targets)}.` };
      return { kind: 'clarify', summary: 'Move it to when? Try “move the Tuesday post to Friday”.' };
    }
    if (moveVerb) return { kind: 'clarify', summary: 'Which post should I move? Try “move the Tuesday post to Friday”.' };
  }

  // 4) FORMAT (structural) — a format word + a change verb. "change the reel to a
  // carousel": DESTINATION format comes from the "to …" side; the TARGET is resolved
  // from the "before to" side (which may itself name a format, e.g. "the reel").
  if (hasFormat && /\b(make|change|turn|switch|convert|set|into|to)\b/.test(t)) {
    const parts = t.split(/\binto\b|\bto\b/);
    const beforeTo = parts[0] ?? t;
    const afterTo  = parts.length > 1 ? parts.slice(1).join(' ') : t;
    const destKey = Object.keys(FORMAT_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(afterTo))
      ?? [...Object.keys(FORMAT_WORDS)].reverse().find((w) => new RegExp(`\\b${w}\\b`).test(t));
    const format = destKey ? FORMAT_WORDS[destKey] : undefined;
    if (!format) return { kind: 'clarify', summary: 'Which format? Try “change the Tuesday post to a carousel”.' };

    let targets = resolveTargets(beforeTo, posts, selectedId);
    if (!targets.length) targets = resolveTargets(t, posts, selectedId);
    if (!targets.length && selectedId) { const sel = posts.find((p) => p.id === selectedId); if (sel) targets = [sel]; }
    if (!targets.length) return { kind: 'clarify', summary: `Which post should become a ${format}? Try “change the Tuesday post to a ${format}”.` };
    return { kind: 'structural', actions: targets.map((p) => ({ type: 'patch' as const, postId: p.id, patch: { format } })), summary: `Changed ${list(targets)} to ${format}.` };
  }

  // 5) REWRITE (AI — counted). Resolve targets; unspecified plural verbs default to all.
  if (rewriteVerb) {
    let targets = resolveTargets(t, posts, selectedId);
    if (!targets.length && /\b(them|they|these|those|all)\b/.test(t)) targets = posts;
    if (!targets.length && selectedId) { const sel = posts.find((p) => p.id === selectedId); if (sel) targets = [sel]; }
    if (!targets.length) return { kind: 'clarify', summary: 'Which posts should I rewrite? Try “make the Tuesday post warmer” or “make them all warmer”.' };
    return { kind: 'rewrite', targetPostIds: targets.map((p) => p.id), instruction: raw, summary: `Sprigly is rewriting ${list(targets)}…` };
  }

  // 6) Unclear — ask rather than spend.
  return { kind: 'clarify', summary: 'I can move, reformat, add, remove, or rewrite posts. Try “move the Tuesday post to Friday” or “make them all warmer”.' };
}
