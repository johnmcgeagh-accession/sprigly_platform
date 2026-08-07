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


describe.skipIf(!TEST_DB)('draft mutations write to the ledger', () => {
  let sql: Any, M: Any;
  let beatDate: string, addDate: string, moveDate: string, cycleMonth: string;

  beforeAll(async () => {
    ({ sql } = await import('@sprigly/db'));
    M = await import('./draft-mutations');
    const { editScopeToday } = await import('./edit-scope');
    const base = nextMonthStart(editScopeToday());
    beatDate   = base;                 // the seeded beat's slot
    addDate    = plusDays(base, 3);    // where a hand-added beat lands
    moveDate   = plusDays(base, 5);    // where a move sends it
    cycleMonth = editScopeToday().slice(0, 7);
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
      VALUES (${clientId}, 'instagram', ${cycleMonth}, 'scheduled') RETURNING id`;
    return { clientId, cycleId };
  }

  const seed = async (clientId: string, cycleId: string): Promise<string> => {
    const [{ id }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, pillar, status, position, beat_meta, source_meta)
      VALUES (${clientId}, ${cycleId}, 'instagram', ${beatDate}, 'single', 'Brand Story & Culture', 'draft', 11,
              ${sql.json({ slotType: 'proven', rationaleEvidence: { basis: 'client_input', reason: 'the wilderness launch' } })},
              ${sql.json({ title: 'wilderness candle launch — Tease' })})
      RETURNING id`;
    return id as string;
  };

  const ledger = async (cycleId: string) =>
    sql`SELECT action, origin, payload FROM plan_activity WHERE cycle_id = ${cycleId} ORDER BY created_at`;

  it('add writes exactly one beat_added', async () => {
    const { clientId, cycleId } = await fixture();
    await M.addBeat(clientId, cycleId, { date: addDate, format: 'reel', pillar: 'Home & Space' });

    const rows = await ledger(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('beat_added');
    expect(rows[0].origin).toBe('user');
    expect(rows[0].payload).toMatchObject({ title: 'Home & Space', date: addDate, basis: 'client_added', format: 'reel' });
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
      title: 'wilderness candle launch — Tease', date: beatDate, basis: 'client_input',
    });
  }, 60_000);

  it('the dropped row NAMES its beat — the drop is a tombstone, so the subject survives', async () => {
    // This asserted `post_id IS NULL`, which was the honest reading when dropBeat hard-deleted:
    // the row was gone, so the ledger could only record that something had been. The drop is a
    // tombstone now, so the ledger names the beat it describes and the audit gets stronger —
    // "this beat was dropped" rather than "something was dropped, we no longer know what".
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId);
    await M.dropBeat(clientId, id);

    const rows = await sql`SELECT post_id, action FROM plan_activity WHERE cycle_id = ${cycleId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].post_id).toBe(id);
    // Gone from every draft read...
    expect(await sql`SELECT count(*)::int n FROM content_cycle_posts
                     WHERE cycle_id = ${cycleId} AND deleted_at IS NULL`).toEqual([{ n: 0 }]);
    // ...but still on the table, because post_edits may reference it.
    expect(await sql`SELECT count(*)::int n FROM content_cycle_posts WHERE cycle_id = ${cycleId}`)
      .toEqual([{ n: 1 }]);
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
    await M.moveBeat(clientId, id, moveDate);

    const rows = await ledger(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('beat_moved');
    expect(rows[0].payload).toMatchObject({ date: moveDate, from: beatDate });
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

    await M.moveBeat(clientId, id, '2020-01-01');                 // deliberately absolute: past whenever this runs
    await M.swapFormat(clientId, id, 'skywriting');               // bad format → refused
    await M.addBeat(clientId, cycleId, { date: addDate, format: 'reel', pillar: 'Nope' });

    expect(await ledger(cycleId)).toHaveLength(0);
  }, 60_000);
});
