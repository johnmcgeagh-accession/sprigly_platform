/**
 * fanout-ceiling.test.ts — the runaway guard on the cutoff fan-out.
 *
 * ── Why a ceiling exists at all ──────────────────────────────────────────────────────
 *
 * `autoApproveAndGenerate` queues one paid Bedrock job per approved post and reads nothing
 * that would ever stop it. Until 0094 a planner bug that produced hundreds of beats was
 * absorbed, by accident, by the client's AI-change allowance running out mid-run — which was
 * never a spend guard, and is now correctly not consulted on this path at all. Removing the
 * accidental brake means the deliberate one has to exist.
 *
 * ── What these pin ───────────────────────────────────────────────────────────────────
 *
 * That a NORMAL month is untouched and silent, that an impossible one is truncated and LOUD,
 * and — the part that matters most — that the two are distinguishable by something other than
 * arithmetic. An enqueue failure also leaves `captionsQueued < approved`, so the flag has to
 * be its own fact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  posts: [] as Record<string, unknown>[],
  approvedIds: [] as string[],
  added: [] as { name: string; payload: Record<string, unknown> }[],
  updates: [] as Record<string, unknown>[],
  logs: { info: [] as unknown[][], warn: [] as unknown[][], error: [] as unknown[][] },
  addThrowsOn: null as string | null,
}));

vi.mock('@sprigly/db', () => ({
  clients: {}, clientChannels: {}, clientConfigs: {}, clientPlanningConfig: {}, clientProductCatalogue: {},
  contentCycles: new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
  contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
  igPosts: {}, voiceSnapshots: {},
  excludeDraftPosts: () => 'excludeDraftPosts',
  POST_STATUS_DRAFT: 'draft',
  PRE_PLANNING_STATUSES: new Set(['scheduled']),
  retireDraftPosts: async () => ({}),
}));

vi.mock('@sprigly/engine', () => ({
  assembleDraft: () => ({}), applyPhrasing: () => ({}), phraseDraftTitles: () => ({}),
  loadDurableInputs: async () => ({}), readDraftFlowFlag: () => true,
  approveDraftCore: async () => ({ ok: true, approved: h.approvedIds.length, postIds: h.approvedIds }),
  cadenceFloorSlots: () => [], resolveRecurringSeries: () => [], observeProductCoverage: () => ({}),
  catalogueProductNames: () => [], STALE_TRAWL_DAYS: 14, DRAFT_DEFAULT_TEMPERATURE: 0.7,
}));

vi.mock('../catalogue/validate-catalogue.js', () => ({ deriveBrandTokens: () => new Set<string>() }));
vi.mock('./job-options.js', () => ({ GENERATION_JOB_OPTIONS: { attempts: 3 } }));
vi.mock('./planning.js', () => ({}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  desc: (a: unknown) => ['desc', a],
  isNull: (a: unknown) => ['isNull', a],
}));

const db = {
  select: () => {
    const q: Record<string, unknown> = {};
    q['from']    = () => q;
    q['where']   = () => Promise.resolve(h.posts);
    q['orderBy'] = () => q;
    q['limit']   = () => Promise.resolve(h.posts);
    return q;
  },
  update: () => ({
    set: (payload: Record<string, unknown>) => ({
      where: () => { h.updates.push(payload); return Promise.resolve(); },
    }),
  }),
} as never;

const logger = {
  info:  (...a: unknown[]) => { h.logs.info.push(a); },
  warn:  (...a: unknown[]) => { h.logs.warn.push(a); },
  error: (...a: unknown[]) => { h.logs.error.push(a); },
} as never;

const queue = {
  add: async (name: string, payload: Record<string, unknown>) => {
    if (h.addThrowsOn && payload['targetPostId'] === h.addThrowsOn) throw new Error('redis is down');
    h.added.push({ name, payload });
  },
} as never;

import { autoApproveAndGenerate, FANOUT_CEILING } from './draft-plan.js';

/** n approved single-format posts, as the re-read returns them. */
function seed(n: number): void {
  h.posts = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, format: 'single', pillar: 'Everyday Ritual', sourceMeta: { title: `Beat ${i}` },
  }));
  h.approvedIds = h.posts.map((p) => String(p['id']));
}

const DEPS = { db, logger } as never;

beforeEach(() => {
  h.posts = []; h.approvedIds = []; h.added = []; h.updates = [];
  h.logs = { info: [], warn: [], error: [] };
  h.addThrowsOn = null;
});

describe('a normal month', () => {
  it('a 30-post month fans out completely and says nothing about a ceiling', async () => {
    seed(30);
    const r = await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc1');

    expect(r.approved).toBe(30);
    expect(r.captionsQueued).toBe(30);
    expect(r.capped).toBe(false);
    expect(h.added).toHaveLength(30);
    expect(h.logs.error).toHaveLength(0);
  });

  it('the ceiling is four months of content — nothing legitimate is near it', () => {
    expect(FANOUT_CEILING).toBe(120);
  });

  it('exactly at the ceiling is still a finished run, not a capped one', async () => {
    // The boundary is `>`, not `>=`: 120 posts produce 120 jobs and no alarm. A guard that
    // cried wolf on the last legitimate value would be one somebody learns to ignore.
    seed(FANOUT_CEILING);
    const r = await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc1');

    expect(r.captionsQueued).toBe(FANOUT_CEILING);
    expect(r.capped).toBe(false);
    expect(h.logs.error).toHaveLength(0);
  });
});

describe('a runaway month', () => {
  it('is truncated at the ceiling and reported as capped', async () => {
    seed(500);
    const r = await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc1');

    expect(r.capped).toBe(true);
    expect(r.captionsQueued).toBe(FANOUT_CEILING);
    expect(h.added).toHaveLength(FANOUT_CEILING);
  });

  it('logs at ERROR, naming the cycle id and the count it was about to queue', async () => {
    seed(500);
    await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc-runaway');

    expect(h.logs.error).toHaveLength(1);
    const [ctx, message] = h.logs.error[0] as [Record<string, unknown>, string];
    expect(ctx['cycleId']).toBe('cyc-runaway');
    expect(ctx['intended']).toBe(500);
    expect(ctx['ceiling']).toBe(FANOUT_CEILING);
    expect(ctx['notQueued']).toBe(500 - FANOUT_CEILING);
    expect(message).toContain('cyc-runaway');
    expect(message).toContain('500');
  });

  it('the excess is left alone — not marked failed, because the fault is ours not the post’s', async () => {
    seed(500);
    await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc1');

    // The only updates a clean run writes are per-post enqueue failures. There were none.
    expect(h.updates).toHaveLength(0);
  });

  it('one alarm per run, not one per post over the line', async () => {
    seed(500);
    await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc1');
    expect(h.logs.error).toHaveLength(1);
  });
});

describe('capped is not "fewer jobs than posts"', () => {
  it('an enqueue failure shortens the count WITHOUT setting capped', async () => {
    // This is the whole reason `capped` is returned rather than derived. Both events leave
    // captionsQueued < approved; only one of them means the month was impossible.
    seed(30);
    h.addThrowsOn = 'p7';
    const r = await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc1');

    expect(r.approved).toBe(30);
    expect(r.captionsQueued).toBe(29);
    expect(r.capped).toBe(false);
    expect(h.logs.error).toHaveLength(0);
    // and the one post that failed is marked, as it always was
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!['status']).toBe('generation_failed');
  });
});

describe('the ceiling never touches the client’s allowance', () => {
  it('fans out without reading usage, and every job it queues is exempt', async () => {
    // A runaway is OUR bug. The client is not billed for it, and a client with an override is
    // not exempt from it — the two mechanisms share no input at all.
    seed(500);
    await autoApproveAndGenerate(DEPS, queue, 'c1', 'cyc1');

    expect(h.added.every((a) => a.payload['billable'] === false)).toBe(true);
  });
});
