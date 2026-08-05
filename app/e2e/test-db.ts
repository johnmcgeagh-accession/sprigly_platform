import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * test-db.ts — the container's connection string, read from the one file that defines it.
 *
 * Both playwright configs used to carry `CONTAINER_DB` as a literal and `helpers.ts`
 * carried none at all, which is the asymmetry that let UAT get truncated: the APP under
 * test was pinned to the container by `webServer.env`, while the SEEDER inherited the
 * ambient environment. The suite therefore stayed green against the container while the
 * `beforeEach` reseed destroyed a different database entirely.
 *
 * So the value comes from `scripts/test-db.identity` — the same file `scripts/test-db.sh`
 * sources to create the container and `packages/db/src/assert-local-db.ts` reads to decide
 * what it will refuse. The tiny parser below is repeated there; the VALUE is not, and the
 * value is the part that gets a database dropped when it drifts.
 */
export const REPO_ROOT = join(__dirname, '..', '..');

function readTestDbEnv(): Record<string, string> {
  const text = readFileSync(join(REPO_ROOT, 'scripts', 'test-db.identity'), 'utf8');
  const vars: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return vars;
}

const v = readTestDbEnv();

/** The disposable local e2e container. The only database the seed will accept. */
export const CONTAINER_DB =
  `postgresql://${v['TESTDB_USER']}:${v['TESTDB_PASS']}@${v['TESTDB_HOST']}:${v['TESTDB_PORT']}/${v['TESTDB_NAME']}`;
