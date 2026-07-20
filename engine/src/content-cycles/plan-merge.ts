/**
 * plan-merge.ts — edit-aware merge classifier for regen (Phase 1: pure, no writes).
 *
 * Model: EDITS WIN, REST REPLACED. On regen of a cycle that has client work, posts
 * the client edited/authored are PRESERVED (and flagged for review); every un-edited
 * post is replaced by the new plan. This classifier decides, per EXISTING post,
 * whether it is preserved / dropped / replaced — it performs NO database work and
 * makes NO writes. The write step (delete only the 'replace' + 'drop' sets, keep the
 * 'preserve' set, insert the new plan as 'regenerated') is a later, gated phase.
 *
 * Why preservation, not FK cascade: the old blind delete-all hit the
 * post_edits → content_cycle_posts foreign key. The fix is to never delete a post
 * that carries client work (all of which are post_edits-referenced here), not to
 * make the FK cascade — cascading would destroy the very edits we must keep.
 */

export type ReviewState = 'preserved_edit' | 'preserved_edit_orphan' | 'regenerated';

/** The minimal shape of an existing content_cycle_posts row the merge needs. */
export interface ExistingPost {
  id:            string;
  scheduledDate: string;                        // 'YYYY-MM-DD'
  status:        string;                        // 'planned' | 'edited' | 'new'
  caption:       string | null;
  title:         string;                        // source_meta.title (may be '')
  hasPostEdit:   boolean;                        // referenced by a post_edits row
  // Generated Stage-6 work living on the row (Build D fix). A hook was CHOSEN by the
  // client from candidates; a script cost a Bedrock call. Neither leaves a post_edits
  // row, so without these flags the merge could not see them at all.
  hasHook:       boolean;
  hasScript:     boolean;
}

export interface PreserveDecision {
  post:        ExistingPost;
  reviewState: 'preserved_edit' | 'preserved_edit_orphan';
  orphaned:    boolean;                          // names a product not anywhere in the brief
  products:    string[];                         // catalogue products named in the post
  reason:      string;
}
export interface PlainDecision { post: ExistingPost; reason: string; }

export interface MergeDecision {
  preserve: PreserveDecision[];   // kept from the client's prior work, flagged for review
  drop:     PlainDecision[];      // disposable empty placeholders (no client content)
  replace:  PlainDecision[];      // un-edited posts — removed, the new plan fills their place
}

// The app writes this exact text into an added-but-unfilled draft slot.
const PLACEHOLDER_PREFIX = 'Draft idea — tell Sprigly';

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** An empty draft placeholder: a 'new' post with no real caption and no client edit.
 *  Disposable — safe to drop (never post_edits-referenced). */
export function isEmptyPlaceholder(p: ExistingPost): boolean {
  if (p.status !== 'new' || p.hasPostEdit) return false;
  // A slot carrying a generated hook or script is not empty, whatever its caption says.
  if (p.hasHook || p.hasScript) return false;
  const cap = (p.caption ?? '').trim();
  return cap.length === 0 || cap.startsWith(PLACEHOLDER_PREFIX);
}

/** Protected = carries client work: referenced by post_edits, OR an edited post, OR a
 *  new post with real content, OR a generated hook/script.
 *  Everything protected is PRESERVED (never deleted).
 *
 *  THE HOOK/SCRIPT CASE (Phase 0 found this latent; Build D fixes it). A post can carry a
 *  hook the client picked from candidates, and a script that cost a Bedrock call, while
 *  being status='planned' with no post_edits row — because neither generation writes one.
 *  Such a post was therefore unprotected, fell into `replace`, and a whole-plan regen
 *  DELETED it: the client silently lost work they had chosen and we had paid for, with
 *  nothing recording the loss. A hook is a client decision even though it leaves no edit
 *  row, and that is exactly what this clause encodes. */
export function isProtected(p: ExistingPost): boolean {
  if (p.hasPostEdit) return true;
  if (p.status === 'edited') return true;
  if (p.status === 'new' && !isEmptyPlaceholder(p)) return true;
  if (p.hasHook || p.hasScript) return true;
  return false;
}

/** Catalogue product names mentioned in a post's title + caption (whole-word).
 *
 * KNOWN REFINEMENT (do NOT rely on this for anything destructive): this is a plain
 * whole-word match, so it does not distinguish a product reference from a same-named
 * SIGN-OFF. "Sally" is both a catalogue product and the founder's sign-off
 * ("Love, Sally x"), so a founder post can match the product "sally". Today this
 * only ever OVER-flags a post for human review (orphan check), never deletes work —
 * and for the current cycle it resolves correctly because Sally is a briefed product.
 * Before this heuristic drives anything automatic, exclude sign-off / closing
 * contexts (and the founder's own name) from product detection. */
export function productsNamed(p: ExistingPost, catalogueNames: string[]): string[] {
  const text = `${p.title} ${p.caption ?? ''}`.toLowerCase();
  return catalogueNames.filter((n) => new RegExp('\\b' + escapeRe(n) + '\\b').test(text));
}

/** The catalogue names present ANYWHERE in the structured brief (products, schedule,
 *  content_asks, focus) — the "briefed universe" the orphan check tests against, so a
 *  post naming a briefed/scheduled product is not mis-flagged as orphaned. Shape is
 *  duck-typed to avoid a hard @sprigly/engine dependency in this pure module. */
export interface BriefLike {
  products?:     Array<{ product?: string | null }>;
  schedule?:     Array<{ product?: string | null }>;
  content_asks?: Array<{ product?: string | null }>;
  focus?:        string[];
}
export function briefedProductNames(brief: BriefLike | null | undefined, catalogueNames: string[]): string[] {
  if (!brief) return [];
  const strings: string[] = [];
  for (const p of brief.products ?? [])     if (p.product) strings.push(p.product);
  for (const b of brief.schedule ?? [])     if (b.product) strings.push(b.product);
  for (const a of brief.content_asks ?? []) if (a.product) strings.push(a.product);
  for (const f of brief.focus ?? [])        strings.push(f);
  const lower = strings.map((s) => s.toLowerCase());
  return catalogueNames.filter((n) => lower.some((s) => new RegExp('\\b' + escapeRe(n) + '\\b').test(s)));
}

export interface MergeInputs {
  existing:        ExistingPost[];
  briefedProducts: string[];   // catalogue names present ANYWHERE in the brief (products/schedule/asks/focus), lowercased
  catalogueNames:  string[];   // catalogue family names, lowercased (ambiguous/brand names excluded)
}

/**
 * Classify every existing post into preserve / drop / replace. A preserved post that
 * names a specific catalogue product, none of which is anywhere in the current brief,
 * is flagged 'preserved_edit_orphan' (theme no longer briefed) so a human decides —
 * it is neither silently carried forward as briefed nor silently dropped.
 */
export function mergePlan(inp: MergeInputs): MergeDecision {
  const briefed = new Set(inp.briefedProducts.map((s) => s.toLowerCase()));
  const dec: MergeDecision = { preserve: [], drop: [], replace: [] };

  for (const p of inp.existing) {
    if (isEmptyPlaceholder(p)) {
      dec.drop.push({ post: p, reason: 'empty draft placeholder — no client content, not post_edits-referenced' });
      continue;
    }
    if (!isProtected(p)) {
      dec.replace.push({ post: p, reason: `un-edited '${p.status}' post — replaced by the new plan` });
      continue;
    }
    const products = productsNamed(p, inp.catalogueNames);
    const orphaned = products.length > 0 && products.every((n) => !briefed.has(n));
    const briefedHere = products.filter((n) => briefed.has(n));
    dec.preserve.push({
      post: p,
      reviewState: orphaned ? 'preserved_edit_orphan' : 'preserved_edit',
      orphaned,
      products,
      reason: orphaned
        ? `client work; names ${products.join('/')}, which is NOT in the current brief — orphaned, needs a keep/remove decision`
        : products.length > 0
          ? `client work; names briefed ${briefedHere.join('/')}`
          : 'client work; no specific product (evergreen founder/brand post)',
    });
  }
  return dec;
}

/**
 * Slot-awareness for the write step (the recurrence fix for same-date duplicates).
 * A preserved edit OWNS its scheduled_date: the client kept that day's post, so the
 * regenerated plan must not also land a post on it. Given the incoming (regenerated)
 * rows and the preserve decisions, split the incoming rows into `kept` (dates the
 * client did NOT preserve — the regen fills these) and `dropped` (dates already owned
 * by a preserved edit). Pure — no writes, no logging; the caller logs each drop.
 */
export function dropCollidingInserts<T extends { scheduledDate: string }>(
  incoming:  T[],
  preserved: Array<{ post: { scheduledDate: string } }>,
): { kept: T[]; dropped: T[] } {
  const preservedDates = new Set(preserved.map((d) => d.post.scheduledDate));
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const row of incoming) {
    (preservedDates.has(row.scheduledDate) ? dropped : kept).push(row);
  }
  return { kept, dropped };
}
