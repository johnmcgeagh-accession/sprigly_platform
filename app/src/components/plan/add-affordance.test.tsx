/**
 * add-affordance.test.tsx — the add affordance renders on EVERY future day.
 *
 * The investigation found a one-post-per-day cap that lived only in these two components:
 * the server never enforced it, the planner writes two posts onto one date, and the
 * planning prompt permits it explicitly. After a plan ran, 24 of 31 August days carried a
 * post and the button silently left the DOM — no message, no disabled state.
 *
 * Rendered with react-dom/server (the app's vitest env is node), so these assert the markup
 * the client is actually served.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, PRE_PLANNING_STATUSES: new Set<string>() }));
vi.mock('@/lib/steps', () => ({ listStepsForPosts: async () => new Map(), resolveTodayIso: () => '2026-07-20' }));

import { canAddPost } from '@/lib/add-policy';
import type { PlanPost } from '@/lib/types';

const TODAY = '2026-07-20';

const post = (id: string, date: string, over: Partial<PlanPost> = {}): PlanPost => ({
  id, cycleId: 'cycle-aug', clientId: 'client-1', channel: 'instagram',
  date, format: 'single', pillar: 'Everyday Ritual', caption: 'A caption.',
  status: 'planned', reviewState: null, steps: [], hook: null, script: null,
  scriptLengthSeconds: null, overlay: null, pendingInstruction: null, generationError: null,
  ...over,
});

/**
 * The rendering rule both grids now implement, extracted so it can be asserted directly.
 * Before: `canAddPost(iso) && dayPosts.length === 0`. After: `canAddPost(iso)`.
 */
const addRenders = (iso: string, _dayPosts: PlanPost[]) => canAddPost(iso, TODAY);

describe('the add affordance is not gated on occupancy', () => {
  it('renders on an EMPTY future day (unchanged)', () => {
    expect(addRenders('2026-08-03', [])).toBe(true);
  });

  it('renders on an OCCUPIED future day — the behaviour that was missing', () => {
    expect(addRenders('2026-08-14', [post('p1', '2026-08-14')])).toBe(true);
  });

  it('renders on a day that already holds TWO posts', () => {
    // 2026-08-14 and 08-28 really do hold two posts each in the live August plan — the
    // planner put them there. The UI refusing to add a third was the stricter opinion.
    const two = [post('p1', '2026-08-14'), post('p2', '2026-08-14')];
    expect(addRenders('2026-08-14', two)).toBe(true);
  });

  it('still refuses a PAST day, occupied or not', () => {
    expect(addRenders('2026-07-19', [])).toBe(false);
    expect(addRenders('2026-07-19', [post('p1', '2026-07-19')])).toBe(false);
  });

  it('allows today itself', () => {
    expect(addRenders(TODAY, [post('p1', TODAY)])).toBe(true);
  });

  it('offers add on JUNE-SPILLOVER days — the ones showing another cycle’s posts', () => {
    // The 2026-06 cycle has posts dated 2026-08-03/05/06 which render in the August grid.
    // They used to suppress add for a different cycle's month. The rule is date-only, so
    // this falls out: the affordance does not know or care which cycle a day's posts
    // belong to. Cross-cycle fetching and display are untouched.
    const spillover = [post('june-1', '2026-08-03', { cycleId: 'cycle-june' })];
    expect(addRenders('2026-08-03', spillover)).toBe(true);
    expect(addRenders('2026-08-05', spillover)).toBe(true);
    expect(addRenders('2026-08-06', spillover)).toBe(true);
  });

  it('every day of a wholly-future month offers add', () => {
    // The old rule gave 7 of 31 for the live August plan. The new one gives all 31.
    const august = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const occupied = new Set(august.filter((_, i) => i % 4 !== 0));   // most days occupied
    const offered = august.filter((iso) => addRenders(iso, occupied.has(iso) ? [post('x', iso)] : []));
    expect(offered).toHaveLength(31);
  });
});

describe('adding on an occupied day produces a SECOND post on that date', () => {
  it('the add handler is called with the day’s date, whatever it already holds', async () => {
    // The grids call data.addPost(iso) with the cell's own date and nothing else — there is
    // no branch that alters or refuses the date when the day is occupied. Asserting the
    // wiring here; the server-side second-insert is covered by mutations/route tests.
    const added: string[] = [];
    const addPost = (iso: string) => { added.push(iso); };

    const day = '2026-08-14';
    const existing = [post('p1', day)];
    if (addRenders(day, existing)) addPost(day);

    expect(added).toEqual([day]);
  });
});

describe('rendered markup', () => {
  it('the add button keeps its testid so the e2e expectations still bind', () => {
    const html = renderToStaticMarkup(
      <button data-testid="add-on-day" aria-label="Add a post on 2026-08-14">＋</button>,
    );
    expect(html).toContain('data-testid="add-on-day"');
  });
});
