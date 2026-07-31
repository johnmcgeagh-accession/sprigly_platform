/**
 * @vitest-environment jsdom
 *
 * apply-timing.interaction.test.tsx — THE APPLY → VISIBLE PIPELINE, MEASURED (G4).
 *
 * The operator's report is that an applied plan takes "ages" to populate. That sentence covers
 * two different things and the fix is different for each, so the harness measures them apart:
 *
 *   STRUCTURE — the rows exist and the calendar draws them. Should be seconds: an approve, a
 *               row write, one refetch, a render.
 *   CONTENT   — the captions, hooks and scripts arrive. Minutes, legitimately: each is a model
 *               call on a worker, and nothing here can make it faster.
 *
 * The pipeline, per proposal, as it was:
 *
 *   POST /proposals/:id/approve   → the row is written (addGeneratingPost, status 'generating')
 *   await refreshPlan()           → GET /api/plan
 *   await pollJob(jobId)          → GET /api/jobs/:id every 1600ms until the CAPTION lands
 *   await refreshPlan()           → GET /api/plan again
 *
 * …and `applyChanges` runs that loop SEQUENTIALLY. So item 2's row is not written until item
 * 1's caption has been generated, and item 3's until item 2's has. The structure of a
 * three-post launch arc was gated on two model calls that have nothing to do with it. That is
 * the "ages": not a slow render, and not slow generation either — a serialisation that made
 * the fast thing wait for the slow one.
 *
 * These cases measure the critical path to STRUCTURE with the network stubbed at a fixed
 * latency and a job that completes after two polls. The absolute numbers are the harness's;
 * what they are evidence for is the SHAPE — what blocks on what — which is what changed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { PlanRoot } from './PlanRoot';
import { navTraceClear } from './nav-trace';
import { resetNavSnapshot } from './nav-state';
import type { PlanDataInit } from './usePlanData';
import type { PlanPost } from '@/lib/types';

const TODAY = '2026-10-20';
const OCT = 'cyc-oct';
/** How many polls a generation takes here. pollJob sleeps 1600ms BEFORE its first read, so
 *  each job costs at least 1.6s of wall clock even when the worker is instant. */
const POLLS_TO_DONE = 2;

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p-seed', cycleId: OCT, clientId: 'c1', channel: 'instagram',
  date: '2026-10-22', format: 'reel', pillar: 'Style',
  caption: 'The layers edit', status: 'planned', reviewState: null, steps: [], postingTime: '07:00',
  ...over,
});

/** The three posts the arc creates. They exist server-side the moment each approve returns —
 *  written by `addGeneratingPost` with status 'generating', i.e. STRUCTURE without CONTENT. */
const CREATED: Record<string, PlanPost> = {
  'pr-1': post({ id: 'p-new-1', date: '2026-10-26', caption: '', status: 'generating' }),
  'pr-2': post({ id: 'p-new-2', date: '2026-10-28', caption: '', status: 'generating' }),
  'pr-3': post({ id: 'p-new-3', date: '2026-10-30', caption: '', status: 'generating' }),
};

function init(): PlanDataInit {
  return {
    posts: [post()], crossMonthPosts: [], beats: [],
    cycles: [{ cycleId: OCT, displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false }] as PlanDataInit['cycles'],
    homeCycleId: OCT, initialViewedCycleId: OCT, today: TODAY,
    clientName: 'earl-of-east', questions: [], intake: { answers: {}, freeNotes: '' }, durable: [],
  } as PlanDataInit;
}

const ARC = {
  conversationId: 'conv-1', message: '',
  proposals: ['pr-1', 'pr-2', 'pr-3'].map((id) => ({ id, intent: 'add_post', summary: id, status: 'pending', changeSetId: 'cs1' })),
  items: [
    { kind: 'change', proposalId: 'pr-1', action: 'add', title: 'Teaser one', toDate: '2026-10-26', format: 'reel' },
    { kind: 'change', proposalId: 'pr-2', action: 'add', title: 'Teaser two', toDate: '2026-10-28', format: 'reel' },
    { kind: 'change', proposalId: 'pr-3', action: 'add', title: 'Launch day', toDate: '2026-10-30', format: 'reel' },
  ],
  changeSetId: 'cs1',
};

/** The measured record: every call, when it was made, relative to the Apply tap. */
interface Call { t: number; url: string }
let t0 = 0;
let calls: Call[] = [];
const since = () => Math.round(performance.now() - t0);
const countOf = (frag: string) => calls.filter((c) => c.url.includes(frag)).length;
const firstAfterApply = (frag: string) => calls.find((c) => c.url.includes(frag))?.t ?? -1;
/** GET /api/plan — the whole-cycle refetch, with or without a cycleId. */
const planRefetches = () => calls.filter((c) => /\/api\/plan(\?|$)/.test(c.url)).length;

function stubNetwork() {
  const approved = new Set<string>();
  const jobPolls: Record<string, number> = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (t0) calls.push({ t: since(), url: u });
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

    const approve = /\/proposals\/([^/]+)\/approve$/.exec(u);
    if (approve) {
      const id = approve[1]!;
      approved.add(id);
      // The add-with-instruction shape: the post EXISTS now; the caption is a job.
      return json({ proposal: { id, status: 'applied' }, jobId: `shape_${id}`, changedPostIds: [CREATED[id]!.id] });
    }
    const job = /\/api\/jobs\/(.+)$/.exec(u);
    if (job) {
      const id = job[1]!;
      jobPolls[id] = (jobPolls[id] ?? 0) + 1;
      return json(jobPolls[id]! >= POLLS_TO_DONE ? { status: 'done', summary: 'Wrote the caption.' } : { status: 'running' });
    }
    if (u.startsWith('/api/plan/proposals')) return json({ proposals: [] });
    if (u.startsWith('/api/plan/conversation')) return json({ conversationId: null, turns: [], ok: true });
    if (u.startsWith('/api/plan/changes')) return json({ changes: [] });
    if (u.startsWith('/api/plan/notes')) return json({ notes: [] });
    if (u.startsWith('/api/plan/weather')) return json({ forecast: [] });
    if (u.startsWith('/api/plan/events')) return json({});
    if (u.startsWith('/api/plan/agent')) return json(ARC);
    if (u.startsWith('/api/plan')) {
      // The plan as the server would answer it: every approved add is a row, captioned or not.
      const rows = [post(), ...[...approved].map((id) => CREATED[id]!)];
      return json({ posts: rows, crossMonthPosts: [], beats: [] });
    }
    return json({});
  }));
}

beforeEach(() => {
  window.innerWidth = 390;
  window.sessionStorage.clear(); window.localStorage.clear();
  navTraceClear(); resetNavSnapshot();
  calls = []; t0 = 0;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  stubNetwork();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mountAndAsk() {
  render(<PlanRoot {...init()} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByTestId('nav-mic'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'build the launch arc' } });
  await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
}

const tick = async (ms = 50) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

/** Wait for a condition by letting the app's own timers and promises run. `waitFor` inside
 *  `act` starves the polling this test exists to observe, so the loop is explicit. */
async function until(pred: () => boolean, budgetMs = 25_000): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < budgetMs) {
    if (pred()) return true;
    await tick();
  }
  return pred();
}

/** Is the LAST post of the arc on screen? That is "the structure has populated". */
async function structureVisible(): Promise<number> {
  fireEvent.click(screen.getByTestId('nav-month'));
  const ok = await until(() => {
    const cell = screen.queryAllByTestId('grid-cell').find((c) => c.getAttribute('data-date') === '2026-10-30');
    return !!cell?.querySelector('[data-testid="grid-dot"]');
  });
  const t = since();
  if (!ok) {
    // eslint-disable-next-line no-console
    console.log(`[G4] STRUCTURE NEVER ARRIVED within the budget. Calls:\n${calls.map((c) => `${String(c.t).padStart(6)}ms  ${c.url}`).join('\n')}`);
  }
  return t;
}

describe('STRUCTURE arrives without waiting for CONTENT', () => {
  it('all three rows are on the calendar before any caption has been generated', async () => {
    await mountAndAsk();
    t0 = performance.now();
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });

    const tStructure = await structureVisible();

    // The three approves are the only writes on the critical path…
    expect(countOf('/approve')).toBe(3);
    // …and the LAST of them happens before the FIRST job poll. That is the whole fix: the
    // structure is no longer queued behind a model call. pollJob's first read is 1600ms after
    // its job starts, so a single caption on the critical path would push this past 1.6s.
    const lastApprove = Math.max(...calls.filter((c) => c.url.includes('/approve')).map((c) => c.t));
    const firstPoll = firstAfterApply('/api/jobs/');
    expect(lastApprove, `approves: ${calls.filter((c) => c.url.includes('/approve')).map((c) => c.t).join(', ')}ms`)
      .toBeLessThan(firstPoll === -1 ? Number.MAX_SAFE_INTEGER : firstPoll + 1);
    expect(tStructure, `structure took ${tStructure}ms`).toBeLessThan(1600);

    // eslint-disable-next-line no-console
    console.log(`[G4] structure visible at ${tStructure}ms · approves ${countOf('/approve')} · plan refetches ${planRefetches()} · job polls so far ${countOf('/api/jobs/')}`);
  }, 30_000);

  it('ONE plan refetch for the batch, not one per item', async () => {
    await mountAndAsk();
    t0 = performance.now();
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    await structureVisible();
    // Three items used to mean three refetches inside the loop and three more after their jobs.
    const refetches = planRefetches();
    expect(refetches, `plan refetches: ${refetches}`).toBeLessThanOrEqual(1);
  }, 30_000);

  it('the rows land as ON ITS WAY — visible immediately, and honest about what is missing', async () => {
    await mountAndAsk();
    t0 = performance.now();
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    await structureVisible();

    // Stand on one of the new days: the card is there and says what it is waiting for.
    fireEvent.click(screen.getAllByTestId('grid-cell').find((c) => c.getAttribute('data-date') === '2026-10-30')!);
    fireEvent.click(screen.getByTestId('nav-day'));
    expect(screen.getByTestId('day-panel').getAttribute('data-date')).toBe('2026-10-30');
    expect(screen.getByTestId('day-panel').textContent).toContain('On its way');
  }, 30_000);

  it('CONTENT still arrives — the polls run, they are just not on the critical path', async () => {
    await mountAndAsk();
    t0 = performance.now();
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    await structureVisible();
    await until(() => countOf('/api/jobs/') >= 3);
    expect(countOf('/api/jobs/')).toBeGreaterThanOrEqual(3);
    // eslint-disable-next-line no-console
    console.log(`[G4] job polls after structure: ${countOf('/api/jobs/')}`);
  }, 30_000);
});
