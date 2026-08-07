/**
 * draft-mutation-fk.integration.test.ts — a ledger row must never block the beat it describes.
 *
 * THE BUG. 0068 gave plan_activity two guarantees that cannot both hold:
 *
 *     post_id uuid REFERENCES content_cycle_posts(id) ON DELETE SET NULL     (line 16)
 *     CREATE TRIGGER plan_activity_no_mutate BEFORE UPDATE OR DELETE ...     (line 37)
 *
 * ON DELETE SET NULL is implemented AS an UPDATE. The trigger blocks every UPDATE. So
 * deleting a post any ledger row points at aborts the whole transaction with
 *
 *     ERROR: plan_activity is append-only (UPDATE is blocked)
 *
 * On uat that surfaced as a 500 from POST /api/plan/draft — but only for beats the operator
 * had previously MOVED, because a move is what writes a ledger row carrying post_id. Beats
 * never moved dropped cleanly, which made it look intermittent and beat-specific.
 *
 * Fixed by 0090 (the FK goes, the trigger stays). These tests cover every mutation op against
 * every beat provenance that exists on ivy-t's real cycle, each one ARMED with a ledger row
 * first — because unarmed beats were never the failing case and a test that skips the arming
 * step passes on the broken schema.
 *
 * beat_meta fixtures are the REAL stored shapes from uat cycle 1b925191, read read-only.
 *
 * Requires Postgres; skipped cleanly without TEST_DATABASE_URL.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const TEST_DB = process.env['TEST_DATABASE_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function nextMonthStart(todayIso: string): string {
  const [y, m] = todayIso.split('-').map(Number);
  return m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`;
}
const plusDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── The four provenances, verbatim from uat ──────────────────────────────────

/** The assembler's own beats (9 of 20 on the cycle). */
const ASSEMBLER = {
  slotType: 'proven',
  assumptions: [
    'No launches or restocks are on record for this month — the draft assumes a business-as-usual month.',
    'Format mix is based on 19 of 50 posts — the rest predate format tracking.',
    'No pillar weights are on record, so the month splits evenly across pillars.',
  ],
  rationaleEvidence: {
    basis: 'observed',
    pillarShare: 0.14285714285714285,
    cadenceBasis: { months: 3, source: 'observed', postsPerWeek: 5.57 },
    formatEngagement: { posts: 9, format: 'reel', avgEngagement: 27.2 },
  },
};

/** PRE-fix transform output: no assumptions key at all (8 of 20). */
const OLD_TRANSFORM = {
  slotType: 'proven',
  rationaleEvidence: { basis: 'client_input', reason: 'A throwback post using the video of Sally fitting the pre-production long sleeve Ivy tee' },
};

/** Pre-fix transform output the client then touched — the three that actually 500'd. */
const TOUCHED_TRANSFORM = {
  slotType: 'proven',
  clientTouched: true,
  rationaleEvidence: { basis: 'client_input', reason: "New mini-series starting early August, one post every 3 weeks, hook 'What I am most proud of…'" },
};

/** What addBeat stamps. */
const HAND_ADDED = { slotType: 'proven', rationaleEvidence: { basis: 'client_added' }, clientTouched: true };

const PROVENANCES: Array<[string, Record<string, unknown>]> = [
  ['assembler (observed)', ASSEMBLER],
  ['old-transform (pre-fix, no assumptions)', OLD_TRANSFORM],
  ['transform + clientTouched', TOUCHED_TRANSFORM],
  ['hand-added', HAND_ADDED],
];

describe.skipIf(!TEST_DB)('a ledger row never blocks the beat it describes', () => {
  let sql: Any, M: Any;
  let beatDate: string, moveDate: string, cycleMonth: string;

  beforeAll(async () => {
    ({ sql } = await import('@sprigly/db'));
    M = await import('./draft-mutations');
    const { editScopeToday } = await import('./edit-scope');
    const base = nextMonthStart(editScopeToday());
    beatDate = base;
    moveDate = plusDays(base, 5);
    cycleMonth = editScopeToday().slice(0, 7);
  });

  const PILLARS = ['Understands Real Women', 'Born From Real Need'];

  async function fixture(): Promise<{ clientId: string; cycleId: string }> {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id: clientId }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES ('FkRepro', ${`fk-${stamp}`}, 'active') RETURNING id`;
    await sql`INSERT INTO client_planning_config (client_id, channel, pillars, categories)
              VALUES (${clientId}, 'instagram', ${sql.json(PILLARS.map((name) => ({ name })))}, ${sql.json(['Brand'])})`;
    const [{ id: cycleId }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status)
      VALUES (${clientId}, 'instagram', ${cycleMonth}, 'scheduled') RETURNING id`;
    return { clientId, cycleId };
  }

  const seed = async (clientId: string, cycleId: string, meta: Record<string, unknown>): Promise<string> => {
    const [{ id }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, pillar, status, position, beat_meta, source_meta)
      VALUES (${clientId}, ${cycleId}, 'instagram', ${beatDate}, 'carousel', 'Understands Real Women', 'draft', 35,
              ${sql.json(meta)}, ${sql.json({ title: 'a beat' })})
      RETURNING id`;
    return id as string;
  };

  /** Write the ledger row a MOVE writes — the thing that armed the FK. */
  const arm = async (clientId: string, cycleId: string, postId: string) =>
    sql`INSERT INTO plan_activity (client_id, cycle_id, post_id, origin, action, payload)
        VALUES (${clientId}, ${cycleId}, ${postId}, 'user', 'beat_moved', ${sql.json({ from: beatDate })})`;

  // ── drop, against every provenance, ARMED ──────────────────────────────────

  describe('DROP an armed beat', () => {
    it.each(PROVENANCES)('%s', async (_label, meta) => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, meta);
      await arm(clientId, cycleId, id);

      const res = await M.dropBeat(clientId, id);
      expect(res.ok).toBe(true);
      // The drop is a tombstone now (post_edits.post_id has no ON DELETE action), so what
      // "dropped" means is: gone from every draft read, not gone from the table.
      const live = await sql`SELECT id FROM content_cycle_posts WHERE id = ${id} AND deleted_at IS NULL`;
      expect(live).toHaveLength(0);
    }, 60_000);

    it('the ledger row SURVIVES and still names the post', async () => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, TOUCHED_TRANSFORM);
      await arm(clientId, cycleId, id);
      await M.dropBeat(clientId, id);

      // TWO rows name it now, not one. The arming move is the first; the second is the drop
      // itself, which used to be written with post_id NULL because the row it described was
      // about to stop existing. A tombstoned beat is still there to point at.
      const rows = await sql`SELECT post_id, action FROM plan_activity WHERE post_id = ${id} ORDER BY created_at`;
      expect(rows.map((r: Any) => r.action)).toEqual(['beat_moved', 'beat_dropped']);
      expect(rows.every((r: Any) => r.post_id === id)).toBe(true);
    }, 60_000);

    it('a beat armed by MANY ledger rows still drops', async () => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, OLD_TRANSFORM);
      for (let i = 0; i < 5; i++) await arm(clientId, cycleId, id);

      expect((await M.dropBeat(clientId, id)).ok).toBe(true);
    }, 60_000);
  });

  // ── every other op, against every provenance, ARMED ────────────────────────

  describe('MOVE an armed beat', () => {
    it.each(PROVENANCES)('%s', async (_label, meta) => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, meta);
      await arm(clientId, cycleId, id);

      const res = await M.moveBeat(clientId, id, moveDate);
      expect(res.ok).toBe(true);
      const [row] = await sql`SELECT scheduled_date FROM content_cycle_posts WHERE id = ${id}`;
      expect(String(row.scheduled_date).slice(0, 10)).toBe(moveDate);
    }, 60_000);
  });

  describe('SWAP FORMAT on an armed beat', () => {
    it.each(PROVENANCES)('%s', async (_label, meta) => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, meta);
      await arm(clientId, cycleId, id);

      expect((await M.swapFormat(clientId, id, 'reel')).ok).toBe(true);
      const [row] = await sql`SELECT format FROM content_cycle_posts WHERE id = ${id}`;
      expect(row.format).toBe('reel');
    }, 60_000);
  });

  describe('ADD alongside armed beats', () => {
    it.each(PROVENANCES)('with a %s beat already armed on the cycle', async (_label, meta) => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, meta);
      await arm(clientId, cycleId, id);

      const res = await M.addBeat(clientId, cycleId, { date: moveDate, format: 'reel', pillar: 'Born From Real Need' });
      expect(res.ok).toBe(true);
    }, 60_000);
  });

  describe('UNDO (drop → restore) an armed beat', () => {
    it.each(PROVENANCES)('%s round-trips', async (_label, meta) => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, meta);
      await arm(clientId, cycleId, id);

      const dropped = await M.dropBeat(clientId, id);
      expect(dropped.ok).toBe(true);
      expect(dropped.dropped).toBeTruthy();

      const restored = await M.restoreBeat(clientId, cycleId, dropped.dropped);
      expect(restored.ok).toBe(true);

      // The evidence came back intact — restore is a restore, not a re-add.
      const [row] = await sql`SELECT beat_meta, source_meta FROM content_cycle_posts
                              WHERE cycle_id = ${cycleId} AND status = 'draft' AND deleted_at IS NULL`;
      expect(row.beat_meta).toEqual(meta);
      expect(row.source_meta).toEqual({ title: 'a beat' });
    }, 60_000);
  });

  // ── revert-proof ───────────────────────────────────────────────────────────

  describe('REVERT-PROOF: the FK is what broke it', () => {
    // NOTE ON THE VEHICLE. This used to drive the conflict through dropBeat, because dropBeat
    // hard-deleted. It tombstones now (post_edits.post_id has no ON DELETE action either), so
    // no app path reaches the SET NULL any more and dropBeat can no longer demonstrate this.
    //
    // The conflict is still worth pinning, because 0090 is a manual migration that a restored
    // snapshot or an un-migrated environment can silently lack — prod carried it for weeks
    // after UAT was fixed. So this drives it with the raw DELETE the constraint acts on, which
    // is what re-assembly's purge still issues for an unreferenced beat.
    it('re-adding plan_activity_post_id_fkey makes a raw post DELETE fail again', async () => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, TOUCHED_TRANSFORM);
      await arm(clientId, cycleId, id);

      // Put 0068's constraint back — the pre-0090 schema, exactly.
      //
      // NOT VALID, because earlier tests in this file have already dropped beats and left
      // ledger rows pointing at them; a validating ADD would fail the initial scan on those
      // orphans. NOT VALID skips only that scan — the referential ACTION (the SET NULL this
      // test is about) is fully live for anything touched afterwards. That orphans block a
      // re-add at all is itself worth knowing, and the down-migration says so.
      await sql.unsafe(`ALTER TABLE plan_activity
        ADD CONSTRAINT plan_activity_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES content_cycle_posts(id) ON DELETE SET NULL NOT VALID`);
      try {
        await expect(sql`DELETE FROM content_cycle_posts WHERE id = ${id}`).rejects.toThrow(/append-only/);
        // and the beat is still there — the transaction aborted, nothing was removed
        expect(await sql`SELECT id FROM content_cycle_posts WHERE id = ${id}`).toHaveLength(1);
      } finally {
        await sql.unsafe('ALTER TABLE plan_activity DROP CONSTRAINT IF EXISTS plan_activity_post_id_fkey');
      }

      // 0090's state again: the identical delete now succeeds.
      await sql`DELETE FROM content_cycle_posts WHERE id = ${id}`;
      expect(await sql`SELECT id FROM content_cycle_posts WHERE id = ${id}`).toHaveLength(0);
    }, 60_000);

    it('and dropBeat no longer reaches that constraint at all', async () => {
      // The app path is out of the blast radius entirely now: a tombstone is an UPDATE of
      // content_cycle_posts, which no referential action on plan_activity or post_edits fires on.
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, TOUCHED_TRANSFORM);
      await arm(clientId, cycleId, id);

      await sql.unsafe(`ALTER TABLE plan_activity
        ADD CONSTRAINT plan_activity_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES content_cycle_posts(id) ON DELETE SET NULL NOT VALID`);
      try {
        expect((await M.dropBeat(clientId, id)).ok).toBe(true);
      } finally {
        await sql.unsafe('ALTER TABLE plan_activity DROP CONSTRAINT IF EXISTS plan_activity_post_id_fkey');
      }
    }, 60_000);

    it('append-only is STILL enforced — 0090 removed the FK, not the guarantee', async () => {
      const { clientId, cycleId } = await fixture();
      const id = await seed(clientId, cycleId, OLD_TRANSFORM);
      await arm(clientId, cycleId, id);

      await expect(sql`UPDATE plan_activity SET action = 'tampered' WHERE post_id = ${id}`)
        .rejects.toThrow(/append-only/);
      await expect(sql`DELETE FROM plan_activity WHERE post_id = ${id}`)
        .rejects.toThrow(/append-only/);
    }, 60_000);
  });
});
