/**
 * cli-cycle-arg.test.ts — every one-off cycle CLI must be told which cycle to act on.
 *
 * These three all defaulted to the same real production cycle id, so a bare invocation
 * silently read someone else's month (and brief-prompt-preview spent a Bedrock call doing
 * it). Parameterised rather than three near-identical files: the guard is one rule, and a
 * new CLI should be able to join the table.
 *
 * Spawned rather than imported — each is a top-level-await module that queries on import,
 * so importing would run the tool. The env below is a superset of what they parse at load;
 * none of it is dialled, because the guard exits before the first query.
 *
 *   pnpm --filter @sprigly/worker exec vitest run src/content-cycles/cli-cycle-arg.test.ts
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
const UNUSED_DB = 'postgresql://unused:unused@127.0.0.1:1/unused';

/** The cycle id that used to sit in all three as a fallback. Must appear in no output. */
const FORMER_FALLBACK = 'd502f22d-983b-442c-880a-db4f86861ecb';

const CLIS = [
  { name: 'plan-merge-dryrun',    file: 'plan-merge-dryrun.ts' },
  { name: 'brief-prompt-preview', file: 'brief-prompt-preview.ts' },
  { name: 'brief-persist-check',  file: 'brief-persist-check.ts' },
] as const;

interface Run { code: number | null; stdout: string; stderr: string }

function run(file: string, args: string[] = []): Promise<Run> {
  const script = fileURLToPath(new URL(`./${file}`, import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(TSX, [script, ...args], {
      env: {
        ...process.env,
        DATABASE_URL:      UNUSED_DB,
        REDIS_URL:         'redis://127.0.0.1:1',
        MODEL_PROVIDER:    'anthropic',
        ANTHROPIC_API_KEY: 'sk-ant-unused',
      },
    });
    let stdout = '', stderr = '', done = false;
    const settle = (code: number | null): void => { if (!done) { done = true; resolve({ code, stdout, stderr }); } };
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', settle);
    setTimeout(() => { child.kill(); settle(null); }, 60_000).unref();
  });
}

describe('one-off cycle CLIs require an explicit cycle id', () => {
  it.each(CLIS)('$name exits non-zero and names the argument when called with none', async ({ name, file }) => {
    const r = await run(file);

    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('missing required argument <cycleId>');
    expect(r.stderr).toContain(name);
    expect(r.stderr).toContain('usage:');
  }, 60_000);

  it.each(CLIS)('$name names no production cycle id when refusing', async ({ file }) => {
    const r = await run(file);
    expect(`${r.stdout}${r.stderr}`).not.toContain(FORMER_FALLBACK);
  }, 60_000);
});
