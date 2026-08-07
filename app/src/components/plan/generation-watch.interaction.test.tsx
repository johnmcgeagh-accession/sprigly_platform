/**
 * @vitest-environment jsdom
 *
 * generation-watch.interaction.test.tsx — the plan fills in while a run writes it.
 *
 * THE GAP. Every refetch in usePlanData hung off something the CLIENT did. A monthly
 * generation run is started by the worker; approval returns counts and no job ids, so pollJob
 * cannot follow it, and nothing else the page subscribed to changed. The captions already in
 * the loaded payload rendered and every later one did not — a real uat run wrote 28 captions
 * over 311 seconds, invisible until a manual refresh, while the grid drew hollow rings from
 * correctly-rendered stale rows.
 *
 * These drive the watcher through /api/plan/generation-status with a scripted sequence, and
 * assert on WHEN the plan is refetched — which is the whole behaviour.
 *
 * The load-time start is the case that matters most and the one no approve-button wiring could
 * have covered: on an AUTO-approved cycle the client presses nothing and simply opens the page
 * mid-run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { PlanRoot } from './PlanRoot';
import { navTraceClear } from './nav-trace';
import { resetNavSnapshot } from './nav-state';
import type { PlanDataInit } from './usePlanData';
import type { PlanPost } from '@/lib/types';

const TODAY = '2026-10-20';
const CYC = 'cyc-oct';
const POLL_MS = 1600;

type Status = { generating: number; total: number; lastWritten: string | null };

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p-1', cycleId: CYC, clientId: 'c1', channel: 'instagram',
  date: '2026-10-22', format: 'reel', pillar: 'Style',
  caption: '', status: 'generating', reviewState: null, steps: [], postingTime: '07:00',
  ...over,
});

function init(): PlanDataInit {
  return {
    posts: [post()], crossMonthPosts: [], beats: [],
    cycles: [{ cycleId: CYC, displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false }] as PlanDataInit['cycles'],
    homeCycleId: CYC, initialViewedCycleId: CYC, today: TODAY,
    clientName: 'earl-of-east', questions: [], intake: { answers: {}, freeNotes: '' }, durable: [],
  } as PlanDataInit;
}

/** Every /api/plan refetch — NOT the status polls, which live at /api/plan/generation-status. */
let planRefetches = 0;
let statusPolls = 0;
/** The scripted answers, one per poll; the last one repeats once exhausted. */
let script: Status[] = [];

function stubNetwork() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

    if (u.startsWith('/api/plan/generation-status')) {
      const s = script[Math.min(statusPolls, script.length - 1)] ?? { generating: 0, total: 1, lastWritten: null };
      statusPolls++;
      return json(s);
    }
    if (u.startsWith('/api/plan/proposals'))    return json({ proposals: [] });
    if (u.startsWith('/api/plan/conversation')) return json({ conversationId: null, turns: [], ok: true });
    if (u.startsWith('/api/plan/changes'))      return json({ changes: [] });
    if (u.startsWith('/api/plan/notes'))        return json({ notes: [] });
    if (u.startsWith('/api/plan/ideas'))        return json({ ideas: [] });
    if (u.startsWith('/api/plan/weather'))      return json({ forecast: [] });
    if (u.startsWith('/api/plan/events'))       return json({});
    if (/^\/api\/plan(\?|$)/.test(u)) { planRefetches++; return json({ posts: [post()], crossMonthPosts: [], beats: [] }); }
    return json({});
  }));
}

/** Advance past N poll intervals, flushing the fetches each one starts. */
async function polls(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
  }
}

beforeEach(async () => {
  window.innerWidth = 390;
  window.sessionStorage.clear(); window.localStorage.clear();
  navTraceClear(); resetNavSnapshot();
  planRefetches = 0; statusPolls = 0; script = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  stubNetwork();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); cleanup(); vi.unstubAllGlobals(); });

/** Mount and let the first (immediate) status poll resolve. */
async function mount() {
  await act(async () => { render(<PlanRoot {...init()} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe('the plan fills in while a generation run writes it', () => {
  it('a cycle already generating at LOAD is watched — no client action required', async () => {
    // The auto-approved case: the scheduler started this, the client just opened the page.
    script = [{ generating: 6, total: 28, lastWritten: '2026-10-20T15:26:00.000Z' }];
    await mount();

    expect(statusPolls).toBeGreaterThan(0);
    // The first sight of an active run syncs once, so a write between page load and this
    // first poll cannot stay invisible.
    expect(planRefetches).toBe(1);
  });

  it('refetches the plan each time a write lands, and only then', async () => {
    script = [
      { generating: 6, total: 28, lastWritten: '2026-10-20T15:26:00.000Z' },  // sync-once
      { generating: 6, total: 28, lastWritten: '2026-10-20T15:26:00.000Z' },  // nothing moved
      { generating: 4, total: 28, lastWritten: '2026-10-20T15:26:03.000Z' },  // a caption
      { generating: 4, total: 28, lastWritten: '2026-10-20T15:26:03.000Z' },  // nothing moved
      { generating: 2, total: 28, lastWritten: '2026-10-20T15:26:07.000Z' },  // another
    ];
    await mount();
    await polls(4);

    // 1 sync-once + 2 advances. NOT one per poll — that is the difference between refetching
    // the month ~28 times over a run and ~195 times.
    expect(planRefetches).toBe(3);
  });

  it('stops once the run goes quiet', async () => {
    script = [
      { generating: 2, total: 28, lastWritten: '2026-10-20T15:26:00.000Z' },
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:30:59.000Z' },  // last caption
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:30:59.000Z' },  // quiet 1
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:30:59.000Z' },  // quiet 2 → stop
    ];
    await mount();
    await polls(6);
    const settled = statusPolls;

    await polls(5);
    expect(statusPolls).toBe(settled);            // it really stopped
  });

  it('a SCRIPT landing after generating hits 0 still refetches — the tail the status misses', async () => {
    // shape.ts moves a post 'generating' → 'new'; hook.ts and script.ts write their fields and
    // never touch status. Settling on `generating === 0` alone would stop here and the reel's
    // script would land unseen. lastWritten moves because the table's trigger bumps updated_at.
    script = [
      { generating: 1, total: 28, lastWritten: '2026-10-20T15:30:00.000Z' },
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:30:59.000Z' },  // captions done
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:31:04.000Z' },  // a script lands
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:31:04.000Z' },
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:31:04.000Z' },
    ];
    await mount();
    await polls(5);

    // sync-once, the caption advance, and the SCRIPT advance.
    expect(planRefetches).toBe(3);
  });

  it('a month that will never be whole still terminates', async () => {
    // A declined launch beat settles as 'new' with no caption; a 'generation_failed' post is
    // terminal and never retried. "Everything has a caption" is unreachable here, which is
    // exactly why the stop condition is quiet rather than completeness.
    script = [
      { generating: 1, total: 28, lastWritten: '2026-10-20T15:26:00.000Z' },
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:26:04.000Z' },  // 26 captions, 1 declined, 1 failed
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:26:04.000Z' },
      { generating: 0, total: 28, lastWritten: '2026-10-20T15:26:04.000Z' },
    ];
    await mount();
    await polls(6);
    const settled = statusPolls;

    await polls(5);
    expect(statusPolls).toBe(settled);
  });

  it('a settled cycle costs one poll and no refetch', async () => {
    script = [{ generating: 0, total: 28, lastWritten: '2026-10-19T09:00:00.000Z' }];
    await mount();
    await polls(4);

    expect(planRefetches).toBe(0);
    expect(statusPolls).toBeLessThanOrEqual(3);   // baseline, then two quiet polls, then stop
  });

  it('a body that is not a status stops the watch rather than retrying for ten minutes', async () => {
    script = [];                                   // the stub falls through to {} for unknown shapes
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
      if (u.startsWith('/api/plan/generation-status')) { statusPolls++; return json({ nonsense: true }); }
      if (/^\/api\/plan(\?|$)/.test(u)) { planRefetches++; return json({ posts: [], crossMonthPosts: [], beats: [] }); }
      return json({});
    }));
    await mount();
    const after = statusPolls;
    await polls(5);

    expect(statusPolls).toBe(after);
  });
});
