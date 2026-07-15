/** cycle-state — the parser digest must cover the WHOLE cycle (plan month), not just this week,
 *  so an agent move-ask can resolve a source post that falls outside the current week. */
import { describe, it, expect, vi } from 'vitest';
// cycle-state imports loadPlanPosts (→ db) at module scope — mock both away for the pure digest.
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {} }));
vi.mock('../plan', () => ({ loadPlanPosts: async () => [] }));
import { cycleDigest, currentWeekPosts } from './cycle-state';

const P = (id: string, date: string) => ({ id, cycleId: 'c', clientId: 'cl', channel: 'instagram', date, format: 'reel', pillar: 'x', caption: `Post ${id}`, status: 'planned', reviewState: null, steps: [] }) as never;

describe('cycleDigest', () => {
  it('lists EVERY post in the cycle by date — including ones outside the current week', () => {
    const today = new Date('2026-08-18');                        // week of Aug 17–23
    const posts = [P('p-01', '2026-08-01'), P('p-18', '2026-08-18'), P('p-22', '2026-08-22')];
    // The old week digest would have hidden Aug 1 and Aug 22 (only Aug 18 is "this week").
    expect(currentWeekPosts(posts, today).map((p) => p.id)).toEqual(['p-18', 'p-22']);
    const digest = cycleDigest(posts);
    expect(digest).toContain('id=p-01');   // the source post is now visible to the parser
    expect(digest).toContain('id=p-18');
    expect(digest).toContain('id=p-22');
    expect(digest).not.toContain('this week');
  });
  it('empty cycle → a neutral message (no "this week")', () => {
    expect(cycleDigest([])).toBe('(no posts in this plan yet)');
  });
});
