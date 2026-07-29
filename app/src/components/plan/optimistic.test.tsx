/**
 * @vitest-environment jsdom
 *
 * optimistic.test.tsx — the committed month's reversible mutations, driven through `usePlanData`.
 *
 * ── The contract (round 7, fix 3) ────────────────────────────────────────────────────
 *
 * Format, move, drop and a task tick each change one field of one row, and each can be put back
 * exactly. So the UI changes NOW and the server confirms behind it.
 *
 * The ROLLBACK is the whole contract, and it is what these tests are for. A change that silently
 * reverts is worse than one that never happened, because by then the client has stopped looking —
 * so a refusal must put the field back AND say why, in words that distinguish "that date has
 * passed" from "the network dropped".
 *
 * Generation-class actions are deliberately excluded and keep their pending states: shape,
 * generate, add-with-instruction. Those are not reversible, they cost money, and showing them as
 * already done while a model is still working is exactly the wrong lie.
 *
 * The hook is exercised directly rather than through a surface: the behaviour under test is the
 * data layer's, and rendering a whole month to observe it would put two things in one test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { usePlanData, type PlanData, type PlanDataInit } from './usePlanData';
import type { PlanPost } from '@/lib/types';

const TODAY = '2026-10-01';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'single', pillar: 'Home & Space', title: 'A post',
  caption: 'Some words.', hook: null, script: null,
  status: 'new', reviewState: null,
  steps: [{ id: 's1', label: 'Shoot it', leadDays: 3, done: false, doneAt: null, sort: 0, createdBy: 'agent' }],
  postingTime: null, rationale: '',
  ...over,
});

/** A probe that exposes the hook's live state to the test without a surface in the way. */
let api: PlanData;
function Probe({ posts }: { posts: PlanPost[] }) {
  api = usePlanData({
    posts, crossMonthPosts: [], beats: [],
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026' }],
    homeCycleId: 'cyc-1', today: TODAY, clientName: 'Earl of East',
    questions: [], intake: { answers: {}, freeNotes: '' }, durable: [],
  } as unknown as PlanDataInit);
  const p = api.posts[0];
  return (
    <div>
      <span data-testid="format">{p?.format}</span>
      <span data-testid="count">{api.posts.length}</span>
      <span data-testid="tick">{p?.steps[0]?.done ? 'done' : 'todo'}</span>
      <span data-testid="toast">{api.toast ?? ''}</span>
    </div>
  );
}

const at = (id: string) => screen.getByTestId(id).textContent;

/** A server that refuses, with the code a real route would send. */
const refuses = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: false, status, json: async () => body }) as unknown as Response);

/** A server that accepts. `/api/plan` answers the reconcile refetch with the same rows. */
const accepts = (posts: PlanPost[]) => vi.fn(async (url: string) => ({
  ok: true,
  json: async () => (String(url).startsWith('/api/plan')
    ? { posts, crossMonthPosts: [], beats: [] }
    : { mode: 'applied', summary: 'Changed the format.', changedPostIds: ['p1'], posts }),
}) as unknown as Response);

beforeEach(() => { vi.stubGlobal('fetch', accepts([post()])); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('format', () => {
  it('changes UNDER THE THUMB, before the server has answered', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate;
      return { ok: true, json: async () => ({ mode: 'applied', summary: 'ok', changedPostIds: [], posts: [] }) } as unknown as Response;
    }));
    render(<Probe posts={[post()]} />);

    let done!: Promise<unknown>;
    act(() => { done = api.changeFormat('p1', 'reel'); });
    // The write has not landed and the control has already moved.
    expect(at('format')).toBe('reel');

    await act(async () => { release(); await done; });
  });

  it('ROLLS BACK on a refusal, and names why', async () => {
    vi.stubGlobal('fetch', refuses(403, { error: 'read_only' }));
    render(<Probe posts={[post()]} />);

    await act(async () => { await api.changeFormat('p1', 'reel'); });

    expect(at('format')).toBe('single');
    expect(at('toast')).toContain('already passed');
  });

  it('names the NETWORK when the request never landed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<Probe posts={[post()]} />);

    await act(async () => { await api.changeFormat('p1', 'reel'); });

    expect(at('format')).toBe('single');
    expect(at('toast')).toContain('couldn’t reach the server');
  });
});

describe('delete', () => {
  it('removes the card immediately and puts it back when refused', async () => {
    vi.stubGlobal('fetch', refuses(404, { error: 'not_found' }));
    render(<Probe posts={[post()]} />);
    expect(at('count')).toBe('1');

    await act(async () => { await api.removePost('p1'); });

    expect(at('count')).toBe('1');
    expect(at('toast')).toContain('may have been removed');
  });
});

describe('a task tick', () => {
  it('fills under the thumb — a checklist is a list, not a form', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate;
      return { ok: true, json: async () => ({ steps: [{ id: 's1', label: 'Shoot it', leadDays: 3, done: true, doneAt: 'x', sort: 0, createdBy: 'agent' }] }) } as unknown as Response;
    }));
    render(<Probe posts={[post()]} />);

    let done!: Promise<unknown>;
    act(() => { done = api.toggleStep('p1', 's1', true); });
    expect(at('tick')).toBe('done');

    await act(async () => { release(); await done; });
    expect(at('tick')).toBe('done');
  });

  it('un-ticks itself when the write is refused, and says why', async () => {
    vi.stubGlobal('fetch', refuses(403, { error: 'read_only' }));
    render(<Probe posts={[post()]} />);

    await act(async () => { await api.toggleStep('p1', 's1', true); });

    expect(at('tick')).toBe('todo');
    expect(at('toast')).toContain('already passed');
  });
});

describe('generation-class actions are NOT optimistic', () => {
  it('shape marks the post pending rather than pretending the words changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes('/shape') ? { mode: 'pending', summary: 'Sprigly is rewriting this…', jobId: 'j1' }
        : u.startsWith('/api/jobs/') ? { status: 'done', summary: 'Updated the caption.' }
        : { posts: [post()], crossMonthPosts: [], beats: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    }));
    render(<Probe posts={[post()]} />);

    let done!: Promise<unknown>;
    act(() => { done = api.shape('p1', 'warmer', 'caption'); });
    // Pending, not applied: nothing on the post has changed and nothing pretends it has.
    await act(async () => { await Promise.resolve(); });
    expect(api.shapingIds.has('p1')).toBe(true);
    expect(api.posts[0]!.caption).toBe('Some words.');

    await act(async () => { await done; });
  });
});
