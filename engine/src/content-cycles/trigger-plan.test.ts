import { describe, it, expect, vi } from 'vitest';
import { clients, clientChannels, contentCycles } from '@sprigly/db';
import {
  isValidMonth,
  cycleMonthForPlanMonth,
  createOnDemandCycle,
  type TriggerPlanParams,
} from './trigger-plan.js';

// ── month arithmetic ──────────────────────────────────────────────────────────

describe('isValidMonth', () => {
  it('accepts well-formed YYYY-MM with month 01-12', () => {
    expect(isValidMonth('2026-08')).toBe(true);
    expect(isValidMonth('2026-01')).toBe(true);
    expect(isValidMonth('2026-12')).toBe(true);
  });
  it('rejects bad format or out-of-range month', () => {
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-00')).toBe(false);
    expect(isValidMonth('2026-8')).toBe(false);
    expect(isValidMonth('26-08')).toBe(false);
    expect(isValidMonth('August')).toBe(false);
    expect(isValidMonth('')).toBe(false);
  });
});

describe('cycleMonthForPlanMonth — plan FOR month M ⇒ cycle_month M-1', () => {
  it('plans for 2026-08 from cycle_month 2026-07', () => {
    expect(cycleMonthForPlanMonth('2026-08')).toBe('2026-07');
  });
  it('rolls the year at January (2026-01 ⇒ 2025-12)', () => {
    expect(cycleMonthForPlanMonth('2026-01')).toBe('2025-12');
  });
  it('mid-year', () => {
    expect(cycleMonthForPlanMonth('2026-06')).toBe('2026-05');
  });
});

// ── createOnDemandCycle: scripted-db mock ─────────────────────────────────────
// Mock mirrors the drizzle chains used by the module:
//   select({...}).from(t).where(...).limit(1)
//   insert(t).values(v).onConflictDoNothing().returning({...})
// Rows are keyed by the table object identity passed to from()/insert().

interface Script {
  client?:   Array<Record<string, unknown>>;
  channel?:  Array<Record<string, unknown>>;
  existing?: Array<Record<string, unknown>>;
  inserted?: Array<Record<string, unknown>>;
}

function makeDb(script: Script): { db: TriggerPlanParams['db']; captured: { insertValues?: Record<string, unknown>; inserts: number } } {
  const captured = { inserts: 0 } as { insertValues?: Record<string, unknown>; inserts: number };
  let table: unknown;
  const chain: Record<string, unknown> = {
    from(t: unknown) { table = t; return chain; },
    where() { return chain; },
    limit() {
      if (table === clients) return Promise.resolve(script.client ?? []);
      if (table === clientChannels) return Promise.resolve(script.channel ?? []);
      if (table === contentCycles) return Promise.resolve(script.existing ?? []);
      return Promise.resolve([]);
    },
    values(v: Record<string, unknown>) { captured.insertValues = v; return chain; },
    onConflictDoNothing() { return chain; },
    returning() { return Promise.resolve(script.inserted ?? []); },
  };
  const db = {
    select() { return chain; },
    insert(t: unknown) { table = t; captured.inserts++; return chain; },
  } as unknown as TriggerPlanParams['db'];
  return { db, captured };
}

const BASE = {
  clientSlug: 'sandbox',
  channel: 'instagram',
  planMonth: '2026-08',
  capturedAt: '2026-07-10T00:00:00.000Z',
};

describe('createOnDemandCycle', () => {
  it('happy path: inserts intake_confirmed + enqueues with the new cycle id', async () => {
    const { db, captured } = makeDb({
      client: [{ id: 'client-1' }], channel: [{ id: 'chan-1' }], existing: [], inserted: [{ id: 'cycle-1' }],
    });
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const r = await createOnDemandCycle({ ...BASE, db, enqueue, intake: 'Launching the Wren vest on the 12th' });

    expect(r.ok).toBe(true);
    expect(r.cycleMonth).toBe('2026-07');          // plan 2026-08 → cycle_month 2026-07
    expect(r.cycleId).toBe('cycle-1');
    expect(r.status).toBe('intake_confirmed');
    expect(captured.insertValues?.['status']).toBe('intake_confirmed');
    expect(captured.insertValues?.['cycleMonth']).toBe('2026-07');
    expect(captured.insertValues?.['intakeSource']).toBe('manual');
    expect((captured.insertValues?.['intakeJson'] as { planContent: { freeNotes: string } }).planContent.freeNotes)
      .toBe('Launching the Wren vest on the 12th');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith('cycle-1');
  });

  it('no --intake ⇒ intake_json null, intakeSource null, still enqueues', async () => {
    const { db, captured } = makeDb({
      client: [{ id: 'client-1' }], channel: [{ id: 'chan-1' }], existing: [], inserted: [{ id: 'cycle-2' }],
    });
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const r = await createOnDemandCycle({ ...BASE, db, enqueue });

    expect(r.ok).toBe(true);
    expect(captured.insertValues?.['intakeJson']).toBeNull();
    expect(captured.insertValues?.['intakeSource']).toBeNull();
    expect(enqueue).toHaveBeenCalledWith('cycle-2');
  });

  it('invalid plan-month ⇒ refuses before touching the db, no enqueue', async () => {
    const db = { select() { throw new Error('db must not be touched'); }, insert() { throw new Error('db must not be touched'); } } as unknown as TriggerPlanParams['db'];
    const enqueue = vi.fn();
    const r = await createOnDemandCycle({ ...BASE, planMonth: '2026-13', db, enqueue });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Invalid --plan-month/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('unknown client ⇒ refuses, no insert, no enqueue', async () => {
    const { db, captured } = makeDb({ client: [] });
    const enqueue = vi.fn();
    const r = await createOnDemandCycle({ ...BASE, clientSlug: 'nope', db, enqueue });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Client not found/);
    expect(captured.inserts).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('unknown channel ⇒ refuses, no insert, no enqueue', async () => {
    const { db, captured } = makeDb({ client: [{ id: 'client-1' }], channel: [] });
    const enqueue = vi.fn();
    const r = await createOnDemandCycle({ ...BASE, channel: 'tiktok', db, enqueue });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Channel "tiktok" not found/);
    expect(captured.inserts).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('duplicate cycle ⇒ refuses cleanly, reports existing id/status, no insert, no enqueue', async () => {
    const { db, captured } = makeDb({
      client: [{ id: 'client-1' }], channel: [{ id: 'chan-1' }],
      existing: [{ id: 'existing-cycle', status: 'planning' }],
    });
    const enqueue = vi.fn();
    const r = await createOnDemandCycle({ ...BASE, db, enqueue });
    expect(r.ok).toBe(false);
    expect(r.cycleId).toBe('existing-cycle');
    expect(r.status).toBe('planning');
    expect(r.message).toMatch(/already exists/);
    expect(captured.inserts).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
