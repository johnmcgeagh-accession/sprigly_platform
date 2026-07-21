/**
 * draft-activity.integration.test.ts — every draft mutation leaves exactly one trace.
 *
 * A draft drop is a hard delete with no tombstone, and these mutations wrote nothing to the
 * ledger. So when six launch-arc beats disappeared from cycle 040d6a1a before approval, the
 * data could not say what had removed them and the answer had to be inferred
 * (docs/reports/wrong-month-generated.md §6). Observability only — nothing reads these.
 *
 * Requires Postgres; skipped cleanly without TEST_DATABASE_URL.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const TEST_DB = process.env['TEST_DATABASE_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe.skipIf(!TEST_DB)('draft mutations write to the ledger', () => {
  let sql: Any, M: Any;

  beforeAll(async () => {
    ({ sql } = await import('@sprigly/db'));
    M = await import('./draft-mutations');
  });

  const PILLARS = ['Brand Story & Culture', 'Home & Space'];

  async function fixture(): Promise<{ clientId: string; cycleId: string }> {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id: clientId }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES ('Ledger', ${`ledger-${stamp}`}, 'active') RETURNING id`;
    await sql`INSERT INTO client_planning_config (client_id, channel, pillars, categories)
              VALUES (${clientId}, 'instagram', ${sql.json(PILLARS.map((name) => ({ name })))}, ${sql.json(['Brand'])})`;
    const [{ id: cycleId }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status)
      VALUES (${clientId}, 'instagram', '2026-09', 'scheduled') RETURNING id`;
    return { clientId, cycleId };
  }

  const seed = async (clientId: string, cycleId: string): Promise<string> => {
    const [{ id }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, pillar, status, position, beat_meta, source_meta)
      VALUES (${clientId}, ${cycleId}, 'instagram', '2026-10-26', 'single', 'Brand Story & Culture', 'draft', 11,
              ${sql.json({ slotType: 'proven', rationaleEvidence: { basis: 'client_input', reason: 'the wilderness launch' } })},
              ${sql.json({ title: 'wilderness candle launch — Tease' })})
      RETURNING id`;
    return id as string;
  };

  const ledger = async (cycleId: string) =>
    sql`SELECT action, origin, payload FROM plan_activity WHERE cycle_id = ${cycleId} ORDER BY created_at`;

  it('add writes exactly one beat_added', async () => {
    const { clientId, cycleId } = await fixture();
    await M.addBeat(clientId, cycleId, { date: '2026-10-20', format: 'reel', pillar: 'Home & Space' });

    const rows = await ledger(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('beat_added');
    expect(rows[0].origin).toBe('user');
    expect(rows[0].payload).toMatchObject({ title: 'Home & Space', date: '2026-10-20', basis: 'client_added', format: 'reel' });
  }, 60_000);

  it('drop writes exactly one beat_dropped — WITH the provenance that was lost', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId);
    await M.dropBeat(clientId, id);

    const rows = await ledger(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('beat_dropped');
    // The exact question the uat investigation could not answer: what was removed, and
    // where had it come from.
    expect(rows[0].payload).toMatchObject({
      title: 'wilderness candle launch — Tease', date: '2026-10-26', basis: 'client_input',
    });
  }, 60_000);

  it('the dropped row survives its beat — post_id is SET NULL, the record is not', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId);
    await M.dropBeat(clientId, id);

    const rows = await sql`SELECT post_id, action FROM plan_activity WHERE cycle_id = ${cycleId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].post_id).toBeNull();
    expect(await sql`SELECT count(*)::int n FROM content_cycle_posts WHERE cycle_id = ${cycleId}`)
      .toEqual([{ n: 0 }]);
  }, 60_000);

  it('restore writes exactly one beat_restored', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId);
    const dropped = await M.dropBeat(clientId, id);
    await M.restoreBeat(clientId, cycleId, dropped.dropped);

    const rows = await ledger(cycleId);
    expect(rows.map((r: Any) => r.action)).toEqual(['beat_dropped', 'beat_restored']);
    expect(rows[1].payload).toMatchObject({ title: 'wilderness candle launch — Tease', basis: 'client_input' });
  }, 60_000);

  it('move writes exactly one beat_moved, recording where it came from', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId);
    await M.moveBeat(clientId, id, '2026-10-28');

    const rows = await ledger(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('beat_moved');
    expect(rows[0].payload).toMatchObject({ date: '2026-10-28', from: '2026-10-26' });
  }, 60_000);

  it('format change writes exactly one beat_format_changed', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId);
    await M.swapFormat(clientId, id, 'reel');

    const rows = await ledger(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('beat_format_changed');
    expect(rows[0].payload).toMatchObject({ format: 'reel' });
  }, 60_000);

  it('a REFUSED mutation writes nothing — the ledger records what happened, not what was tried', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId);

    await M.moveBeat(clientId, id, '2020-01-01');                 // past date → refused
    await M.swapFormat(clientId, id, 'skywriting');               // bad format → refused
    await M.addBeat(clientId, cycleId, { date: '2026-10-20', format: 'reel', pillar: 'Nope' });

    expect(await ledger(cycleId)).toHaveLength(0);
  }, 60_000);
});
