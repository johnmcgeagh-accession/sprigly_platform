/**
 * surface-follows-cycle.test.ts — the surface kind is decided PER CYCLE, server-side, and
 * the client follows it on every month switch.
 *
 * The bug: the surface was computed once, for the landed cycle, and a month switch could
 * only swap data inside the shell that decision had already chosen. A client who left a
 * draft month could never get back to it (docs/reports/draft-mode-not-rendering.md §3).
 *
 * `surfaceForCycle` is the single server-side computation, shared by the first paint
 * (page.tsx) and GET /api/plan. Testing it per cycle IS the round trip: the same helper,
 * asked about two cycles alternately, must keep answering correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// One in-memory table, keyed by cycle. The db mock returns whatever the current scenario
// says that cycle holds, so a "switch" is just asking about a different id.
const draftRowsByCycle = new Map<string, unknown[]>();

vi.mock('@sprigly/db', () => {
  const col = (name: string) => ({ name });
  const chain = (rows: unknown[]) => ({
    from:    () => chain(rows),
    where:   () => chain(rows),
    orderBy: () => Promise.resolve(rows),
    limit:   () => Promise.resolve(rows),
  });
  return {
    db: {
      // loadDraftBeats is the only reader surfaceForCycle touches; `where` closes over the
      // cycle id the test set up via currentCycle.
      select: () => chain(draftRowsByCycle.get(currentCycle) ?? []),
    },
    contentCycles:        new Proxy({}, { get: (_t, p) => col(String(p)) }),
    contentCyclePosts:    new Proxy({}, { get: (_t, p) => col(String(p)) }),
    clientPlanningConfig: new Proxy({}, { get: (_t, p) => col(String(p)) }),
    excludeDraftPosts:    () => ({}),
    POST_STATUS_DRAFT:    'draft',
    PRE_PLANNING_STATUSES: new Set(['scheduled']),
  };
});
vi.mock('@/lib/steps', () => ({ listStepsForPosts: async () => new Map() }));
vi.mock('@/lib/draft-mutations', () => ({ cycleIsPreCutoff: async () => true }));
vi.mock('@/lib/draft-apply', () => ({ loadReceipts: async () => [] }));

let currentCycle = '';

import { surfaceForCycle } from './plan';
import { followServerSurface } from './surface-state';

const DRAFT_CYCLE     = 'cyc-draft';
const COMMITTED_CYCLE = 'cyc-committed';

/** A minimal draft row — only the fields toDraftBeat reads structurally. */
const draftRow = (id: string) => ({
  id, cycleId: DRAFT_CYCLE, scheduledDate: '2026-10-02', format: 'carousel',
  pillar: 'Brand', position: 0, sourceMeta: { title: 'Brand — Carousel' }, beatMeta: null,
});

async function surfaceOf(cycleId: string, committedPostCount: number) {
  currentCycle = cycleId;
  return surfaceForCycle({ clientId: 'client-1', cycleId, committedPostCount, planRedesign: true });
}

beforeEach(() => {
  draftRowsByCycle.clear();
  draftRowsByCycle.set(DRAFT_CYCLE, [draftRow('b1'), draftRow('b2')]);
  draftRowsByCycle.set(COMMITTED_CYCLE, []);
});

describe('surfaceForCycle — the server decides, per cycle', () => {
  it('draft-only cycle → draft', async () => {
    const { kind, draftBeats } = await surfaceOf(DRAFT_CYCLE, 0);
    expect(kind).toBe('draft');
    expect(draftBeats).toHaveLength(2);
  });

  it('committed cycle → committed-redesign', async () => {
    const { kind } = await surfaceOf(COMMITTED_CYCLE, 12);
    expect(kind).toBe('committed-redesign');
  });

  it('MIXED (committed posts AND drafts) → committed wins, per the Build B rule', async () => {
    // A cycle holding both is the known interim state; the committed plan must win and the
    // drafts stay invisible, exactly as they are to every other reader.
    draftRowsByCycle.set(COMMITTED_CYCLE, [draftRow('b1')]);
    const { kind, draftBeats } = await surfaceOf(COMMITTED_CYCLE, 12);
    expect(kind).toBe('committed-redesign');
    // …and the draft read was never even paid for.
    expect(draftBeats).toHaveLength(0);
  });

  it('empty cycle (no posts, no drafts) → committed-redesign, which renders its own empty state', async () => {
    const { kind } = await surfaceOf(COMMITTED_CYCLE, 0);
    expect(kind).toBe('committed-redesign');
  });

  it('flag-off tenant with a draft still gets draft — the draft check precedes the flag', async () => {
    currentCycle = DRAFT_CYCLE;
    const { kind } = await surfaceForCycle({
      clientId: 'client-1', cycleId: DRAFT_CYCLE, committedPostCount: 0, planRedesign: false,
    });
    expect(kind).toBe('draft');
  });

  it('ROUND TRIP: draft → committed → draft, the hole the report identified', async () => {
    expect((await surfaceOf(DRAFT_CYCLE, 0)).kind).toBe('draft');              // land on the draft
    expect((await surfaceOf(COMMITTED_CYCLE, 12)).kind).toBe('committed-redesign'); // switch away
    expect((await surfaceOf(DRAFT_CYCLE, 0)).kind).toBe('draft');              // and back again
  });
});

describe('followServerSurface — the client follows, it does not decide', () => {
  it('draft: adopt it and fetch the draft payload from its own reader', () => {
    expect(followServerSurface('draft')).toEqual({ kind: 'draft', loadDraft: true });
  });

  it('committed: adopt it and load NO draft, so a stale draft cannot render over a plan', () => {
    expect(followServerSurface('committed-redesign')).toEqual({ kind: 'committed-redesign', loadDraft: false });
    expect(followServerSurface('committed-legacy')).toEqual({ kind: 'committed-legacy', loadDraft: false });
  });

  it('missing field falls back to the committed shell, not to an empty draft frame', () => {
    expect(followServerSurface(undefined)).toEqual({ kind: 'committed-redesign', loadDraft: false });
  });
});
