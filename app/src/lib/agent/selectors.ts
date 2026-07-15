/**
 * agent/selectors.ts — deterministic post-reference resolution + display
 * helpers, salvaged from the retired regex router. These are NOT a routing
 * mechanism: they only resolve a textual selector the task parser returned to a
 * concrete post id (server-side backstop when the parser didn't resolve it), and
 * format posts/dates for digests and proposal summaries.
 */
import type { PlanPost, PostFormat } from '../types';

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const FORMAT_WORDS: Record<string, PostFormat> = {
  reel: 'reel', reels: 'reel', video: 'reel',
  carousel: 'carousel', carousels: 'carousel', gallery: 'carousel',
  single: 'single', image: 'single', photo: 'single',
};

const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Generic reference words stripped before caption matching, so "the Mabel post"
// keys on "mabel" and a filler word like "post" can't drag in every caption. Format
// nouns are here too — those are handled by the format branch above; if they reach the
// caption fallback they didn't identify a post, so they must not match caption prose.
const SELECTOR_STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'your', 'their',
  'post', 'posts', 'one', 'ones', 'its', 'for', 'and', 'about', 'with', 'please',
  'reel', 'reels', 'video', 'carousel', 'carousels', 'gallery', 'image', 'images',
  'photo', 'photos', 'single',
]);

/** 'YYYY-MM-DD' → local Date (avoid UTC day-shift). */
export function parseISO(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, day || 1);
}

/** 'YYYY-MM-DD' → 'Thu 12 Mar'. */
export function fmtDate(isoStr: string): string {
  const d = parseISO(isoStr);
  return `${WK[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A short human title for a post: first line of the caption, else the pillar. */
export function postTitle(p: Pick<PlanPost, 'caption' | 'pillar'>): string {
  const firstLine = (p.caption ?? '').split(/\n/)[0]?.trim() ?? '';
  const base = firstLine || (p.pillar ?? '').trim() || 'post';
  return base.length > 44 ? `${base.slice(0, 43)}…` : base;
}

/** Candidate posts a textual reference could mean: weekday, day-number, a format
 *  noun, or a pillar keyword. Returns all matches (0, 1, or many). */
export function resolveTargets(text: string, posts: PlanPost[]): PlanPost[] {
  const t = text.toLowerCase();

  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const hits = posts.filter((p) => parseISO(p.date).getDay() === dow);
      if (hits.length) return hits;
    }
  }
  const dayM = t.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dayM) {
    const day = Number(dayM[1] ?? 0);
    const hits = posts.filter((p) => parseISO(p.date).getDate() === day);
    if (hits.length) return hits;
  }
  for (const [w, fmt] of Object.entries(FORMAT_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) {
      const hits = posts.filter((p) => p.format === fmt);
      if (hits.length) return hits;
    }
  }
  const pillarWords = Array.from(new Set(
    posts.map((p) => (p.pillar || '').toLowerCase().split(/\s+/)[0] ?? '').filter((w) => w.length >= 3),
  ));
  for (const w of pillarWords) {
    if (new RegExp(`\\b${w}\\b`).test(t)) {
      const hits = posts.filter((p) => (p.pillar || '').toLowerCase().startsWith(w));
      if (hits.length) return hits;
    }
  }
  // Last-resort fallback: a distinctive word from the reference (e.g. a product name
  // like "Mabel") matched against post CAPTION text, since products live in the caption
  // — not the pillar. Only reached when every branch above found nothing, so references
  // that already resolve are unchanged. Each significant reference token is tried in
  // order; the first token with hits wins, and its FULL hit set is returned — so a
  // caption word matching two posts still returns both, and resolvePostSelector() nulls
  // on ambiguity rather than guessing.
  const captionTokens = Array.from(new Set(
    t.split(/\W+/).filter((w) => w.length >= 3 && !SELECTOR_STOPWORDS.has(w)),
  ));
  for (const w of captionTokens) {
    const re = new RegExp(`\\b${w}\\b`);
    const hits = posts.filter((p) => re.test((p.caption || '').toLowerCase()));
    if (hits.length) return hits;
  }
  return [];
}

/**
 * Resolve a textual post reference to exactly one post id. Returns null when the
 * reference matches zero or more than one post — the caller turns that into a
 * clarify task (an ambiguous reference must never guess).
 */
export function resolvePostSelector(selector: string, posts: PlanPost[]): string | null {
  const hits = resolveTargets(selector, posts);
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * Resolve a MOVE's source post from what the parser produced. Tries, in order: the model's postId
 * (only if it actually matches a post — the model can't reliably copy 36-char ids); the parsed
 * SOURCE DATE (`fromDate`, the reliable deterministic key); then the raw selector phrase. Returns
 * the single post, an AMBIGUOUS set (several posts on the named date, for the caller to list), or
 * null (genuinely not found). This is the layer that makes "move the post on the 1st" work even
 * when the id round-trips imperfectly.
 */
export type MoveSource = { post: PlanPost } | { ambiguous: PlanPost[] } | null;
export function resolveMoveSource(ref: { postId?: string | null; fromDate?: string | null; selector?: string | null }, posts: PlanPost[]): MoveSource {
  if (ref.postId) { const p = posts.find((x) => x.id === ref.postId); if (p) return { post: p }; }
  if (ref.fromDate) { const on = posts.filter((p) => p.date === ref.fromDate); if (on.length === 1) return { post: on[0]! }; if (on.length > 1) return { ambiguous: on }; }
  if (ref.selector) { const hits = resolveTargets(ref.selector, posts); if (hits.length === 1) return { post: hits[0]! }; if (hits.length > 1) return { ambiguous: hits }; }
  return null;
}
