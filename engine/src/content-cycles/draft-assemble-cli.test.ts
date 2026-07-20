/**
 * draft-assemble-cli.test.ts — the argument guard, the sandbox guard, and the happy path
 * of the on-demand draft-assemble CLI.
 *
 * The CLI is a top-level-await module with side effects on import, so it is exercised by
 * spawning it rather than importing it — importing would run the assembly.
 *
 * The guard cases need a syntactically valid environment (env.ts and @sprigly/db both
 * parse at module load, before any of this file's code runs) but never reach the network.
 * MODEL_PROVIDER/ANTHROPIC_API_KEY are dummies: constructing the client makes no request,
 * and on the happy path phraseDraftTitles fails against the bogus key and falls back to the
 * deterministic assembler titles — which is exactly the reproducible mode we want to assert.
 *
 * The DB-backed cases are skipped cleanly without TEST_DATABASE_URL, so the offline suite
 * stays green. Same harness as the integration tests alongside this file.
 *
 *   ./scripts/test-db.sh up
 *   DATABASE_URL="$(./scripts/test-db.sh url)" TEST_DATABASE_URL="$(./scripts/test-db.sh url)" \
 *     pnpm --filter @sprigly/worker exec vitest run src/content-cycles/draft-assemble-cli.test.ts
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./draft-assemble-cli.ts', import.meta.url));
const TSX    = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
const UNUSED_DB = 'postgresql://unused:unused@127.0.0.1:1/unused';
const TEST_DB   = process.env['TEST_DATABASE_URL'];

/**
 * Everything env.ts + the model factory validate at import. None of it is dialled.
 *
 * TAVILY_API_KEY and APP_BASE_URL are here only because the CLI imports the worker's
 * shared env module (the convention the other cycle CLIs follow), and
 * LOCAL_DEV_ENCRYPTION_KEY only because PlanningDeps carries an encProvider — draft
 * assembly touches none of the three. Real runs get them from .env.local.
 */
function cliEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL:             databaseUrl,
    REDIS_URL:                'redis://127.0.0.1:1',
    GOOGLE_CLIENT_ID:         'unused',
    GOOGLE_CLIENT_SECRET:     'unused',
    TAVILY_API_KEY:           'unused',
    APP_BASE_URL:             'http://localhost:3000',
    AWS_KMS_KEY_ID:           '',                                   // force the local provider
    LOCAL_DEV_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    MODEL_PROVIDER:           'anthropic',
    ANTHROPIC_API_KEY:        'sk-ant-unused',
  };
}

interface Run { code: number | null; stdout: string; stderr: string }

function run(args: string[], databaseUrl: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [SCRIPT, ...args], { env: cliEnv(databaseUrl) });
    let stdout = '', stderr = '', done = false;
    const settle = (code: number | null): void => { if (!done) { done = true; resolve({ code, stdout, stderr }); } };
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', settle);
    setTimeout(() => { child.kill(); settle(null); }, 60_000).unref();
  });
}

/** The model factory writes a resolution banner to stdout; the JSON is everything else. */
function parseResult(stdout: string): Record<string, unknown> {
  const json = stdout.split('\n').filter((l) => !l.startsWith('[model-client]')).join('\n').trim();
  return JSON.parse(json) as Record<string, unknown>;
}

async function fixture(settings: Record<string, boolean>): Promise<{ clientId: string; cycleId: string }> {
  const { sql } = await import('@sprigly/db');
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const clients = await sql<{ id: string }[]>`
    INSERT INTO clients (name, slug, status) VALUES ('Draft Assemble', ${`draft-asm-${stamp}`}, 'active')
    RETURNING id`;
  const clientId = clients[0]!.id;
  await sql`INSERT INTO client_configs (client_id, settings) VALUES (${clientId}, ${sql.json(settings)})`;
  await sql`INSERT INTO client_planning_config (client_id, channel, pillars, categories)
            VALUES (${clientId}, 'instagram',
                    ${sql.json([{ name: 'Everyday Ritual' }, { name: 'Origin Story' }])},
                    ${sql.json(['Styling', 'Brand'])})`;
  const cycles = await sql<{ id: string }[]>`
    INSERT INTO content_cycles (client_id, channel, cycle_month, status)
    VALUES (${clientId}, 'instagram', '2026-07', 'scheduled') RETURNING id`;
  return { clientId, cycleId: cycles[0]!.id };
}

describe('draft-assemble CLI', () => {
  it('exits non-zero and names the required argument when called with none', async () => {
    const r = await run([], UNUSED_DB);

    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('missing required argument <cycleId>');
    expect(r.stderr).toContain('usage:');
    // No default cycle id was invented, so nothing identifies a target.
    expect(r.stdout).toBe('');
  }, 60_000);

  it.skipIf(!TEST_DB)('refuses an unknown cycle id', async () => {
    const r = await run(['00000000-0000-0000-0000-000000000000'], TEST_DB!);

    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no content_cycles row with id');
  }, 60_000);

  it.skipIf(!TEST_DB)('refuses when draft_flow_enabled is off, and writes no draft rows', async () => {
    const { sql } = await import('@sprigly/db');
    const { cycleId } = await fixture({ plan_redesign: true });        // flag absent

    const r = await run([cycleId], TEST_DB!);

    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('does not have draft_flow_enabled');
    const rows = await sql`SELECT count(*)::int AS n FROM content_cycle_posts WHERE cycle_id = ${cycleId}`;
    expect(rows[0]).toEqual({ n: 0 });
  }, 60_000);

  it.skipIf(!TEST_DB)('assembles, persists draft beats, prints the result JSON and exits 0', async () => {
    const { sql } = await import('@sprigly/db');
    const { cycleId } = await fixture({ draft_flow_enabled: true });

    const r = await run([cycleId], TEST_DB!);

    expect(r.code).toBe(0);
    const out = parseResult(r.stdout);
    expect(out).toMatchObject({
      beatsWritten: expect.any(Number),
      phrasing:     expect.stringMatching(/^(phrased|fallback)$/),
      draft:        expect.any(Object),
    });
    expect(out['beatsWritten']).toBeGreaterThan(0);

    // The beats are really on disk, as draft rows for the month AFTER the cycle's own.
    const rows = await sql<{ status: string; scheduled_date: string }[]>`
      SELECT status, scheduled_date FROM content_cycle_posts WHERE cycle_id = ${cycleId}`;
    expect(rows.length).toBe(out['beatsWritten']);
    expect(rows.every((x) => x.status === 'draft')).toBe(true);
    expect(rows.every((x) => x.scheduled_date.startsWith('2026-08'))).toBe(true);
  }, 60_000);

  it.skipIf(!TEST_DB)('--auto-approve stamps the cycle approved_by=auto and transitions the beats', async () => {
    const { sql } = await import('@sprigly/db');
    const { cycleId } = await fixture({ draft_flow_enabled: true });

    const r = await run([cycleId, '--auto-approve'], TEST_DB!);

    expect(r.code).toBe(0);
    const out = parseResult(r.stdout);
    expect(out['approval']).toMatchObject({ ok: true, approved: expect.any(Number) });

    // approved_at is `timestamp without time zone`, which this raw handle returns as a
    // string rather than a Date — assert it was stamped, not what shape it came back as.
    const cycles = await sql<{ approved_by: string | null; approved_at: string | null }[]>`
      SELECT approved_by, approved_at FROM content_cycles WHERE id = ${cycleId}`;
    expect(cycles[0]!.approved_by).toBe('auto');
    expect(cycles[0]!.approved_at).toBeTruthy();

    // Approval is the only writer that moves a draft row off 'draft'.
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM content_cycle_posts WHERE cycle_id = ${cycleId}`;
    expect(rows.every((x) => x.status === 'generating')).toBe(true);
  }, 60_000);
});
