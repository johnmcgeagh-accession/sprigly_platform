/**
 * assert-local-db.ts — refuse to run a whole-database destructive operation against
 * anything that is not the disposable local e2e container.
 *
 * ── Why this exists, and why it lives HERE ───────────────────────────────────────────
 *
 * `seed-e2e.ts` opens with `TRUNCATE TABLE clients CASCADE` — every tenant, no scoping.
 * It was safe only by convention: whoever ran it was expected to have DATABASE_URL
 * already pointed at the container. `app/e2e/helpers.ts` called it with the ambient
 * environment inherited, so under `scripts/e2e.sh` that convention held and from any
 * shell with `.env.local` sourced it did not — and UAT was truncated by a `beforeEach`.
 *
 * The lesson is not "set the variable in helpers.ts". It is that the guard has to travel
 * with the destructive statement, because the statement is what gets called from places
 * nobody enumerated. A variable set at one call site protects that call site. A refusal
 * compiled into the seed protects every call site, including the ones added next year.
 *
 * ── Why the whole identity, not just the host ────────────────────────────────────────
 *
 * A host allowlist (localhost/127.0.0.1) is not enough. UAT is reached through a Railway
 * TCP proxy, and forwarding a remote database onto a local port is an ordinary thing to
 * do — a proxied UAT connection is `127.0.0.1` and would sail through a host check. So
 * host, port AND database name must all match the one container `test-db.sh` creates.
 *
 * The expected values are read from `scripts/test-db.identity`, the same file `test-db.sh`
 * sources to build the container and the URL. There is deliberately no second copy: a
 * guard holding its own literal drifts away from the thing it guards, and then it is
 * only decoration.
 *
 * There is no override flag. An escape hatch on a guard like this is the accident,
 * rescheduled.
 *
 * ── IMPORTING THIS MODULE RUNS THE CHECK ─────────────────────────────────────────────
 *
 * Deliberately, and it is the whole reason the check is not just a call in the caller's
 * body: ESM evaluates every import before the importing module's first statement, so a
 * body-level call happens AFTER `client.ts` has already parsed the environment and built
 * a pool. Running at evaluation time, from an import placed above `./client.js`, puts the
 * refusal genuinely first. Import order in the destructive file is load-bearing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// src/ when run through tsx, dist/ when built — both are two levels below packages/.
const ENV_FILE = join(HERE, '..', '..', '..', 'scripts', 'test-db.identity');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

interface Identity { host: string; port: string; name: string }

/** Plain KEY=value, matching what bash `.`-sources. No quoting, no expansion. */
function readExpected(): Identity {
  const text = readFileSync(ENV_FILE, 'utf8');
  const vars = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) vars.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  const host = vars.get('TESTDB_HOST'), port = vars.get('TESTDB_PORT'), name = vars.get('TESTDB_NAME');
  if (!host || !port || !name) {
    throw new Error(`assert-local-db: ${ENV_FILE} is missing TESTDB_HOST/TESTDB_PORT/TESTDB_NAME`);
  }
  return { host, port, name };
}

function parseUrl(url: string): Identity | null {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port, name: decodeURIComponent(u.pathname).replace(/^\//, '') };
  } catch {
    return null;
  }
}

/** Loopback aliases are interchangeable — but only as hosts. Port and name still decide. */
function hostMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  return LOOPBACK.has(actual) && LOOPBACK.has(expected);
}

function refuse(reason: string, detail: string, expected: Identity): never {
  // stderr, because the only thing the caller sees of a failed execSync is what we print.
  console.error(`\nREFUSED: ${reason}`);
  console.error(`  ${detail}`);
  console.error(`  expected: ${expected.host}:${expected.port}/${expected.name} (the disposable e2e container)`);
  console.error('\nThis operation TRUNCATEs every tenant. It is allowed only against the local');
  console.error('test container. Nothing was written.');
  console.error('\nStart it and point at it with:  bash scripts/e2e.sh seed');
  process.exit(1);
}

/**
 * Exit non-zero unless DATABASE_URL names exactly the local test container.
 * Call at module scope, before the first query and before anything is truncated.
 */
export function assertLocalDatabase(): void {
  const expected = readExpected();
  const url = process.env['DATABASE_URL'];

  if (!url) refuse('DATABASE_URL is not set.', 'nothing to check against', expected);

  const actual = parseUrl(url);
  if (!actual) refuse('DATABASE_URL is not a parseable URL.', 'could not read a host from it', expected);

  const where = `${actual.host}:${actual.port || '(no port)'}/${actual.name || '(no database)'}`;

  if (!hostMatches(actual.host, expected.host)) {
    refuse('DATABASE_URL points at a remote database.', `got: ${where}`, expected);
  }
  if (actual.port !== expected.port) {
    // The case the host check alone misses: a proxy or tunnel forwarding a remote
    // database onto loopback looks local and is not.
    refuse('DATABASE_URL is on loopback but not the container port.', `got: ${where} — a forwarded port is not the container`, expected);
  }
  if (actual.name !== expected.name) {
    refuse('DATABASE_URL names a different database.', `got: ${where}`, expected);
  }
}

assertLocalDatabase();
