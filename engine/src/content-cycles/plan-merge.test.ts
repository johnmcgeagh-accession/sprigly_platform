import { describe, it, expect } from 'vitest';
import { mergePlan, dropCollidingInserts, isEmptyPlaceholder, type ExistingPost } from './plan-merge.js';
import { DRAFT_PLACEHOLDER_CAPTION, DRAFT_PLACEHOLDER_PREFIX } from '@sprigly/db';

// Minimal existing-post factory.
function ep(over: Partial<ExistingPost>): ExistingPost {
  return {
    id: over.id ?? 'x', scheduledDate: over.scheduledDate ?? '2026-06-01',
    status: over.status ?? 'planned', caption: over.caption ?? 'c',
    title: over.title ?? '', hasPostEdit: over.hasPostEdit ?? false,
    hasHook: over.hasHook ?? false, hasScript: over.hasScript ?? false,
  };
}

// Minimal incoming (regenerated) row — only scheduledDate matters to the helper.
function ins(id: string, scheduledDate: string) { return { id, scheduledDate }; }

describe('dropCollidingInserts — slot-aware merge (recurrence fix)', () => {
  it('regen over same-date edits produces ZERO same-date preserved/regenerated pairs', () => {
    // The client kept edits on 06-01 and 06-19; the fresh plan re-covers the whole
    // month INCLUDING those two dates. Slot-awareness must drop the two colliders.
    const dec = mergePlan({
      existing: [
        ep({ id: 'keep-0601', scheduledDate: '2026-06-01', status: 'edited', hasPostEdit: true }),
        ep({ id: 'keep-0619', scheduledDate: '2026-06-19', status: 'edited', hasPostEdit: true }),
      ],
      briefedProducts: [], catalogueNames: [],
    });
    expect(dec.preserve.map((d) => d.post.id).sort()).toEqual(['keep-0601', 'keep-0619']);

    const incoming = [
      ins('regen-0601', '2026-06-01'),   // collides → dropped
      ins('regen-0603', '2026-06-03'),
      ins('regen-0619', '2026-06-19'),   // collides → dropped
      ins('regen-0620', '2026-06-20'),
    ];
    const { kept, dropped } = dropCollidingInserts(incoming, dec.preserve);

    expect(dropped.map((r) => r.id).sort()).toEqual(['regen-0601', 'regen-0619']);
    expect(kept.map((r) => r.id).sort()).toEqual(['regen-0603', 'regen-0620']);

    // No preserved date survives in the insert set → zero same-date pairs.
    const preservedDates = new Set(dec.preserve.map((d) => d.post.scheduledDate));
    expect(kept.some((r) => preservedDates.has(r.scheduledDate))).toBe(false);
  });

  it('the 06-08-style non-colliding case still inserts (preserved edit on a date the plan does not reuse)', () => {
    // The client kept an edit on 06-08; the fresh plan places that theme on 06-09
    // instead — no collision, so every incoming row is inserted, and the 06-08 edit
    // is preserved alongside them (distinct dates, not a pair).
    const dec = mergePlan({
      existing: [ep({ id: 'keep-0608', scheduledDate: '2026-06-08', status: 'edited', hasPostEdit: true })],
      briefedProducts: [], catalogueNames: [],
    });
    const incoming = [ins('regen-0609', '2026-06-09'), ins('regen-0610', '2026-06-10')];
    const { kept, dropped } = dropCollidingInserts(incoming, dec.preserve);

    expect(dropped).toHaveLength(0);
    expect(kept.map((r) => r.id)).toEqual(['regen-0609', 'regen-0610']);
  });

  it('is a no-op when there are no preserved edits (full replace)', () => {
    const incoming = [ins('a', '2026-06-01'), ins('b', '2026-06-02')];
    const { kept, dropped } = dropCollidingInserts(incoming, []);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(2);
  });
});

describe('generated hook/script survives a whole-plan regeneration (Phase 0 latent bug)', () => {
  // The bug: a post carrying a generated hook and script, but NO post_edits row, is
  // neither 'edited' nor a non-empty 'new' post — so isProtected() was false, it fell
  // into `replace`, and the regen DELETED it. The client silently lost a hook they had
  // chosen and a script that cost a Bedrock call, with nothing recording the loss.
  const withHookAndScript = ep({
    id: 'reel-with-work', scheduledDate: '2026-06-10', status: 'planned',
    caption: 'A perfectly ordinary generated caption.',
    hasHook: true, hasScript: true,
  });

  it('PRESERVES a planned post that carries a generated hook', () => {
    const dec = mergePlan({
      existing: [ep({ id: 'plain', scheduledDate: '2026-06-02', status: 'planned' }),
                 ep({ id: 'hooked', scheduledDate: '2026-06-10', status: 'planned', hasHook: true })],
      briefedProducts: [], catalogueNames: [],
    });
    expect(dec.preserve.map((d) => d.post.id)).toContain('hooked');
    expect(dec.replace.map((d) => d.post.id)).not.toContain('hooked');
    // The un-hooked ordinary post is still replaceable — this must not preserve everything.
    expect(dec.replace.map((d) => d.post.id)).toContain('plain');
  });

  it('PRESERVES a planned post that carries a generated script', () => {
    const dec = mergePlan({
      existing: [ep({ id: 'scripted', scheduledDate: '2026-06-10', status: 'planned', hasScript: true })],
      briefedProducts: [], catalogueNames: [],
    });
    expect(dec.preserve.map((d) => d.post.id)).toContain('scripted');
  });

  it('never DROPS a post carrying generated work, even if it looks like a placeholder', () => {
    const dec = mergePlan({
      existing: [ep({ id: 'placeholder-but-hooked', status: 'new', caption: '', hasHook: true })],
      briefedProducts: [], catalogueNames: [],
    });
    expect(dec.drop.map((d) => d.post.id)).not.toContain('placeholder-but-hooked');
    expect(dec.preserve.map((d) => d.post.id)).toContain('placeholder-but-hooked');
  });

  it('preserves a post with BOTH, and nothing is lost across the merge', () => {
    const dec = mergePlan({ existing: [withHookAndScript], briefedProducts: [], catalogueNames: [] });
    const all = [...dec.preserve, ...dec.drop, ...dec.replace].map((d) => d.post.id);
    expect(all).toEqual(['reel-with-work']);          // accounted for exactly once
    expect(dec.preserve).toHaveLength(1);
  });
});

describe('placeholder classification — the writer and the classifier agree', () => {
  // The bug: plan-merge held its own PLACEHOLDER_PREFIX ('Draft idea \u2014 tell Sprigly',
  // em dash, lowercase "tell") while mutations.ts wrote 'Draft idea. Tell Sprigly ...'
  // (full stop, capital T). startsWith could never match, so an unfilled placeholder was
  // never classified disposable and survived a re-merge, contrary to the stated intent.
  // Both now consume one constant from @sprigly/db.

  it('THE FIX: the exact caption addDraft writes is classified disposable', () => {
    expect(isEmptyPlaceholder(ep({ id: 'unfilled', status: 'new', caption: DRAFT_PLACEHOLDER_CAPTION }))).toBe(true);
  });

  it('a placeholder post is DROPPED by the merge, not preserved', () => {
    const dec = mergePlan({
      existing: [ep({ id: 'unfilled', status: 'new', caption: DRAFT_PLACEHOLDER_CAPTION })],
      briefedProducts: [], catalogueNames: [],
    });
    expect(dec.drop.map((d) => d.post.id)).toEqual(['unfilled']);
    expect(dec.preserve).toHaveLength(0);
  });

  it('the prefix is genuinely a prefix of the caption — they cannot drift apart', () => {
    expect(DRAFT_PLACEHOLDER_CAPTION.startsWith(DRAFT_PLACEHOLDER_PREFIX)).toBe(true);
  });

  it('the OLD em-dash form is no longer matched \u2014 recorded, not accidental', () => {
    // One legacy dev row (2026-07-06) carries this; nothing writes it any more. It stops
    // being classified disposable, which is the honest outcome: the classifier now matches
    // what the app actually writes rather than a string that only ever existed in code.
    const legacy = ep({ id: 'legacy', status: 'new', caption: 'Draft idea \u2014 tell Sprigly what this post should be about' });
    expect(isEmptyPlaceholder(legacy)).toBe(false);
  });

  it('a post with a REAL caption is never treated as a placeholder', () => {
    expect(isEmptyPlaceholder(ep({ id: 'real', status: 'new', caption: 'A genuine caption about candles.' }))).toBe(false);
  });

  it('an empty caption is still disposable, as before', () => {
    expect(isEmptyPlaceholder(ep({ id: 'blank', status: 'new', caption: '' }))).toBe(true);
  });

  it('a placeholder carrying a generated hook is NOT disposable', () => {
    // The generated-work protection still wins: a chosen hook outranks a placeholder caption.
    expect(isEmptyPlaceholder(ep({ id: 'hooked', status: 'new', caption: DRAFT_PLACEHOLDER_CAPTION, hasHook: true }))).toBe(false);
  });
});
