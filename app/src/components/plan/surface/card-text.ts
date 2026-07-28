/**
 * card-text.ts — what a card's heading and its teaser say, and why they are never the same.
 *
 * There is no dedicated title column on a post. `postTitle` has always derived one from the
 * caption's first sentence, which was fine on a surface that showed a title OR a caption. This
 * one shows both — heading, then a two-line excerpt — and naively that renders the opening
 * sentence twice, once as a heading and again as the first line under it.
 *
 * Two sources, in order:
 *
 *   1. `source_meta.title`, the slot title the assembler wrote ('Wilderness candle relaunch —
 *      Launch', or its deterministic 'Pillar — Format' fallback). It is a real, different
 *      thing from the caption, so the excerpt can be the caption from the top.
 *   2. Failing that, the caption's first sentence — in which case the excerpt starts AFTER it,
 *      because the heading has already said it.
 *
 * A post whose whole caption is one sentence therefore gets a heading and no teaser, which is
 * correct: there is nothing else to show, and a repeated line reads as a rendering fault.
 */
import type { PlanPost } from '@/lib/types';

/** Where a card's heading came from — the excerpt rule depends on it. */
export type HeadingSource = 'slot' | 'caption' | 'none';

export interface CardText {
  heading: string;
  source: HeadingSource;
  /** The excerpt under the heading. Empty means render nothing, not a placeholder. */
  teaser: string;
}

const DRAFT_PREFIX = 'Draft idea';
/** Sentence boundary: a terminator followed by whitespace. */
const SENTENCE = /(?<=[.!?])\s+/;

export function cardText(post: Pick<PlanPost, 'title' | 'caption'>): CardText {
  const caption = (post.caption ?? '').trim();
  const usable = caption && !caption.startsWith(DRAFT_PREFIX) ? caption : '';
  const slot = (post.title ?? '').trim();

  if (slot) return { heading: slot, source: 'slot', teaser: usable };
  if (!usable) return { heading: 'Untitled', source: 'none', teaser: '' };

  const [first, ...rest] = usable.split(SENTENCE);
  return {
    heading: first!.slice(0, 90),
    source: 'caption',
    // The heading already said the first sentence; the teaser picks up from the second.
    teaser: rest.join(' ').trim(),
  };
}
