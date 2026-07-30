/**
 * @vitest-environment jsdom
 *
 * time-jump.interaction.test.tsx — selectedDay NEVER changes except by explicit user
 * navigation or a restore of where the user last put it. (F2)
 *
 * The operator's report: occasional forward date-jumps with nothing pressed, surviving the
 * ghost-click fix. The in-page audit found every `setSelected` gesture-driven and the re-anchor
 * keyed to the month alone — so these tests LOCK that: a data refetch replacing the post arrays
 * under a live selection must not move it, however different the new arrays are. The surviving
 * out-of-page mechanism (a reload nobody pressed re-running the landing) is closed by
 * `nav-state.ts`; the restore path is tested here too, because a restore that restores the
 * wrong month would be the same bug wearing the fix's clothes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';   // a Thursday

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: '2026-10-01', format: 'reel', pillar: 'Home & Space',
  caption: 'Wilderness is back.', status: 'planned', reviewState: null, steps: [], postingTime: '06:00',
  ...over,
});

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
    addShapedPost: vi.fn(async () => true),
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

const selectDay = (iso: string) => {
  const day = screen.getAllByTestId('week-day').find((el) => el.getAttribute('data-date') === iso)!;
  fireEvent.click(day);
};
const panelDate = () => screen.getByTestId('day-panel').getAttribute('data-date');

beforeEach(() => { window.innerWidth = 390; window.sessionStorage.clear(); });
afterEach(cleanup);

describe('refetch under a live selection', () => {
  it('replacing the post arrays (a background refetch) does NOT move the selected day', () => {
    const first = [post({ id: 'a', date: '2026-10-01' }), post({ id: 'b', date: '2026-10-02' })];
    const { rerender } = render(<CommittedSurface data={fakeData({ posts: first })} />);

    selectDay('2026-10-02');
    expect(panelDate()).toBe('2026-10-02');

    // A refetch returns NEW array identities — fresh objects, an extra post, a status change.
    const refetched = [
      post({ id: 'a', date: '2026-10-01', status: 'edited' }),
      post({ id: 'b', date: '2026-10-02' }),
      post({ id: 'c', date: '2026-10-09' }),
    ];
    rerender(<CommittedSurface data={fakeData({ posts: refetched })} />);
    expect(panelDate()).toBe('2026-10-02');
  });

  it('an applied change that MOVES a post elsewhere still does not move the selection', () => {
    const first = [post({ id: 'a', date: '2026-10-02' })];
    const { rerender } = render(<CommittedSurface data={fakeData({ posts: first })} />);

    selectDay('2026-10-02');
    // The agent applied "move it to the 9th"; the refetch lands the new truth.
    rerender(<CommittedSurface data={fakeData({ posts: [post({ id: 'a', date: '2026-10-09' })] })} />);
    // The DAY the client was reading stays put — the post left it, the client did not.
    expect(panelDate()).toBe('2026-10-02');
  });

  it('a refetch that empties the month entirely does not move the selection either', () => {
    const { rerender } = render(<CommittedSurface data={fakeData({ posts: [post({ id: 'a', date: '2026-10-02' })] })} />);
    selectDay('2026-10-02');
    rerender(<CommittedSurface data={fakeData({ posts: [] })} />);
    expect(panelDate()).toBe('2026-10-02');
  });
});

describe('the reload nobody pressed (nav-state restore)', () => {
  it('a remount restores the day the client was standing on, not the default anchor', () => {
    const posts = [post({ id: 'a', date: '2026-10-01' }), post({ id: 'b', date: '2026-10-15' })];
    const { unmount } = render(<CommittedSurface data={fakeData({ posts })} />);
    selectDay('2026-10-02');
    unmount();

    // The tab reloads: a fresh mount of the same surface. Without the restore this anchors on
    // today (2026-10-01) — the unprompted jump.
    render(<CommittedSurface data={fakeData({ posts })} />);
    expect(panelDate()).toBe('2026-10-02');
  });

  it('a stored day from ANOTHER cycle is ignored — restore never drags a month to a stale date', () => {
    window.sessionStorage.setItem('sprigly:nav-state', JSON.stringify({ cycleId: 'cyc-OTHER', selected: '2026-10-27', view: 'day' }));
    render(<CommittedSurface data={fakeData({ posts: [post({ id: 'a', date: '2026-10-01' })] })} />);
    expect(panelDate()).toBe(TODAY);   // the ordinary anchor, untouched
  });

  it('a stored day outside the viewed month is ignored', () => {
    window.sessionStorage.setItem('sprigly:nav-state', JSON.stringify({ cycleId: 'cyc-1', selected: '2026-09-12', view: 'day' }));
    render(<CommittedSurface data={fakeData({ posts: [post({ id: 'a', date: '2026-10-01' })] })} />);
    expect(panelDate()).toBe(TODAY);
  });

  it('explicit month navigation still re-anchors — the fix must not freeze the surface', () => {
    const cycles = [
      { cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false },
      { cycleId: 'cyc-2', displayMonth: '2026-11', monthLabel: 'November 2026', prePlanning: false },
    ];
    const novPosts = [post({ id: 'n', date: '2026-11-06', cycleId: 'cyc-2' })];
    const { rerender } = render(<CommittedSurface data={fakeData({ posts: [post({ id: 'a', date: '2026-10-02' })], cycles } as Partial<PlanData>)} />);
    selectDay('2026-10-02');

    // The client tapped › — the surface follows them into November and anchors there.
    rerender(<CommittedSurface data={fakeData({ posts: novPosts, cycles, viewedCycleId: 'cyc-2' } as Partial<PlanData>)} />);
    expect(panelDate()).toBe('2026-11-06');
  });
});
