/**
 * undo-restore.integration.test.ts — undo of a drop restores the beat, byte-identical.
 *
 * Before this, the Remove button stashed `{op:'add', date, format, pillar}` and undo routed
 * through addBeat, which manufactures a NEW beat: title = pillar name, basis =
 * 'client_added', clientTouched = true, position at the end, evidence gone. Undoing a
 * launch-arc beat destroyed it. Reproduced in Part 0; it is where the seven subjectless
 * husks in cycle 040d6a1a came from (docs/reports/uat-findings-fixes.md).
 *
 * The three provenances below are exactly the three found in that cycle's data.
 *
 * Requires Postgres; skipped cleanly without TEST_DATABASE_URL.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const TEST_DB = process.env['TEST_DATABASE_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Dates relative to the RUN date, not the authoring date.
 *
 * These fixtures pass through the real date gate (isEditableDate, defaulting today to
 * editScopeToday()), so a hardcoded literal is only "a future date" until the calendar
 * reaches it — the failure mode plan-activity.integration.test.ts hit. Anchoring to the 1st
 * of next month keeps every fixture date future whenever the suite runs.
 */
function nextMonthStart(todayIso: string): string {
  const [y, m] = todayIso.split('-').map(Number);
  return m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`;
}
const plusDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);


describe.skipIf(!TEST_DB)('undo restores a dropped beat byte-identically', () => {
  let sql: Any, M: Any;
  let beatDate: string, cycleMonth: string;

  beforeAll(async () => {
    ({ sql } = await import('@sprigly/db'));
    M = await import('./draft-mutations');
    const { editScopeToday } = await import('./edit-scope');
    beatDate   = nextMonthStart(editScopeToday());
    cycleMonth = editScopeToday().slice(0, 7);     // a cycle plans the month AFTER its own
  });

  const PILLARS = ['Brand Story & Culture', 'Home & Space', 'Workshops & Experiences'];

  async function fixture(): Promise<{ clientId: string; cycleId: string }> {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id: clientId }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES ('Undo', ${`undo-${stamp}`}, 'active') RETURNING id`;
    await sql`INSERT INTO client_planning_config (client_id, channel, pillars, categories)
              VALUES (${clientId}, 'instagram', ${sql.json(PILLARS.map((name) => ({ name })))}, ${sql.json(['Brand'])})`;
    const [{ id: cycleId }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status)
      VALUES (${clientId}, 'instagram', ${cycleMonth}, 'scheduled') RETURNING id`;
    return { clientId, cycleId };
  }

  /** The full row as stored, which is what "byte-identical" is measured against. */
  const readRow = async (id: string) => {
    const [r] = await sql`
      SELECT scheduled_date, format, pillar, position, status, beat_meta, source_meta
      FROM content_cycle_posts WHERE id = ${id}`;
    return r;
  };
  const readOnly1 = async (cycleId: string) => {
    const [r] = await sql`
      SELECT scheduled_date, format, pillar, position, status, beat_meta, source_meta
      FROM content_cycle_posts WHERE cycle_id = ${cycleId}`;
    return r;
  };

  async function seed(clientId: string, cycleId: string, over: {
    title: string; pillar: string; position: number; beatMeta: unknown; format?: string;
  }): Promise<string> {
    const [{ id }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, pillar, status, position, beat_meta, source_meta)
      VALUES (${clientId}, ${cycleId}, 'instagram', ${beatDate}, ${over.format ?? 'single'}, ${over.pillar}, 'draft',
              ${over.position}, ${sql.json(over.beatMeta as Any)}, ${sql.json({ title: over.title })})
      RETURNING id`;
    return id as string;
  }

  /** The three provenances present in cycle 040d6a1a. */
  const CASES = [
    {
      name: "assembler beat ('observed')",
      title: 'An afternoon spent making something',
      pillar: 'Workshops & Experiences',
      position: 9,
      beatMeta: {
        slotType: 'proven',
        rationaleEvidence: {
          basis: 'observed',
          formatEngagement: { format: 'single', avgEngagement: 69.9, posts: 8 },
          pillarShare: 0.2,
          cadenceBasis: { postsPerWeek: 2.24, source: 'observed', months: 4 },
        },
        assumptions: ['No launches or restocks are on record for this month.'],
      },
    },
    {
      name: "launch-arc beat ('client_input') — the case that failed on the phone",
      title: 'wilderness candle launch — Tease',
      pillar: 'Brand Story & Culture',
      position: 11,
      beatMeta: {
        slotType: 'proven',
        rationaleEvidence: { basis: 'client_input', reason: 'The wilderness candle launches on the 31st' },
        sourceRef: 'plan-input-abc',
        assumptions: ['No product catalogue is cached, so no beat names a specific product.'],
      },
    },
    {
      name: "hand-added beat ('client_added')",
      title: 'Home & Space',
      pillar: 'Home & Space',
      position: 21,
      beatMeta: { slotType: 'proven', rationaleEvidence: { basis: 'client_added' }, clientTouched: true },
    },
  ] as const;

  it.each(CASES)('drop → undo restores $name unchanged', async (c) => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId, c);
    const before = await readRow(id);

    const dropped = await M.dropBeat(clientId, id);
    expect(dropped.ok).toBe(true);
    expect(dropped.dropped).toBeTruthy();
    expect(await sql`SELECT count(*)::int n FROM content_cycle_posts WHERE cycle_id = ${cycleId}`)
      .toEqual([{ n: 0 }]);

    const undone = await M.restoreBeat(clientId, cycleId, dropped.dropped);
    expect(undone.ok).toBe(true);

    // Every stored field matches. The id is new — the row was genuinely deleted — and that
    // is the only permitted difference.
    expect(await readOnly1(cycleId)).toEqual(before);
  }, 60_000);

  it('the snapshot survives a refetch between drop and undo', async () => {
    // The client holds `dropped` in a ref; a refetch replaces the beats list but not the
    // ref. Simulated here by reloading the list before restoring.
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId, CASES[1]);
    const before = await readRow(id);

    const dropped = await M.dropBeat(clientId, id);
    const { loadDraftBeats } = await import('./plan');
    await loadDraftBeats(clientId, cycleId);                   // the refetch

    const undone = await M.restoreBeat(clientId, cycleId, dropped.dropped);
    expect(undone.ok).toBe(true);
    expect(await readOnly1(cycleId)).toEqual(before);
  }, 60_000);

  it('restore still refuses what addBeat refuses — a foreign pillar', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId, CASES[1]);
    const dropped = await M.dropBeat(clientId, id);

    const forged = { ...dropped.dropped, pillar: 'Not A Configured Pillar' };
    const res = await M.restoreBeat(clientId, cycleId, forged);
    expect(res).toMatchObject({ ok: false, error: 'invalid_pillar' });
  }, 60_000);

  it('restore refuses a past date, like every other draft write', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId, CASES[1]);
    const dropped = await M.dropBeat(clientId, id);

    // Deliberately absolute: 2020 is past no matter when this runs — that is the assertion.
    const res = await M.restoreBeat(clientId, cycleId, { ...dropped.dropped, date: '2020-01-01' });
    expect(res).toMatchObject({ ok: false, error: 'read_only_date' });
  }, 60_000);
});
