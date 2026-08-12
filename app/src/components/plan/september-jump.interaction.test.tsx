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
    intake: { answers: {}, freeNotes: '' }, savedExtraction: null,
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

/**
 * ── THE INSTRUMENT, ARMABLE ON THE DEVICE (round 4) ──────────────────────────────────
 *
 * `?nav=trace` is an instruction to retype a magic-link URL on a phone, which by definition
 * happens after the session the operator wanted to watch. Three taps on the wordmark arm it in
 * place, and the panel appears on the third tap rather than on the next navigation.
 */
describe('the nav trace can be armed from the surface', () => {
  const tapWordmark = (n: number) => {
    const w = screen.getByTestId('wordmark');
    for (let i = 0; i < n; i++) fireEvent.click(w);
  };

  it('is absent until it is armed', async () => {
    window.sessionStorage.removeItem('sprigly:nav-trace');
    await mount();
    expect(screen.queryByTestId('nav-trace')).toBeNull();
  });

  it('two taps are not three — the identity is still just the identity', async () => {
    window.sessionStorage.removeItem('sprigly:nav-trace');
    await mount();
    tapWordmark(2);
    expect(screen.queryByTestId('nav-trace')).toBeNull();
  });

  it('THREE taps arm it, and the panel lands on the third — not on the next navigation', async () => {
    window.sessionStorage.removeItem('sprigly:nav-trace');
    await mount();
    await act(async () => { tapWordmark(3); });
    expect(screen.getByTestId('nav-trace')).toBeTruthy();
    expect(window.sessionStorage.getItem('sprigly:nav-trace')).toBe('1');
  });

  it('and three more disarm it again', async () => {
    window.sessionStorage.removeItem('sprigly:nav-trace');
    await mount();
    await act(async () => { tapWordmark(3); });
    await act(async () => { tapWordmark(3); });
    expect(screen.queryByTestId('nav-trace')).toBeNull();
    expect(window.sessionStorage.getItem('sprigly:nav-trace')).toBeNull();
  });

  it('an armed trace records the mover with its call site — what the operator screenshots', async () => {
    await mount();                                       // beforeEach armed it
    fireEvent.click(screen.getByTestId('next-week'));
    const line = trace().find((l) => l.includes('2026-08-21'));
    expect(line).toMatch(/select user:strip 2026-08-21 ← .*WeekStrip|select user:strip 2026-08-21 ← .*CommittedSurface/);
  });
});

/**
 * ── ROUND 4: THE MOVER THAT SURVIVED THE CLAMP ───────────────────────────────────────
 *
 * Round 3 put `clampToMonth` on `WeekStrip.move()` and made it the only way the CHEVRONS, the
 * SWIPE and the ARROW KEYS change the selection. It never touched the fourth mover, which is
 * the plainest one on the surface: **a finger on a day cell**.
 *
 * `weekOf(selected)` renders seven days whatever month they belong to, and every cell is a
 * button that calls `onSelect(iso)` with no clamp at all. So the round-3 fix opened the door
 * rather than closing it — the report itself records that the clamp made 30–31 July newly
 * reachable, and the same is true of 31 August. Stand on 31 Aug (which the arrow keys now
 * reach) and the strip draws **Mon 31 Aug … Sun 6 Sep**: six September cells, all tappable,
 * none of them clamped. One tap and the day header reads *Friday 4 September* while the month
 * title still says August and the week's posts belong to a cycle nobody fetched.
 *
 * That is the round-3 report verbatim — and the trace line it was convicted on,
 * `select user:strip 2026-09-04 ← CommittedSurface.tsx:75`, is produced IDENTICALLY by this
 * path. The chevron was one way to make that line; the cell tap is the other, and only the
 * first was fixed.
 *
 * The month grid has the same hole (`MonthGrid.tsx`, `onClick={() => onPick(iso)}` on padding
 * cells), so both are covered here.
 */
describe('ROUND 4 — the padding-day tap, which the clamp never covered', () => {
  /** Walk to the month's last day the way the clamp now permits, and tap out of it. */
  const dayCell = (iso: string) =>
    screen.getAllByTestId('week-day').find((d) => d.getAttribute('data-date') === iso);

  it('the strip renders September cells on the week of 31 August — the door the clamp opened', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('next-week'));
    fireEvent.click(screen.getByTestId('next-week'));       // 28 Aug
    const strip = screen.getByTestId('week-strip');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(strip, { key: 'ArrowRight' });
    expect(panelDate()).toBe('2026-08-31');
    expect(dayCell('2026-09-04'), 'the week of 31 Aug must contain 4 September').toBeTruthy();
  });

  it('TAPPING that September cell must not take the day into September', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('next-week'));
    fireEvent.click(screen.getByTestId('next-week'));       // 28 Aug
    const strip = screen.getByTestId('week-strip');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(strip, { key: 'ArrowRight' });   // 31 Aug

    const sep4 = dayCell('2026-09-04')!;
    fireEvent.click(sep4);

    expect(panelDate()?.slice(0, 7), `THE JUMP — trace:\n${trace().join('\n')}`).toBe('2026-08');
    expect(monthTitle()).toBe('August 2026');
  });

  it('an in-month cell tap still selects — the fix is a clamp, not a dead strip', async () => {
    await mount();
    fireEvent.click(dayCell('2026-08-12')!);
    expect(panelDate()).toBe('2026-08-12');
  });

  it('the month grid’s padding cells do not move the day out of the month either', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('nav-month'));
    const cell = screen.getAllByTestId('grid-cell').find((d) => d.getAttribute('data-date')?.startsWith('2026-09'));
    expect(cell, 'September padding cells are drawn in the August grid').toBeTruthy();
    fireEvent.click(cell!);
    // Back to the day view, which is where the selection is legible.
    fireEvent.click(screen.getByTestId('nav-day'));
    expect(panelDate()?.slice(0, 7), `trace:\n${trace().join('\n')}`).toBe('2026-08');
  });
});

/**
 * ── ROUND 5: THE GHOST CLICK, WHICH ROUND 4'S CLAMP WAS NEVER ABOUT ──────────────────
 *
 * The operator's own trace, from the device, with the instrument armed:
 *
 *     1ms     select user:grid        2026-08-29   ← onClick@…
 *     4325ms  cycle user:next-month   d5670806-…   ← a_@…
 *     4326ms  cycle switch            d5670806-…
 *     6346ms  select user:month-change 2026-09-02  ← a0@…
 *
 * Read it backwards. The jump the client SEES — landing on 2 September — is the re-anchor at
 * 6346ms, two seconds after the switch, which is the refetch settling. That is the "wait ~1s"
 * in the report. The CAUSE is at 4325ms: `cycle user:next-month`, which is written in exactly
 * one place (`CommittedSurface.tsx` → `onNextMonth`) and reachable from exactly one control
 * (`PlanShell.tsx` → `<ArrowBtn dir="next">`). Something clicked the month arrow, 4.3 seconds
 * after the day tap — which is when the operator closed the post they had opened.
 *
 * The geometry says how, and it was measured in the browser rather than reasoned about:
 *
 *     next-month  x 129.4 … 169.4   y 32 … 72
 *     grabber     x 0     … 390     y 67.5 … 101.5      (390 × 844)
 *
 * The sheet's close control overlaps the month arrow. 4.5px at a 844px viewport, and MORE on a
 * phone with browser chrome — the panel is `h-[92%]`, so at 700px of visible height the grabber
 * starts at y 56 and the overlap is 16px, half its height. A thumb closing the sheet at
 * x ≈ 150 is over the arrow.
 *
 * `Sheet.tsx` already had a guard for this — round 4's `swallowNextClick`. It fails on the
 * device because it is a RACE: it disarms on `setTimeout(…, 0)`, on the assumption that the
 * browser dispatches the compatibility click in the same input-dispatch turn as the
 * `pointerup`. Nothing specifies that, and iOS does not honour it. These reproduce the losing
 * ordering — the click arriving one macrotask later — which is the only thing the old guard
 * cannot survive.
 */
describe('ROUND 5 — closing a sheet must not click what is underneath it', () => {
  const openAPost = () => {
    const opener = screen.queryAllByTestId('post-card')[0] ?? screen.queryAllByTestId('summary-row')[0];
    fireEvent.click(opener!);
    expect(screen.getByTestId('detail-sheet')).toBeTruthy();
  };

  /**
   * A THUMB, MODELLED THE WAY THE BROWSER ACTUALLY BEHAVES.
   *
   * `pointerdown`, `pointerup`, and then ONE compatibility click — a macrotask later, which is
   * the ordering the device produced and the one round 4's timer lost to. Its target is whatever
   * is under the finger AT DISPATCH TIME, which is the whole question: if the sheet closed on
   * `pointerup` the grabber is gone and the click lands on the shell (`under`); if it is still
   * there, the grabber eats its own click and nothing reaches the shell at all.
   *
   * Writing it any other way would be writing the answer into the harness.
   */
  const dismissWithThumb = async (at: { clientX: number; clientY: number }, under: string) => {
    const grabber = screen.getByTestId('detail-sheet-grabber');
    await act(async () => {
      fireEvent.pointerDown(grabber, { ...at, pointerId: 1 });
      fireEvent.pointerUp(grabber, { ...at, pointerId: 1 });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const target = screen.queryByTestId('detail-sheet-grabber') ?? screen.queryByTestId(under);
    if (target) await act(async () => { fireEvent.click(target, at); });
  };

  const openAndCloseAPost = async (at: { clientX: number; clientY: number }, under = 'next-month') => {
    openAPost();
    await dismissWithThumb(at, under);
  };

  /** A click arriving on the shell a macrotask after a dismissal — the DRAG path's trailing one. */
  const ghostClickOn = async (testid: string, at: { clientX: number; clientY: number }) => {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const el = screen.queryByTestId(testid);
    if (el) await act(async () => { fireEvent.click(el, at); });
  };

  it('THE REPRODUCTION: a tap on the grabber, then the click it leaves behind on next-month', async () => {
    await mount();
    // Stand on the 14th, the way the operator stood on the 29th.
    const day = screen.getAllByTestId('week-day').find((d) => d.getAttribute('data-date') === '2026-08-14');
    if (day) fireEvent.click(day);
    expect(monthTitle()).toBe('August 2026');

    const at = { clientX: 150, clientY: 70 };   // the measured overlap: over the arrow, on the grabber
    await openAndCloseAPost(at);
    expect(screen.queryByTestId('detail-sheet')).toBeNull();   // it closed, which is all the client asked for

    expect(monthTitle(), 'closing a post must not change the month').toBe('August 2026');
    expect(trace().join('\n')).not.toContain('cycle user:next-month');
  });

  it('and the day does not follow it into September either — the trace stays clean', async () => {
    await mount();
    const at = { clientX: 150, clientY: 70 };
    await openAndCloseAPost(at);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(panelDate()?.startsWith('2026-08')).toBe(true);
    expect(trace().join('\n')).not.toContain('2026-09');
  });

  it('the same from the MONTH view, which is where the operator was', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('nav-month'));
    const cell = screen.getAllByTestId('grid-cell').find((c) => c.getAttribute('data-date') === '2026-08-14');
    if (cell) fireEvent.click(cell);

    const at = { clientX: 150, clientY: 70 };
    await openAndCloseAPost(at);

    expect(monthTitle()).toBe('August 2026');
  });

  it('a ghost click on the PREVIOUS arrow is refused on the same terms', async () => {
    await mount();
    const at = { clientX: 25, clientY: 70 };
    await openAndCloseAPost(at, 'prev-month');
    expect(monthTitle()).toBe('August 2026');
  });

  /**
   * THE OTHER HALF. A guard that eats clicks is only safe if it eats exactly one. These pin
   * that closing a sheet does not deaden the surface behind it.
   */
  it('the arrow still works when the client actually means it', async () => {
    await mount();
    await openAndCloseAPost({ clientX: 150, clientY: 70 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // A DELIBERATE tap: its own pointer sequence, then its click.
    const next = screen.getByTestId('next-month');
    await act(async () => {
      fireEvent.pointerDown(next, { clientX: 150, clientY: 70, pointerId: 2 });
      fireEvent.pointerUp(next, { clientX: 150, clientY: 70, pointerId: 2 });
      fireEvent.click(next, { clientX: 150, clientY: 70 });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(trace().join('\n')).toContain('cycle user:next-month');
  });

  it('and the grabber still closes the sheet — the fix is not a dead control', async () => {
    await mount();
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    expect(screen.getByTestId('detail-sheet')).toBeTruthy();
    await dismissWithThumb({ clientX: 195, clientY: 85 }, 'next-month');
    expect(screen.queryByTestId('detail-sheet')).toBeNull();
  });

  it('a DRAG down still dismisses, and its own trailing click is still eaten', async () => {
    await mount();
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    const grabber = screen.getByTestId('detail-sheet-grabber');
    await act(async () => {
      fireEvent.pointerDown(grabber, { clientX: 195, clientY: 80, pointerId: 1 });
      fireEvent.pointerMove(grabber, { clientX: 195, clientY: 200, pointerId: 1 });
      fireEvent.pointerUp(grabber, { clientX: 195, clientY: 200, pointerId: 1 });
    });
    expect(screen.queryByTestId('detail-sheet')).toBeNull();

    await ghostClickOn('next-month', { clientX: 195, clientY: 200 });
    expect(monthTitle()).toBe('August 2026');
  });
});
