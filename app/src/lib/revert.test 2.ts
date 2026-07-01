import { describe, it, expect } from 'vitest';
import { resolveRevert, type RevertableRow } from './revert';

describe('resolveRevert — baseline preserved across reshapes', () => {
  const ORIGINAL = { caption: 'The original generated caption.', format: 'single', pillar: 'Product', scheduledDate: '2026-09-14', position: 3 };
  // A regen/edit only writes caption + status; it NEVER touches source_meta, so the
  // original baseline survives any number of reshapes. Model that here.
  const reshapedRow = (caption: string, status = 'edited'): RevertableRow => ({
    status, caption, format: 'single', pillar: 'Product', scheduledDate: '2026-09-14', position: 3,
    sourceMeta: { original: ORIGINAL, title: 'X' },
  });

  it('two successive reshapes → revert lands on the TRUE original, not the last rewrite', () => {
    // reshape 1 → 'first rewrite', reshape 2 → 'the SECOND rewrite'; source_meta intact.
    const d = resolveRevert(reshapedRow('the SECOND rewrite'));
    expect(d.action).toBe('restore');
    if (d.action === 'restore') {
      expect(d.values.caption).toBe('The original generated caption.'); // not the rewrite
      expect(d.values.status).toBe('planned');
      expect(d.values.scheduledDate).toBe('2026-09-14');
      expect(d.values.position).toBe(3);
    }
  });

  it('an added draft reverts by removal', () => {
    expect(resolveRevert(reshapedRow('whatever', 'new')).action).toBe('remove');
  });

  it('no baseline snapshot → clears the edited flag only', () => {
    const row: RevertableRow = { status: 'edited', caption: 'x', format: 'single', pillar: 'P', scheduledDate: '2026-09-01', position: 0, sourceMeta: { title: 'no original' } };
    expect(resolveRevert(row).action).toBe('clear');
  });
});
