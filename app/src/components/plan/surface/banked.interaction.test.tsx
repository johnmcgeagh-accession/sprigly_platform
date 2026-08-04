/**
 * @vitest-environment jsdom
 *
 * banked.interaction.test.tsx — X2c/X2d, on the surface.
 *
 * Found live: a post the monthly change cap refused stored an honest message and kept its
 * instruction — and rendered as *On its way*. Nothing was coming until the allowance reset, so
 * the one sentence the client was shown about that post was false.
 *
 * These drive the real components. What they pin is the pair of claims the ruling makes: that
 * a banked post NEVER reads as on its way, and that it says what it is actually waiting for.
 * Plus the commercial half — one affordance, on the turn where the agent raised the cap, that
 * records the interest and says a person will follow up.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import { DetailSheet } from './DetailSheet';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';
import type { CapNotice } from '@/lib/agent/types';

const TODAY = '2026-07-31';
const RESETS = '2026-08-01T00:00:00.000Z';
const WAITING = 'Waiting for your changes to refresh on 1 August.';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'reel', pillar: 'New idea',
  title: 'Oak tree launch', caption: '', hook: null, script: null,
  status: 'generation_failed', reviewState: null, steps: [], postingTime: null, rationale: null,
  pendingInstruction: 'Launch the oak tree candle.',
  generationError: WAITING,
  banked: true,
  ...over,
});

function fakeData(over: Partial<PlanData> = {}): PlanData {
  const posts = (over.posts ?? [post()]) as PlanPost[];
  return {
    posts, crossMonthPosts: [], calendarPosts: posts, beats: [], beatsOn: () => [],
    weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-07', monthLabel: 'July 2026', prePlanning: false }],
    viewedCycleId: 'cyc-1', homeCycleId: 'cyc-1', todayCycleId: 'cyc-1',
    today: TODAY, clientName: 'Earl of East', readOnly: false,
    canEdit: () => true,
    shapingIds: new Set<string>(),
    hookGenerating: new Set<string>(), hookCandidates: new Map<string, string[]>(), hookError: new Map<string, string>(),
    scriptGenerating: new Set<string>(), scriptError: new Map<string, string>(), shapeErrors: new Map<string, string>(),
    proposals: [], agentBusy: false,
    switchCycle: vi.fn(async () => {}), addPost: vi.fn(async () => {}),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    changeFormat: vi.fn(async () => {}), regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}), generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}), clearHookCandidates: vi.fn(),
    ...over,
  } as unknown as PlanData;
}

afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
describe('X2c — a banked post never says "On its way"', () => {
  it('the card carries its OWN state, the stored message and the instruction we are holding', () => {
    render(<CommittedSurface data={fakeData()} />);

    expect(screen.queryByTestId('on-the-way')).toBeNull();
    expect(screen.getByTestId('banked').textContent).toBe('Waiting on your changes');
    expect(screen.getByTestId('banked-message').textContent).toBe(WAITING);
    expect(screen.getByTestId('banked-instruction').textContent).toContain('Launch the oak tree candle.');
  });

  it('and no working motion — nothing is in flight, so nothing pulses', () => {
    render(<CommittedSurface data={fakeData()} />);
    expect(screen.queryByTestId('on-the-way-dots')).toBeNull();
  });

  it('the month footer does not count it as being written', () => {
    render(<CommittedSurface data={fakeData({ posts: [post()] as PlanPost[] })} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    const footer = screen.getByTestId('month-foot').textContent ?? '';
    expect(footer).not.toMatch(/still being written/);
  });

  it('a post that IS being written still reads as on its way — the state is not collapsed', () => {
    render(<CommittedSurface data={fakeData({
      posts: [post({ status: 'generating', banked: false, generationError: null, title: null, caption: '' })] as PlanPost[],
    })} />);
    expect(screen.getByTestId('on-the-way').textContent).toBe('On its way');
    expect(screen.queryByTestId('banked')).toBeNull();
  });

  it('the detail sheet says the same thing, with room for the whole instruction', () => {
    const p = post();
    render(<DetailSheet post={p} data={fakeData()} rationale="" chrome="sheet" onClose={() => {}} onMove={() => {}} onDelete={() => {}} />);

    expect(screen.queryByTestId('detail-on-the-way')).toBeNull();
    const panel = screen.getByTestId('detail-banked').textContent ?? '';
    expect(panel).toContain('Waiting on your changes');
    expect(panel).toContain('1 August');
    expect(panel).toContain('Launch the oak tree candle.');
  });

  it('none of the copy uses the words the client fence bans', () => {
    render(<CommittedSurface data={fakeData()} />);
    expect(document.body.textContent).not.toMatch(/\b(failed|failure|retry|retrying)\b/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('X2a/X2d — the announcement, and the one thing it offers', () => {
  const NOTICE: CapNotice = { needed: 3, remaining: 0, limit: 30, resetsOn: RESETS };

  const withCap = (over: Partial<PlanData> = {}) => fakeData({
    posts: [post({ status: 'planned', banked: false, caption: 'A written post', generationError: null, pendingInstruction: null })] as PlanPost[],
    ask: vi.fn(async () => ({
      message: 'ok', proposals: [], items: [], conversationId: 'conv-1', capNotice: NOTICE,
    })),
    ...over,
  });

  const speak = async (value: string) => {
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
  };

  it('the cap becomes its own turn, with the sentence the client can act on', async () => {
    render(<CommittedSurface data={withCap()} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('tease it, launch it, show it in use');

    const turn = screen.getByTestId('turn-cap').textContent ?? '';
    expect(turn).toContain('3 changes');
    expect(turn).toContain('none left this month');
    expect(turn).toContain('1 August');
  });

  it('ONE affordance, and tapping it records the interest', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    render(<CommittedSurface data={withCap()} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('tease it, launch it, show it in use');

    await act(async () => { fireEvent.click(screen.getByTestId('want-more')); });

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('upsell-interest'));
    expect(call, 'the interest reaches the route').toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ cycleId: 'cyc-1', changesWanted: 3 });

    // The offer is replaced by what actually happens next, and it is a person, not a system.
    expect(screen.queryByTestId('want-more')).toBeNull();
    expect(screen.getByTestId('want-more-sent').textContent).toContain('we’ll be in touch');
    vi.unstubAllGlobals();
  });

  it('a refused record leaves the offer standing — nothing claims to be filed that is not', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: false, json: async () => ({}) }) as unknown as Response));

    render(<CommittedSurface data={withCap()} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('tease it, launch it, show it in use');
    await act(async () => { fireEvent.click(screen.getByTestId('want-more')); });

    expect(screen.getByTestId('want-more')).toBeTruthy();
    expect(screen.queryByTestId('want-more-sent')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('there is NO price, NO plan change and NO payment anywhere on the turn', async () => {
    render(<CommittedSurface data={withCap()} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('tease it, launch it, show it in use');

    const turn = screen.getByTestId('turn-cap').textContent ?? '';
    expect(turn).not.toMatch(/£|\$|upgrade|plan|card|pay|checkout|billing/i);
  });

  it('no notice → no cap turn at all', async () => {
    render(<CommittedSurface data={fakeData({
      posts: [post({ status: 'planned', banked: false, caption: 'A written post' })] as PlanPost[],
      ask: vi.fn(async () => ({ message: 'Done.', proposals: [], items: [], conversationId: 'conv-1' })),
    })} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');
    expect(screen.queryByTestId('turn-cap')).toBeNull();
    expect(screen.queryByTestId('want-more')).toBeNull();
  });
});
