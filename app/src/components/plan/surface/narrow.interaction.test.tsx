/**
 * @vitest-environment jsdom
 *
 * narrow.interaction.test.tsx — every new sheet and state, at 375px and 320px. (R4)
 *
 * ── What this can and cannot prove ───────────────────────────────────────────────────
 *
 * The ≤480px breakpoint has never been exercised by any design round: Chrome headless clamps its
 * viewport to a 500px minimum, so the round-5.1 "clipping at 460px" finding turned out to be a
 * screenshot-crop artifact and the breakpoint stayed unverified (X7). jsdom has no layout engine
 * either, so nothing here measures a pixel.
 *
 * What it DOES prove is the half that a screenshot cannot: that at those widths every sheet still
 * opens, every control is present, and every flow still completes. A geometric check is a device
 * check, and the report says so rather than claiming it here.
 *
 * Every sheet Session B added is driven end-to-end at both widths, because the failure this
 * guards against is a control that renders at 390 and is unreachable at 320 — which is a
 * behavioural fact a render assertion would miss.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { DraftSurface } from './DraftSurface';
import { CommittedSurface } from './CommittedSurface';
import type { DraftBeatView, PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';
const WIDTHS = [375, 320];

class FakeRecognition {
  static live: FakeRecognition | null = null;
  continuous = false; interimResults = false; lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  /** WebKit fires this when the capture actually OPENS. The sheet now requires it before it
   *  will claim to be listening — see VoiceSheet's `audioOk`. A fake without it models a
   *  browser that says "recording" and never records, which is the bug, not the baseline. */
  onaudiostart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  start() { FakeRecognition.live = this; this.onaudiostart?.(); }
  stop() { this.onend?.(); }
}

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

const RECEIPT = {
  id: 'r1', at: '', sourceText: 'The Navy Edit launches on 28th August', scope: 'month_scoped',
  changedIds: ['b1'], lines: ['Added: The Navy Edit — Launch, Fri 28 Aug'],
};

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
    ...over,
  } as unknown as PlanData;
}

const draftData = (receipts: unknown[] = []) => base({
  surfaceKind: 'draft',
  draft: { beats: [draftBeat()], pillars: ['Home & Space', 'Everyday Ritual'], editable: true, receipts },
} as Partial<PlanData>);

const committedData = (over: Partial<PlanData> = {}) => base({ posts: [post()], calendarPosts: [post()], ...over });

beforeEach(() => {
  FakeRecognition.live = null;
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, beats: [draftBeat()] }) }) as unknown as Response));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

for (const width of WIDTHS) {
  describe(`at ${width}px`, () => {
    beforeEach(() => { window.innerWidth = width; });

    it('the draft month renders whole: badge, framing, pill, strip, nav, mic', () => {
      render(<DraftSurface data={draftData()} />);
      for (const id of ['draft-badge', 'draft-framing', 'ready-pill', 'week-strip', 'nav-pill', 'nav-mic', 'draft-card', 'add-slot']) {
        expect(screen.getByTestId(id), id).toBeTruthy();
      }
      expect(document.querySelectorAll('[data-testid="week-day"]')).toHaveLength(7);
      expect(screen.getByTestId('prev-week')).toBeTruthy();
      expect(screen.getByTestId('next-week')).toBeTruthy();
    });

    it('THE CONVERSATION SHEET opens, takes a sentence in the composer and sends it — and stays', async () => {
      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('nav-mic'));

      expect(screen.getByTestId('voice-sheet')).toBeTruthy();
      expect(screen.getByTestId('voice-mic')).toBeTruthy();
      expect(screen.queryAllByTestId('voice-starter')).toHaveLength(0);

      // One composer for keyboard and voice — no mode toggle to fit any more.
      fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'more product this month' } });
      await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
      // The thread model: the sheet STAYS, the exchange renders as turns.
      expect(screen.getByTestId('voice-sheet')).toBeTruthy();
      expect(screen.getByTestId('turn-user').textContent).toBe('more product this month');
    });

    it('THE THREAD fits the width — turns are fluid, never fixed', async () => {
      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('nav-mic'));
      const framing = await screen.findByTestId('turn-agent');
      expect(framing.className).toContain('self-stretch');
      expect(framing.className).not.toMatch(/\bw-\[\d+px\]|\bmin-w-\[\d{3,}px\]/);
    });

    it('THE APPROVAL SHEET opens with its counts and both answers reachable', () => {
      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('ready-pill'));

      expect(screen.getByTestId('approval-counts').querySelectorAll('li').length).toBeGreaterThan(0);
      expect(screen.getByTestId('approve-confirm')).toBeTruthy();
      fireEvent.click(screen.getByTestId('approve-not-yet'));
      expect(screen.queryByTestId('approval-sheet')).toBeNull();
    });

    it('THE ADD SHEET opens with format, pillar and subject, and submits', async () => {
      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('add-slot'));

      expect(screen.getByTestId('add-format')).toBeTruthy();
      expect(screen.getByTestId('add-pillar')).toBeTruthy();
      fireEvent.change(screen.getByTestId('add-subject'), { target: { value: 'the candle' } });
      await act(async () => { fireEvent.click(screen.getByTestId('add-confirm')); });
      expect(screen.queryByTestId('add-sheet')).toBeNull();
    });

    it('THE DRAFT DETAIL SHEET opens, changes format and reaches the move picker', async () => {
      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('draft-card'));

      expect(screen.getByTestId('detail-sheet')).toBeTruthy();
      expect(screen.getByTestId('format-control')).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByTestId('format-carousel')); });

      fireEvent.click(screen.getByTestId('act-move'));
      expect(screen.getByTestId('move-sheet')).toBeTruthy();
      expect(screen.getAllByTestId('grid-cell').length).toBeGreaterThan(27);
    });

    it('THE SUMMARY CHIP and its panel are reachable and clearable', () => {
      render(<DraftSurface data={draftData([RECEIPT])} />);
      fireEvent.click(screen.getByTestId('summary-chip'));

      expect(screen.getByTestId('receipt-panel')).toBeTruthy();
      expect(screen.getAllByTestId('receipt-line')).toHaveLength(1);
      fireEvent.click(screen.getByTestId('clear-summary'));
      expect(screen.queryByTestId('summary-chip')).toBeNull();
    });

    it('THE ASSUMPTION NUDGE is reachable and opens the sheet on its question — as an agent turn', async () => {
      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('assumption-nudge'));
      const agents = await screen.findAllByTestId('turn-agent');
      expect(agents[agents.length - 1]!.textContent).toContain('anything coming up?');
    });

    it('the COMMITTED sheet still reaches its tabs, its format control and its actions', () => {
      render(<CommittedSurface data={committedData()} />);
      fireEvent.click(screen.getByTestId('post-card'));

      fireEvent.click(screen.getByTestId('tab-script'));
      expect(screen.getByTestId('generate-script')).toBeTruthy();
      expect(screen.getByTestId('act-move')).toBeTruthy();
      expect(screen.getByTestId('act-delete')).toBeTruthy();

      // The format control lives inside Shape now, and Shape is reachable at both widths.
      fireEvent.click(screen.getByTestId('tab-caption'));
      fireEvent.click(screen.getByTestId('act-shape'));
      expect(screen.getByTestId('format-control')).toBeTruthy();
      expect(screen.getByTestId('shape-input')).toBeTruthy();
    });

    it('a sheet can always be left — grabber, scrim and its own close', () => {
      render(<DraftSurface data={draftData()} />);
      fireEvent.click(screen.getByTestId('nav-mic'));

      expect(screen.getByTestId('voice-sheet-grabber')).toBeTruthy();
      expect(screen.getByTestId('voice-sheet-scrim')).toBeTruthy();
      fireEvent.click(screen.getByTestId('voice-close'));
      expect(screen.queryByTestId('voice-sheet')).toBeNull();
    });
    it('THE INTERPRETATION fits: no fixed widths, and Apply never runs off the edge', async () => {
      render(<CommittedSurface data={committedData({
        ask: vi.fn(async () => ({
          message: '', proposals: [{ id: 'pr1' }, { id: 'pr2' }],
          items: [
            { kind: 'change', proposalId: 'pr1', action: 'move', title: 'Fragrance Note Deep Dive: Summer', fromDate: '2026-10-08', toDate: '2026-10-12' },
            { kind: 'change', proposalId: 'pr2', action: 'add', title: 'Atlas Cedar restock', toDate: '2026-10-20', format: 'single' },
          ],
        })),
        proposals: [{ id: 'pr1' }, { id: 'pr2' }],
        applyChanges: vi.fn(async () => ({ applied: ['pr1', 'pr2'], failed: [], changedPostIds: [] })),
        discardChanges: vi.fn(async () => {}),
      } as unknown as Partial<PlanData>)} />);
      fireEvent.click(screen.getByTestId('nav-mic'));
      fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'move it and add one' } });
      await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
      {
        const apply = screen.getByTestId('interp-apply');
        // The label grows with the count — "Apply these 2 changes" beside a Discard button at
        // 320px is where a fixed width would show. It is fluid, and it wraps rather than clips.
        expect(apply.className).toContain('flex-1');
        expect(apply.className).not.toMatch(/\bw-\[\d+px\]/);
        expect(screen.getByTestId('interp-discard').className).toContain('flex-none');
        // Every line is a full-width row inside a scrolling region, not a fixed column.
        for (const row of screen.getAllByTestId('interp-change')) {
          expect(row.className).not.toMatch(/\bw-\[\d+px\]|\bmin-w-\[\d{3,}px\]/);
        }
      }
    });

  });
}
