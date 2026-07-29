/**
 * @vitest-environment jsdom
 *
 * sheets.interaction.test.tsx — the detail sheet, the move sheet, and undo, driven.
 *
 * These are the flows the standing invariant names: typing, tapping, sheet flows. Every case
 * below opens something, does something inside it, and asserts what happened AFTER — because
 * the failures on this surface are sequential ones. A sheet that keeps the previous post's
 * half-typed instruction, a Shape button that stays a Shape button in shape mode, a move that
 * crosses a month and says nothing: none of those is visible in a first render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'reel', pillar: 'Home & Space',
  title: 'Wilderness candle relaunch — Launch',
  caption: 'Wilderness is back. Cedarwood, damp earth, and the cold-clean note of open air.',
  hook: 'The one that sold out in a week.',
  script: null,
  status: 'new', reviewState: null, steps: [], postingTime: '06:00',
  rationale: 'Carousels average 70 likes across your last 8 posts.',
  ...over,
});

function fakeData(over: Partial<PlanData> = {}): PlanData {
  const posts = (over.posts ?? [post()]) as PlanPost[];
  return {
    posts, crossMonthPosts: [], calendarPosts: posts, beats: [], beatsOn: () => [],
    weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false }],
    viewedCycleId: 'cyc-1', homeCycleId: 'cyc-1', todayCycleId: 'cyc-1',
    today: TODAY, clientName: 'Earl of East', readOnly: false,
    canEdit: () => true,
    shapingIds: new Set<string>(),
    switchCycle: vi.fn(async () => {}), addPost: vi.fn(async () => {}),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    ...over,
  } as unknown as PlanData;
}

const openSheet = () => fireEvent.click(screen.getByTestId('post-card'));

beforeEach(() => { window.innerWidth = 390; });
afterEach(cleanup);

describe('opening a post', () => {
  it('a card tap opens the sheet, captioned and titled', () => {
    render(<CommittedSurface data={fakeData()} />);
    expect(screen.queryByTestId('detail-sheet')).toBeNull();

    openSheet();

    const sheet = screen.getByTestId('detail-sheet');
    expect(sheet.getAttribute('aria-label')).toBe('Wilderness candle relaunch — Launch');
    expect(screen.getByTestId('field-body').textContent).toContain('Wilderness is back.');
  });

  it('the header states the date, the time and the pillar — so Move need not repeat the date', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    expect(screen.getByTestId('detail-meta').textContent).toBe('Thursday 1 October · 06:00 · Home & Space');
    expect(screen.getByTestId('act-move').textContent).toBe('Move');
  });

  it('caption is the default tab; a field with nothing in it is disabled', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    expect(screen.getByTestId('tab-caption').getAttribute('aria-selected')).toBe('true');
    expect((screen.getByTestId('tab-script') as HTMLButtonElement).disabled).toBe(true);
  });

  it('switching tab switches the words', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));
    expect(screen.getByTestId('field-body').textContent).toBe('The one that sold out in a week.');
  });

  it('copy exists ONLY here — never on the card', () => {
    render(<CommittedSurface data={fakeData()} />);
    expect(screen.queryByTestId('copy-field')).toBeNull();
    openSheet();
    expect(screen.getByTestId('copy-field')).toBeTruthy();
  });

  it('copy puts the SELECTED field on the clipboard, not the caption every time', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));
    await act(async () => { fireEvent.click(screen.getByTestId('copy-field')); });

    expect(writeText).toHaveBeenCalledWith('The one that sold out in a week.');
    expect(screen.getByTestId('copied')).toBeTruthy();
  });
});

describe('insights', () => {
  it('the reasoning is behind a toggle, not in front of the words', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    expect(screen.queryByTestId('insights')).toBeNull();

    fireEvent.click(screen.getByTestId('insights-toggle'));
    expect(screen.getByTestId('insights').textContent).toContain('Carousels average 70 likes');
    // Above the tabs, so the words the client came for do not move down the page.
    expect(screen.getByTestId('tab-caption')).toBeTruthy();
  });

  it('no toggle at all when the post carries no reasoning', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ rationale: '' })] })} />);
    openSheet();
    expect(screen.queryByTestId('insights-toggle')).toBeNull();
  });
});

describe('shape, in place', () => {
  it('replaces the FOOTER wholesale — the action row is gone, not relabelled', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('act-shape'));

    expect(screen.queryByTestId('act-shape')).toBeNull();
    expect(screen.queryByTestId('act-move')).toBeNull();
    expect(screen.queryByTestId('act-delete')).toBeNull();
    expect(screen.getByTestId('shape-submit')).toBeTruthy();
    expect(screen.getByTestId('shape-cancel')).toBeTruthy();
  });

  it('stays the SAME sheet — no second sheet stacked over the first', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('act-shape'));
    expect(screen.getAllByTestId('detail-sheet')).toHaveLength(1);
  });

  it('the cancel is a WORD and is not the destructive treatment (X1)', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('act-shape'));

    const cancel = screen.getByTestId('shape-cancel');
    expect(cancel.textContent).toBe('Cancel');
    // danger is Delete's monopoly. A red cancel one screen away from a red delete is the
    // finding round 5.1 reversed.
    expect(cancel.className).not.toContain('bg-danger');
    expect(cancel.className).toContain('text-muted');
    // And nothing on the shape footer wears the destructive treatment at all.
    const footer = cancel.parentElement!;
    expect(footer.innerHTML).not.toContain('bg-danger');
  });

  it('submit is inert until something is typed, then sends the instruction for the OPEN TAB', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));
    fireEvent.click(screen.getByTestId('act-shape'));

    expect((screen.getByTestId('shape-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('shape-input'), { target: { value: 'shorter, and lead with the scent' } });
    expect((screen.getByTestId('shape-submit') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('shape-submit'));
    expect(data.shape).toHaveBeenCalledWith('p1', 'shorter, and lead with the scent', 'hook');
  });

  it('cancel returns the action row and throws the instruction away', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('act-shape'));
    fireEvent.change(screen.getByTestId('shape-input'), { target: { value: 'never mind' } });
    fireEvent.click(screen.getByTestId('shape-cancel'));

    expect(screen.getByTestId('act-shape')).toBeTruthy();
    fireEvent.click(screen.getByTestId('act-shape'));
    expect((screen.getByTestId('shape-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('a half-typed instruction NEVER follows you to another post', () => {
    // The post-return bug this whole file exists for: state that outlives the thing it was about.
    render(<CommittedSurface data={fakeData({ posts: [
      post({ id: 'a', title: 'First' }),
      post({ id: 'b', title: 'Second' }),
    ] })} />);
    fireEvent.click(screen.getAllByTestId('post-card')[0]!);
    fireEvent.click(screen.getByTestId('act-shape'));
    fireEvent.change(screen.getByTestId('shape-input'), { target: { value: 'meant for the first one' } });
    fireEvent.click(screen.getByTestId('detail-sheet-scrim'));

    fireEvent.click(screen.getAllByTestId('post-card')[1]!);
    expect(screen.getByTestId('detail-sheet').getAttribute('aria-label')).toBe('Second');
    expect(screen.queryByTestId('shape-input')).toBeNull();      // back to the action row
    expect(screen.getByTestId('tab-caption').getAttribute('aria-selected')).toBe('true');
  });
});

describe('a post with nothing written', () => {
  const planned = [post({ id: 'e', caption: '', hook: null, script: null, title: 'Home & Space — Carousel', rationale: '' })];

  it('has NO tabs, and says why instead of showing three empty ones', () => {
    render(<CommittedSurface data={fakeData({ posts: planned })} />);
    openSheet();
    expect(screen.queryByTestId('tab-caption')).toBeNull();
    expect(screen.getByTestId('not-written-yet').textContent).toContain('Nothing written yet');
  });

  it('has no Shape — there is nothing to rewrite, and a rewrite of nothing is a paid no-op', () => {
    render(<CommittedSurface data={fakeData({ posts: planned })} />);
    openSheet();
    expect(screen.queryByTestId('act-shape')).toBeNull();
    expect(screen.getByTestId('act-move')).toBeTruthy();
    expect(screen.getByTestId('act-delete')).toBeTruthy();
  });
});

describe('a post still being written', () => {
  it('the sheet says "On its way" and offers no way to restart it', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ status: 'generation_failed', caption: '', hook: null, generationError: 'Bedrock timed out' })] })} />);
    openSheet();
    const sheet = screen.getByTestId('detail-sheet');
    expect(screen.getByTestId('detail-on-the-way').textContent).toContain('On its way');
    expect(sheet.textContent).not.toMatch(/\b(retry|failed|error)\b/i);
    expect(sheet.textContent).not.toContain('Bedrock');
    expect(screen.queryByTestId('act-shape')).toBeNull();
  });
});

describe('move: a date, a time, and where it went', () => {
  const openMove = () => { openSheet(); fireEvent.click(screen.getByTestId('act-move')); };

  it('opens over the whole month, at the post’s own date', () => {
    render(<CommittedSurface data={fakeData()} />);
    openMove();
    expect(screen.getByTestId('move-month').textContent).toBe('October 2026');
    expect(screen.getAllByTestId('grid-cell').length).toBeGreaterThan(27);
  });

  it('navigates months FREELY — the destination may be a month no cycle plans', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openMove();
    fireEvent.click(screen.getByTestId('move-next-month'));
    expect(screen.getByTestId('move-month').textContent).toBe('November 2026');
    // The month arrows here walk the CALENDAR, not the client's cycles.
    expect(data.switchCycle).not.toHaveBeenCalled();
  });

  it('offers the client’s OWN posting labels, not a contract’s example values', () => {
    render(<CommittedSurface data={fakeData({ posts: [
      post({ id: 'a', postingTime: '06:00' }),
      post({ id: 'b', date: '2026-10-02', postingTime: 'Evening' }),
    ] })} />);
    openMove();
    const offered = [...document.querySelectorAll('[data-testid="time-slot"]')].map((b) => b.getAttribute('data-time'));
    expect(offered).toContain('06:00');
    expect(offered).toContain('Evening');
  });

  it('moves with the date AND the time in ONE write', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openMove();
    fireEvent.click(document.querySelector('[data-testid="move-sheet"] [data-date="2026-10-22"]')!);
    fireEvent.change(screen.getByTestId('time-free'), { target: { value: '19:30' } });
    fireEvent.click(screen.getByTestId('move-confirm'));

    expect(data.reschedule).toHaveBeenCalledWith('p1', '2026-10-22', '19:30');
  });

  it('WITHIN the month, the feedback names the day', () => {
    render(<CommittedSurface data={fakeData()} />);
    openMove();
    fireEvent.click(document.querySelector('[data-testid="move-sheet"] [data-date="2026-10-22"]')!);
    fireEvent.click(screen.getByTestId('move-confirm'));

    expect(screen.getByTestId('feedback').textContent).toContain('Moved to 22 Oct');
  });

  it('ACROSS a month, it names the month — gap 11, the post that vanished', () => {
    render(<CommittedSurface data={fakeData()} />);
    openMove();
    fireEvent.click(screen.getByTestId('move-next-month'));
    fireEvent.click(document.querySelector('[data-testid="move-sheet"] [data-date="2026-11-03"]')!);
    fireEvent.click(screen.getByTestId('move-confirm'));

    const text = screen.getByTestId('feedback').textContent ?? '';
    expect(text).toContain('3 Nov');
    expect(text).toContain('November');
  });

  it('undo puts the date AND the time back', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openMove();
    fireEvent.click(document.querySelector('[data-testid="move-sheet"] [data-date="2026-10-22"]')!);
    fireEvent.click(screen.getByTestId('move-confirm'));
    fireEvent.click(screen.getByTestId('feedback-undo'));

    expect(data.reschedule).toHaveBeenLastCalledWith('p1', TODAY, '06:00');
  });

  it('the feedback renders at the TOP, never over the row it is undoing', () => {
    render(<CommittedSurface data={fakeData()} />);
    openMove();
    fireEvent.click(document.querySelector('[data-testid="move-sheet"] [data-date="2026-10-22"]')!);
    fireEvent.click(screen.getByTestId('move-confirm'));

    expect(screen.getByTestId('feedback').className).toContain('top-[46px]');
  });

  it('a past date is not pickable, so the move cannot be refused after the fact', () => {
    const data = fakeData({ canEdit: (d?: string) => (d ?? '') >= TODAY });
    render(<CommittedSurface data={data} />);
    openMove();
    fireEvent.click(document.querySelector('[data-testid="move-sheet"] [data-date="2026-09-28"]')!);
    fireEvent.click(screen.getByTestId('move-confirm'));

    expect(data.reschedule).toHaveBeenCalledWith('p1', TODAY, '06:00');   // unchanged
  });
});

describe('delete', () => {
  it('removes the post, closes the sheet, and says so WITHOUT offering an undo it cannot honour', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('act-delete'));

    expect(data.removePost).toHaveBeenCalledWith('p1');
    expect(screen.queryByTestId('detail-sheet')).toBeNull();
    expect(screen.getByTestId('feedback').textContent).toContain('Removed it.');
    // No route un-deletes a post, so an Undo here would be a button that cannot do what it says.
    expect(screen.queryByTestId('feedback-undo')).toBeNull();
  });
});

describe('a read-only day', () => {
  it('shows the words and none of the actions', () => {
    render(<CommittedSurface data={fakeData({ canEdit: () => false })} />);
    openSheet();
    expect(screen.getByTestId('field-body')).toBeTruthy();
    expect(screen.queryByTestId('act-move')).toBeNull();
    expect(screen.queryByTestId('act-delete')).toBeNull();
    expect(screen.queryByTestId('act-shape')).toBeNull();
  });
});

describe('the grabber is a control (round 6, P7)', () => {
  /** jsdom has no pointer capture; the handler calls it optionally, so stub it away. */
  const grab = (testid: string) => {
    const el = screen.getByTestId(testid);
    (el as HTMLElement & { setPointerCapture?: unknown }).setPointerCapture = () => {};
    return el;
  };

  it('a plain TAP on the grabber closes the sheet', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const g = grab('detail-sheet-grabber');
    fireEvent.pointerDown(g, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(g, { clientY: 200, pointerId: 1 });

    expect(screen.queryByTestId('detail-sheet')).toBeNull();
  });

  it('a DRAG past the threshold closes it', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const g = grab('detail-sheet-grabber');
    fireEvent.pointerDown(g, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(g, { clientY: 320, pointerId: 1 });
    fireEvent.pointerUp(g, { clientY: 320, pointerId: 1 });

    expect(screen.queryByTestId('detail-sheet')).toBeNull();
  });

  it('a HESITATION springs back — the sheet stays open', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const g = grab('detail-sheet-grabber');
    fireEvent.pointerDown(g, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(g, { clientY: 240, pointerId: 1 });
    fireEvent.pointerUp(g, { clientY: 240, pointerId: 1 });

    expect(screen.getByTestId('detail-sheet')).toBeTruthy();
  });

  it('an UPWARD drag is not a dismissal, and is not a tap either', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const g = grab('detail-sheet-grabber');
    fireEvent.pointerDown(g, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(g, { clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(g, { clientY: 120, pointerId: 1 });

    expect(screen.getByTestId('detail-sheet')).toBeTruthy();
  });

  it('the move sheet gets the same gesture from the same chrome', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('act-move'));
    const g = grab('move-sheet-grabber');
    fireEvent.pointerDown(g, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(g, { clientY: 200, pointerId: 1 });

    expect(screen.queryByTestId('move-sheet')).toBeNull();
    expect(screen.getByTestId('detail-sheet')).toBeTruthy();   // the sheet it opened from stays
  });
});
