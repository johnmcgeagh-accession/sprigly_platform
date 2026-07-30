/**
 * @vitest-environment jsdom
 *
 * draft-surface.interaction.test.tsx — the draft month, in the shell, driven.
 *
 * The standing invariant: interaction, not render. Every assertion here happens after a tap,
 * because what breaks on this surface is sequential — the panel following the strip, the sheet
 * carrying the right beat, an undo that restores rather than re-adds.
 *
 * The fixture is Earl of East's October from the Build D dogfood run, plus the one thing the
 * mockups could not show: a `client_input` beat, whose reason rendered blank until this session
 * (gap 4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, within, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { DraftSurface } from './DraftSurface';
import type { DraftBeatView } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';   // a Thursday

const beat = (over: Partial<DraftBeatView> = {}): DraftBeatView => ({
  id: 'b1', cycleId: 'cyc-1', date: TODAY, format: 'reel', pillar: 'Home & Space',
  title: 'Wilderness candle relaunch — Launch', position: 0, slotType: 'proven',
  evidence: { basis: 'client_input', reason: 'The Wilderness candle relaunches on the 24th, can we build up to it?' },
  assumptions: [],
  ...over,
});

/** The fetch the surface makes, and what it hands back. */
function stubFetch(reply: Record<string, unknown> = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return { ok: true, json: async () => ({ ok: true, ...reply }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

function fakeData(over: Partial<PlanData> = {}, beats: DraftBeatView[] = [beat()]): PlanData {
  const draft = { beats, pillars: ['Home & Space', 'Everyday Ritual'], editable: true, receipts: [] };
  return {
    posts: [], crossMonthPosts: [], calendarPosts: [], beats: [], beatsOn: () => [],
    weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: true }],
    viewedCycleId: 'cyc-1', homeCycleId: 'cyc-1', todayCycleId: 'cyc-1',
    today: TODAY, clientName: 'Earl of East', readOnly: false,
    surfaceKind: 'draft', draft, setDraft: vi.fn(),
    canEdit: () => true,
    switchCycle: vi.fn(async () => {}),
    track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    toast: null,
    ...over,
  } as unknown as PlanData;
}

beforeEach(() => { window.innerWidth = 390; window.sessionStorage.clear(); });   // nav-state must not leak a position between tests — each render is a fresh tab
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the draft month renders in the SHELL', () => {
  it('is the same frame as a committed month, not a page of its own', () => {
    render(<DraftSurface data={fakeData()} />);

    expect(screen.getByTestId('plan-shell')).toBeTruthy();
    expect(screen.getByTestId('nav-pill')).toBeTruthy();
    expect(screen.getByTestId('week-strip')).toBeTruthy();
    expect(screen.getByTestId('month-title').textContent).toBe('October 2026');
    // The retired standalone chrome: month pills, and a header that restated the client's name.
    expect(screen.queryByTestId('draft-month-nav')).toBeNull();
    expect(screen.queryByText(/We’ve drafted/)).toBeNull();
  });

  it('says it is a draft in one badge and one line, possessive-month', () => {
    render(<DraftSurface data={fakeData()} />);
    expect(screen.getByTestId('draft-badge').textContent).toBe('Draft');
    expect(screen.getByTestId('draft-framing').textContent).toBe('This is your October draft');
    // "Not sent yet" is redundant with the badge and is gone (round 3, R8).
    expect(screen.queryByText('Not sent yet')).toBeNull();
  });

  it('counts PLANNED POSTS, and never says "beat"', () => {
    render(<DraftSurface data={fakeData({}, [beat(), beat({ id: 'b2', position: 1 })])} />);
    expect(screen.getByTestId('day-count').textContent).toBe('2 planned posts');
    expect(document.body.textContent).not.toMatch(/\bbeats?\b/i);
  });

  it('the day view follows the strip, exactly as the committed one does', () => {
    render(<DraftSurface data={fakeData({}, [
      beat({ id: 'a', date: '2026-10-01', title: 'the first' }),
      beat({ id: 'b', date: '2026-10-02', title: 'the second' }),
    ])} />);
    expect(screen.getByTestId('day-panel').getAttribute('data-date')).toBe('2026-10-01');
    expect(screen.getByText('the first')).toBeTruthy();

    fireEvent.click(document.querySelector('[data-testid="week-day"][data-date="2026-10-02"]')!);
    expect(screen.getByText('the second')).toBeTruthy();
    expect(screen.queryByText('the first')).toBeNull();
  });

  it('the month grid marks draft days in accent, and stays the view (P6)', () => {
    render(<DraftSurface data={fakeData()} />);
    fireEvent.click(screen.getByTestId('nav-month'));

    const dot = document.querySelector(`[data-testid="grid-cell"][data-date="${TODAY}"] [data-testid="grid-dot"]`);
    expect(dot?.getAttribute('data-mark')).toBe('draft');

    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);
    expect(screen.getByTestId('month-grid')).toBeTruthy();
    expect(screen.getByTestId('month-summary').textContent).toContain('Nothing drafted');
  });
});

describe('the draft card', () => {
  it('is DASHED and carries no shadow — a provisional thing must not look settled', () => {
    render(<DraftSurface data={fakeData()} />);
    const card = screen.getByTestId('draft-card');
    expect(card.className).toContain('border-dashed');
    expect(card.className).not.toContain('shadow-card');
  });

  it('QUOTES THE CLIENT BACK when the beat came from their own words (gap 4)', () => {
    render(<DraftSurface data={fakeData()} />);
    expect(screen.getByTestId('card-reason').textContent)
      .toBe('From what you told us: “The Wilderness candle relaunches on the 24th, can we build up to it?”');
  });

  it('states a measured figure with its sample size when that is the evidence', () => {
    render(<DraftSurface data={fakeData({}, [beat({
      evidence: { basis: 'observed', formatEngagement: { format: 'single', avgEngagement: 38.2, posts: 23 } },
    })])} />);
    expect(screen.getByTestId('card-reason').textContent)
      .toBe('Single posts average 38 likes and comments across your last 23 posts.');
  });

  it('shows NO reason rather than a hedge when the evidence supports nothing', () => {
    render(<DraftSurface data={fakeData({}, [beat({ evidence: { basis: 'observed' } })])} />);
    expect(screen.queryByTestId('card-reason')).toBeNull();
  });

  it('states no TIME — the assembler records none, and the mockups’ times were examples', () => {
    render(<DraftSurface data={fakeData()} />);
    expect(screen.getByTestId('draft-card').textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('marks an experiment with a banner pill carrying its WORDS, and no tooltip (§2.1)', () => {
    render(<DraftSurface data={fakeData({}, [beat({ slotType: 'experiment' })])} />);
    const pill = screen.getByTestId('experiment-pill');
    expect(pill.textContent).toBe('Something new');
    // Not tappable, and not styled as though it were — X4 cuts both ways.
    expect(pill.tagName).toBe('SPAN');
    expect(pill.getAttribute('title')).toBeNull();
  });

  it('the changed card is the one card that is NOT dashed', () => {
    const data = fakeData();
    (data.draft as { receipts: unknown[] }).receipts = [{ id: 'r1', at: '', sourceText: '', scope: 'month_scoped', lines: [], changedIds: ['b1'] }];
    render(<DraftSurface data={data} />);
    const card = screen.getByTestId('draft-card');
    expect(card.getAttribute('data-changed')).toBe('true');
    expect(card.className).not.toContain('border-dashed');
    expect(screen.getByTestId('changed-badge').textContent).toBe('New');
  });

  it('three or more on a day become compact rows, and four is the cap', () => {
    const many = Array.from({ length: 6 }, (_, i) => beat({ id: `b${i}`, position: i, title: `post ${i}` }));
    render(<DraftSurface data={fakeData({}, many)} />);

    expect(screen.queryByTestId('draft-card')).toBeNull();
    expect(screen.getAllByTestId('post-row')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getAllByTestId('post-row')).toHaveLength(6);
  });
});

describe('the draft detail sheet', () => {
  const open = () => fireEvent.click(screen.getByTestId('draft-card'));

  it('has no tabs, no copy and no Shape — none of those things exists yet', () => {
    render(<DraftSurface data={fakeData()} />);
    open();

    expect(screen.getByTestId('not-written-yet')).toBeTruthy();
    expect(screen.queryByTestId('tab-caption')).toBeNull();
    expect(screen.queryByTestId('copy-field')).toBeNull();
    expect(screen.queryByTestId('act-shape')).toBeNull();
    expect(screen.getByTestId('act-move')).toBeTruthy();
    expect(screen.getByTestId('act-delete')).toBeTruthy();
  });

  it('puts the reason behind the insights icon, where every other post’s reasoning lives', () => {
    render(<DraftSurface data={fakeData()} />);
    open();
    expect(screen.queryByTestId('insights')).toBeNull();

    fireEvent.click(screen.getByTestId('insights-toggle'));
    expect(screen.getByTestId('insights').textContent).toContain('From what you told us');
  });

  it('explains the experiment marker HERE, which is the whole reason the card needs no tooltip', () => {
    render(<DraftSurface data={fakeData({}, [beat({ slotType: 'experiment' })])} />);
    open();
    fireEvent.click(screen.getByTestId('insights-toggle'));
    expect(screen.getByTestId('experiment-note').textContent).toContain('a new idea we’re trying');
  });

  it('changes the format through the draft mutation, not the posts API', async () => {
    const calls = stubFetch({ beats: [beat({ format: 'carousel' })] });
    render(<DraftSurface data={fakeData()} />);
    open();
    await act(async () => { fireEvent.click(screen.getByTestId('format-carousel')); });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/plan/draft');
    expect(calls[0]!.body).toEqual({ op: 'format', postId: 'b1', format: 'carousel' });
  });

  it('the move picker offers NO posting time — the draft route cannot save one', () => {
    render(<DraftSurface data={fakeData()} />);
    open();
    fireEvent.click(screen.getByTestId('act-move'));

    expect(screen.getByTestId('move-sheet')).toBeTruthy();
    expect(screen.queryByTestId('time-slots')).toBeNull();
    expect(screen.queryByTestId('time-free')).toBeNull();
  });

  it('a read-only month shows the post and none of the controls', () => {
    const data = fakeData();
    (data.draft as { editable: boolean }).editable = false;
    render(<DraftSurface data={data} />);
    open();

    expect(screen.getByTestId('not-written-yet')).toBeTruthy();
    expect(screen.queryByTestId('format-control')).toBeNull();
    expect(screen.queryByTestId('act-move')).toBeNull();
    expect(screen.queryByTestId('act-delete')).toBeNull();
    expect(screen.queryByTestId('add-slot')).toBeNull();
  });
});

describe('structural edits, and one slot of undo', () => {
  const open = () => fireEvent.click(screen.getByTestId('draft-card'));

  it('a move sends the date and offers to put it back', async () => {
    const calls = stubFetch({ beats: [beat({ date: '2026-10-22' })] });
    render(<DraftSurface data={fakeData()} />);
    open();
    fireEvent.click(screen.getByTestId('act-move'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);
    await act(async () => { fireEvent.click(screen.getByTestId('move-confirm')); });

    expect(calls[0]!.body).toEqual({ op: 'move', postId: 'b1', date: '2026-10-22' });
    expect(screen.getByTestId('feedback').textContent).toContain('Moved to 22 Oct');

    await act(async () => { fireEvent.click(screen.getByTestId('feedback-undo')); });
    expect(calls[1]!.body).toEqual({ op: 'move', postId: 'b1', date: TODAY });
  });

  it('a delete RESTORES the whole beat on undo, never re-adds a husk', async () => {
    const dropped = { date: TODAY, format: 'reel', pillar: 'Home & Space', title: 'Wilderness candle relaunch — Launch', position: 0, beatMeta: { slotType: 'proven' } };
    const calls = stubFetch({ beats: [], dropped });
    render(<DraftSurface data={fakeData()} />);
    open();
    await act(async () => { fireEvent.click(screen.getByTestId('act-delete')); });

    expect(calls[0]!.body).toEqual({ op: 'drop', postId: 'b1' });
    expect(screen.getByTestId('feedback').textContent).toContain('Post removed.');

    await act(async () => { fireEvent.click(screen.getByTestId('feedback-undo')); });
    // The WHOLE row goes back — title, evidence, position — not {date, format, pillar}.
    expect(calls[1]!.body).toEqual({ op: 'restore', beat: dropped });
  });

  it('says "Post removed", never "Beat removed"', async () => {
    stubFetch({ beats: [] });
    render(<DraftSurface data={fakeData()} />);
    open();
    await act(async () => { fireEvent.click(screen.getByTestId('act-delete')); });
    expect(screen.getByTestId('feedback').textContent).not.toMatch(/beat/i);
  });

  it('the add slot opens the shaping sheet, and a draft month ASKS for a pillar', async () => {
    const calls = stubFetch({ beats: [beat()] });
    render(<DraftSurface data={fakeData()} />);
    fireEvent.click(screen.getByTestId('add-slot'));

    expect(screen.getByTestId('add-sheet')).toBeTruthy();
    // addBeat refuses a pillar outside the configured vocabulary, so the sheet has to ask.
    const pillar = screen.getByTestId('add-pillar') as HTMLSelectElement;
    expect([...pillar.options].map((o) => o.value)).toEqual(['Home & Space', 'Everyday Ritual']);

    fireEvent.change(screen.getByTestId('add-subject'), { target: { value: 'The candle, back in stock' } });
    await act(async () => { fireEvent.click(screen.getByTestId('add-confirm')); });

    expect(calls[0]!.body).toEqual({
      op: 'add', date: TODAY, format: 'single', pillar: 'Home & Space', subject: 'The candle, back in stock',
    });
  });

  /** Every setDraft updater, applied in order to a starting draft — what the client ends up with. */
  const settled = (data: PlanData, from: DraftBeatView[]) => {
    const calls = (data.setDraft as unknown as { mock: { calls: [(d: unknown) => unknown][] } }).mock.calls;
    let state: unknown = { beats: from, pillars: [], editable: true, receipts: [] };
    for (const [updater] of calls) state = updater(state);
    return state as { beats: DraftBeatView[] };
  };

  it('shows the move IMMEDIATELY, then settles on the SERVER’s list (round 7, fix 3)', async () => {
    const authoritative = [beat({ id: 'b1', date: '2026-10-22' }), beat({ id: 'b9', date: '2026-10-30' })];
    stubFetch({ beats: authoritative });
    const data = fakeData();
    render(<DraftSurface data={data} />);
    open();
    fireEvent.click(screen.getByTestId('act-move'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);
    await act(async () => { fireEvent.click(screen.getByTestId('move-confirm')); });

    const calls = (data.setDraft as unknown as { mock: { calls: [(d: unknown) => unknown][] } }).mock.calls;
    // FIRST the optimistic patch — the card moves under the thumb…
    const first = calls[0]![0]({ beats: [beat()], pillars: [], editable: true, receipts: [] }) as { beats: DraftBeatView[] };
    expect(first.beats[0]!.date).toBe('2026-10-22');
    // …and LAST the server's authoritative list, so a rejected mutation can never leave the
    // client showing a change that did not happen.
    expect(settled(data, [beat()]).beats).toEqual(authoritative);
  });

  it('A REFUSED WRITE ROLLS BACK VISIBLY, and says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, json: async () => ({ ok: false, message: 'This month’s draft is closed for changes.' }),
    }) as unknown as Response));
    const data = fakeData();
    render(<DraftSurface data={data} />);
    fireEvent.click(screen.getByTestId('draft-card'));
    await act(async () => { fireEvent.click(screen.getByTestId('act-delete')); });

    await waitFor(() => expect(data.flash).toHaveBeenCalledWith('This month’s draft is closed for changes.'));
    // The beat went, and came back. What matters is where the client ends up: exactly where they
    // started. A change that silently stays after a refusal is the failure this guards against.
    expect(settled(data, [beat()]).beats).toEqual([beat()]);
    expect(screen.queryByTestId('feedback-undo')).toBeNull();
  });

  it('a refused FORMAT change puts the format back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, json: async () => ({ ok: false, message: 'That isn’t a format we can plan for.' }),
    }) as unknown as Response));
    const data = fakeData();
    render(<DraftSurface data={data} />);
    open();
    await act(async () => { fireEvent.click(screen.getByTestId('format-carousel')); });

    await waitFor(() => expect(data.flash).toHaveBeenCalledWith('That isn’t a format we can plan for.'));
    expect(settled(data, [beat()]).beats[0]!.format).toBe('reel');
  });
});

describe('a thin month', () => {
  it('acknowledges itself at the FOOT of the day, and never as a caveat above it', () => {
    render(<DraftSurface data={fakeData({}, [beat(), beat({ id: 'b2', date: '2026-10-09', position: 1 })])} />);
    const note = screen.getByTestId('thin-month');
    expect(note.textContent).toContain('2 posts so far');
    expect(note.textContent).toContain('say you’re ready');

    // After the day's content, not before it: an invitation reads as confidence, a warning
    // reads as an excuse.
    const panel = screen.getByTestId('day-panel');
    const kids = [...panel.children];
    expect(kids.indexOf(note)).toBe(kids.length - 1);
  });

  it('a full month says nothing about its size', () => {
    const many = Array.from({ length: 10 }, (_, i) => beat({ id: `b${i}`, date: `2026-10-0${(i % 9) + 1}`, position: i }));
    render(<DraftSurface data={fakeData({}, many)} />);
    expect(screen.queryByTestId('thin-month')).toBeNull();
  });

  it('the month view counts the month rather than padding it with ghost cells', () => {
    render(<DraftSurface data={fakeData({}, [beat(), beat({ id: 'b2', date: '2026-10-09', position: 1 })])} />);
    fireEvent.click(screen.getByTestId('nav-month'));
    expect(screen.getByTestId('month-foot').textContent).toBe('2 planned posts across October. Tap a day to see it.');
  });
});

describe('the ivy-t density case', () => {
  /** Seven pillars, three posts on 3 August, titles verbatim including the clipping. */
  const IVY = [
    '14th August — the stock leaves the factory for our next drop. Tease it: can you show the boxes being packed and the labels going on, without showing the pieces themselves',
    '15th August — our factory in Portugal starts its annual summer shutdown until 7th September',
    'In the Navy Edit build-up, include colour-reveal content — who can guess the main colour',
  ];

  it('survives 200-character titles in a compact row without carrying pillar or format words', () => {
    render(<DraftSurface data={fakeData({}, IVY.map((t, i) => beat({ id: `i${i}`, position: i, title: t, pillar: 'Understands Real Women' })))} />);

    const rows = screen.getAllByTestId('post-row');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      // Time and title answer *what is happening and when*; everything else is a tap away.
      expect(r.textContent).not.toContain('Understands Real Women');
      expect(within(r).getByTestId('format-tile')).toBeTruthy();
      expect(r.querySelector('.truncate')).toBeTruthy();
    }
  });
});

describe('the microphone, and what it does HERE', () => {
  it('is present on an editable draft and named for this month', () => {
    render(<DraftSurface data={fakeData()} />);
    expect(screen.getByTestId('nav-mic').getAttribute('aria-label')).toBe('Tell us about October');
  });

  it('is ABSENT past the cutoff — a mic that refuses is worse than no mic', () => {
    const data = fakeData();
    (data.draft as { editable: boolean }).editable = false;
    render(<DraftSurface data={data} />);
    expect(screen.queryByTestId('nav-mic')).toBeNull();
  });

  it('opens the voice sheet, and the sheet is where the framing copy lives', () => {
    render(<DraftSurface data={fakeData()} />);
    fireEvent.click(screen.getByTestId('nav-mic'));

    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    expect(screen.getByTestId('voice-framing').textContent).toContain('This is your October draft');
    // There is exactly ONE place to say something: the page carries no say-something box.
    expect(screen.queryByLabelText('Anything we should know?')).toBeNull();
  });

  it('sends what was said to the draft apply route, WITH its transport (gap 8)', async () => {
    const calls = stubFetch({ beats: [beat()], application: { id: 'r', at: '', sourceText: 'x', scope: 'month_scoped', lines: [], changedIds: [] } });
    render(<DraftSurface data={fakeData()} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    fireEvent.click(screen.getByTestId('voice-mode'));
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'The candle relaunches on the 24th' } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });

    expect(calls[0]!.url).toBe('/api/plan/draft/apply');
    expect(calls[0]!.body).toEqual({ op: 'text', text: 'The candle relaunches on the 24th', source: 'web' });
    expect(screen.queryByTestId('voice-sheet')).toBeNull();
  });
});

describe('the assumption, re-voiced as a nudge', () => {
  const withAssumptions = (assumptions: string[]) => fakeData({}, [beat({ assumptions })]);

  it('shows the ONE the client can act on, as a question, once', () => {
    render(<DraftSurface data={withAssumptions([
      'no launches or restocks are on record for this month',
      'the format mix is based on posts whose format we could not read',
    ])} />);

    const nudge = screen.getByTestId('assumption-nudge');
    expect(nudge.textContent).toContain('anything coming up?');
    // The second is a fact about OUR data, not a question for them.
    expect(document.body.textContent).not.toContain('format we could not read');
    expect(screen.getAllByTestId('assumption-nudge')).toHaveLength(1);
  });

  it('is an invitation, not an amber warning box', () => {
    render(<DraftSurface data={withAssumptions(['no launches or restocks are on record for this month'])} />);
    expect(document.body.textContent).not.toMatch(/what we assumed/i);
    expect(screen.getByTestId('assumption-nudge').className).toContain('bg-coral-100');
  });

  it('sits AFTER the day’s content — a banner must not push the month off the fold', () => {
    render(<DraftSurface data={withAssumptions(['no launches or restocks are on record for this month'])} />);
    const panel = screen.getByTestId('day-panel');
    const kids = [...panel.children];
    expect(kids.indexOf(screen.getByTestId('assumption-nudge')))
      .toBeGreaterThan(kids.indexOf(screen.getByTestId('draft-card')));
  });

  it('opens the voice sheet on the question, and sends only the client’s answer', async () => {
    const calls = stubFetch({ beats: [beat()] });
    render(<DraftSurface data={withAssumptions(['no launches or restocks are on record for this month'])} />);
    fireEvent.click(screen.getByTestId('assumption-nudge'));

    expect(screen.getByTestId('voice-framing').textContent).toContain('anything coming up?');

    fireEvent.click(screen.getByTestId('voice-mode'));
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'The candle, on the 24th' } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });

    // Our question is context for the person, never part of the text a card quotes back.
    expect(calls[0]!.body).toEqual({ op: 'text', text: 'The candle, on the 24th', source: 'web' });
  });

  it('says nothing when every assumption is about our own bookkeeping', () => {
    render(<DraftSurface data={withAssumptions(['the format mix is based on posts whose format we could not read'])} />);
    expect(screen.queryByTestId('assumption-nudge')).toBeNull();
  });

  it('and nothing at all past the cutoff', () => {
    const data = withAssumptions(['no launches or restocks are on record for this month']);
    (data.draft as { editable: boolean }).editable = false;
    render(<DraftSurface data={data} />);
    expect(screen.queryByTestId('assumption-nudge')).toBeNull();
  });
});

describe('the what-changed chip (spec §3)', () => {
  const withReceipt = (r: Record<string, unknown>) => {
    const data = fakeData();
    (data.draft as { receipts: unknown[] }).receipts = [r];
    return data;
  };

  const ARC = {
    id: 'r1', at: '', sourceText: 'The Navy Edit launches on 28th August at 7pm', scope: 'month_scoped',
    changedIds: ['b1'],
    lines: [
      'Added: The Navy Edit — Tease, Wed 26 Aug',
      'Added: The Navy Edit — Launch, Fri 28 Aug',
      'Added: The Navy Edit — Follow, Sun 30 Aug',
      'Replaced: Understands Real Women — Reel, Wed 26 Aug',
      'Replaced: Sustainable & Considered — Single post, Fri 28 Aug',
      'Replaced: Quality & Craft — Carousel, Sun 30 Aug',
    ],
  };

  it('states the counts and NEVER grows — 48px for one change and for fourteen', () => {
    render(<DraftSurface data={withReceipt(ARC)} />);
    const chip = screen.getByTestId('summary-chip');
    expect(screen.getByTestId('summary-counts').textContent).toBe('3 added · 3 replaced');
    expect(chip.className).toContain('h-12');
    // Truncation rather than wrapping is what makes the height a promise.
    expect(screen.getByTestId('summary-counts').className).toContain('truncate');
  });

  it('is ONE control — the whole chip toggles, and there is no ✕ to hit by accident', () => {
    render(<DraftSurface data={withReceipt(ARC)} />);
    const chip = screen.getByTestId('summary-chip');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(within(chip).queryByLabelText(/dismiss|close/i)).toBeNull();

    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('receipt-panel')).toBeTruthy();

    fireEvent.click(chip);
    expect(screen.queryByTestId('receipt-panel')).toBeNull();
  });

  it('the panel REPLACES the view rather than stacking over it — no scrim, nav still live', () => {
    render(<DraftSurface data={withReceipt(ARC)} />);
    fireEvent.click(screen.getByTestId('summary-chip'));

    expect(screen.queryByTestId('day-panel')).toBeNull();
    expect(screen.queryByTestId('week-strip')).toBeNull();
    expect(screen.getByTestId('nav-pill')).toBeTruthy();

    // Changing view is the way out, and it is the gesture already on screen.
    fireEvent.click(screen.getByTestId('nav-month'));
    expect(screen.queryByTestId('receipt-panel')).toBeNull();
    expect(screen.getByTestId('month-grid')).toBeTruthy();
  });

  it('the expanded panel lists the deltas the receipt recorded, in its own words', () => {
    render(<DraftSurface data={withReceipt(ARC)} />);
    fireEvent.click(screen.getByTestId('summary-chip'));

    const lines = screen.getAllByTestId('receipt-line').map((n) => n.textContent);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('Added: The Navy Edit — Tease, Wed 26 Aug');
    expect(screen.getByTestId('receipt-source').textContent).toContain('The Navy Edit launches on 28th August');
  });

  it('CLEARING KEEPS THE HIGHLIGHTS — they are different state with a different lifetime', () => {
    render(<DraftSurface data={withReceipt(ARC)} />);
    expect(screen.getByTestId('draft-card').getAttribute('data-changed')).toBe('true');

    fireEvent.click(screen.getByTestId('summary-chip'));
    fireEvent.click(screen.getByTestId('clear-summary'));

    expect(screen.queryByTestId('summary-chip')).toBeNull();
    expect(screen.queryByTestId('receipt-panel')).toBeNull();
    // The card is still marked. Clearing the summary never un-marks what changed.
    expect(screen.getByTestId('draft-card').getAttribute('data-changed')).toBe('true');
    expect(screen.getByTestId('changed-badge')).toBeTruthy();
  });

  it('there is NO chip when the application changed nothing', () => {
    render(<DraftSurface data={withReceipt({ id: 'r', at: '', sourceText: 'x', scope: 'month_scoped', lines: [], changedIds: [] })} />);
    expect(screen.queryByTestId('summary-chip')).toBeNull();
  });

  it('an evergreen filing still says where it went, and offers the way back', () => {
    render(<DraftSurface data={withReceipt({
      id: 'r', at: '', sourceText: 'breakdown of how our sweatshirts are made', scope: 'evergreen',
      lines: [], changedIds: [], planInputId: 'pi-1',
    })} />);
    expect(screen.getByTestId('summary-counts').textContent).toBe('Saved to your ideas');

    fireEvent.click(screen.getByTestId('summary-chip'));
    expect(screen.getByTestId('receipt-panel').textContent).toContain('kept this for later');
    expect(screen.getByTestId('add-to-this-month')).toBeTruthy();
  });

  it('a failed extraction ADMITS it rather than calling it a filing they asked for', () => {
    render(<DraftSurface data={withReceipt({
      id: 'r', at: '', sourceText: 'x', scope: 'evergreen', reason: 'couldnt_apply',
      lines: [], changedIds: [],
    })} />);
    expect(screen.getByTestId('summary-counts').textContent).toBe('We couldn’t apply that');
    fireEvent.click(screen.getByTestId('summary-chip'));
    expect(screen.getByTestId('receipt-panel').textContent).toContain('couldn’t work this into October');
  });
});

describe('the itemised rollup (mockup 08)', () => {
  /** Sally's August brief, in shape: 14 segments, 8 applied, 6 filed. */
  const SALLY = {
    id: 'r1', at: '', sourceText: '~700 words', scope: 'month_scoped', changedIds: [],
    lines: [], segmentCount: 14,
    items: [
      { span: 'The Navy Edit launches on 28th August at 7pm', outcome: 'applied', kind: 'launch',
        lines: ['Added a launch build-up — 3 posts around Fri 28 Aug'], changedIds: [] },
      { span: 'Weekend Style Guide every Friday … 4th September', outcome: 'applied', kind: 'series',
        lines: ['Added 4 posts — Fri 7, 14, 21 and 28 Aug'], changedIds: [], deferredCount: 1 },
      ...Array.from({ length: 6 }, (_, i) => ({
        span: `an evergreen idea ${i}`, outcome: 'idea', lines: [], changedIds: [],
        planInputId: `pi-${i}`, note: 'Kept for later rather than changing August.',
      })),
    ],
  };

  const openRollup = () => {
    const data = fakeData();
    (data.draft as { receipts: unknown[] }).receipts = [SALLY];
    render(<DraftSurface data={data} />);
    fireEvent.click(screen.getByTestId('summary-chip'));
  };

  it('the chip counts applied and saved; the panel renders the DECOMPOSER’s segment count', () => {
    openRollup();
    expect(screen.getByTestId('summary-counts').textContent).toBe('2 applied · 6 saved');
    // 14, not 8: segmentCount is what the decomposer found, not what we chose to show.
    expect(screen.getByTestId('receipt-panel').textContent).toContain('We found 14 things in what you sent');
  });

  it('one line per segment, in the client’s own words', () => {
    openRollup();
    const items = screen.getAllByTestId('brief-item');
    expect(items).toHaveLength(8);
    expect(items[0]!.textContent).toContain('The Navy Edit launches on 28th August at 7pm');
  });

  it('an applied line expands to its own diff, collapsed by default', () => {
    openRollup();
    expect(screen.queryByTestId('item-diff')).toBeNull();
    fireEvent.click(screen.getAllByTestId('item-diff-toggle')[0]!);
    expect(screen.getByTestId('item-diff').textContent).toContain('Added a launch build-up — 3 posts around Fri 28 Aug');
  });

  it('says what it deferred rather than dropping it silently', () => {
    openRollup();
    expect(screen.getAllByTestId('brief-item')[1]!.textContent).toContain('1 saved for next month');
  });

  it('NOTHING is silently demoted — an idea line says so and carries the way back', () => {
    openRollup();
    const idea = screen.getAllByTestId('brief-item').find((n) => n.getAttribute('data-outcome') === 'idea')!;
    expect(idea.textContent).toContain('Kept for later rather than changing August.');
    expect(within(idea).getByTestId('add-to-this-month')).toBeTruthy();
  });

  it('the rescue tap sends the backlog row and a date inside this month', async () => {
    const calls = stubFetch({ beats: [beat()] });
    openRollup();
    const idea = screen.getAllByTestId('brief-item').find((n) => n.getAttribute('data-outcome') === 'idea')!;
    await act(async () => { fireEvent.click(within(idea).getByTestId('add-to-this-month')); });

    expect(calls[0]!.url).toBe('/api/plan/draft/apply');
    expect(calls[0]!.body).toEqual({ op: 'add_to_month', planInputId: 'pi-0', date: TODAY });
  });

  it('a read-only month reads the rollup and rescues nothing', () => {
    const data = fakeData();
    (data.draft as { receipts: unknown[]; editable: boolean }).receipts = [SALLY];
    (data.draft as { editable: boolean }).editable = false;
    render(<DraftSurface data={data} />);
    fireEvent.click(screen.getByTestId('summary-chip'));

    expect(screen.getAllByTestId('brief-item')).toHaveLength(8);
    expect(screen.queryByTestId('add-to-this-month')).toBeNull();
  });
});

describe('approval — the one door that spends money', () => {
  /** Earl of East's October as the dogfood run approved it: 1 reel, 2 carousels, 7 singles. */
  const OCTOBER = [
    beat({ id: 'r1', format: 'reel' }),
    ...Array.from({ length: 2 }, (_, i) => beat({ id: `c${i}`, format: 'carousel', position: i + 1 })),
    ...Array.from({ length: 7 }, (_, i) => beat({ id: `s${i}`, format: 'single', position: i + 3 })),
  ];

  it('the pill is labelled, persistent and secondary — never an unlabelled tick', () => {
    render(<DraftSurface data={fakeData({}, OCTOBER)} />);
    const pill = screen.getByTestId('ready-pill');
    expect(pill.textContent).toBe('Generate');
    // Secondary weight: a hairline accent border and accent text on surface, not a filled block.
    expect(pill.className).toContain('border-coral-600');
    expect(pill.className).not.toContain('bg-coral-650');
  });

  it('is absent when there is nothing to approve, and past the cutoff', () => {
    render(<DraftSurface data={fakeData({}, [])} />);
    expect(screen.queryByTestId('ready-pill')).toBeNull();
    cleanup();

    const data = fakeData({}, OCTOBER);
    (data.draft as { editable: boolean }).editable = false;
    render(<DraftSurface data={data} />);
    expect(screen.queryByTestId('ready-pill')).toBeNull();
  });

  it('IS STILL TWO TAPS — the pill opens the consequence, the consequence commits', async () => {
    const calls = stubFetch();
    render(<DraftSurface data={fakeData({}, OCTOBER)} />);
    fireEvent.click(screen.getByTestId('ready-pill'));

    expect(screen.getByTestId('approval-sheet')).toBeTruthy();
    // Opening it spends nothing.
    expect(calls).toHaveLength(0);
  });

  it('states the counts, from the posts already in memory rather than a second source', async () => {
    const calls = stubFetch();
    render(<DraftSurface data={fakeData({}, OCTOBER)} />);
    fireEvent.click(screen.getByTestId('ready-pill'));

    const rows = [...screen.getByTestId('approval-counts').querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('10');
    expect(rows[1]).toContain('3');
    expect(rows[2]).toContain('1');
    // No pre-approval summary endpoint: a second source for a number the client is holding.
    expect(calls).toHaveLength(0);
  });

  it('omits the zero rows rather than printing "0 hooks"', () => {
    render(<DraftSurface data={fakeData({}, [beat({ format: 'single' }), beat({ id: 'b2', format: 'single', position: 1 })])} />);
    fireEvent.click(screen.getByTestId('ready-pill'));

    const rows = screen.getByTestId('approval-counts').querySelectorAll('li');
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId('approval-sheet').textContent).not.toMatch(/0 (opening hooks|scripts)/);
  });

  it('NEVER says the month is locked — it says the writing has started', () => {
    render(<DraftSurface data={fakeData({}, OCTOBER)} />);
    fireEvent.click(screen.getByTestId('ready-pill'));

    const copy = screen.getByTestId('approval-consequence').textContent ?? '';
    expect(copy).toContain('Dates and formats stay yours to change afterwards');
    expect(copy).toContain('What this starts is the writing');
    expect(copy).not.toMatch(/set for the month|locked|final/i);
  });

  it('“Not yet” closes and spends nothing', async () => {
    const calls = stubFetch();
    render(<DraftSurface data={fakeData({}, OCTOBER)} />);
    fireEvent.click(screen.getByTestId('ready-pill'));
    fireEvent.click(screen.getByTestId('approve-not-yet'));

    expect(screen.queryByTestId('approval-sheet')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('the commit posts to approve and lands on the month it just approved, BY NAME', async () => {
    const calls = stubFetch();
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as unknown as Location);
    render(<DraftSurface data={fakeData({}, OCTOBER)} />);
    fireEvent.click(screen.getByTestId('ready-pill'));
    await act(async () => { fireEvent.click(screen.getByTestId('approve-confirm')); });

    expect(calls[0]!.url).toBe('/api/plan/draft/approve');
    // A bare reload re-runs the landing rule, which approval itself breaks — it moves every
    // draft row to 'generating', and the fallback then picks a cycle by today's date.
    expect(assign).toHaveBeenCalledWith('/?cycle=cyc-1');
  });

  it('a refusal is SHOWN, because a silent second fan-out is worse than saying no', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, json: async () => ({ ok: false, message: 'This month has already been approved.' }),
    }) as unknown as Response));
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as unknown as Location);
    render(<DraftSurface data={fakeData({}, OCTOBER)} />);
    fireEvent.click(screen.getByTestId('ready-pill'));
    await act(async () => { fireEvent.click(screen.getByTestId('approve-confirm')); });

    await waitFor(() => expect(screen.getByTestId('approval-error').textContent).toBe('This month has already been approved.'));
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('approval-sheet')).toBeTruthy();
  });
});

describe('hardened against what a real client throws at it', () => {
  /** ivy-t's 3 August title, verbatim, clipping included. */
  const LONG = '14th August — the stock leaves the factory for our next drop. Tease it: can you show the '
    + 'boxes being packed and the labels going on, without showing the pieces themselves';

  it('a 200-character title is CLAMPED on the card and whole in the sheet', () => {
    render(<DraftSurface data={fakeData({}, [beat({ title: LONG })])} />);
    const heading = screen.getByTestId('draft-card').querySelector('h4')!;
    // Two lines on the card, so one post cannot push the day's second off the fold…
    expect(heading.className).toContain('line-clamp-2');
    expect(heading.className).toContain('break-words');

    // …and the sheet the clamp sends you to shows all of it.
    fireEvent.click(screen.getByTestId('draft-card'));
    expect(screen.getByTestId('detail-sheet').querySelector('h2')!.textContent).toBe(LONG);
  });

  it('a title with nowhere to break still cannot widen the page', () => {
    render(<DraftSurface data={fakeData({}, [beat({ title: 'https://ivy-t.example/a-very-long-unbroken-path-with-no-spaces-at-all-whatsoever' })])} />);
    expect(screen.getByTestId('draft-card').querySelector('h4')!.className).toContain('break-words');
  });

  it('a REFUSED reshape keeps the sheet, the words and the mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, json: async () => ({ ok: false, message: 'This month’s draft is closed for changes.' }),
    }) as unknown as Response));
    const data = fakeData();
    render(<DraftSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    fireEvent.click(screen.getByTestId('voice-mode'));
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'a sentence worth keeping' } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });

    // A dictated brief can be several hundred words. Losing them to a network blip is the one
    // failure a toast cannot undo.
    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value).toBe('a sentence worth keeping');
    await waitFor(() => expect(data.flash).toHaveBeenCalledWith('This month’s draft is closed for changes.'));
  });

  it('a REFUSED add keeps the sheet, the subject and the format', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, json: async () => ({ ok: false, message: 'That isn’t one of your content pillars.' }),
    }) as unknown as Response));
    render(<DraftSurface data={fakeData()} />);
    fireEvent.click(screen.getByTestId('add-slot'));
    fireEvent.click(within(screen.getByTestId('add-format')).getByTestId('format-reel'));
    fireEvent.change(screen.getByTestId('add-subject'), { target: { value: 'the candle' } });
    await act(async () => { fireEvent.click(screen.getByTestId('add-confirm')); });

    expect(screen.getByTestId('add-sheet')).toBeTruthy();
    expect((screen.getByTestId('add-subject') as HTMLTextAreaElement).value).toBe('the candle');
    expect(within(screen.getByTestId('add-format')).getByTestId('format-reel').getAttribute('aria-pressed')).toBe('true');
  });

  it('an empty month says so and offers nothing it cannot honour', () => {
    render(<DraftSurface data={fakeData({}, [])} />);
    expect(screen.getByTestId('day-count').textContent).toBe('Nothing drafted');
    expect(screen.queryByTestId('ready-pill')).toBeNull();     // nothing to approve
    expect(screen.queryByTestId('thin-month')).toBeNull();     // and nothing to acknowledge
    expect(screen.getByTestId('add-slot')).toBeTruthy();       // but you can still start it
    expect(screen.getByTestId('nav-mic')).toBeTruthy();
  });

  it('a client with no configured pillars gets no pillar picker it could not satisfy', () => {
    const data = fakeData();
    (data.draft as { pillars: string[] }).pillars = [];
    render(<DraftSurface data={data} />);
    fireEvent.click(screen.getByTestId('add-slot'));
    expect(screen.queryByTestId('add-pillar')).toBeNull();
  });
});
