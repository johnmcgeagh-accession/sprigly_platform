/**
 * @vitest-environment jsdom
 *
 * desktop.interaction.test.tsx — the desktop shell, driven.
 *
 * ── What this can and cannot prove ───────────────────────────────────────────────────
 *
 * jsdom has no layout engine, so nothing here measures a pixel and the column arithmetic
 * (196 + 24 + 512 + 20 + 320 + 24 + 344 = 1440) is asserted where it is DECLARED — in the
 * Tailwind width scale — rather than where it renders. The e2e project at 1440×900 is what
 * measures it.
 *
 * What this proves is the half a screenshot cannot: that the month and the day are on screen at
 * the same time and neither is a view you switch to; that opening a post takes the DAY column's
 * slot and leaves the conversation mounted; that the conversation is there before anyone asks
 * for it; and that the rings appear with an open turn and leave with it. Those are behavioural
 * facts, and every one of them would pass a render assertion while being wrong.
 *
 * Both widths run the same suite. 1024 is the middle band, where the plan region stacks and the
 * rail collapses — the layout differs, the BEHAVIOUR must not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { DraftSurface } from './DraftSurface';
import { CommittedSurface } from './CommittedSurface';
import type { DraftBeatView, PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';
const WIDTHS = [1440, 1024];

const draftBeat = (over: Partial<DraftBeatView> = {}): DraftBeatView => ({
  id: 'b1', cycleId: 'cyc-1', date: TODAY, format: 'reel', pillar: 'Home & Space',
  title: 'Wilderness candle relaunch — Launch', position: 0, slotType: 'proven',
  evidence: { basis: 'client_input', reason: 'The candle relaunches on the 24th' },
  assumptions: ['no launches or restocks are on record for this month'],
  ...over,
});

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'reel', pillar: 'Home & Space', title: 'Wilderness candle relaunch — Launch',
  caption: 'Wilderness is back. Cedarwood, damp earth, and the cold-clean note of open air.',
  hook: 'The one that sold out in a week.', script: null,
  status: 'new', reviewState: null, steps: [], postingTime: '06:00', rationale: 'Carousels average 70 likes.',
  ...over,
});

function base(over: Partial<PlanData> = {}): PlanData {
  return {
    posts: [], crossMonthPosts: [], calendarPosts: [], beats: [], beatsOn: () => [],
    weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: true }],
    viewedCycleId: 'cyc-1', homeCycleId: 'cyc-1', todayCycleId: 'cyc-1',
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
    ...over,
  } as unknown as PlanData;
}

const draftData = (beats: DraftBeatView[] = [draftBeat()]) => base({
  surfaceKind: 'draft',
  draft: { beats, pillars: ['Home & Space', 'Everyday Ritual'], editable: true, receipts: [] },
} as Partial<PlanData>);

const committedData = (over: Partial<PlanData> = {}) =>
  base({ posts: [post()], calendarPosts: [post()], ...over });

beforeEach(() => {
  // The surface persists the day it is standing on to sessionStorage (nav-state.ts — the reload
  // nobody pressed). Across tests that is pollution: a case that picks the 9th leaves the next
  // one standing on a day with no posts. Clear it, the way a fresh tab would be.
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, beats: [draftBeat()] }) }) as unknown as Response));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

for (const width of WIDTHS) {
  describe(`the desktop shell at ${width}px`, () => {
    beforeEach(() => { window.innerWidth = width; });

    // ── D1 · the shell ───────────────────────────────────────────────────────────────

    it('has four regions and a rail of three, and the mobile shell is nowhere near it', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);

      expect(screen.getByTestId('plan-desktop')).toBeTruthy();
      expect(screen.getByTestId('plan-rail')).toBeTruthy();
      expect(screen.getByTestId('month-col')).toBeTruthy();
      expect(screen.getByTestId('day-col')).toBeTruthy();
      expect(screen.getByTestId('conversation-dock')).toBeTruthy();

      // Three rail items since W6. Insights is STILL deliberately not drawn — a control that
      // does nothing is worse than an absent one, and the prediction that a vertical list would
      // take a third item with no layout change is what Ideas went on to prove.
      expect(screen.getByTestId('rail-plan')).toBeTruthy();
      expect(screen.getByTestId('rail-tasks')).toBeTruthy();
      expect(screen.getByTestId('rail-ideas')).toBeTruthy();
      expect(screen.queryByTestId('rail-insights')).toBeNull();

      // The mobile shell and its furniture are absent, not hidden.
      expect(screen.queryByTestId('plan-shell')).toBeNull();
      expect(screen.queryByTestId('nav-pill')).toBeNull();
      expect(screen.queryByTestId('nav-mic')).toBeNull();
      expect(screen.queryByTestId('week-strip')).toBeNull();
    });

    it('the retired controls are gone with their successors in place', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      // brief-month-btn (adding is the per-day slot, briefing is the conversation), the FAB
      // (the conversation is docked), Timeline / Notes / Approvals (the grid, the thread and
      // the interpretation turn absorbed them).
      for (const gone of ['brief-month-btn', 'agent-fab', 'nav-timeline', 'nav-notes', 'nav-approvals', 'rail']) {
        expect(screen.queryByTestId(gone), gone).toBeNull();
      }
      expect(screen.getByTestId('add-slot')).toBeTruthy();          // the successor to the first
      expect(screen.getByTestId('conversation-dock')).toBeTruthy(); // the successor to the rest
    });

    it('the identity is the phone’s component — accent word, accent mark, one place', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      const word = screen.getByText('Sprigly');
      expect(word.className).toContain('text-coral-700');
      expect(word.className).toContain('font-logo');
      expect(word.className).not.toContain('text-chrome');
      // `accent-600` is 2.35:1 on canvas and is ruled out for text by name.
      expect(word.className).not.toMatch(/\btext-coral-(500|600)\b/);
    });

    // ── D2 · month and day, side by side ─────────────────────────────────────────────

    it('renders the month grid AND the selected day at once, with no switcher between them', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);

      const monthCol = screen.getByTestId('month-col');
      const dayCol = screen.getByTestId('day-col');
      expect(within(monthCol).getByTestId('month-grid')).toBeTruthy();
      expect(within(dayCol).getByTestId('day-panel')).toBeTruthy();

      // The day the panel shows is the day the grid has selected — one selection, two readings.
      expect(within(dayCol).getByTestId('day-panel').getAttribute('data-date')).toBe(TODAY);
    });

    it('picking a day in the grid moves the day column and leaves the grid standing', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      const cell = document.querySelector('[data-testid="grid-cell"][data-date="2026-10-09"]')!;
      fireEvent.click(cell);

      expect(screen.getByTestId('day-panel').getAttribute('data-date')).toBe('2026-10-09');
      // Nothing was replaced: this is E2's whole point.
      expect(screen.getByTestId('month-grid')).toBeTruthy();
      expect(screen.getByTestId('conversation-dock')).toBeTruthy();
    });

    // ── D3 · the detail panel takes the DAY column's slot ────────────────────────────

    it('opening a post fills the day column and never the dock, and the month does not move', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      expect(screen.getByTestId('month-grid')).toBeTruthy();

      fireEvent.click(screen.getByTestId('post-card'));

      const detail = screen.getByTestId('detail-sheet');
      expect(detail.getAttribute('data-chrome')).toBe('panel');
      // IN the day column — a drill-down of the day, not a third column.
      expect(within(screen.getByTestId('day-col')).getByTestId('detail-sheet')).toBeTruthy();
      // The day list gave up its slot; the month and the conversation did not.
      expect(screen.queryByTestId('day-panel')).toBeNull();
      expect(screen.getByTestId('month-grid')).toBeTruthy();
      expect(screen.getByTestId('conversation-dock')).toBeTruthy();
      expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    });

    it('the detail panel is a region, not a modal — no scrim, no grabber', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      fireEvent.click(screen.getByTestId('post-card'));
      expect(screen.queryByTestId('detail-sheet-scrim')).toBeNull();
      expect(screen.queryByTestId('detail-sheet-grabber')).toBeNull();
      expect(screen.getByTestId('detail-sheet').getAttribute('aria-modal')).toBeNull();
    });

    it('the panel still carries the whole sheet — tabs, copy, insights, actions', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      fireEvent.click(screen.getByTestId('post-card'));
      const detail = screen.getByTestId('detail-sheet');
      expect(within(detail).getByTestId('tab-caption')).toBeTruthy();
      expect(within(detail).getByTestId('tab-hook')).toBeTruthy();
      expect(within(detail).getByTestId('copy-field')).toBeTruthy();
      expect(within(detail).getByTestId('insights-toggle')).toBeTruthy();
      expect(within(detail).getByTestId('act-move')).toBeTruthy();
      expect(within(detail).getByTestId('act-delete')).toBeTruthy();
    });

    // ── D4 · the docked conversation ─────────────────────────────────────────────────

    it('the conversation is there before anyone asks for it, and cannot be closed', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      // No gesture. It is a region of the shell.
      const dock = screen.getByTestId('conversation-dock');
      expect(within(dock).getByTestId('voice-sheet')).toBeTruthy();
      expect(within(dock).getByTestId('voice-input')).toBeTruthy();
      expect(within(dock).getByTestId('voice-mic')).toBeTruthy();
      // Nothing to close — the ✕ belongs to a sheet that covers the month.
      expect(screen.queryByTestId('voice-close')).toBeNull();
      expect(screen.queryByTestId('voice-sheet-scrim')).toBeNull();
    });

    it('does NOT take focus on mount — nobody opened it', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      expect(document.activeElement).not.toBe(screen.getByTestId('voice-input'));
    });

    it('a read-only month has no dock at all, rather than a composer that can only refuse', () => {
      render(<CommittedSurface data={committedData({ readOnly: true } as Partial<PlanData>)} frame="desktop" />);
      expect(screen.queryByTestId('conversation-dock')).toBeNull();
      expect(screen.getByTestId('month-grid')).toBeTruthy();
    });

    // ── D5 · the ringed days ─────────────────────────────────────────────────────────

    it('rings the days an OPEN turn names, and clears them when it is discarded', async () => {
      const ask = vi.fn(async () => ({
        conversationId: 'conv-1',
        items: [{
          kind: 'change' as const, proposalId: 'pr-1', action: 'move' as const,
          title: 'Wilderness candle relaunch — Launch',
          fromDate: '2026-10-01', toDate: '2026-10-09',
        }],
      }));
      render(<CommittedSurface data={committedData({ ask } as unknown as Partial<PlanData>)} frame="desktop" />);

      const ringed = () => [...document.querySelectorAll('[data-testid="grid-cell"][data-ringed="true"]')]
        .map((e) => e.getAttribute('data-date'));

      expect(ringed()).toEqual([]);

      fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'move the 1st to the 9th' } });
      await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });

      expect(screen.getByTestId('interpretation')).toBeTruthy();
      // BOTH ends of the move: the day losing the post and the day gaining it.
      expect(ringed().sort()).toEqual(['2026-10-01', '2026-10-09']);

      await act(async () => { fireEvent.click(screen.getByTestId('interp-discard')); });
      expect(ringed()).toEqual([]);
    });

    it('the ring is announced, not only drawn', async () => {
      const ask = vi.fn(async () => ({
        conversationId: 'conv-1',
        items: [{
          kind: 'change' as const, proposalId: 'pr-1', action: 'move' as const,
          title: 'Wilderness candle relaunch — Launch', fromDate: '2026-10-01', toDate: '2026-10-09',
        }],
      }));
      render(<CommittedSurface data={committedData({ ask } as unknown as Partial<PlanData>)} frame="desktop" />);
      fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'move it' } });
      await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });

      const cell = document.querySelector('[data-testid="grid-cell"][data-date="2026-10-09"]')!;
      expect(cell.getAttribute('aria-label')).toContain('in the change you are being asked about');
    });

    // ── the rail ─────────────────────────────────────────────────────────────────────

    it('Tasks replaces the plan region and the conversation stays put', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      fireEvent.click(screen.getByTestId('rail-tasks'));

      expect(screen.getByTestId('tasks-panel')).toBeTruthy();
      expect(screen.queryByTestId('month-grid')).toBeNull();
      // The dock is a region of the shell, not a feature of the Plan view.
      expect(screen.getByTestId('conversation-dock')).toBeTruthy();

      fireEvent.click(screen.getByTestId('rail-plan'));
      expect(screen.getByTestId('month-grid')).toBeTruthy();
    });

    // ── the draft month ──────────────────────────────────────────────────────────────

    it('a draft month wears its provisional skin in the same shell', () => {
      render(<DraftSurface data={draftData()} frame="desktop" />);
      expect(screen.getByTestId('plan-desktop')).toBeTruthy();
      expect(screen.getByTestId('draft-badge')).toBeTruthy();
      expect(screen.getByTestId('draft-framing')).toBeTruthy();
      expect(screen.getByTestId('ready-pill')).toBeTruthy();
      expect(screen.getByTestId('draft-card')).toBeTruthy();
      expect(screen.getByTestId('draft-summary')).toBeTruthy();
      expect(screen.getByTestId('conversation-dock')).toBeTruthy();
    });

    it('opening a planned post gives the day column the beat sheet, grounding and all', () => {
      render(<DraftSurface data={draftData()} frame="desktop" />);
      fireEvent.click(screen.getByTestId('draft-card'));
      const detail = screen.getByTestId('detail-sheet');
      expect(detail.getAttribute('data-chrome')).toBe('panel');
      expect(within(screen.getByTestId('day-col')).getByTestId('detail-sheet')).toBeTruthy();
      expect(within(detail).getByTestId('insights-toggle')).toBeTruthy();
      expect(screen.getByTestId('conversation-dock')).toBeTruthy();
    });

    // ── W2 · the approval is a modal at content width, not a full-width sheet ────────

    it('the Generate confirm is a centred MODAL on desktop and a sheet on the phone', () => {
      render(<DraftSurface data={draftData()} frame="desktop" />);
      fireEvent.click(screen.getByTestId('ready-pill'));
      const modal = screen.getByTestId('approval-sheet');
      expect(modal.getAttribute('data-chrome')).toBe('modal');
      // Still modal in the ways that matter — it is the one door that spends money.
      expect(modal.getAttribute('aria-modal')).toBe('true');
      expect(screen.getByTestId('approval-sheet-scrim')).toBeTruthy();
      // …and it carries the same three things it always did.
      expect(within(modal).getByTestId('approval-counts')).toBeTruthy();
      expect(within(modal).getByTestId('approval-consequence')).toBeTruthy();
      expect(within(modal).getByTestId('approve-confirm')).toBeTruthy();
      expect(within(modal).getByTestId('approve-not-yet')).toBeTruthy();
      cleanup();

      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('ready-pill'));
      // The sheet NAMES its frame now, like the other two. This used to assert the attribute
      // was absent, which pinned an accident: `Sheet` simply had not been given one, so "is
      // this the sheet form?" was answerable for two frames of three and had to be read off a
      // class string for the third.
      expect(screen.getByTestId('approval-sheet').getAttribute('data-chrome')).toBe('sheet');
    });

    // ── W3 · the dock's turns are panel-native ───────────────────────────────────────

    it('an agent turn bleeds to the dock’s edges instead of floating as a card', async () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      const turn = await screen.findByTestId('turn-agent');
      // The bleed is a negative inset against the thread's own gutter; the card treatment —
      // a radius and a right inset — is what a phone sheet needs and a panel does not.
      expect(turn.className).toContain('-mx-[18px]');
      expect(turn.className).not.toContain('rounded-[14px]');
      expect(turn.className).not.toContain('mr-8');
      // The register survives: the accent left edge and the tint are what make it the agent.
      expect(turn.className).toContain('border-l-[3px]');
      expect(turn.className).toContain('bg-coral-100');
    });

    it('a thread grows from the composer upwards in a dock', async () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      await screen.findByTestId('turn-agent');
      expect(screen.getByTestId('thread').className).toContain('[&>*:first-child]:mt-auto');
    });

    // ── W4 · tasks own the whole region ──────────────────────────────────────────────

    it('Tasks takes the whole plan region, not the day column', () => {
      render(<CommittedSurface data={committedData()} frame="desktop" />);
      fireEvent.click(screen.getByTestId('rail-tasks'));

      expect(within(screen.getByTestId('plan-region')).getByTestId('tasks-panel')).toBeTruthy();
      // The two columns are gone entirely — a checklist in a 420px column beside an empty
      // month is the shape this replaces.
      expect(screen.queryByTestId('day-col')).toBeNull();
      expect(screen.queryByTestId('month-col')).toBeNull();
      // …and its sections flow into columns rather than one mobile-width stack.
      expect(screen.getByTestId('tasks-panel').className).toContain('wide:columns-2');
    });

    it('opening a task’s post RETURNS to the plan, where the detail panel can be seen', () => {
      // W4 shipped this half-done and W6 found it: the detail renders into the DAY column, and
      // `region` replaces both columns — so setting the id while Tasks still owned the region
      // changed the state and nothing on the screen. A control that visibly does nothing.
      const withStep = post({ steps: [{ id: 's1', label: 'Shoot the reel', leadDays: 2, done: false, doneAt: null }] } as Partial<PlanPost>);
      render(<CommittedSurface data={committedData({ posts: [withStep], calendarPosts: [withStep] })} frame="desktop" />);
      fireEvent.click(screen.getByTestId('rail-tasks'));

      const panel = screen.getByTestId('tasks-panel');
      fireEvent.click(within(panel).getAllByText('Wilderness is back.')[0]!);

      expect(screen.queryByTestId('tasks-panel')).toBeNull();
      expect(within(screen.getByTestId('day-col')).getByTestId('detail-sheet')).toBeTruthy();
    });

    // ── D6 · the thin month ──────────────────────────────────────────────────────────

    it('a THIN month opens its own argument; a full one does not', () => {
      const thin = [draftBeat(), draftBeat({ id: 'b2', date: '2026-10-02', title: 'A small moment' })];
      render(<DraftSurface data={draftData(thin)} frame="desktop" />);
      // The panel that explains the month is what fills the column a thin month leaves empty.
      expect(screen.getByTestId('draft-summary-toggle').getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByTestId('thin-month')).toBeTruthy();
      cleanup();

      const full = Array.from({ length: 12 }, (_, i) =>
        draftBeat({ id: `b${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
      render(<DraftSurface data={draftData(full)} frame="desktop" />);
      // Thirty posts are their own argument. Two are not.
      expect(screen.getByTestId('draft-summary-toggle').getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('thin-month')).toBeNull();
    });
  });
}

describe('the mobile surface is untouched by any of it', () => {
  beforeEach(() => { window.innerWidth = 390; });

  it('still renders the phone shell, its nav pill and its week strip', () => {
    render(<CommittedSurface data={committedData()} />);
    expect(screen.getByTestId('plan-shell')).toBeTruthy();
    expect(screen.getByTestId('nav-pill')).toBeTruthy();
    expect(screen.getByTestId('week-strip')).toBeTruthy();
    expect(screen.queryByTestId('plan-desktop')).toBeNull();
    expect(screen.queryByTestId('conversation-dock')).toBeNull();
  });

  it('a thin month does NOT open the summary on a phone — it would push the day down', () => {
    const thin = [draftBeat(), draftBeat({ id: 'b2', date: '2026-10-02', title: 'A small moment' })];
    render(<DraftSurface data={draftData(thin)} />);
    expect(screen.getByTestId('draft-summary-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('the detail sheet is still a SHEET on a phone — scrim, grabber, modal', () => {
    render(<CommittedSurface data={committedData()} />);
    fireEvent.click(screen.getByTestId('post-card'));
    const detail = screen.getByTestId('detail-sheet');
    expect(detail.getAttribute('data-chrome')).toBe('sheet');
    expect(detail.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('detail-sheet-scrim')).toBeTruthy();
  });
});
