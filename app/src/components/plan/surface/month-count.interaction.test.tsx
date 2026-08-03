/**
 * @vitest-environment jsdom
 *
 * month-count.interaction.test.tsx — what "N posts across August" counts, pinned.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 *
 * The operator read "17 posts across August" against a month they knew held 29, and asked what
 * the surface was actually counting. The answer turned out to be: exactly the right thing (see
 * docs/reports/desktop-refinement.md §W5 — two different databases, and `cycle_month` sitting
 * one month behind the month it displays). Nothing was broken.
 *
 * But "nothing was broken" is only worth as much as the next person's ability to check it, and
 * this number is the one figure on the surface a client will verify by counting cards. So the
 * rule it follows is pinned here rather than left to be re-derived from three files:
 *
 *   THE COUNT IS THE MONTH'S, NOT THE CYCLE'S. Every live post DATED in the displayed month,
 *   whichever cycle owns it. A post the viewed cycle owns but which was moved out of the month
 *   is NOT counted — it is in the "Outside this month" strip instead — and a post another cycle
 *   owns that was moved IN is.
 *
 *   BOTH FRAMES SAY THE SAME THING. The derivation is computed once and handed to whichever
 *   shell is rendering, so a client cannot get one answer on a phone and another on a desktop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-08-03';

const post = (id: string, date: string, over: Partial<PlanPost> = {}): PlanPost => ({
  id, cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram',
  date, format: 'single', pillar: 'Home & Space', title: `Post ${id}`,
  caption: 'A caption.', hook: null, script: null,
  status: 'new', reviewState: null, steps: [], postingTime: null, rationale: '',
  ...over,
} as PlanPost);

function data(posts: PlanPost[], crossMonthPosts: PlanPost[] = []): PlanData {
  return {
    posts, crossMonthPosts, calendarPosts: [...posts, ...crossMonthPosts],
    beats: [], beatsOn: () => [], weather: new Map(),
    cycles: [{ cycleId: 'cyc-aug', displayMonth: '2026-08', monthLabel: 'August 2026', prePlanning: false }],
    viewedCycleId: 'cyc-aug', homeCycleId: 'cyc-aug', todayCycleId: 'cyc-aug',
    today: TODAY, clientName: 'Earl of East', readOnly: false, toast: null,
    canEdit: () => true, setDraft: vi.fn(),
    switchCycle: vi.fn(async () => {}), track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    shapingIds: new Set<string>(), hookGenerating: new Set<string>(), hookCandidates: new Map(),
    hookError: new Map(), scriptGenerating: new Set<string>(), scriptError: new Map(), shapeErrors: new Map(),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    addPost: vi.fn(async () => {}), addShapedPost: vi.fn(async () => true),
    changeFormat: vi.fn(async () => {}), regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}), generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}), clearHookCandidates: vi.fn(),
    ideas: [], ideasError: false,
    proposals: [], agentBusy: false, agentToast: null,
    ask: vi.fn(async () => null), applyChanges: vi.fn(async () => ({ applied: [], failures: [], changedPostIds: [] })),
    discardChanges: vi.fn(),
  } as unknown as PlanData;
}

/** The month footer, on whichever frame. On mobile it lives in the month view. */
function footerText(): string {
  return screen.getByTestId('month-foot').textContent ?? '';
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The 31 live posts of the real August cycle, by their real scheduled dates. */
const REAL_AUGUST = [
  '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
  '2026-08-08', '2026-08-09', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
  '2026-08-14', '2026-08-14', '2026-08-15', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
  '2026-08-21', '2026-08-22', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
  '2026-08-28', '2026-08-29', '2026-08-31',
].map((d, i) => post(`p${i}`, d));

describe('the month count is the MONTH’s, not the cycle’s', () => {
  it('counts every live post dated in the month — the real August, all 31 of them', () => {
    render(<CommittedSurface data={data(REAL_AUGUST)} frame="desktop" />);
    expect(footerText()).toContain('31 posts across August');
  });

  it('adds a post another cycle owns but which is DATED in this month', () => {
    // `loadCrossMonthPosts` is what puts it in the set; the count must not skip it just
    // because its cycleId is not the one on screen.
    const incoming = post('x1', '2026-08-16', { cycleId: 'cyc-sep' });
    render(<CommittedSurface data={data(REAL_AUGUST, [incoming])} frame="desktop" />);
    expect(footerText()).toContain('32 posts across August');
  });

  it('does NOT count a post this cycle owns that was moved OUT of the month', () => {
    // It belongs to the cycle and is loaded, but it is not part of August any more. The
    // "Outside this month" strip is where it goes; counting it here would make the number
    // disagree with the cards a client can see.
    const moved = post('gone', '2026-09-04');
    render(<CommittedSurface data={data([...REAL_AUGUST, moved])} frame="desktop" />);
    expect(footerText()).toContain('31 posts across August');
    expect(footerText()).not.toContain('32');
  });

  it('says the same number on both frames — one derivation, two shells', () => {
    render(<CommittedSurface data={data(REAL_AUGUST)} frame="desktop" />);
    const onDesktop = footerText();
    cleanup();

    // On the phone the grid is a peer view, so the footer is one nav tap away.
    render(<CommittedSurface data={data(REAL_AUGUST)} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    expect(footerText()).toBe(onDesktop);
  });

  it('an empty month says so in words rather than printing a zero', () => {
    render(<CommittedSurface data={data([])} frame="desktop" />);
    expect(footerText()).toContain('Nothing planned across August');
    expect(footerText()).not.toContain('0 posts');
  });

  it('the rail’s subtitle is the same count, not a second reading of the same rows', () => {
    render(<CommittedSurface data={data(REAL_AUGUST)} frame="desktop" />);
    expect(screen.getByTestId('plan-rail').textContent).toContain('31 posts this month');
  });
});
