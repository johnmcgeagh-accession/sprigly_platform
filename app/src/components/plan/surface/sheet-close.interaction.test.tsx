/**
 * @vitest-environment jsdom
 *
 * sheet-close.interaction.test.tsx — closing a sheet must change nothing but the sheet.
 *
 * ── The bug this file exists for ─────────────────────────────────────────────────────
 *
 * The operator closed a detail sheet on 13 August and landed on 2 September; from 2 September the
 * next close moved them toward October. Two mechanisms, both confirmed in the source:
 *
 * A · THE GHOST CLICK. The grabber is `h-[34px] w-full` at the top of a sheet pinned to
 *   `bottom-0 h-[92%]`, so it lies across `PlanShell`'s title row (the ‹ › month arrows) and
 *   Today row. Measured in the browser at 390×844: `next-month` occupies x 129.4–169.4,
 *   y 32–72; the grabber x 0–390, y 67.5–101.5. They overlap, and by more on a phone with
 *   browser chrome, because 92% of a shorter viewport starts higher.
 *
 *   ROUND 4 dismissed on `pointerup` and tried to EAT the click the browser then sent onto
 *   whatever was underneath. ROUND 5 stops producing it: a TAP now closes on `click`, so the
 *   compatibility click is consumed by the grabber itself and nothing reaches the shell. The
 *   old guard survives for the DRAG path alone, which has no click of its own to close on, and
 *   its disarm is a `pointerdown` rather than a timer. `Sheet.tsx` states the whole argument.
 *
 * B · THE FOCUS RESTORE SCROLLS. `useFocusTrap` returns focus to the opener with a bare
 *   `.focus()`, which scrolls it into view — so the day panel's scroll position moves on every
 *   close, whether or not the date did.
 *
 * jsdom does not synthesise the click after a pointer sequence, so the tests below dispatch it
 * explicitly. That is not a contrivance: it is the one browser behaviour under test, and writing
 * it out is the only way to pin it where the components live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-08-13';   // a Thursday, and the day the operator was standing on

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'aug', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'reel', pillar: 'Home & Space', title: 'A post',
  caption: 'Some words that are already written.', hook: 'A hook.', script: null,
  status: 'new', reviewState: null, steps: [], postingTime: '06:00', rationale: '',
  ...over,
});

/** August and September, so a month switch has somewhere to go — exactly the operator's shape. */
const AUG = ['2026-08-06', '2026-08-13', '2026-08-20', '2026-08-27'].map((d, i) => post({ id: `a${i}`, date: d }));
const SEP = ['2026-09-02', '2026-09-10'].map((d, i) => post({ id: `s${i}`, cycleId: 'sep', date: d }));

function fakeData(over: Partial<PlanData> = {}): PlanData {
  const posts = (over.posts ?? AUG) as PlanPost[];
  return {
    posts, crossMonthPosts: [], calendarPosts: posts, beats: [], beatsOn: () => [], weather: new Map(),
    cycles: [
      { cycleId: 'aug', displayMonth: '2026-08', monthLabel: 'August 2026', prePlanning: false },
      { cycleId: 'sep', displayMonth: '2026-09', monthLabel: 'September 2026', prePlanning: false },
    ],
    viewedCycleId: 'aug', homeCycleId: 'aug', todayCycleId: 'aug',
    today: TODAY, clientName: 'Earl of East', readOnly: false, toast: null,
    canEdit: () => true,
    shapingIds: new Set<string>(), hookGenerating: new Set<string>(), hookCandidates: new Map(),
    hookError: new Map(), scriptGenerating: new Set<string>(), scriptError: new Map(), shapeErrors: new Map(),
    switchCycle: vi.fn(async () => {}), addPost: vi.fn(async () => {}), addShapedPost: vi.fn(async () => true),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    changeFormat: vi.fn(async () => {}), regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}), generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}), clearHookCandidates: vi.fn(),
    ...over,
  } as unknown as PlanData;
}

/**
 * A thumb on the grabber, modelled the way a browser behaves: `pointerdown`, `pointerup`, then
 * ONE compatibility click at the release point — dispatched onto whatever is under it AT THAT
 * MOMENT. `under` names the shell control that is there once the sheet has gone.
 *
 * That last part is the whole test. If the sheet closed on `pointerup` the grabber is already
 * unmounted and the click lands on the shell; if it is still mounted, the grabber eats its own
 * click and nothing reaches anything. Deciding the target in the harness rather than asserting
 * it would be writing the answer down.
 */
function tapGrabber(testid = 'detail-sheet-grabber', under = 'next-month') {
  const g = screen.getByTestId(testid) as HTMLElement & { setPointerCapture?: unknown };
  g.setPointerCapture = () => {};
  fireEvent.pointerDown(g, { clientY: 80, clientX: 195, pointerId: 1 });
  fireEvent.pointerUp(g, { clientY: 80, clientX: 195, pointerId: 1 });
  const target = screen.queryByTestId(testid) ?? screen.queryByTestId(under);
  if (target) fireEvent.click(target, { clientX: 195, clientY: 80 });
}

/** A click arriving on the shell after a dismissal that produced no click of its own — the DRAG
 *  path, which is the only one that still dismisses without one. */
function ghostClickOn(testid: string, at: { x: number; y: number } = { x: 195, y: 80 }) {
  fireEvent.click(screen.getByTestId(testid), { clientX: at.x, clientY: at.y });
}

const day = () => screen.getByTestId('day-panel').getAttribute('data-date');

beforeEach(() => { window.innerWidth = 390; window.sessionStorage.clear(); });   // nav-state must not leak a position between tests — each render is a fresh tab
afterEach(cleanup);

describe('A · a dismissed sheet must not leak its click to the shell', () => {
  it('the grabber SITS OVER the header band — the geometry that made this reachable', () => {
    render(<CommittedSurface data={fakeData()} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);

    // 92% tall, pinned to the bottom → the top 8% of the shell shows through, and that is where
    // the month arrows and Today live. Full width, so the whole band is a close target.
    const sheet = screen.getByTestId('detail-sheet');
    expect(sheet.className).toContain('h-[92%]');
    expect(sheet.className).toContain('bottom-0');
    expect(screen.getByTestId('detail-sheet-grabber').className).toContain('w-full');
    // The controls underneath it:
    expect(screen.getByTestId('next-month')).toBeTruthy();
    expect(screen.getByTestId('today-btn')).toBeTruthy();
  });

  it('THE BUG: a tap closes the sheet and its click reaches NOTHING underneath', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    expect(day()).toBe(TODAY);

    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    tapGrabber();

    // It closed, which is all the client asked for…
    expect(screen.queryByTestId('detail-sheet')).toBeNull();
    // …and the compatibility click went to the grabber, not to the arrow it overlaps. Before
    // round 5 this called switchCycle, the month changed, and the re-anchor moved the selection
    // to September's earliest post: 13 Aug → 2 Sep.
    expect(data.switchCycle).not.toHaveBeenCalled();
    expect(day()).toBe(TODAY);
  });

  it('and nothing reaches Today either — it is the whole band, not one control', () => {
    render(<CommittedSurface data={fakeData()} />);
    // Stand somewhere that is NOT today, so a Today click would be visible if it landed.
    fireEvent.click(screen.getByTestId('nav-month'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-08-06"]')!);
    fireEvent.click(screen.getByTestId('nav-day'));
    expect(day()).toBe('2026-08-06');

    fireEvent.click(screen.getByTestId('post-card'));
    tapGrabber('detail-sheet-grabber', 'today-btn');

    expect(screen.queryByTestId('detail-sheet')).toBeNull();
    expect(day()).toBe('2026-08-06');
  });

  it('a DRAG-close is guarded on the same path', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);

    const g = screen.getByTestId('detail-sheet-grabber') as HTMLElement & { setPointerCapture?: unknown };
    g.setPointerCapture = () => {};
    fireEvent.pointerDown(g, { clientX: 195, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(g, { clientX: 195, clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(g, { clientX: 195, clientY: 220, pointerId: 1 });

    // A browser that does dispatch a click after a drag dispatches it where the finger LIFTED.
    ghostClickOn('next-month', { x: 195, y: 220 });
    expect(data.switchCycle).not.toHaveBeenCalled();
    expect(day()).toBe(TODAY);
  });

  it('but a REAL tap on next-month still works — closing a sheet is not a mode', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    tapGrabber();
    fireEvent.click(screen.getByTestId('next-month'));   // the client's own, deliberate tap

    expect(data.switchCycle).toHaveBeenCalledWith('sep');
  });

  /**
   * THE KEYBOARD. The grabber IS the close control on a sheet with no ✕, so Enter and Space must
   * dismiss — and a keyboard activation is a click with no pointer sequence in front of it. That
   * absence is what `Sheet`'s `onClick` reads, and it is the one case the pointer path could
   * have quietly broken.
   */
  it('Enter on the grabber still closes it — a click with no pointer sequence is a keyboard one', () => {
    render(<CommittedSurface data={fakeData()} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    fireEvent.click(screen.getByTestId('detail-sheet-grabber'));
    expect(screen.queryByTestId('detail-sheet')).toBeNull();
  });

  it('a scrim tap closes without arming the guard — no pointer sequence, no ghost', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    fireEvent.click(screen.getByTestId('detail-sheet-scrim'));

    fireEvent.click(screen.getByTestId('next-month'));
    expect(data.switchCycle).toHaveBeenCalledWith('sep');
  });
});

describe('A · open and close returns to the SAME day, five days over two months', () => {
  for (const [cycle, month, days] of [
    ['aug', '2026-08', ['2026-08-06', '2026-08-13', '2026-08-20']],
    ['sep', '2026-09', ['2026-09-02', '2026-09-10']],
  ] as const) {
    for (const d of days) {
      it(`${d} is byte-identical after open → close`, () => {
        render(<CommittedSurface data={fakeData({
          posts: [...AUG, ...SEP], viewedCycleId: cycle,
          cycles: [
            { cycleId: 'aug', displayMonth: '2026-08', monthLabel: 'August 2026', prePlanning: false },
            { cycleId: 'sep', displayMonth: '2026-09', monthLabel: 'September 2026', prePlanning: false },
          ],
        } as Partial<PlanData>)} />);

        // Reach the day through the month grid: the strip only holds the selected week, and
        // these five deliberately span more than one.
        fireEvent.click(screen.getByTestId('nav-month'));
        fireEvent.click(document.querySelector(`[data-testid="grid-cell"][data-date="${d}"]`)!);
        fireEvent.click(screen.getByTestId('nav-day'));
        expect(day()).toBe(d);
        void month;

        fireEvent.click(screen.getByTestId('post-card'));
        expect(screen.getByTestId('detail-sheet')).toBeTruthy();
        tapGrabber();

        expect(day()).toBe(d);
      });
    }
  }

  it('and the day survives the move sheet closing over the detail sheet', () => {
    render(<CommittedSurface data={fakeData()} />);
    fireEvent.click(screen.getByTestId('post-card'));
    fireEvent.click(screen.getByTestId('act-move'));

    tapGrabber('move-sheet-grabber');

    expect(screen.queryByTestId('move-sheet')).toBeNull();
    expect(screen.getByTestId('detail-sheet')).toBeTruthy();   // the sheet it opened from stays
    expect(day()).toBe('2026-08-13');
  });
});

describe('B · closing must not move the scroll either', () => {
  it('focus goes back to the opener WITHOUT scrolling it into view', () => {
    render(<CommittedSurface data={fakeData()} />);
    const card = screen.getAllByTestId('post-card')[0]!;

    const opts: (FocusOptions | undefined)[] = [];
    const realFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function focus(o?: FocusOptions) { opts.push(o); return realFocus.call(this, o); };

    try {
      fireEvent.click(card);
      fireEvent.click(screen.getByTestId('detail-sheet-scrim'));
      // A bare .focus() scrolls the day panel to put the card in view, which moves the client's
      // position on a list they had already scrolled. Restoration is not navigation.
      expect(opts.some((o) => o?.preventScroll === true)).toBe(true);
      expect(opts.every((o) => o === undefined || o.preventScroll === true)).toBe(true);
    } finally {
      HTMLElement.prototype.focus = realFocus;
    }
  });
});

describe('the guard is one click, in one place, for one turn', () => {
  it('a click somewhere ELSE on the same turn is untouched', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    tapGrabber();

    // The finger lifted at (195, 80). A tap on the nav pill is nowhere near it, and closing a
    // sheet must not make the rest of the surface inert even for a frame.
    fireEvent.click(screen.getByTestId('nav-month'), { clientX: 195, clientY: 800 });
    expect(screen.getByTestId('month-grid')).toBeTruthy();
  });

  /**
   * The DRAG path's guard, which is the only one left. It eats ONE click and then it is spent —
   * and it disarms on the next `pointerdown` rather than on a timer, so a deliberate second tap
   * always gets through whatever the scheduling did.
   */
  it('the drag guard eats one click and then is spent', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    const g = screen.getByTestId('detail-sheet-grabber') as HTMLElement & { setPointerCapture?: unknown };
    g.setPointerCapture = () => {};
    fireEvent.pointerDown(g, { clientX: 195, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(g, { clientX: 195, clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(g, { clientX: 195, clientY: 220, pointerId: 1 });

    ghostClickOn('next-month', { x: 195, y: 220 });       // eaten
    ghostClickOn('next-month', { x: 195, y: 220 });       // the guard is spent
    expect(data.switchCycle).toHaveBeenCalledTimes(1);
  });

  it('and a REAL gesture disarms it, whatever the timing did', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    const g = screen.getByTestId('detail-sheet-grabber') as HTMLElement & { setPointerCapture?: unknown };
    g.setPointerCapture = () => {};
    fireEvent.pointerDown(g, { clientX: 195, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(g, { clientX: 195, clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(g, { clientX: 195, clientY: 220, pointerId: 1 });

    // A compatibility click is never preceded by its own pointerdown. This one is, so it is a
    // new deliberate gesture and the guard steps aside — even at the same coordinates.
    const next = screen.getByTestId('next-month');
    fireEvent.pointerDown(next, { clientX: 195, clientY: 220, pointerId: 2 });
    fireEvent.click(next, { clientX: 195, clientY: 220 });
    expect(data.switchCycle).toHaveBeenCalledWith('sep');
  });
});
