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

/** The full scaffolding sentence `addDraft` writes. Restated here rather than imported: this
 *  module is client-side and `@sprigly/db` is not. The PREFIX above is what actually matches, so
 *  the two cannot drift apart in a way that matters. */
export const PLACEHOLDER_CAPTION =
  'Draft idea. Tell Sprigly what this post should be about and it’ll write the caption.';

/**
 * The caption, or '' when there isn't one — INCLUDING when the row holds the placeholder.
 *
 * `addDraft` writes `DRAFT_PLACEHOLDER_CAPTION` into the caption column, and that string is
 * scaffolding rather than content. The data model already treats it as absent: the merge
 * classifier matches its prefix, and `cardText` has stripped it since it was written.
 *
 * The detail sheet did NOT, which is the whole of the fresh-reel bug. It asked `!!post.caption`,
 * saw a non-empty string, showed three tabs with our own sentence in the first one, and left the
 * Script tab's Generate offer live — so a client could have a hook and a script written with the
 * placeholder as their subject. One predicate now, and every surface asks it.
 */
export function realCaption(post: Pick<PlanPost, 'caption'>): string {
  const caption = (post.caption ?? '').trim();
  return caption && !caption.startsWith(DRAFT_PREFIX) ? caption : '';
}

export function cardText(post: Pick<PlanPost, 'title' | 'caption'>): CardText {
  const usable = realCaption(post);
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
