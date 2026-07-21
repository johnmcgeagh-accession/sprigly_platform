/**
 * editor.test.tsx — the planning-config editor against the REAL config shapes in prod and uat.
 *
 * Fixtures below are the actual stored rows, read read-only:
 *   ivy-t (prod + uat) — complete: 7 pillars, full cadence, all 5 posting-time slots
 *   earl-of-east (uat) — posting_times is literally `{}`
 * plus the shapes the page can synthesise (`?? {}` / `?? []` when no row exists).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./actions', () => ({ upsertPlanningConfig: async () => ({ ok: true }) }));

import { PlanningConfigEditor, pillarToState, stateToPillar, type InitialPlanningConfig } from './editor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const pillar = (name: string, over: Record<string, unknown> = {}) => ({
  name, tagline: `${name} tagline`,
  keyMessages:  ['a', 'b'],
  contentIdeas: ['c', 'd'],
  ...over,
});

/** ivy-t, exactly as stored on prod AND uat. */
const IVY_T: InitialPlanningConfig = {
  pillars: [
    'Simplify Your Morning', 'Born From Real Need', 'Stable Foundations',
    'Ethical Without Compromise', 'Understands Real Women', 'Personal Relationships',
    'A Supportive Friend, Always By Your Side',
  ].map((n) => pillar(n)) as Any,
  competitors: ['organicbasics', 'withnothingunderneath'],
  cadence: { postsPerMonthMin: 16, postsPerMonthMax: 20, minPerWeek: 3, maxPerWeek: 5 },
  recurringSeries: [
    { name: 'Sunday Style', dayOfWeek: 'Sunday', time: '8pm', format: 'Carousel', whoPosts: 'Sprigly' },
  ] as Any,
  postingTimes: { launch: '6am', morning: '7am', evening: '7pm', wsg: '6pm', sundayStyle: '8pm' },
  categories: ['Styling', 'WSG'],
};

/** earl-of-east on uat: posting_times is `{}`. */
const EARL: InitialPlanningConfig = {
  ...IVY_T,
  pillars: ['Product & Fragrance', 'Everyday Ritual'].map((n) => pillar(n)) as Any,
  cadence: { postsPerMonthMin: 12, postsPerMonthMax: 15, minPerWeek: 3, maxPerWeek: 4 },
  recurringSeries: [],
  postingTimes: {} as Any,
};

/** What page.tsx synthesises when there is NO config row (`?? {}` / `?? []`). */
const NO_ROW: InitialPlanningConfig = {
  pillars: [], competitors: [], cadence: {} as Any,
  recurringSeries: [], postingTimes: {} as Any, categories: [],
};

const render = (initial: InitialPlanningConfig) =>
  renderToStaticMarkup(
    <PlanningConfigEditor clientId="c1" clientName="Test" channel="instagram" initial={initial} />,
  );

describe('PlanningConfigEditor — real stored shapes', () => {
  it('renders ivy-t (prod + uat) — the complete shape', () => {
    expect(() => render(IVY_T)).not.toThrow();
    expect(render(IVY_T)).toContain('Posting cadence');
  });

  it('renders earl-of-east (uat) — posting_times {}', () => {
    expect(() => render(EARL)).not.toThrow();
  });

  it('renders a client with NO config row at all', () => {
    expect(() => render(NO_ROW)).not.toThrow();
  });
});

describe('PlanningConfigEditor — degraded pillar shapes', () => {
  it('a pillar missing keyMessages does not crash the page', () => {
    const initial = { ...IVY_T, pillars: [pillar('X', { keyMessages: undefined })] as Any };
    expect(() => render(initial)).not.toThrow();
  });

  it('a pillar missing contentIdeas does not crash the page', () => {
    const initial = { ...IVY_T, pillars: [pillar('X', { contentIdeas: undefined })] as Any };
    expect(() => render(initial)).not.toThrow();
  });

  it('a pillar that is only a name — the minimum any arc could write', () => {
    const initial = { ...IVY_T, pillars: [{ name: 'Bare' }] as Any };
    expect(() => render(initial)).not.toThrow();
  });

  it('a recurring series missing optional fields does not crash', () => {
    const initial = { ...IVY_T, recurringSeries: [{ name: 'S' }] as Any };
    expect(() => render(initial)).not.toThrow();
  });
});

describe('PlanningConfigEditor — sharePct round-trip', () => {
  it('a pillar carrying sharePct renders (post-Build-A shape is real too)', () => {
    const initial = { ...IVY_T, pillars: [pillar('X', { sharePct: 20 })] as Any };
    expect(() => render(initial)).not.toThrow();
  });
});

// ── sharePct must survive the edit round-trip ────────────────────────────────
// Onboarding persists a share-of-posts percentage per pillar (onboard.ts:361-365). This
// panel has no field for it, so before the guard the first save of an onboarded client
// silently deleted every one. Both shapes are real and neither may be invented or destroyed.

describe('pillar round-trip', () => {
  it('preserves sharePct when the stored pillar has one (onboarded shape)', () => {
    const withShare = { name: 'X', tagline: 't', keyMessages: ['a'], contentIdeas: ['c'], sharePct: 22 };
    expect(stateToPillar(pillarToState(withShare as Any))).toEqual(withShare);
  });

  it('does NOT invent sharePct when the stored pillar has none (ivy-t shape)', () => {
    const noShare = { name: 'X', tagline: 't', keyMessages: ['a'], contentIdeas: ['c'] };
    const out = stateToPillar(pillarToState(noShare as Any)) as unknown as Record<string, unknown>;
    expect(out).toEqual(noShare);
    expect('sharePct' in out).toBe(false);
  });

  it('a degraded pillar normalises to empty, not to invented content', () => {
    const out = stateToPillar(pillarToState({ name: 'Bare' } as Any)) as unknown as Record<string, unknown>;
    expect(out).toEqual({ name: 'Bare', tagline: '', keyMessages: [], contentIdeas: [] });
  });

  it('ignores a non-numeric sharePct rather than passing junk through', () => {
    const out = stateToPillar(pillarToState({ name: 'X', tagline: '', keyMessages: [], contentIdeas: [], sharePct: 'lots' } as Any)) as unknown as Record<string, unknown>;
    expect('sharePct' in out).toBe(false);
  });
});
