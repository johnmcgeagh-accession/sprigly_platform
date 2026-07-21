/**
 * draft-mutations.test.ts — structural edits on draft beats.
 *
 * The guards are the point. Every mutation must refuse a committed post, refuse a cycle
 * past its cutoff, and refuse vocabulary it was not given — and each refusal must be
 * distinguishable, because the client sees the difference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Terminal query results, consumed in call order. */
let results: unknown[][] = [];
const writes: { kind: 'update' | 'insert' | 'delete'; payload?: unknown; where?: unknown }[] = [];
const captured: { where: unknown[] } = { where: [] };

vi.mock('@sprigly/db', () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q['from']    = vi.fn(() => q);
    q['where']   = vi.fn((cond: unknown) => { captured.where.push(cond); return q; });
    q['orderBy'] = vi.fn(() => Promise.resolve(results.shift() ?? []));
    q['limit']   = vi.fn(() => Promise.resolve(results.shift() ?? []));
    // A bare .where() that is awaited (the max-position aggregate) resolves too.
    q['then']    = (res: (v: unknown) => unknown) => res(results.shift() ?? []);
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select: vi.fn(() => chain()),
    update: vi.fn(() => ({
      set: vi.fn((payload: unknown) => ({
        where: vi.fn((where: unknown) => { writes.push({ kind: 'update', payload, where }); return Promise.resolve(); }),
      })),
    })),
    insert: vi.fn(() => ({
      // `.returning()` is awaited by addBeat/restoreBeat so the ledger row can name the
      // post they created; a bare thenable is no longer a usable stand-in for the insert.
      values: vi.fn((payload: unknown) => {
        writes.push({ kind: 'insert', payload });
        const rows = [{ id: 'new-post-id' }];
        return Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((where: unknown) => { writes.push({ kind: 'delete', where }); return Promise.resolve(); }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return {
    db,
    contentCycles:        new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
    contentCyclePosts:    new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
    clientPlanningConfig: new Proxy({}, { get: (_t, k) => `clientPlanningConfig.${String(k)}` }),
    excludeDraftPosts:    () => Symbol('fence'),
    POST_STATUS_DRAFT:    'draft',
    PRE_PLANNING_STATUSES: new Set(['scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed']),
  };
});

vi.mock('drizzle-orm', () => ({
  and:    (...args: unknown[]) => args,
  eq:     (a: unknown, b: unknown) => ['eq', a, b],
  ne:     (a: unknown, b: unknown) => ['ne', a, b],
  asc:    (a: unknown) => ['asc', a],
  desc:   (a: unknown) => ['desc', a],
  gte:    (a: unknown, b: unknown) => ['gte', a, b],
  lt:     (a: unknown, b: unknown) => ['lt', a, b],
  isNull: (a: unknown) => ['isNull', a],
  sql:    Object.assign(() => 'sql', { raw: () => 'sql' }),
}));

vi.mock('@/lib/steps', () => ({ listStepsForPosts: () => Promise.resolve(new Map()), resolveTodayIso: () => '2026-08-01' }));

const TODAY = '2026-08-01';

/** requireDraftMutable does: [post row] then [cycle row]; each mutation then reloads beats. */
const mutableDraft = (over: Record<string, unknown> = {}) => [
  [{ cycleId: 'cycle-1', scheduledDate: '2026-09-02', channel: 'instagram', position: 0, pillar: 'Everyday Ritual', status: 'draft', ...over }],
  [{ status: 'scheduled' }],   // pre-cutoff
];
const reload = [[]];   // loadDraftBeats after the write

function hasEq(node: unknown, column: string, value: unknown): boolean {
  if (Array.isArray(node)) {
    if (node[0] === 'eq' && node[1] === column && node[2] === value) return true;
    return node.some((n) => hasEq(n, column, value));
  }
  return false;
}

beforeEach(() => { results = []; writes.length = 0; captured.where = []; });

describe('moveBeat', () => {
  it('moves a draft beat to a new date', async () => {
    results = [...mutableDraft(), ...reload];
    const { moveBeat } = await import('@/lib/draft-mutations');
    const res = await moveBeat('client-1', 'beat-1', '2026-09-10', TODAY);
    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'update', payload: { scheduledDate: '2026-09-10' } });
  });

  it('scopes the write to status=draft, so a committed post is unreachable even by id', async () => {
    results = [...mutableDraft(), ...reload];
    const { moveBeat } = await import('@/lib/draft-mutations');
    await moveBeat('client-1', 'beat-1', '2026-09-10', TODAY);
    expect(hasEq(writes[0]!.where, 'contentCyclePosts.status', 'draft')).toBe(true);
    expect(hasEq(writes[0]!.where, 'contentCyclePosts.clientId', 'client-1')).toBe(true);
  });

  it('rejects a COMMITTED post with not_a_draft', async () => {
    results = [[{ cycleId: 'cycle-1', scheduledDate: '2026-09-02', channel: 'instagram', position: 0, pillar: 'x', status: 'planned' }]];
    const { moveBeat } = await import('@/lib/draft-mutations');
    const res = await moveBeat('client-1', 'beat-1', '2026-09-10', TODAY);
    expect(res).toMatchObject({ ok: false, error: 'not_a_draft' });
    expect(writes).toHaveLength(0);
  });

  it('rejects a cycle PAST its cutoff', async () => {
    results = [mutableDraft()[0]!, [{ status: 'workbook_built' }]];
    const { moveBeat } = await import('@/lib/draft-mutations');
    const res = await moveBeat('client-1', 'beat-1', '2026-09-10', TODAY);
    expect(res).toMatchObject({ ok: false, error: 'cutoff_passed' });
    expect(writes).toHaveLength(0);
  });

  it('rejects an unknown id with not_found, never revealing whose it is', async () => {
    results = [[]];
    const { moveBeat } = await import('@/lib/draft-mutations');
    const res = await moveBeat('client-1', 'nope', '2026-09-10', TODAY);
    expect(res).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('rejects a past date and a malformed date', async () => {
    const { moveBeat } = await import('@/lib/draft-mutations');
    results = [...mutableDraft()];
    expect(await moveBeat('client-1', 'beat-1', '2026-07-01', TODAY)).toMatchObject({ ok: false, error: 'read_only_date' });
    results = [...mutableDraft()];
    expect(await moveBeat('client-1', 'beat-1', 'not-a-date', TODAY)).toMatchObject({ ok: false, error: 'read_only_date' });
    expect(writes).toHaveLength(0);
  });
});

describe('swapFormat', () => {
  it.each(['reel', 'carousel', 'single'])('accepts %s', async (format) => {
    results = [...mutableDraft(), ...reload];
    const { swapFormat } = await import('@/lib/draft-mutations');
    const res = await swapFormat('client-1', 'beat-1', format);
    expect(res.ok).toBe(true);
    expect(writes[0]).toMatchObject({ kind: 'update', payload: { format } });
  });

  it.each(['email', 'story', 'REEL', ''])('rejects %s as invalid_format', async (format) => {
    results = [...mutableDraft()];
    const { swapFormat } = await import('@/lib/draft-mutations');
    const res = await swapFormat('client-1', 'beat-1', format);
    expect(res).toMatchObject({ ok: false, error: 'invalid_format' });
    expect(writes).toHaveLength(0);
  });

  it('rejects a committed post', async () => {
    results = [[{ cycleId: 'c', scheduledDate: '2026-09-02', channel: 'instagram', position: 0, pillar: 'x', status: 'edited' }]];
    const { swapFormat } = await import('@/lib/draft-mutations');
    expect(await swapFormat('client-1', 'beat-1', 'reel')).toMatchObject({ ok: false, error: 'not_a_draft' });
  });
});

describe('dropBeat', () => {
  it('HARD deletes the row — a draft has no history worth tombstoning', async () => {
    results = [...mutableDraft(), ...reload];
    const { dropBeat } = await import('@/lib/draft-mutations');
    const res = await dropBeat('client-1', 'beat-1');
    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.kind).toBe('delete');
    expect(hasEq(writes[0]!.where, 'contentCyclePosts.status', 'draft')).toBe(true);
  });

  it('refuses to delete a committed post', async () => {
    results = [[{ cycleId: 'c', scheduledDate: '2026-09-02', channel: 'instagram', position: 0, pillar: 'x', status: 'planned' }]];
    const { dropBeat } = await import('@/lib/draft-mutations');
    expect(await dropBeat('client-1', 'beat-1')).toMatchObject({ ok: false, error: 'not_a_draft' });
    expect(writes).toHaveLength(0);
  });

  it('refuses past cutoff', async () => {
    results = [mutableDraft()[0]!, [{ status: 'delivered' }]];
    const { dropBeat } = await import('@/lib/draft-mutations');
    expect(await dropBeat('client-1', 'beat-1')).toMatchObject({ ok: false, error: 'cutoff_passed' });
    expect(writes).toHaveLength(0);
  });
});

describe('addBeat', () => {
  const VOCAB = [[{ pillars: [{ name: 'Everyday Ritual' }, { name: 'Home & Space' }] }]];

  it('adds a beat with HONEST client_added evidence — no metrics pretended', async () => {
    results = [[{ status: 'scheduled' }], [{ channel: 'instagram' }], ...VOCAB, [{ position: 4 }], ...reload];
    const { addBeat } = await import('@/lib/draft-mutations');
    const res = await addBeat('client-1', 'cycle-1', { date: '2026-09-15', format: 'reel', pillar: 'Home & Space' }, TODAY);
    expect(res.ok).toBe(true);

    const payload = writes[0]!.payload as Record<string, unknown>;
    expect(writes[0]!.kind).toBe('insert');
    expect(payload['status']).toBe('draft');
    expect(payload['position']).toBe(5);
    const meta = payload['beatMeta'] as Record<string, unknown>;
    expect(meta['slotType']).toBe('proven');
    // The crux: the evidence says the client added it, and claims nothing else.
    expect(meta['rationaleEvidence']).toEqual({ basis: 'client_added' });
  });

  it('takes the channel from the CYCLE, never the caller', async () => {
    results = [[{ status: 'scheduled' }], [{ channel: 'instagram' }], ...VOCAB, [{ position: 0 }], ...reload];
    const { addBeat } = await import('@/lib/draft-mutations');
    await addBeat('client-1', 'cycle-1', { date: '2026-09-15', format: 'reel', pillar: 'Home & Space' }, TODAY);
    expect((writes[0]!.payload as Record<string, unknown>)['channel']).toBe('instagram');
  });

  it('rejects a pillar outside the client’s configured vocabulary', async () => {
    results = [[{ status: 'scheduled' }], [{ channel: 'instagram' }], ...VOCAB];
    const { addBeat } = await import('@/lib/draft-mutations');
    const res = await addBeat('client-1', 'cycle-1', { date: '2026-09-15', format: 'reel', pillar: 'Made Up Pillar' }, TODAY);
    expect(res).toMatchObject({ ok: false, error: 'invalid_pillar' });
    expect(writes).toHaveLength(0);
  });

  it('rejects ANY pillar when the client has no configured vocabulary', async () => {
    // Refusing beats accepting free text: an unvalidated pillar would poison the pillar
    // weights the assembler reads back.
    results = [[{ status: 'scheduled' }], [{ channel: 'instagram' }], [[]]];
    const { addBeat } = await import('@/lib/draft-mutations');
    const res = await addBeat('client-1', 'cycle-1', { date: '2026-09-15', format: 'reel', pillar: 'Anything' }, TODAY);
    expect(res).toMatchObject({ ok: false, error: 'invalid_pillar' });
  });

  it('rejects an invalid format before touching the database', async () => {
    results = [[{ status: 'scheduled' }]];
    const { addBeat } = await import('@/lib/draft-mutations');
    expect(await addBeat('client-1', 'cycle-1', { date: '2026-09-15', format: 'email', pillar: 'Home & Space' }, TODAY))
      .toMatchObject({ ok: false, error: 'invalid_format' });
    expect(writes).toHaveLength(0);
  });

  it('rejects past cutoff and past dates', async () => {
    const { addBeat } = await import('@/lib/draft-mutations');
    results = [[{ status: 'workbook_built' }]];
    expect(await addBeat('client-1', 'cycle-1', { date: '2026-09-15', format: 'reel', pillar: 'Home & Space' }, TODAY))
      .toMatchObject({ ok: false, error: 'cutoff_passed' });
    results = [[{ status: 'scheduled' }]];
    expect(await addBeat('client-1', 'cycle-1', { date: '2026-07-01', format: 'reel', pillar: 'Home & Space' }, TODAY))
      .toMatchObject({ ok: false, error: 'read_only_date' });
    expect(writes).toHaveLength(0);
  });

  it('rejects a cycle that is not this client’s', async () => {
    results = [[{ status: 'scheduled' }], []];
    const { addBeat } = await import('@/lib/draft-mutations');
    expect(await addBeat('client-1', 'cycle-x', { date: '2026-09-15', format: 'reel', pillar: 'Home & Space' }, TODAY))
      .toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('reorderWithinDay', () => {
  it('renumbers same-day beats into the requested order, reusing their existing slots', async () => {
    results = [
      [{ status: 'scheduled' }],
      [{ id: 'a', position: 3 }, { id: 'b', position: 4 }, { id: 'c', position: 5 }],
      ...reload,
    ];
    const { reorderWithinDay } = await import('@/lib/draft-mutations');
    const res = await reorderWithinDay('client-1', 'cycle-1', '2026-09-02', ['c', 'a', 'b']);
    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(3);
    // c→3, a→4, b→5: the block of positions is reused, so no other day shifts.
    expect(writes.map((w) => (w.payload as Record<string, unknown>)['position'])).toEqual([3, 4, 5]);
  });

  it('ignores ids not on that date rather than failing wholesale', async () => {
    results = [
      [{ status: 'scheduled' }],
      [{ id: 'a', position: 0 }, { id: 'b', position: 1 }],
      ...reload,
    ];
    const { reorderWithinDay } = await import('@/lib/draft-mutations');
    const res = await reorderWithinDay('client-1', 'cycle-1', '2026-09-02', ['ghost', 'b', 'a']);
    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(2);
  });

  it('refuses past cutoff', async () => {
    results = [[{ status: 'delivered' }]];
    const { reorderWithinDay } = await import('@/lib/draft-mutations');
    expect(await reorderWithinDay('client-1', 'cycle-1', '2026-09-02', ['a']))
      .toMatchObject({ ok: false, error: 'cutoff_passed' });
    expect(writes).toHaveLength(0);
  });
});

describe('no mutation ever writes `status`', () => {
  it('approval is Build D — an edit must never commit a plan the client did not approve', async () => {
    const { moveBeat, swapFormat } = await import('@/lib/draft-mutations');
    results = [...mutableDraft(), ...reload];
    await moveBeat('client-1', 'beat-1', '2026-09-10', TODAY);
    results = [...mutableDraft(), ...reload];
    await swapFormat('client-1', 'beat-1', 'reel');
    for (const w of writes) {
      if (w.kind === 'update') expect(w.payload).not.toHaveProperty('status');
    }
  });
});
