/**
 * @vitest-environment jsdom
 *
 * summary-foot.interaction.test.tsx — the month summary's two foot buttons, on both frames. (F3)
 *
 * ── What was broken ──────────────────────────────────────────────────────────────────
 *
 * The assumption row ("We've assumed nothing's launching this month — anything coming up?") and
 * the shaping CTA ("Not right? Tell us what to change") DID NOTHING on desktop. Both were wired
 * to `setVoiceFor`, which on the phone opens the summoned sheet AND points it at the question —
 * one act, one mount-time effect. The desktop dock is never summoned: it has been open since the
 * page loaded, that effect had already run, and both buttons changed a prop nobody was listening
 * to. Two visible controls, no feedback, no error (operator, 3 Aug).
 *
 * ── What these tests hold ────────────────────────────────────────────────────────────
 *
 * Not "a click happened" — the two things a client would notice and the one thing a server sees:
 *
 *   THE COMPOSER TAKES FOCUS. That is the whole of the shaping CTA's job: it is an invitation to
 *   type, so the cursor has to be where the typing goes.
 *   THE QUESTION ARRIVES AS A TURN. The assumption row is answering something, and the thing
 *   being answered has to be on screen or the answer is context-free.
 *   THE REQUEST BODY IS THE SAME ON BOTH FRAMES. A surface can look right and send something
 *   else, and the phone's path is the one that already worked — so the desktop's is asserted
 *   against the same body rather than against itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { DraftSurface } from './DraftSurface';
import type { DraftBeatView } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';

const beat = (over: Partial<DraftBeatView> = {}): DraftBeatView => ({
  id: 'b1', cycleId: 'cyc-1', date: TODAY, format: 'reel', pillar: 'Home & Space',
  title: 'Wilderness candle relaunch — Launch', position: 0, slotType: 'proven',
  evidence: { basis: 'observed', pillarShare: 0.4, cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 } },
  assumptions: ['no launches or restocks are on record for this month'],
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
    surfaceKind: 'draft',
    draft: { beats: [beat(), beat({ id: 'b2', date: '2026-10-09', title: 'A small moment' })], pillars: ['Home & Space'], editable: true, receipts: [] },
    ...over,
  } as unknown as PlanData;
}

/** Every POST body this render sent, in order. */
let sent: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  window.sessionStorage.clear();
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && typeof init.body === 'string') {
      sent.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> });
    }
    return {
      ok: true,
      json: async () => ({ ok: true, conversationId: 'conv-1', turns: [], application: { id: 'r1', at: '', sourceText: '', scope: 'month_scoped', lines: ['Moved: something'], changedIds: [] }, beats: [] }),
    } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Open the summary panel, on whichever frame. A thin month opens it for you on desktop. */
function openSummary() {
  if (!screen.queryByTestId('draft-summary-detail')) {
    fireEvent.click(screen.getByTestId('draft-summary-toggle'));
  }
  return screen.getByTestId('draft-summary-detail');
}

const composer = () => screen.getByTestId('voice-input') as HTMLTextAreaElement;

/** Type into the composer and send, then hand back the body that went to the server. */
async function sendFromComposer(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
  return sent.find((s) => s.url.includes('/api/plan/draft/apply'))?.body;
}

for (const frame of ['desktop', 'mobile'] as const) {
  const isDesktop = frame === 'desktop';
  const renderSurface = () => (isDesktop
    ? render(<DraftSurface data={base()} frame="desktop" />)
    : render(<DraftSurface data={base()} />));

  describe(`the summary's foot buttons on ${frame}`, () => {
    beforeEach(() => { window.innerWidth = isDesktop ? 1440 : 390; });

    it('the shaping CTA puts the cursor in the composer', () => {
      // The whole job of "Not right? Tell us what to change" is to invite typing. On desktop it
      // did nothing at all: the dock was already open, so the only thing that used to happen —
      // a sheet appearing — was not available to happen.
      renderSurface();
      openSummary();
      fireEvent.click(screen.getByTestId('summary-shape'));

      expect(screen.getByTestId('voice-input')).toBeTruthy();
      expect(document.activeElement).toBe(composer());
    });

    it('the assumption row puts its question in the thread AND takes the composer', () => {
      renderSurface();
      const panel = openSummary();
      const nudge = within(panel).getByTestId('assumption-nudge');
      const question = nudge.textContent!.trim();
      fireEvent.click(nudge);

      // The thing being answered is on screen, so the answer has something to be about.
      expect(screen.getByTestId('thread').textContent).toContain(question);
      expect(document.activeElement).toBe(composer());
    });

    it('sends the client’s answer as an ordinary reshape — the SAME body on both frames', async () => {
      // The assertion that catches a surface which looks right and sends something else. The
      // phone's path is the one that already worked, so the desktop's is held to its shape
      // rather than to its own.
      renderSurface();
      const panel = openSummary();
      fireEvent.click(within(panel).getByTestId('assumption-nudge'));

      const body = await sendFromComposer('Nothing is launching in October');
      expect(body).toMatchObject({ op: 'text', text: 'Nothing is launching in October', source: 'web' });
      // …and it names the month it is for, on both frames (useDraftMonth.write).
      expect((body as { cycleId?: string }).cycleId).toBeTruthy();
    });

    it('pressing the shaping CTA twice still takes the composer the second time', () => {
      // The reason the signal is a counter and not a flag: a client taps "tell us what to
      // change", is interrupted, and taps it again. A boolean would already be true and the
      // second tap would be as dead as the first was.
      renderSurface();
      openSummary();
      fireEvent.click(screen.getByTestId('summary-shape'));
      composer().blur();
      expect(document.activeElement).not.toBe(composer());

      fireEvent.click(screen.getByTestId('summary-shape'));
      expect(document.activeElement).toBe(composer());
    });

    it('does not repeat the question when the surface re-renders', () => {
      // Keyed on the signal, not on `question`. Re-running on the question would append the same
      // agent turn on any unrelated re-render, and a thread that repeats itself reads worse than
      // one that misses a line.
      renderSurface();
      const panel = openSummary();
      const nudge = within(panel).getByTestId('assumption-nudge');
      const question = nudge.textContent!.trim();
      fireEvent.click(nudge);

      // Force re-renders that have nothing to do with the question.
      fireEvent.change(composer(), { target: { value: 'typing' } });
      fireEvent.change(composer(), { target: { value: 'typing more' } });

      const thread = screen.getByTestId('thread').textContent ?? '';
      const occurrences = thread.split(question).length - 1;
      expect(occurrences).toBe(1);
    });
  });
}
