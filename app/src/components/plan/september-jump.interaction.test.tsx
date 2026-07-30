/**
 * @vitest-environment jsdom
 *
 * september-jump.interaction.test.tsx — the reproduction harness for the month jump.
 *
 * Round 3 of a bug that has survived two fixes, so this drives the REAL stack — `PlanRoot`,
 * the real `usePlanData`, the real surface — with only the network faked. The two earlier
 * fixtures tested the surface in isolation with a hand-built `PlanData`, which is precisely
 * why they could not see a mover that lives in the hook or the root.
 *
 * The client stands on AUGUST; SEPTEMBER exists as the next cycle. Anything that ends the run
 * on September is the bug, and `navTrace` names who did it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { PlanRoot } from './PlanRoot';
import { navTraceEntries, navTraceClear } from './nav-trace';
import { resetNavSnapshot } from './nav-state';
import type { PlanDataInit } from './usePlanData';
import type { PlanPost } from '@/lib/types';

const TODAY = '2026-07-30';
const AUG = 'cyc-aug';
const SEP = 'cyc-sep';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p-aug-14', cycleId: AUG, clientId: 'c1', channel: 'instagram',
  date: '2026-08-14', format: 'reel', pillar: 'Style',
  caption: 'Weekend Style Guide', status: 'planned', reviewState: null, steps: [], postingTime: '07:00',
  ...over,
});

const AUG_POSTS = [post(), post({ id: 'p-aug-21', date: '2026-08-21', caption: 'The restock' })];

function init(over: Partial<PlanDataInit> = {}): PlanDataInit {
  return {
    posts: AUG_POSTS, crossMonthPosts: [], beats: [],
    cycles: [
      { cycleId: AUG, displayMonth: '2026-08', monthLabel: 'August 2026', prePlanning: false },
      { cycleId: SEP, displayMonth: '2026-09', monthLabel: 'September 2026', prePlanning: false },
    ] as PlanDataInit['cycles'],
    homeCycleId: AUG,
    initialViewedCycleId: AUG,
    today: TODAY,
    clientName: 'ivy-t',
    questions: [],
    intake: { answers: {}, freeNotes: '' },
    durable: [],
    ...over,
  } as PlanDataInit;
}

/** Every network call the surface makes, answered plausibly and RECORDED. */
function stubNetwork(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
    const u = String(url);
    calls.push(`${opts?.method ?? 'GET'} ${u}`);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (u.startsWith('/api/plan/proposals')) {
      if (u.endsWith('/approve')) return json({ proposal: { id: 'pr1', status: 'applied' }, changedPostIds: ['p-aug-14'] });
      if (u.endsWith('/reject')) return json({ proposal: { id: 'pr1', status: 'rejected' } });
      return json({ proposals: [] });
    }
    if (u.startsWith('/api/plan/conversation')) return json({ conversationId: null, turns: [] });
    if (u.startsWith('/api/plan/changes')) return json({ changes: [] });
    if (u.startsWith('/api/plan/notes')) return json({ notes: [] });
    if (u.startsWith('/api/plan/weather')) return json({ forecast: [] });
    if (u.startsWith('/api/plan/events')) return json({});
    if (u.startsWith('/api/plan/agent')) {
      return json({
        conversationId: 'conv-1', message: '',
        proposals: [{ id: 'pr1', intent: 'move_post', summary: 's', status: 'pending', changeSetId: 'cs1' }],
        items: [{ kind: 'change', proposalId: 'pr1', action: 'move', title: 'Weekend Style Guide', fromDate: '2026-08-14', toDate: '2026-08-21' }],
        changeSetId: 'cs1',
      });
    }
    // THE REFETCH. `over.plan` lets a case answer it the way the real route would in that
    // case — which is the whole point of the harness.
    if (u.startsWith('/api/plan')) return json((over['plan'] as object) ?? { posts: AUG_POSTS, crossMonthPosts: [], beats: [] });
    return json({});
  }));
  return calls;
}

const monthTitle = () => screen.getByTestId('month-title').textContent;
const panelDate = () => screen.getByTestId('day-panel')?.getAttribute('data-date');
/** The trace, as the operator would read it off `?nav=trace`. */
const trace = () => navTraceEntries().map((e) => `${e.ev}${e.detail ? ` ${e.detail}` : ''}${e.from ? ` ← ${e.from}` : ''}`);

beforeEach(() => {
  window.innerWidth = 390;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.sessionStorage.setItem('sprigly:nav-trace', '1');   // arm the instrument
  navTraceClear();
  resetNavSnapshot();   // each test is its own page load
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  stubNetwork();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Mount and let the mount-time effects (proposals, notes, changes, restore) settle. */
async function mount(over: Partial<PlanDataInit> = {}) {
  const r = render(<PlanRoot {...init(over)} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return r;
}

describe('the surface lands on the month it was given', () => {
  it('August in, August on screen', async () => {
    await mount();
    expect(monthTitle()).toBe('August 2026');
    expect(panelDate()).toBe('2026-08-14');   // today is 30 Jul, so the month anchors on its first post
  });
});

describe('THE REPRODUCTION: a sheet apply, its refetch, and where the client ends up', () => {
  it('applying from the sheet leaves the month and the day exactly where they were', async () => {
    await mount();
    const day = screen.getAllByTestId('week-day').find((d) => d.getAttribute('data-date') === '2026-08-14');
    if (day) fireEvent.click(day);

    fireEvent.click(screen.getByTestId('nav-mic'));
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'move it to the 21st' } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });

    const before = panelDate();
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    // …and let the refetch chain that follows the approve settle completely.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(monthTitle(), `month moved — trace:\n${trace().join('\n')}`).toBe('August 2026');
    expect(panelDate(), `day moved — trace:\n${trace().join('\n')}`).toBe(before);
  });

  /**
   * THE CASE THE HARNESS EXISTS FOR. `usePlanData.refreshPlan` asks for `/api/plan` with NO
   * cycleId when the viewed cycle IS the home cycle — and that route serves `session.cycleId`.
   * If the two ever disagree, the refetch returns ANOTHER MONTH'S POSTS into this month's view.
   */
  it('a refetch that answers with another month’s posts must not drag the surface into that month', async () => {
    stubNetwork({
      plan: {
        posts: [post({ id: 'p-sep-04', cycleId: SEP, date: '2026-09-04', caption: 'Autumn layers' })],
        crossMonthPosts: [], beats: [],
      },
    });
    await mount();
    fireEvent.click(screen.getByTestId('nav-mic'));
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'move it' } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(monthTitle(), `trace:\n${trace().join('\n')}`).toBe('August 2026');
    expect(panelDate()?.slice(0, 7), `trace:\n${trace().join('\n')}`).toBe('2026-08');
  });
});

describe('the session restore, which the harness caught doing nothing at all', () => {
  /**
   * THE HARNESS'S FIRST FINDING, and it is about the LAST fix rather than this one.
   *
   * F2 gave the tab's stored position priority over the server's landing, for the reload nobody
   * pressed. It had never once fired. React runs CHILD effects before PARENT effects, so
   * `CommittedSurface`'s `saveNavState` overwrote the stored position with the month the server
   * had just landed on — and `PlanRoot`'s restore then read it back, found it equal to the
   * viewed cycle, and returned. The writer beat the reader to the same key, every mount, and
   * the trace said so: `select mount` and `land mount` present, `cycle restore:session` absent.
   *
   * `nav-state.ts` now snapshots the inherited position at module load — before any component
   * has mounted, let alone saved — and `readNavState` serves that.
   */
  it('a stored SEPTEMBER position now restores — the read is snapshotted before any save', async () => {
    window.sessionStorage.setItem('sprigly:nav-state', JSON.stringify({ cycleId: SEP, selected: '2026-09-04', view: 'day' }));
    await mount();
    expect(trace().some((l) => l.includes('restore:session')), `trace:\n${trace().join('\n')}`).toBe(true);
    expect(monthTitle()).toBe('September 2026');
  });

  it('and an unchanged position does not restore over itself', async () => {
    window.sessionStorage.setItem('sprigly:nav-state', JSON.stringify({ cycleId: AUG, selected: '2026-08-14', view: 'day' }));
    await mount();
    expect(trace().some((l) => l.includes('restore:session'))).toBe(false);
    expect(monthTitle()).toBe('August 2026');
  });
});

describe('THE MOVER: the week strip leaves the month on a swipe', () => {
  /**
   * `canPage` is the rule the CHEVRONS obey — a week with no day of the viewed month is not
   * reachable, because past that edge the strip renders seven days whose posts are not loaded.
   * The SWIPE has never obeyed it (`WeekStrip.tsx`, `onPointerUp` → `onSelect(addDays(±7))`),
   * and neither did the arrow keys. From the last week of August one page forward is September:
   * the day header reads *Friday 4 September*, the week is empty because September's posts
   * belong to a cycle that was never fetched, and the month title still says August.
   *
   * That is the report, exactly: the plan jumped to September and the posts went with it.
   */
  const swipe = (dx: number) => {
    const strip = screen.getByTestId('week-strip');
    fireEvent.pointerDown(strip, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(strip, { clientX: 200 + dx, clientY: 100 });
  };

  /**
   * THE CHEVRON DOES IT TOO, and it is the plainest reproduction there is: three taps on a
   * visible, ENABLED control walks the client out of the month. `canPage` asks whether the
   * WEEK it would land on overlaps the viewed month — the week of Mon 31 Aug does, because it
   * contains 31 August — and then `page()` sets the DAY seven days on, which is 4 September.
   * The guard tests one thing and the action does another.
   */
  it('paging forward off the end of August must not land the DAY in September', async () => {
    await mount();                                          // selected = 14 Aug
    fireEvent.click(screen.getByTestId('next-week'));       // 21 Aug
    fireEvent.click(screen.getByTestId('next-week'));       // 28 Aug
    expect(panelDate()).toBe('2026-08-28');
    fireEvent.click(screen.getByTestId('next-week'));       // ← the jump

    expect(panelDate()?.slice(0, 7), `trace:\n${trace().join('\n')}`).toBe('2026-08');
    expect(monthTitle()).toBe('August 2026');
  });

  it('a forward SWIPE from the last week of August is refused the same way', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('next-week'));       // 21 Aug
    fireEvent.click(screen.getByTestId('next-week'));       // 28 Aug
    swipe(-120);                                            // one more week forward
    expect(panelDate()?.slice(0, 7), `trace:\n${trace().join('\n')}`).toBe('2026-08');
  });

  it('a backward swipe out of the month is refused too', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('prev-week'));       // 7 Aug
    swipe(120);                                             // → week of 27 Jul
    expect(panelDate()?.slice(0, 7)).toBe('2026-08');
  });

  it('a swipe WITHIN the month still works — the fix is a clamp, not a lock', async () => {
    await mount();
    swipe(-120);
    expect(panelDate()).toBe('2026-08-21');
  });

  it('the arrow keys are clamped too — the same mover through a different control', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('next-week'));
    fireEvent.click(screen.getByTestId('next-week'));       // 28 Aug
    const strip = screen.getByTestId('week-strip');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(strip, { key: 'ArrowRight' });
    expect(panelDate()?.slice(0, 7)).toBe('2026-08');
    expect(panelDate()).toBe('2026-08-31');                 // clamped to the month's last day
  });
});
