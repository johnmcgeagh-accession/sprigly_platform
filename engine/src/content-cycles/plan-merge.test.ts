import { describe, it, expect } from 'vitest';
import { mergePlan, dropCollidingInserts, type ExistingPost } from './plan-merge.js';

// Minimal existing-post factory.
function ep(over: Partial<ExistingPost>): ExistingPost {
  return {
    id: over.id ?? 'x', scheduledDate: over.scheduledDate ?? '2026-06-01',
    status: over.status ?? 'planned', caption: over.caption ?? 'c',
    title: over.title ?? '', hasPostEdit: over.hasPostEdit ?? false,
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
