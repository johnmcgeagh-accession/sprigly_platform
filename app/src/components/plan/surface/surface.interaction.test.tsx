/**
 * @vitest-environment jsdom
 *
 * surface.interaction.test.tsx — the committed surface, driven rather than rendered.
 *
 * ── Why these are interaction tests ──────────────────────────────────────────────────
 *
 * The round-1 lesson, recorded in the arc's own reports: render coverage cannot reach
 * post-return bugs. Every assertion below happens AFTER a tap, because the things that break
 * on this surface are not "did it render" but "did the panel follow the strip", "did the grid
 * carry the date back to Day view", "did the add slot use the day I was looking at". A
 * markup snapshot passes all four of those while every one of them is broken.
 *
 * The app's vitest env is `node`; this file opts into jsdom in its docblock so the rest of the
 * suite is unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';   // a Thursday

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: '2026-10-01', format: 'reel', pillar: 'Home & Space',
  caption: 'Wilderness is back. There is a particular quality to autumn light indoors.',
  status: 'new', reviewState: null, steps: [], postingTime: '06:00',
  ...over,
});

/** A PlanData stand-in. Only the fields this surface reads — a full fake would hide which. */
function fakeData(over: Partial<PlanData> = {}): PlanData {
  const posts = (over.posts ?? []) as PlanPost[];
  const base = {
    posts,
    crossMonthPosts: [],
    calendarPosts: posts,
    beats: [],
    beatsOn: () => [],
    weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false }],
    viewedCycleId: 'cyc-1',
    homeCycleId: 'cyc-1',
    todayCycleId: 'cyc-1',
    today: TODAY,
    clientName: 'Earl of East',
    readOnly: false,
    canEdit: () => true,
    switchCycle: vi.fn(async () => {}),
    addPost: vi.fn(async () => {}),
    track: vi.fn(),
    flash: vi.fn(),
    toggleStep: vi.fn(async () => {}),
    shapingIds: new Set<string>(),
    hookGenerating: new Set<string>(),
    hookCandidates: new Map<string, string[]>(),
    hookError: new Map<string, string>(),
    scriptGenerating: new Set<string>(),
    scriptError: new Map<string, string>(),
    shapeErrors: new Map<string, string>(),
    changeFormat: vi.fn(async () => {}),
    regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}),
    generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}),
    clearHookCandidates: vi.fn(),
    ...over,
  };
  return base as unknown as PlanData;
}

beforeEach(() => { window.innerWidth = 390; });
afterEach(cleanup);

describe('the strip selects and the panel follows', () => {
  it('tapping a day swaps the panel to THAT day — no feed, no scroll', () => {
    render(<CommittedSurface data={fakeData({ posts: [
      post({ id: 'a', date: '2026-10-01', caption: 'the first' }),
      post({ id: 'b', date: '2026-10-02', caption: 'the second' }),
    ] })} />);

    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe('2026-10-01');
    expect(screen.getByText('the first')).toBeTruthy();
    expect(screen.queryByText('the second')).toBeNull();

    fireEvent.click(document.querySelector('[data-testid="week-day"][data-date="2026-10-02"]')!);

    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe('2026-10-02');
    expect(screen.getByText('the second')).toBeTruthy();
    // The point of the reversal: the day you left is GONE, not scrolled past.
    expect(screen.queryByText('the first')).toBeNull();
  });

  it('the selected day is the only one pressed, and the header names it', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(document.querySelector('[data-testid="week-day"][data-date="2026-10-03"]')!);

    const pressed = document.querySelectorAll('[data-testid="week-day"][aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.getAttribute('data-date')).toBe('2026-10-03');
    expect(screen.getByTestId('day-title').textContent).toBe('Saturday 3 October');
  });

  it('swiping the strip left moves a week, keeping the weekday', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    const strip = screen.getByTestId('week-strip');
    fireEvent.pointerDown(strip, { clientX: 300 });
    fireEvent.pointerUp(strip, { clientX: 200 });   // 100px left → next week

    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe('2026-10-08');
  });

  it('a swipe shorter than the threshold is not a swipe', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    const strip = screen.getByTestId('week-strip');
    fireEvent.pointerDown(strip, { clientX: 300 });
    fireEvent.pointerUp(strip, { clientX: 280 });

    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe(TODAY);
  });
});

describe('the nav pill, and the month grid you stay in', () => {
  it('Month is a peer view — it opens without a dismiss control', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(screen.getByTestId('nav-month'));

    expect(screen.getByTestId('month-grid')).toBeTruthy();
    expect(screen.queryByTestId('day-panel')).toBeNull();
    expect(screen.queryByTestId('week-strip')).toBeNull();   // the grid replaces the strip
    // No ✕ anywhere: you leave a peer view the way you entered it.
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('TAPPING A GRID DAY STAYS ON THE GRID and summarises that day (round 6, P6)', () => {
    const data = fakeData({ posts: [post({ id: 'z', date: '2026-10-22', title: 'three weeks out' })] });
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);

    // The calendar is still the view. N3 flipped to Day here and the phone read that as being
    // thrown out of the month you were reading.
    expect(screen.getByTestId('month-grid')).toBeTruthy();
    expect(screen.queryByTestId('day-panel')).toBeNull();

    const summary = screen.getByTestId('month-summary');
    expect(summary.getAttribute('data-date')).toBe('2026-10-22');
    expect(within(summary).getByText('three weeks out')).toBeTruthy();
    // Nothing is fetched — the month's posts were already loaded for the grid just drawn.
    expect(data.switchCycle).not.toHaveBeenCalled();
  });

  it('a summary row opens that post’s sheet, from inside the month view', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ id: 'z', date: '2026-10-22', title: 'three weeks out' })] })} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);
    fireEvent.click(screen.getByTestId('summary-row'));

    expect(screen.getByTestId('detail-sheet')).toBeTruthy();
    expect(screen.getByTestId('month-grid')).toBeTruthy();   // and the month is still behind it
  });

  it('an empty day says so and offers nothing — a glance is not a place to create', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);

    const summary = screen.getByTestId('month-summary');
    expect(summary.textContent).toContain('Nothing planned');
    expect(within(summary).queryByTestId('row-list')).toBeNull();
    expect(screen.queryByTestId('add-slot')).toBeNull();
  });

  it('the selection is SHARED, so switching to Day lands where you were reading', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);
    fireEvent.click(screen.getByTestId('nav-day'));

    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe('2026-10-22');
    const days = [...document.querySelectorAll('[data-testid="week-day"]')].map((d) => d.getAttribute('data-date'));
    expect(days[0]).toBe('2026-10-19');   // the strip re-anchored to that week
    expect(days).toContain('2026-10-22');
  });

  it('the selected segment carries its word; the others are named only to a screen reader', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    expect(screen.getByTestId('nav-day').textContent).toContain('Day');
    expect(screen.getByTestId('nav-month').textContent).toBe('');
    expect(screen.getByTestId('nav-month')?.getAttribute('aria-label')).toBe('Month');

    fireEvent.click(screen.getByTestId('nav-month'));
    expect(screen.getByTestId('nav-month').textContent).toContain('Month');
    expect(screen.getByTestId('nav-day').textContent).toBe('');
  });

  it('Tasks mounts the existing checklist surface', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(screen.getByTestId('nav-tasks'));
    expect(screen.getByTestId('tasks-panel')).toBeTruthy();
  });

  it('Today on the month view selects in place rather than leaving the grid', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);
    fireEvent.click(screen.getByTestId('today-btn'));

    expect(screen.getByTestId('month-grid')).toBeTruthy();
    expect(screen.getByTestId('month-summary').getAttribute('data-date')).toBe(TODAY);
  });

  it('Today on the DAY view still returns to the current day', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(document.querySelector('[data-testid="week-day"][data-date="2026-10-03"]')!);
    fireEvent.click(screen.getByTestId('today-btn'));

    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe(TODAY);
  });
});

describe('the week pager (round 6, P5)', () => {
  it('a chevron pages a week, keeping the weekday you were on', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(screen.getByTestId('next-week'));

    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe('2026-10-08');
    const days = [...document.querySelectorAll('[data-testid="week-day"]')].map((d) => d.getAttribute('data-date'));
    expect(days[0]).toBe('2026-10-05');
  });

  it('and pages back', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    fireEvent.click(screen.getByTestId('next-week'));
    fireEvent.click(screen.getByTestId('prev-week'));
    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe(TODAY);
  });

  it('STOPS at the month edge — disabled, never hidden', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    // 1 Oct is in the week of 28 Sep; one page back is 21–27 Sep, entirely outside October.
    // Paging there would draw seven days whose posts were never loaded, which reads as loss.
    expect(screen.getByTestId('prev-week').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('next-week').hasAttribute('disabled')).toBe(false);
  });
});

describe('the per-day add slot', () => {
  it('adds to the day you are LOOKING at, not to the month', async () => {
    const data = fakeData({ posts: [post()] });
    render(<CommittedSurface data={data} />);
    fireEvent.click(document.querySelector('[data-testid="week-day"][data-date="2026-10-03"]')!);
    fireEvent.click(screen.getByTestId('add-slot'));

    expect(data.addPost).toHaveBeenCalledWith('2026-10-03');
  });

  it('is absent on a day the client may not edit', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()], canEdit: () => false })} />);
    expect(screen.queryByTestId('add-slot')).toBeNull();
  });

  it('is the ONLY add affordance — the global "Add to your plan" button is gone', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    expect(screen.queryByText(/Add to your plan|Brief this month/)).toBeNull();
    expect(screen.getAllByTestId('add-slot')).toHaveLength(1);
  });
});

describe('the density rule (§9.1)', () => {
  const day = (n: number) => Array.from({ length: n }, (_, i) => post({ id: `p${i}`, date: TODAY, caption: `caption ${i}` }));

  it('0 posts: the day says so, and offers one slot', () => {
    render(<CommittedSurface data={fakeData({ posts: [] })} />);
    expect(screen.getByTestId('day-count').textContent).toBe('Nothing planned');
    expect(screen.getByTestId('add-slot')).toBeTruthy();
  });

  it('1–2 posts: full cards', () => {
    render(<CommittedSurface data={fakeData({ posts: day(2) })} />);
    expect(screen.getAllByTestId('post-card')).toHaveLength(2);
    expect(screen.queryByTestId('row-list')).toBeNull();
  });

  it('3–4 posts: ONE grouped list of compact rows, no cards', () => {
    render(<CommittedSurface data={fakeData({ posts: day(4) })} />);
    expect(screen.queryByTestId('post-card')).toBeNull();
    expect(screen.getAllByTestId('row-list')).toHaveLength(1);
    expect(screen.getAllByTestId('post-row')).toHaveLength(4);
  });

  it('5+: four rows, then "＋N more" — which expands IN PLACE', () => {
    render(<CommittedSurface data={fakeData({ posts: day(8) })} />);
    expect(screen.getAllByTestId('post-row')).toHaveLength(4);

    const more = screen.getByTestId('show-more');
    expect(more.textContent).toContain('4 more');
    fireEvent.click(more);

    expect(screen.getAllByTestId('post-row')).toHaveLength(8);
    expect(screen.queryByTestId('show-more')).toBeNull();
    // In place: still one list, still the same day.
    expect(screen.getAllByTestId('row-list')).toHaveLength(1);
    expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe(TODAY);
  });

  it('a compact row states time and title and nothing else — the icon and pillar are a tap away', () => {
    render(<CommittedSurface data={fakeData({ posts: day(3) })} />);
    const row = screen.getAllByTestId('post-row')[0]!;
    expect(row.textContent).toContain('06:00');
    expect(within(row).queryByTestId('format-tile')).toBeNull();
    expect(row.textContent).not.toContain('Home & Space');
  });
});

describe('a post still being written', () => {
  const failing = [post({ id: 'f', date: TODAY, status: 'generation_failed', caption: '', generationError: 'Bedrock timed out after 180s' })];

  it('reads as "On its way" on the card', () => {
    render(<CommittedSurface data={fakeData({ posts: failing })} />);
    expect(screen.getByTestId('on-the-way').textContent).toBe('On its way');
  });

  it('NEVER shows the client failure vocabulary, a reason, or a retry', () => {
    const { container } = render(<CommittedSurface data={fakeData({ posts: failing })} />);
    expect(container.textContent).not.toMatch(/\b(retry|failed|failure|error|couldn.t)\b/i);
    expect(container.textContent).not.toContain('Bedrock');
  });

  it('is a RING in the month grid, not a different colour', () => {
    render(<CommittedSurface data={fakeData({ posts: failing })} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    const dot = document.querySelector(`[data-testid="grid-cell"][data-date="${TODAY}"] [data-testid="grid-dot"]`);
    expect(dot?.getAttribute('data-mark')).toBe('onway');
  });

  it('the month footer names the exception in words, so the grid needs no legend', () => {
    render(<CommittedSurface data={fakeData({ posts: [...failing, post({ id: 'ok', date: '2026-10-09' })] })} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    expect(screen.getByTestId('month-foot').textContent).toContain('One is still being written');
  });
});

describe('the microphone', () => {
  it('is present on an editable month, labelled as talking to the plan', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    expect(screen.getByTestId('nav-mic')?.getAttribute('aria-label')).toBe('Talk to your plan');
  });

  it('is ABSENT on a read-only month, not disabled', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()], readOnly: true })} />);
    expect(screen.queryByTestId('nav-mic')).toBeNull();
    // The pill is still there — losing the mic must not lose navigation.
    expect(screen.getByTestId('nav-pill')).toBeTruthy();
  });
});

describe('month edges', () => {
  it('the arrows are disabled, not hidden, when there is no sibling month', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] })} />);
    expect((screen.getByTestId('prev-month') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('next-month') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('month-title').textContent).toBe('October 2026');
  });

  it('a sibling month makes the arrow live and switches the cycle', () => {
    const data = fakeData({
      posts: [post()],
      cycles: [
        { cycleId: 'cyc-0', displayMonth: '2026-09', monthLabel: 'September 2026', prePlanning: false },
        { cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false },
      ],
    } as Partial<PlanData>);
    render(<CommittedSurface data={data} />);

    expect((screen.getByTestId('prev-month') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('prev-month'));
    expect(data.switchCycle).toHaveBeenCalledWith('cyc-0');
  });
});

describe('narrow viewports (round-5.1 carry-in X7)', () => {
  // The ≤480px breakpoint was never exercised: Chrome headless clamps its viewport to 500px,
  // so no design round could reach it. jsdom has no layout engine either, so what CAN be
  // asserted here is that the surface renders and stays operable at 375 and 320 — every
  // control present, every one reachable. The geometry itself is a device check, and is
  // flagged as such in the report rather than claimed here.
  for (const width of [375, 320]) {
    it(`renders and stays operable at ${width}px`, () => {
      window.innerWidth = width;
      render(<CommittedSurface data={fakeData({ posts: [post(), post({ id: 'q', date: '2026-10-02' })] })} />);

      expect(document.querySelectorAll('[data-testid="week-day"]')).toHaveLength(7);
      expect(screen.getByTestId('nav-pill')).toBeTruthy();
      expect(screen.getByTestId('nav-mic')).toBeTruthy();

      // and it still WORKS at that width, which is the part a screenshot cannot tell you
      fireEvent.click(document.querySelector('[data-testid="week-day"][data-date="2026-10-02"]')!);
      expect(screen.getByTestId('day-panel')?.getAttribute('data-date')).toBe('2026-10-02');
      fireEvent.click(screen.getByTestId('nav-month'));
      expect(screen.getAllByTestId('grid-cell').length).toBeGreaterThan(27);
    });
  }
});
