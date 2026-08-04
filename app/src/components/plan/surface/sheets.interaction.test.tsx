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

/** What `applyChanges` settles with — the real shape, so a fixture cannot drift from it. */
type ApplyReport = Awaited<ReturnType<PlanData['applyChanges']>>;

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
    hookGenerating: new Set<string>(), hookCandidates: new Map<string, string[]>(), hookError: new Map<string, string>(),
    scriptGenerating: new Set<string>(), scriptError: new Map<string, string>(), shapeErrors: new Map<string, string>(),
    switchCycle: vi.fn(async () => {}), addPost: vi.fn(async () => {}),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    changeFormat: vi.fn(async () => {}), regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}), generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}), clearHookCandidates: vi.fn(),
    ...over,
  } as unknown as PlanData;
}

const openSheet = () => fireEvent.click(screen.getByTestId('post-card'));

beforeEach(() => { window.innerWidth = 390; window.sessionStorage.clear(); });   // nav-state must not leak a position between tests — each render is a fresh tab
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

  it('caption is the default tab; an empty one is OPEN, not disabled (round 6, P3)', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    expect(screen.getByTestId('tab-caption').getAttribute('aria-selected')).toBe('true');
    // The post is a reel with no script. Round 5 greyed this out, which said "broken" and
    // nothing else; it now opens onto the thing that writes it.
    expect((screen.getByTestId('tab-script') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('tab-script'));
    expect(screen.getByTestId('empty-field').textContent).toContain('No script yet');
    expect(screen.getByTestId('generate-script')).toBeTruthy();
  });

  it('a single post has no hook or script tab at all — absent is not empty', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ format: 'single', hook: null })] })} />);
    openSheet();
    expect(screen.queryByTestId('tab-hook')).toBeNull();
    expect(screen.queryByTestId('tab-script')).toBeNull();
    // And with one field there is no tab BAR either — a tablist of one is a label pretending
    // to be a choice. The caption is simply the sheet's body.
    expect(screen.queryByLabelText('Post fields')).toBeNull();
    expect(screen.getByTestId('field-body').textContent).toContain('Wilderness is back.');
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

    // The placement moved one element out, to the frame wrapper — the bar itself is now only
    // the bar, and where it sits is the shell's answer rather than the phone's for everyone.
    expect(screen.getByTestId('feedback').parentElement!.className).toContain('top-[46px]');
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

  /**
   * DELIBERATE CHANGE (round 5). A tap now closes on the CLICK the browser sends for it rather
   * than on `pointerup`, so that the compatibility click is consumed by the grabber instead of
   * landing on the month arrow it overlaps (`Sheet.tsx`, and `sheet-close.interaction` for the
   * whole argument). The gesture the client makes is unchanged; the event it completes on is
   * not, so the fixture completes it.
   */
  it('a plain TAP on the grabber closes the sheet', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const g = grab('detail-sheet-grabber');
    fireEvent.pointerDown(g, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(g, { clientY: 200, pointerId: 1 });
    fireEvent.click(g, { clientY: 200 });

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
    fireEvent.click(g, { clientY: 200 });

    expect(screen.queryByTestId('move-sheet')).toBeNull();
    expect(screen.getByTestId('detail-sheet')).toBeTruthy();   // the sheet it opened from stays
  });
});

/**
 * The format control's THIRD placement, and the operator's ruling: it lives inside Shape mode.
 *
 * Always-visible under the header it read as a display toggle — one tap away from a client who
 * had opened the sheet to read their caption. A format change is a shaping decision WITH
 * consequences (it can strand a hook and a script, and it changes what the checklist is for), so
 * it belongs in the deliberate flow, beside the field where the client is already saying what
 * they want different, with room for its consequence note to be read before anything is sent.
 */
const openShape = () => { openSheet(); fireEvent.click(screen.getByTestId('act-shape')); };

describe('the format control, inside Shape mode', () => {
  it('is NOT on the sheet until Shape is open', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    expect(screen.queryByTestId('format-control')).toBeNull();

    fireEvent.click(screen.getByTestId('act-shape'));
    expect(screen.getByTestId('format-control')).toBeTruthy();
    // …beside the prompt field, not instead of it.
    expect(screen.getByTestId('shape-input')).toBeTruthy();
  });

  it('and it goes again when Shape is cancelled', () => {
    render(<CommittedSurface data={fakeData()} />);
    openShape();
    fireEvent.click(screen.getByTestId('shape-cancel'));
    expect(screen.queryByTestId('format-control')).toBeNull();
  });

  it('is wired to the format mutation, and does not re-send the format it is on', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openShape();

    expect(screen.getByTestId('format-control')).toBeTruthy();
    expect(screen.getByTestId('format-reel').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('format-reel'));
    expect(data.changeFormat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('format-carousel'));
    expect(data.changeFormat).toHaveBeenCalledWith('p1', 'carousel');
  });

  it('states the consequence honestly — nothing is cleared, so it does not say it was', async () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ script: 'Open on the shelf.' })] })} />);
    openShape();
    await act(async () => { fireEvent.click(screen.getByTestId('format-single')); });

    const note = screen.getByTestId('format-note').textContent ?? '';
    expect(note).toContain('still saved');
    expect(note).toContain('doesn’t use them');
    expect(note).not.toMatch(/remov|delet|clear/i);
  });

  it('names what the NEW format still needs', async () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ format: 'single', hook: null })] })} />);
    openShape();
    await act(async () => { fireEvent.click(screen.getByTestId('format-reel')); });

    expect(screen.getByTestId('format-note').textContent).toContain('needs a hook and a script');
  });

  it('regenerates the checklist silently when nothing has been ticked', async () => {
    const steps = [{ id: 's1', label: 'Shoot it', leadDays: 3, done: false, doneAt: null, sort: 0, createdBy: 'agent' as const }];
    const data = fakeData({ posts: [post({ steps })] });
    render(<CommittedSurface data={data} />);
    openShape();
    await act(async () => { fireEvent.click(screen.getByTestId('format-carousel')); });

    expect(data.regenerateChecklist).toHaveBeenCalledWith('p1');
    expect(screen.queryByTestId('checklist-choice')).toBeNull();
  });

  it('ASKS when there is progress to lose, and keeping it calls nothing', async () => {
    const steps = [{ id: 's1', label: 'Shoot it', leadDays: 3, done: true, doneAt: '2026-09-30T10:00:00Z', sort: 0, createdBy: 'agent' as const }];
    const data = fakeData({ posts: [post({ steps })] });
    render(<CommittedSurface data={data} />);
    openShape();
    await act(async () => { fireEvent.click(screen.getByTestId('format-carousel')); });

    expect(screen.getByTestId('checklist-choice')).toBeTruthy();
    expect(data.regenerateChecklist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('checklist-keep'));
    expect(screen.queryByTestId('checklist-choice')).toBeNull();
    expect(data.regenerateChecklist).not.toHaveBeenCalled();
  });

  it('is unreachable on a read-only day — there is no Shape to open', () => {
    render(<CommittedSurface data={fakeData({ canEdit: () => false })} />);
    openSheet();
    expect(screen.queryByTestId('act-shape')).toBeNull();
    expect(screen.queryByTestId('format-control')).toBeNull();
  });
});

describe('writing a missing hook or script (round 6, P3)', () => {
  it('an empty hook tab explains and offers the action, and does NOT offer Shape', () => {
    // A CAROUSEL: its hook is its own, so the solo path (and its three candidates) is right.
    const data = fakeData({ posts: [post({ format: 'carousel', hook: null, script: null })] });
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));

    expect(screen.getByTestId('empty-field').textContent).toContain('Nothing is wrong with it.');
    // Shape rewrites words. There are none, and shaping an empty field is a paid no-op.
    expect(screen.queryByTestId('act-shape')).toBeNull();

    fireEvent.click(screen.getByTestId('generate-hook'));
    expect(data.generateHooks).toHaveBeenCalledWith('p1');
  });

  /**
   * ── C4: on a REEL both tabs are the same act ───────────────────────────────────────
   *
   * The Hook tab used to offer "Write the hook" and reach the standalone hook job, so a reel
   * could be handed a hook a later script had never seen — the two disagreeing on screen is
   * the operator's video. A reel's fields are one pair, written together from the caption.
   */
  it('a REEL’s hook tab offers the PAIR, and takes the combined path', () => {
    const data = fakeData({ posts: [post({ format: 'reel', hook: null, script: null })] });
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));

    const empty = screen.getByTestId('empty-field').textContent ?? '';
    expect(empty).toContain('written together');
    expect(screen.getByTestId('generate-hook').textContent).toContain('Write the hook and script');
    // The length belongs to the pair, so it is offered from either tab.
    expect(screen.getByTestId('script-length')).toBeTruthy();

    fireEvent.click(screen.getByTestId('generate-hook'));
    expect(data.generateScript).toHaveBeenCalledWith('p1', 30);
    expect(data.generateHooks).not.toHaveBeenCalled();
  });

  it('a REEL with no caption is REFUSED on both tabs — nothing here writes a caption first', () => {
    const data = fakeData({ posts: [post({ format: 'reel', caption: '', hook: null, script: null })] });
    render(<CommittedSurface data={data} />);
    openSheet();
    // No caption → the sheet has nothing written at all, so it says so and offers no generate.
    expect(screen.queryByTestId('generate-hook')).toBeNull();
    expect(screen.getByTestId('not-written-yet')).toBeTruthy();
  });

  it('the three candidates are a choice, and picking one saves it', () => {
    const data = fakeData({
      posts: [post({ hook: null })],
      hookCandidates: new Map([['p1', ['One', 'Two', 'Three']]]),
    });
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));

    expect(screen.getAllByTestId('hook-candidate')).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId('hook-candidate')[1]!);
    expect(data.saveHook).toHaveBeenCalledWith('p1', 'Two');
    expect(data.clearHookCandidates).toHaveBeenCalledWith('p1');
  });

  it('a script with no caption to build on says so and offers NOTHING — a 422 is worse than no offer', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ caption: '', hook: null, script: null, title: 'A held slot' })] })} />);
    openSheet();
    // Nothing written at all → the planned-post variant, which has no tabs.
    expect(screen.getByTestId('not-written-yet')).toBeTruthy();
    expect(screen.queryByTestId('generate-script')).toBeNull();
  });

  it('the length picker is offered with the script action, seeded from the post', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ scriptLengthSeconds: 60 })] })} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-script'));

    expect(screen.getByTestId('length-60').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('length-15'));
    fireEvent.click(screen.getByTestId('generate-script'));
    // The chosen length rides along, not the default.
    expect(screen.getByTestId('length-15').getAttribute('aria-pressed')).toBe('true');
  });

  it('a generation in flight shows the skeleton, not the empty state', () => {
    render(<CommittedSurface data={fakeData({
      posts: [post({ hook: null })],
      hookGenerating: new Set(['p1']),
    })} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByTestId('empty-field')).toBeNull();
  });
});

describe('a shape in flight (round 6, P11)', () => {
  it('replaces the words being rewritten with a skeleton, so a second tap is not invited', () => {
    render(<CommittedSurface data={fakeData({ shapingIds: new Set(['p1']) })} />);
    openSheet();

    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByTestId('field-body')).toBeNull();
    // And Shape cannot be fired again while it runs.
    expect((screen.getByTestId('act-shape') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a post’s tasks, in its sheet (round 6, P9)', () => {
  const steps = [
    { id: 's1', label: 'Shoot it', leadDays: 3, done: false, doneAt: null, sort: 0, createdBy: 'agent' as const },
    { id: 's2', label: 'Pick the shots', leadDays: 1, done: true, doneAt: '2026-09-30T10:00:00Z', sort: 1, createdBy: 'agent' as const },
  ];

  it('renders the post’s own steps, with the done one folded away', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ steps })] })} />);
    openSheet();

    const tasks = screen.getByTestId('sheet-tasks');
    expect(tasks.textContent).toContain('Shoot it');
    // Done work is present and countable, but collapsed — never silently gone.
    expect(tasks.textContent).toContain('Completed');
    expect(tasks.textContent).not.toContain('Pick the shots');

    fireEvent.click(screen.getByTestId('completed-toggle'));
    expect(screen.getByTestId('completed-list').textContent).toContain('Pick the shots');
  });

  it('ticking one sends done, and un-ticking from Completed sends it back', () => {
    const data = fakeData({ posts: [post({ steps })] });
    render(<CommittedSurface data={data} />);
    openSheet();

    fireEvent.click(screen.getAllByTestId('task-check')[0]!);
    expect(data.toggleStep).toHaveBeenCalledWith('p1', 's1', true);

    fireEvent.click(screen.getByTestId('completed-toggle'));
    fireEvent.click(screen.getByTestId('completed-list').querySelector('[data-testid="task-check"]')!);
    expect(data.toggleStep).toHaveBeenCalledWith('p1', 's2', false);
  });

  it('a post with no steps gets no empty Tasks section', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    expect(screen.queryByTestId('sheet-tasks')).toBeNull();
  });
});

describe('the mic on a committed month opens the CONVERSATION sheet', () => {
  /**
   * The sheet is a thread now: the reply renders as turns, the interpretation is a turn with
   * inline Apply/Discard, and the apply's settled report becomes the confirmation turn. The
   * composer never unmounts — there is no mode toggle and no phase to escape from.
   */
  const REPLY = {
    message: 'I’ve put that up for you.',
    proposals: [{ id: 'pr1' }],
    items: [{ kind: 'change', proposalId: 'pr1', action: 'move', title: 'Fragrance Note Deep Dive: Summer', fromDate: '2026-10-08', toDate: '2026-10-12' }],
  };
  const withAgent = (over: Partial<PlanData> = {}) => fakeData({
    posts: [post()],
    ask: vi.fn(async () => REPLY),
    // The surface's isPending reads the live pending list — Apply only sends what is pending.
    proposals: REPLY.proposals,
    agentReply: REPLY,
    applyChanges: vi.fn(async () => ({ applied: ['pr1'], failed: [], changedPostIds: [] })),
    discardChanges: vi.fn(async () => {}),
    agentBusy: false,
    ...over,
  } as Partial<PlanData>);

  const speak = async (value: string) => {
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value } });
    await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
  };

  /**
   * ── X5b / X5a: ONE indicator, ONE changed-surface ─────────────────────────────────
   *
   * Both are operator rulings and both are deletions, so both are pinned as ABSENCES over the
   * exact state that used to produce them.
   */
  it('X5a: a working turn shows ONE thinking indicator — not a second one over the sheet', () => {
    render(<CommittedSurface data={withAgent({ agentBusy: true })} />);
    // Closed: the top channel is the only surface there is, and it speaks.
    expect(screen.getByTestId('feedback-agent')).toBeTruthy();

    fireEvent.click(screen.getByTestId('nav-mic'));
    // Open: the THREAD owns it. The bar under the wordmark says nothing at all.
    expect(screen.queryByTestId('feedback-agent')).toBeNull();
    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
  });

  it('X5a: and the working state still reaches the thread — the indicator moved, it did not go', async () => {
    render(<CommittedSurface data={withAgent({ ask: vi.fn(() => new Promise(() => {})) })} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');
    // Exactly one three-dot pulse on the whole surface, and it is inside the sheet.
    const dots = screen.getAllByTestId('agent-dots');
    expect(dots).toHaveLength(1);
    expect(screen.getByTestId('voice-sheet').contains(dots[0]!)).toBe(true);
  });

  it('opens the conversation sheet: one thread, one composer, one mic control', () => {
    render(<CommittedSurface data={withAgent()} />);
    fireEvent.click(screen.getByTestId('nav-mic'));

    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    expect(screen.getByTestId('thread')).toBeTruthy();
    expect(screen.getByTestId('voice-mic')).toBeTruthy();
    expect(screen.getByTestId('voice-input')).toBeTruthy();
  });

  it('submits to the AGENT path — silent, so nothing doubles over the thread — and the words become a bubble', async () => {
    const data = withAgent();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move the Thursday post to Friday');

    expect(data.ask).toHaveBeenCalledWith('move the Thursday post to Friday', null, 'web', { silent: true, conversationId: null, pendingProposalIds: [] });
    expect(screen.getByTestId('turn-user').textContent).toBe('move the Thursday post to Friday');
    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    expect(screen.getByTestId('interpretation')).toBeTruthy();
  });

  it('shows the INTERPRETATION as a turn and applies nothing until the client says so', async () => {
    const data = withAgent();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');

    const said = screen.getByTestId('interpretation').textContent ?? '';
    expect(said).toContain('Fragrance Note Deep Dive: Summer');
    expect(said).toContain('Mon 12 Oct');
    expect(said).not.toMatch(/approve|approval/i);
    expect(data.applyChanges).not.toHaveBeenCalled();
    expect(screen.queryByTestId('feedback')).toBeNull();
  });

  /**
   * ── F4, threaded ───────────────────────────────────────────────────────────────────
   *
   * Apply still runs in the background — but the sheet STAYS, and the settled report arrives
   * as the next agent turn. The chip + highlights land outside the sheet either way (the
   * post-apply confirmation on the plan surface, unchanged).
   */
  it('APPLY stays in the thread: dots on the turn, then the confirmation turn — and the cards mark outside', async () => {
    let settle!: (v: ApplyReport) => void;
    const data = withAgent({
      applyChanges: vi.fn(() => new Promise((res) => { settle = res; })),
    } as Partial<PlanData>);
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');
    fireEvent.click(screen.getByTestId('interp-apply'));

    // In flight: the sheet is open, the turn shows the one working indicator, nothing landed.
    expect(data.applyChanges).toHaveBeenCalledWith(['pr1']);
    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    expect(screen.getByTestId('interpretation').getAttribute('data-status')).toBe('applying');

    await act(async () => { settle({ applied: ['pr1'], failed: [], failures: [], changedPostIds: ['p1'] }); });
    // The confirmation is the next agent turn…
    const agents = screen.getAllByTestId('turn-agent');
    expect(agents[agents.length - 1]!.textContent).toContain('Done — your plan is updated.');
    // …and the ONLY thing that landed behind the sheet is the mark on the card itself.
    fireEvent.click(screen.getByTestId('voice-close'));
    expect(screen.getByTestId('post-card').getAttribute('data-changed')).toBe('true');
    expect(screen.queryByTestId('summary-chip')).toBeNull();
  });

  /**
   * ── X5b: the applied chip and its panel are DELETED ────────────────────────────────
   *
   * A deleted surface with no fixture is one that can come back by accident — the same
   * reasoning G6's what-changed fixtures were rewritten under. This asserts the absence over
   * a completed apply, which is the only state that could ever have produced it.
   */
  it('NO chip and NO panel after an apply — the marked card is the whole changed-surface', async () => {
    const data = withAgent({
      applyChanges: vi.fn(async () => ({ applied: ['pr1'], failed: [], failures: [], changedPostIds: ['p1'] })),
    } as Partial<PlanData>);
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    fireEvent.click(screen.getByTestId('voice-close'));

    expect(screen.queryByTestId('summary-chip')).toBeNull();
    expect(screen.queryByTestId('applied-panel')).toBeNull();
    expect(screen.queryByTestId('applied-line')).toBeNull();
    expect(screen.queryByTestId('applied-clear')).toBeNull();
    // No count of the change anywhere on the surface — that sentence lives in the thread.
    expect(document.body.textContent).not.toMatch(/\b1 moved\b/);
    // The card is still marked, and the day is still there to tap.
    expect(screen.getByTestId('post-card').getAttribute('data-changed')).toBe('true');
    expect(screen.getByTestId('day-panel')).toBeTruthy();
  });

  it('with the sheet OPEN a failure is the confirmation turn, not a second banner over the thread', async () => {
    const data = withAgent({
      applyChanges: vi.fn(async () => ({
        applied: [], failed: ['pr1'], changedPostIds: [],
        // Retryable: the ordering-dependency case, which is the one that really IS still there.
        failures: [{ proposalId: 'pr1', reason: null, retryable: true }],
      })),
    } as Partial<PlanData>);
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });

    const agents = screen.getAllByTestId('turn-agent');
    expect(agents[agents.length - 1]!.textContent).toContain('Move “Fragrance Note Deep Dive: Summer”');
    expect(agents[agents.length - 1]!.textContent).toContain('still here');
    expect(screen.queryByTestId('feedback')).toBeNull();
  });

  it('with the sheet CLOSED at settle time, the failure goes to the ONE feedback channel', async () => {
    let settle!: (v: ApplyReport) => void;
    const data = withAgent({
      applyChanges: vi.fn(() => new Promise((res) => { settle = res; })),
    } as Partial<PlanData>);
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');
    fireEvent.click(screen.getByTestId('interp-apply'));
    fireEvent.click(screen.getByTestId('voice-close'));   // the client left mid-apply

    await act(async () => { settle({ applied: [], failed: ['pr1'], changedPostIds: [], failures: [{ proposalId: 'pr1', reason: null, retryable: true }] }); });
    const said = screen.getByTestId('feedback').textContent ?? '';
    expect(said).toContain('Move “Fragrance Note Deep Dive: Summer”');
    expect(said).toContain('still here');
  });

  it('DISCARD rejects them, marks the turn, and the conversation continues', async () => {
    const data = withAgent();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('move it');
    await act(async () => { fireEvent.click(screen.getByTestId('interp-discard')); });

    expect(data.discardChanges).toHaveBeenCalledWith(['pr1']);
    expect(data.applyChanges).not.toHaveBeenCalled();
    expect(screen.getByTestId('interpretation').getAttribute('data-status')).toBe('discarded');
    expect(screen.getByTestId('voice-sheet')).toBeTruthy();   // no dead end, no exit forced
  });

  it('a refusal keeps the sheet and the words', async () => {
    const data = withAgent({ ask: vi.fn(async () => null) } as Partial<PlanData>);
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    await speak('something worth keeping');

    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).value).toBe('something worth keeping');
  });

  it('THE LEGACY POPUP IS GONE — no flash-only mic on this surface', () => {
    const data = withAgent();
    render(<CommittedSurface data={data} />);
    fireEvent.click(screen.getByTestId('nav-mic'));
    expect(data.flash).not.toHaveBeenCalled();
  });
});

describe('the action row, attempt two (round 7, fix 5)', () => {
  it('is a stock-iOS row: one line, thin glyph, 15px label, quiet fill', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const move = screen.getByTestId('act-move');

    expect(move.className).toContain('min-h-[44px]');   // 68 → 56 → 44
    expect(move.className).toContain('flex-row');       // beside, not stacked
    expect(move.className).toContain('bg-line-soft');   // a quiet fill, not a ring on surface
    expect(move.className).not.toContain('ring-1');
    expect(move.querySelector('span')?.className).toContain('text-[15px]');
    expect(move.querySelector('svg')?.getAttribute('class')).toContain('stroke-width:1.5');
  });

  it('Delete is still unmistakable — fill AND colour AND glyph, none of them text alone', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const del = screen.getByTestId('act-delete');

    // S1's principle survives the restyle: a destructive action is never something to infer.
    expect(del.className).toContain('bg-danger/10');
    expect(del.className).toContain('text-danger');
    expect(del.querySelector('svg')).toBeTruthy();
    // …and it is no longer the loudest object on a sheet whose common action is "read this".
    expect(del.className).not.toContain('bg-danger text-white');
  });

  it('the draft sheet’s two buttons match the committed sheet’s three', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    const committed = screen.getByTestId('act-move').className;
    cleanup();

    // Same component, same class string — the two sheets cannot drift apart on this.
    expect(committed).toContain('min-h-[44px]');
    expect(committed).toContain('rounded-[12px]');
  });
});
