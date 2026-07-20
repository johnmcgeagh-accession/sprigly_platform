/**
 * reset-cycle.test.ts — the argument guard on the one-off reset-cycle CLI.
 *
 * reset-cycle used to default its clientId to a hardcoded production client id, so
 * `pnpm reset-cycle` with no arguments silently rewrote a real client's cycle status.
 * These tests pin the two halves of the fix: refusing without an explicit client, and
 * still doing exactly what it did before when given one.
 *
 * The CLI is a top-level-await module with side effects on import, so it is exercised by
 * spawning it rather than importing it — importing would run the update.
 *
 * The no-argument case needs a syntactically valid DATABASE_URL (the @sprigly/db import
 * zod-parses it at module load, before any of this file's code runs) but never connects:
 * postgres.js is lazy, and the guard exits before the first query.
 *
 * The "proceeds" case needs a real Postgres and is skipped cleanly without
 * TEST_DATABASE_URL, so the offline suite stays green.
 *
 *   ./scripts/test-db.sh up
 *   DATABASE_URL="$(./scripts/test-db.sh url)" TEST_DATABASE_URL="$(./scripts/test-db.sh url)" \
 *     pnpm --filter @sprigly/worker exec vitest run src/reset-cycle.test.ts
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT   = fileURLToPath(new URL('./reset-cycle.ts', import.meta.url));
const TSX      = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
// Never dialled — the guard exits first. Valid enough to satisfy the zod parse on import.
const UNUSED_DB = 'postgresql://unused:unused@127.0.0.1:1/unused';
const TEST_DB   = process.env['TEST_DATABASE_URL'];

interface Run { code: number | null; exited: boolean; stdout: string; stderr: string }

/**
 * Spawn the CLI and collect its output.
 *
 * `settleOnStdout` exists because the CLI never closes its postgres pool, so on the
 * SUCCESS path the process prints its JSON and then hangs forever. That is pre-existing
 * behaviour and out of scope for this fix, so the test resolves once the line has been
 * printed and kills the child, rather than waiting for an exit that never comes.
 * The guard path does exit, so those assertions use the real code.
 */
function run(args: string[], databaseUrl: string, settleOnStdout = false): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [SCRIPT, ...args], { env: { ...process.env, DATABASE_URL: databaseUrl } });
    let stdout = '', stderr = '', done = false;
    const settle = (code: number | null, exited: boolean): void => {
      if (done) return;
      done = true;
      resolve({ code, exited, stdout, stderr });
    };
    child.stdout.on('data', (d) => {
      stdout += String(d);
      if (settleOnStdout && stdout.includes('\n')) { child.kill(); settle(null, false); }
    });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => settle(code, true));
    setTimeout(() => { child.kill(); settle(null, false); }, 25_000).unref();
  });
}

describe('reset-cycle argument guard', () => {
  it('exits non-zero and names the required argument when called with none', async () => {
    const r = await run([], UNUSED_DB);

    expect(r.exited).toBe(true);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('missing required argument <clientId>');
    expect(r.stderr).toContain('usage:');
    // The whole point: no client id was invented, so nothing identifies a target.
    expect(r.stdout).toBe('');
  }, 30_000);

  it('carries no hardcoded client id or ivy literal in its output', async () => {
    const r = await run([], UNUSED_DB);
    expect(`${r.stdout}${r.stderr}`.toLowerCase()).not.toContain('ivy');
    expect(`${r.stdout}${r.stderr}`).not.toContain('c79cf1c5-b51d-4a9b-aedc-48577df43e8f');
  }, 30_000);

  it.skipIf(!TEST_DB)('with an explicit clientId it proceeds past the guard', async () => {
    // A client id that matches nothing: the UPDATE runs, touches zero rows, and reports
    // the same JSON array of {id, status} it always did.
    const r = await run(['00000000-0000-0000-0000-000000000000', '2026-05'], TEST_DB!, true);

    expect(r.stderr).not.toContain('missing required argument');
    expect(JSON.parse(r.stdout.trim())).toEqual([]);
  }, 30_000);

  it.skipIf(!TEST_DB)('with an explicit clientId it still resets a matching cycle', async () => {
    const { sql } = await import('@sprigly/db');
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO clients (name, slug, status) VALUES ('Reset Arg', ${`reset-arg-${Date.now()}`}, 'active')
      RETURNING id`;
    const clientId = inserted[0]!.id;
    await sql`INSERT INTO content_cycles (client_id, channel, cycle_month, status, request_sent_at)
              VALUES (${clientId}, 'instagram', '2026-05', 'workbook_built', now())`;

    const r = await run([clientId, '2026-05'], TEST_DB!, true);
    expect(JSON.parse(r.stdout.trim())).toEqual([{ id: expect.any(String), status: 'scheduled' }]);

    const [row] = await sql`SELECT status, request_sent_at FROM content_cycles WHERE client_id = ${clientId}`;
    expect(row).toEqual({ status: 'scheduled', request_sent_at: null });
  }, 30_000);
});
