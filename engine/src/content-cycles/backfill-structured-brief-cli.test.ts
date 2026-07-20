/**
 * backfill-structured-brief-cli.test.ts — the argument guard on the structured-brief
 * backfill CLI.
 *
 * It used to default its cycle id to a real production cycle, so a bare `--write` would
 * have persisted a structured_brief onto someone else's month. This pins the refusal.
 *
 * Spawned rather than imported: the CLI is a top-level-await module that reads the DB and
 * calls Bedrock on import, so importing it would run the backfill.
 *
 *   pnpm --filter @sprigly/worker exec vitest run src/content-cycles/backfill-structured-brief-cli.test.ts
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./backfill-structured-brief-cli.ts', import.meta.url));
const TSX    = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
// Never dialled: the guard exits before the first query, and postgres.js is lazy.
const UNUSED_DB = 'postgresql://unused:unused@127.0.0.1:1/unused';

interface Run { code: number | null; stdout: string; stderr: string }

function run(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [SCRIPT, ...args], {
      env: { ...process.env, DATABASE_URL: UNUSED_DB, MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-unused' },
    });
    let stdout = '', stderr = '', done = false;
    const settle = (code: number | null): void => { if (!done) { done = true; resolve({ code, stdout, stderr }); } };
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', settle);
    setTimeout(() => { child.kill(); settle(null); }, 60_000).unref();
  });
}

describe('backfill-structured-brief argument guard', () => {
  it('exits non-zero and names the required argument when called with none', async () => {
    const r = await run([]);

    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('missing required argument <cycleId>');
    expect(r.stderr).toContain('usage:');
    expect(r.stdout).toBe('');
  }, 60_000);

  it('refuses with --write but no cycle id, and names no production cycle', async () => {
    const r = await run(['--write']);

    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('missing required argument <cycleId>');
    // The fallback that used to sit here was a real cycle. Nothing may name one now.
    expect(`${r.stdout}${r.stderr}`).not.toContain('d502f22d-983b-442c-880a-db4f86861ecb');
  }, 60_000);
});
