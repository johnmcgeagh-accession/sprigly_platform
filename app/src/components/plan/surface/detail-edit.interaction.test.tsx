/**
 * @vitest-environment jsdom
 *
 * detail-edit.interaction.test.tsx — F6: the detail sheet's fields are editable by hand.
 *
 * The pencil swaps the field for a plain textarea IN PLACE (no modal-on-modal); Save goes
 * through the EXISTING per-field update path (`saveCaption`/`saveHook`/`saveScript` →
 * PATCH /api/posts/:id → the caption_saved/hook_saved/script_saved ledger, actor 'client'
 * via the session); Cancel discards and the field is byte-identical.
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
  caption: 'Wilderness is back.',
  hook: 'The one that sold out in a week.',
  script: 'HOOK: The one that sold out.\nBEAT 1 — close-up.',
  status: 'new', reviewState: null, steps: [], postingTime: '06:00',
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
    saveCaption: vi.fn(async () => true), saveHook: vi.fn(async () => true), saveScript: vi.fn(async () => true),
    clearHookCandidates: vi.fn(),
    ...over,
  } as unknown as PlanData;
}

const openSheet = () => fireEvent.click(screen.getByTestId('post-card'));
const field = () => screen.getByTestId('edit-input') as HTMLTextAreaElement;

beforeEach(() => { window.innerWidth = 390; window.sessionStorage.clear(); });
afterEach(cleanup);

describe('the pencil, per field', () => {
  it('CAPTION: pencil → textarea seeded with the caption → Save goes through saveCaption', async () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('edit-field'));

    expect(field().value).toBe('Wilderness is back.');
    fireEvent.change(field(), { target: { value: 'Wilderness returns on Friday.' } });
    await act(async () => { fireEvent.click(screen.getByTestId('edit-save')); });

    expect(data.saveCaption).toHaveBeenCalledWith('p1', 'Wilderness returns on Friday.');
    expect(screen.queryByTestId('edit-input')).toBeNull();   // back to reading
  });

  it('HOOK: the hook tab edits through saveHook', async () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-hook'));
    fireEvent.click(screen.getByTestId('edit-field'));

    expect(field().value).toBe('The one that sold out in a week.');
    fireEvent.change(field(), { target: { value: 'Sold out twice. Here’s why.' } });
    await act(async () => { fireEvent.click(screen.getByTestId('edit-save')); });

    expect(data.saveHook).toHaveBeenCalledWith('p1', 'Sold out twice. Here’s why.');
    expect(data.saveCaption).not.toHaveBeenCalled();
  });

  it('SCRIPT: the script tab edits through saveScript', async () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('tab-script'));
    fireEvent.click(screen.getByTestId('edit-field'));

    fireEvent.change(field(), { target: { value: 'HOOK: new.\nBEAT 1 — wide shot.' } });
    await act(async () => { fireEvent.click(screen.getByTestId('edit-save')); });

    expect(data.saveScript).toHaveBeenCalledWith('p1', 'HOOK: new.\nBEAT 1 — wide shot.');
  });

  it('the saved words render once the post reloads with them', async () => {
    const data = fakeData();
    const { rerender } = render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('edit-field'));
    fireEvent.change(field(), { target: { value: 'Wilderness returns on Friday.' } });
    await act(async () => { fireEvent.click(screen.getByTestId('edit-save')); });

    // The save path splices the fresh post into local state; the sheet re-reads it.
    rerender(<CommittedSurface data={fakeData({ posts: [post({ caption: 'Wilderness returns on Friday.' })] })} />);
    expect(screen.getByTestId('field-body').textContent).toBe('Wilderness returns on Friday.');
  });
});

describe('cancel, and the edges', () => {
  it('CANCEL discards: the field is byte-identical and nothing was saved', () => {
    const data = fakeData();
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('edit-field'));
    fireEvent.change(field(), { target: { value: 'something else entirely' } });
    fireEvent.click(screen.getByTestId('edit-cancel'));

    expect(screen.getByTestId('field-body').textContent).toBe('Wilderness is back.');
    expect(data.saveCaption).not.toHaveBeenCalled();
    expect(data.saveHook).not.toHaveBeenCalled();
    expect(data.saveScript).not.toHaveBeenCalled();
  });

  it('Save is disabled while the draft is unchanged — a write of nothing is a ledger row about nothing', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('edit-field'));
    expect((screen.getByTestId('edit-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field(), { target: { value: 'changed' } });
    expect((screen.getByTestId('edit-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a REFUSED save keeps the textarea and the words — hand-typed text is never thrown away', async () => {
    const data = fakeData({ saveCaption: vi.fn(async () => false) } as Partial<PlanData>);
    render(<CommittedSurface data={data} />);
    openSheet();
    fireEvent.click(screen.getByTestId('edit-field'));
    fireEvent.change(field(), { target: { value: 'the words that must not be lost' } });
    await act(async () => { fireEvent.click(screen.getByTestId('edit-save')); });

    expect(field().value).toBe('the words that must not be lost');
  });

  it('no pencil on a read-only (past-dated) post', () => {
    render(<CommittedSurface data={fakeData({ canEdit: () => false } as Partial<PlanData>)} />);
    openSheet();
    expect(screen.queryByTestId('edit-field')).toBeNull();
  });

  it('editing hides the tabs and the action row — one mode at a time, in place, no modal-on-modal', () => {
    render(<CommittedSurface data={fakeData()} />);
    openSheet();
    fireEvent.click(screen.getByTestId('edit-field'));
    expect(screen.queryByTestId('tab-hook')).toBeNull();
    expect(screen.queryByTestId('act-shape')).toBeNull();
    expect(screen.queryByTestId('act-delete')).toBeNull();
    // And only ONE dialog is up.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
