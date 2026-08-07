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
 * ── What changed, and what these now measure ─────────────────────────────────────────
 *
 * The drop is a TOMBSTONE now, not a hard delete: post_edits.post_id has no ON DELETE action,
 * so the delete these tests were written around was refused by the database for any beat that
 * had had a caption generated. Undo clears `deleted_at` on the row the server still holds.
 *
 * So "byte-identical" gets stronger rather than weaker. It used to mean a NEW row that matched
 * the old one on every stored field, id excepted. It now means the SAME row — same id, which
 * is what every receipt, ledger row and post_edits row already names. The assertions below
 * check the id is preserved, where they used to permit it to differ.
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

  /** The full row as stored, which is what "byte-identical" is measured against. `id` is IN
   *  the projection now — a restore that minted a new one would orphan the ledger. */
  const readRow = async (id: string) => {
    const [r] = await sql`
      SELECT id, scheduled_date, format, pillar, position, status, beat_meta, source_meta
      FROM content_cycle_posts WHERE id = ${id}`;
    return r;
  };
  /** The one LIVE row on the cycle — a tombstone is not a beat, so it must not be counted. */
  const readOnly1 = async (cycleId: string) => {
    const [r] = await sql`
      SELECT id, scheduled_date, format, pillar, position, status, beat_meta, source_meta
      FROM content_cycle_posts WHERE cycle_id = ${cycleId} AND deleted_at IS NULL`;
    return r;
  };
  const liveCount = async (cycleId: string) => {
    const [r] = await sql`
      SELECT count(*)::int n FROM content_cycle_posts
      WHERE cycle_id = ${cycleId} AND deleted_at IS NULL`;
    return r.n as number;
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
    expect(dropped.dropped).toEqual({ id });          // the undo token is the beat's own id
    expect(await liveCount(cycleId)).toBe(0);          // gone from every draft read
    // ...but the row survives, because post_edits may name it.
    expect(await sql`SELECT count(*)::int n FROM content_cycle_posts WHERE cycle_id = ${cycleId}`)
      .toEqual([{ n: 1 }]);

    const undone = await M.restoreBeat(clientId, cycleId, dropped.dropped);
    expect(undone.ok).toBe(true);

    // Every stored field matches, INCLUDING the id — it is the same row, not an equal one.
    expect(await readOnly1(cycleId)).toEqual(before);
  }, 60_000);

  it('the undo token survives a refetch between drop and undo', async () => {
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

  it('a beat that has had a caption GENERATED can still be dropped and undone', async () => {
    // The case the old hard delete could not survive, and the reason the client could not
    // remove a beat they did not want. A post_edits row is what caption generation leaves.
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId, CASES[1]);
    await sql`INSERT INTO post_edits (post_id, cycle_id, scope, instruction, caption_before, caption_after, passed, actor)
              VALUES (${id}, ${cycleId}, 'post', 'Write the caption for this post.', '', 'a generated caption', true, 'agent')`;
    const before = await readRow(id);

    const dropped = await M.dropBeat(clientId, id);
    expect(dropped.ok).toBe(true);
    expect(await liveCount(cycleId)).toBe(0);

    // The ledger row still names it — the billing count and the regen's protection both hold.
    expect(await sql`SELECT count(*)::int n FROM post_edits WHERE post_id = ${id}`).toEqual([{ n: 1 }]);

    expect((await M.restoreBeat(clientId, cycleId, dropped.dropped)).ok).toBe(true);
    expect(await readOnly1(cycleId)).toEqual(before);
  }, 60_000);

  it('restore refuses a beat whose date has passed while it sat dropped', async () => {
    const { clientId, cycleId } = await fixture();
    const id = await seed(clientId, cycleId, CASES[1]);
    const dropped = await M.dropBeat(clientId, id);

    // `today` is the gate's own parameter. Deliberately absolute: a date years after the
    // beat's is past no matter when this runs — that is the assertion.
    const res = await M.restoreBeat(clientId, cycleId, dropped.dropped, '2099-01-01');
    expect(res).toMatchObject({ ok: false, error: 'read_only_date' });
  }, 60_000);

  it('restore refuses an id that is not a tombstone on this cycle', async () => {
    // The trust boundary the old snapshot needed guards for is simply gone: nothing about the
    // beat crosses to the client, so the only thing to forge is the id, and that is scoped.
    const { clientId, cycleId } = await fixture();
    const live = await seed(clientId, cycleId, CASES[1]);

    // a LIVE beat is not restorable — that would be a no-op reporting success
    expect(await M.restoreBeat(clientId, cycleId, { id: live }))
      .toMatchObject({ ok: false, error: 'not_found' });

    // another client's tombstone is not reachable
    const other = await fixture();
    const foreign = await seed(other.clientId, other.cycleId, CASES[1]);
    await M.dropBeat(other.clientId, foreign);
    expect(await M.restoreBeat(clientId, cycleId, { id: foreign }))
      .toMatchObject({ ok: false, error: 'not_found' });
  }, 60_000);
});
