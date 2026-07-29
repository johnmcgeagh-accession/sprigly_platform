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

beforeEach(() => { window.innerWidth = 390; });
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

  it('replaces the month from the SERVER’s list rather than predicting the outcome', async () => {
    const authoritative = [beat({ id: 'b1', date: '2026-10-22' }), beat({ id: 'b9', date: '2026-10-30' })];
    stubFetch({ beats: authoritative });
    const data = fakeData();
    render(<DraftSurface data={data} />);
    open();
    fireEvent.click(screen.getByTestId('act-move'));
    fireEvent.click(document.querySelector('[data-testid="grid-cell"][data-date="2026-10-22"]')!);
    await act(async () => { fireEvent.click(screen.getByTestId('move-confirm')); });

    // A rejected mutation can then never leave the client showing a change that did not happen.
    const updater = (data.setDraft as unknown as { mock: { calls: [(d: unknown) => unknown][] } }).mock.calls[0]![0];
    expect(updater({ beats: [], pillars: [], editable: true, receipts: [] })).toEqual({
      beats: authoritative, pillars: [], editable: true, receipts: [],
    });
  });

  it('a refused write says so and changes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, json: async () => ({ ok: false, message: 'This month’s draft is closed for changes.' }),
    }) as unknown as Response));
    const data = fakeData();
    render(<DraftSurface data={data} />);
    fireEvent.click(screen.getByTestId('draft-card'));
    await act(async () => { fireEvent.click(screen.getByTestId('act-delete')); });

    await waitFor(() => expect(data.flash).toHaveBeenCalledWith('This month’s draft is closed for changes.'));
    expect(data.setDraft).not.toHaveBeenCalled();
    expect(screen.queryByTestId('feedback-undo')).toBeNull();
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
