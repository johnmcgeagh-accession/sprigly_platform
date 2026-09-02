/**
 * @vitest-environment jsdom
 *
 * ideas-promote.interaction.test.tsx — the backlog's way into the month.
 *
 * Twenty-five ideas sat under "On record. Not used yet, and not turned down." with no control on
 * any of them. The only promote route was the receipt's rescue, and a receipt is transient: once
 * cleared or reloaded the ideas were visible, permanent and unusable. This pins the control that
 * closes that, and — as much — pins where it must NOT appear.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { IdeasPanel } from './IdeasPanel';
import type { IdeaView, IdeaState } from '@/lib/ideas';
import type { PlanData } from '../usePlanData';

const idea = (id: string, state: IdeaState, over: Partial<IdeaView> = {}): IdeaView => ({
  id, content: `idea ${id}`, createdAt: '2026-09-01T00:00:00Z', state,
  usedInMonth: null, usedInCycleId: null, postId: null, postTitle: null, ...over,
});

const IDEAS = [
  idea('w1', 'waiting'), idea('w2', 'waiting'), idea('w3', 'waiting'),
  idea('d1', 'deferred'),
  idea('u1', 'used', { usedInMonth: 'October 2026' }),
  idea('s1', 'set-aside'),
];

const data = (ideas: IdeaView[] = IDEAS) =>
  ({ ideas, ideasError: false, calendarPosts: [], draft: { beats: [] } } as unknown as PlanData);

const panel = (props: Partial<React.ComponentProps<typeof IdeasPanel>> = {}) =>
  render(<IdeasPanel data={data()} onOpen={() => {}} {...props} />);

beforeEach(() => { cleanup(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('promoting from the backlog', () => {
  it('offers the control on every WAITING idea', () => {
    panel({ onPromote: () => {} });
    expect(screen.getAllByTestId('promote-idea')).toHaveLength(3);
  });

  it('promotes THAT idea, by its plan_inputs id', () => {
    const onPromote = vi.fn();
    panel({ onPromote });
    fireEvent.click(screen.getAllByTestId('promote-idea')[1]!);
    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledWith('w2');
  });

  /** The three states that already have an answer. Offering to promote any of them would be
   *  offering to undo a decision, which is a different act and a different control. */
  it.each<[IdeaState]>([['used'], ['deferred'], ['set-aside']])(
    'never offers it on a %s idea', (state) => {
      panel({ onPromote: () => {} });
      const group = screen.getAllByTestId('ideas-group').find((g) => g.dataset['state'] === state)!;
      expect(within(group).queryByTestId('promote-idea')).toBeNull();
    },
  );

  it('shows NOTHING when no callback is given — the committed surface is unchanged', () => {
    panel();
    expect(screen.queryByTestId('promote-idea')).toBeNull();
  });

  it('one row says “Adding…” while it works, not all three', () => {
    panel({ onPromote: () => {}, promotingId: 'w2' });
    const labels = screen.getAllByTestId('promote-idea').map((b) => b.textContent);
    expect(labels.filter((t) => t === 'Adding…')).toHaveLength(1);
    expect(labels.filter((t) => t === 'Add to this month')).toHaveLength(2);
  });

  it('a promoted row reports itself and the others stay usable', () => {
    panel({ onPromote: () => {}, promotedIds: ['w2'] });
    expect(screen.getAllByTestId('idea-promoted')).toHaveLength(1);
    expect(screen.getAllByTestId('promote-idea')).toHaveLength(2);
  });

  it('a promoted row cannot be promoted again in the same session', () => {
    const onPromote = vi.fn();
    panel({ onPromote, promotedIds: ['w1', 'w2', 'w3'] });
    expect(screen.queryByTestId('promote-idea')).toBeNull();
    expect(onPromote).not.toHaveBeenCalled();
  });

  it('after a reload the idea is USED and carries no control — the state does the work', () => {
    // lifecycle:'used' is written by add_to_month, so the next load derives state 'used' and the
    // row moves group. `promotedIds` is only the bridge until then.
    render(<IdeasPanel data={data([idea('w1', 'used', { usedInMonth: 'October 2026' })])} onOpen={() => {}} onPromote={() => {}} />);
    expect(screen.queryByTestId('promote-idea')).toBeNull();
    expect(screen.getByTestId('idea-state').textContent).toBe('Used in October 2026');
  });

  it('the panel is still not a CAPTURE surface — no add, edit or delete appears', () => {
    panel({ onPromote: () => {} });
    for (const t of ['idea-add', 'idea-edit', 'idea-delete']) expect(screen.queryByTestId(t)).toBeNull();
  });
});
