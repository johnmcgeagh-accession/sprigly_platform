/**
 * @vitest-environment jsdom
 *
 * what-changed.interaction.test.tsx — the recently-changed marks and the What-changed row.
 *
 * The operator-agreed design: (a) day dots gain a recently-changed state — an accent second dot
 * on days holding posts changed since the LAST VISIT, decaying as each day is viewed; (b) a
 * "What changed" row from the month header lists the recent receipts (the existing ledger via
 * /api/plan/changes), tapping through to the day. First visits mark nothing — there is no
 * "since" to mark against, and a fresh link covered in alerts is crying wolf on arrival.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import { changeWord, changedDays, readAndStampVisit, resetVisitStamps } from './what-changed';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'reel', pillar: 'Home & Space',
  caption: 'Wilderness is back.', status: 'planned', reviewState: null, steps: [], postingTime: '06:00',
  ...over,
});

function fakeData(over: Partial<PlanData> = {}): PlanData {
  const posts = (over.posts ?? [post(), post({ id: 'p2', date: '2026-10-02' })]) as PlanPost[];
  return {
    posts, crossMonthPosts: [], calendarPosts: posts, beats: [], beatsOn: () => [],
    weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false }],
    viewedCycleId: 'cyc-1', homeCycleId: 'cyc-1', todayCycleId: 'cyc-1',
    today: TODAY, clientName: 'Earl of East', readOnly: false,
    canEdit: () => true, proposals: [],
    shapingIds: new Set(), hookGenerating: new Set(), hookCandidates: new Map(), hookError: new Map(),
    scriptGenerating: new Set(), scriptError: new Map(), shapeErrors: new Map(),
    switchCycle: vi.fn(async () => {}), addPost: vi.fn(async () => {}), addShapedPost: vi.fn(async () => true),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    changeFormat: vi.fn(async () => {}), regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}), generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}), clearHookCandidates: vi.fn(),
    ...over,
  } as unknown as PlanData;
}

const CHANGES = [
  { id: 'a1', action: 'rescheduled', postId: 'p2', date: '2026-10-02', title: 'Wilderness is back.', at: '2026-10-01T08:00:00Z', origin: 'agent' },
  { id: 'a2', action: 'caption_saved', postId: 'p2', date: '2026-10-02', title: 'Wilderness is back.', at: '2026-10-01T08:01:00Z', origin: 'agent' },
];

function stubChanges(changes: unknown[] = CHANGES) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/plan/changes')) return { ok: true, json: async () => ({ changes }) };
    return { ok: true, json: async () => ({ conversationId: null, turns: [] }) };
  }));
}

/** A PREVIOUS visit exists — the marks are "since then". */
const visited = () => window.localStorage.setItem('sprigly:seen:cyc-1', '2026-09-30T12:00:00Z');

beforeEach(() => {
  window.innerWidth = 390;
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetVisitStamps();   // each test is its own "page load"
  stubChanges();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the helpers', () => {
  it('changeWord maps ledger actions to receipt words, never model prose', () => {
    expect(changeWord('rescheduled')).toBe('Moved');
    expect(changeWord('post_created')).toBe('Added');
    expect(changeWord('hook_saved')).toBe('Hook updated');
    expect(changeWord('something_new')).toBe('Updated');
  });

  it('changedDays collects the changed dates minus what has been viewed', () => {
    const days = changedDays(CHANGES, new Set(['2026-10-02']));
    expect(days.size).toBe(0);
    expect(changedDays(CHANGES, new Set()).has('2026-10-02')).toBe(true);
  });

  it('readAndStampVisit returns the PREVIOUS stamp, advances it, and is IDEMPOTENT per page load', () => {
    expect(readAndStampVisit('cyc-9', '2026-10-01T10:00:00Z')).toBeNull();
    // Same page load (StrictMode's second effect run, a cycle switched away and back):
    // the SAME answer, not the stamp just planted — read-then-stamp must not eat its own marks.
    expect(readAndStampVisit('cyc-9', '2026-10-01T10:00:05Z')).toBeNull();
    // A NEW page load sees the advanced stamp.
    resetVisitStamps();
    expect(readAndStampVisit('cyc-9', '2026-10-02T10:00:00Z')).toBe('2026-10-01T10:00:00Z');
  });
});

describe('a) the recently-changed day dots', () => {
  it('a returning visit marks the changed day with the accent second dot', async () => {
    visited();
    render(<CommittedSurface data={fakeData()} />);
    const changed = await screen.findByTestId('day-changed');
    expect(changed.closest('[data-date]')?.getAttribute('data-date')).toBe('2026-10-02');
  });

  it('a FIRST visit marks nothing — there is no "since" to mark against', async () => {
    render(<CommittedSurface data={fakeData()} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('day-changed')).toBeNull();
    // …but the stamp is planted, so the NEXT visit has its baseline.
    expect(window.localStorage.getItem('sprigly:seen:cyc-1')).toBeTruthy();
  });

  it('the mark DECAYS when the day is viewed', async () => {
    visited();
    render(<CommittedSurface data={fakeData()} />);
    await screen.findByTestId('day-changed');
    const day = screen.getAllByTestId('week-day').find((el) => el.getAttribute('data-date') === '2026-10-02')!;
    fireEvent.click(day);
    expect(screen.queryByTestId('day-changed')).toBeNull();
  });

  it('the month grid carries the same mark beside its dots', async () => {
    visited();
    render(<CommittedSurface data={fakeData()} />);
    await screen.findByTestId('day-changed');
    fireEvent.click(screen.getByTestId('nav-month'));
    const cell = screen.getAllByTestId('grid-cell').find((c) => c.getAttribute('data-date') === '2026-10-02')!;
    expect(cell.querySelector('[data-testid="grid-changed"]')).toBeTruthy();
  });
});

describe('b) the What-changed row', () => {
  it('lists the recent receipts with their words, titles and days', async () => {
    visited();
    render(<CommittedSurface data={fakeData()} />);
    const row = await screen.findByTestId('what-changed-row');
    expect(row.textContent).toContain('What changed · 2');

    fireEvent.click(row);
    const lines = screen.getAllByTestId('what-changed-line');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toContain('Moved');
    expect(lines[0]!.textContent).toContain('Wilderness is back.');
    expect(lines[0]!.textContent).toContain('Fri 2 Oct');
    expect(lines[1]!.textContent).toContain('Caption updated');
  });

  it('a line taps through to the day', async () => {
    visited();
    render(<CommittedSurface data={fakeData()} />);
    fireEvent.click(await screen.findByTestId('what-changed-row'));
    fireEvent.click(screen.getAllByTestId('what-changed-line')[0]!);

    expect(screen.queryByTestId('what-changed-panel')).toBeNull();
    expect(screen.getByTestId('day-panel').getAttribute('data-date')).toBe('2026-10-02');
  });

  it('is ABSENT when nothing changed — a row reading "0 changes" says nothing', async () => {
    visited();
    stubChanges([]);
    render(<CommittedSurface data={fakeData()} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('what-changed-row')).toBeNull();
  });
});
