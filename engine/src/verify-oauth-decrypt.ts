#!/usr/bin/env tsx
/**
 * verify-oauth-decrypt.ts — prove a stored OAuth credential can be decrypted,
 * without sending anything.
 *
 * WHY THIS EXISTS
 *   On UAT the app could not kms:Decrypt the data key wrapping the Gmail
 *   credentials. plan-ready failed six times in an hour, wrote no row anywhere,
 *   and logged a single line under a prefix you had to know to grep. The only
 *   way to exercise the credential was send-request-email, which seeds a cycle
 *   and fires the Ask — a product action, not a test.
 *
 *   This does the decrypt and nothing else, so the same question can be asked
 *   of production before go-live.
 *
 * WHAT IT PROVES
 *   Reads the oauth_connections row for <client-slug>/<provider> and decrypts it
 *   through getTokens() + createEncryptionProvider() — the same functions the
 *   send path calls (see packages/destinations/src/notification/
 *   gmail-send-notification.ts:45). Nothing here reimplements the decrypt.
 *
 * READ-ONLY, BY ENFORCEMENT NOT BY PROMISE
 *   - default_transaction_read_only=on is set as a startup parameter on the
 *     connection, and the script verifies server-side that it took effect before
 *     doing any work. A write would be refused by Postgres, not merely absent
 *     from this file.
 *   - The encryption provider is wrapped so generateDataKey() throws, which
 *     makes storeTokens() structurally unable to complete.
 *   - No Google API call, so no token refresh and no write-back. The account
 *     address comes out of the decrypted bundle itself.
 *   - No cycle is seeded, no email is composed or sent.
 *
 * ENV WIRING — THE PART THAT MATTERS
 *   Every other engine script sources ../.env.local, which is UAT. Pointing
 *   this at UAT and seeing a pass would be worse than never running it, so
 *   there is deliberately no default and no ambient fallback: the target must
 *   be named on the command line or in SPRIGLY_VERIFY_* variables, and the
 *   resolved values overwrite anything already in the environment. Sourcing
 *   .env.local first cannot contaminate the run.
 *
 *   A LocalDevProvider result would be a false pass — it decrypts with a local
 *   master key and never calls KMS at all — so the provider is asserted to be
 *   KmsProvider and LOCAL_DEV_ENCRYPTION_KEY is stripped from the environment.
 *
 * USAGE
 *   pnpm --filter @sprigly/worker verify-oauth-decrypt <client-slug> <provider> --env-file ../.env.prod
 *
 *   or, naming the target explicitly:
 *     SPRIGLY_VERIFY_DATABASE_URL=...              \
 *     SPRIGLY_VERIFY_AWS_KMS_KEY_ID=...            \
 *     SPRIGLY_VERIFY_KMS_AWS_ACCESS_KEY_ID=...     \
 *     SPRIGLY_VERIFY_KMS_AWS_SECRET_ACCESS_KEY=... \
 *     pnpm --filter @sprigly/worker verify-oauth-decrypt <client-slug> <provider>
 *
 * EXIT CODES
 *   0  decrypted
 *   1  decrypt failed (KMS error, or ciphertext/key mismatch) — the error is
 *      printed verbatim, unprefixed, including AWS $metadata
 *   2  usage or configuration error — nothing was contacted
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { inspect } from 'node:util';

// ── Output ───────────────────────────────────────────────────────────────────
// Plain console, no pino. The whole point is that a failure is readable without
// knowing a log prefix to grep for.

const out = (line = ''): void => { console.log(line); };

function fail(code: number, message: string, detail: string[] = []): never {
  console.error('');
  console.error(message);
  for (const line of detail) console.error(line);
  console.error('');
  process.exit(code);
}

/**
 * Everything the AWS SDK attaches to a failure, printed flat. The UAT outage was
 * legible in principle and invisible in practice; nothing here is summarised
 * away.
 */
function describeError(err: unknown): string[] {
  const lines: string[] = [];

  if (err instanceof Error) {
    lines.push(`  name       ${err.name}`);
    lines.push(`  message    ${err.message}`);
  } else {
    lines.push(`  value      ${String(err)}`);
  }

  const meta = (err as { $metadata?: Record<string, unknown> }).$metadata;
  if (meta !== undefined) {
    if (meta['httpStatusCode'] !== undefined) lines.push(`  http       ${String(meta['httpStatusCode'])}`);
    if (meta['requestId'] !== undefined)      lines.push(`  requestId  ${String(meta['requestId'])}`);
    if (meta['attempts'] !== undefined)       lines.push(`  attempts   ${String(meta['attempts'])}`);
  }

  const fault = (err as { $fault?: string }).$fault;
  if (fault !== undefined) lines.push(`  fault      ${fault}`);

  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) lines.push(`  cause      ${String(cause)}`);

  lines.push('');
  lines.push('  full error object:');
  for (const line of inspect(err, { depth: 5, colors: false }).split('\n')) {
    lines.push(`    ${line}`);
  }
  return lines;
}

// ── Args ─────────────────────────────────────────────────────────────────────

const USAGE =
  'Usage: verify-oauth-decrypt <client-slug> <provider> [--env-file <path>]\n' +
  '       providers: gmail | outlook | slack | drive';

// Mirrors OAuthProvider in packages/oauth-tokens/src/types.ts.
const PROVIDERS = ['gmail', 'outlook', 'slack', 'drive'] as const;
type Provider = (typeof PROVIDERS)[number];

const argv = process.argv.slice(2);
const positional: string[] = [];
let envFileArg: string | undefined;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === undefined) continue;
  if (arg === '--env-file') {
    const next = argv[i + 1];
    if (next === undefined) fail(2, 'Missing path after --env-file.', [USAGE]);
    envFileArg = next;
    i++;
  } else if (arg.startsWith('--env-file=')) {
    envFileArg = arg.slice('--env-file='.length);
  } else if (arg === '--help' || arg === '-h') {
    out(USAGE);
    process.exit(0);
  } else {
    positional.push(arg);
  }
}

const slug = positional[0];
const providerArg = positional[1];

if (slug === undefined || providerArg === undefined) {
  fail(2, 'Both <client-slug> and <provider> are required.', [USAGE]);
}
if (!(PROVIDERS as readonly string[]).includes(providerArg)) {
  fail(2, `Unknown provider '${providerArg}'.`, [USAGE]);
}
const provider = providerArg as Provider;

// ── Target resolution ────────────────────────────────────────────────────────
// No ambient fallback. DATABASE_URL / AWS_KMS_KEY_ID / KMS_* already in the
// environment are ignored and then overwritten, so a stray `. ../.env.local`
// earlier in the shell cannot decide what this run talks to.

interface Target {
  source: string;
  databaseUrl: string;
  kmsKeyId: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/**
 * Minimal KEY=value reader for the repo's .env files. Quoted values are
 * unwrapped; `#` starts a comment only at the beginning of a line, never
 * mid-value — connection strings and secrets legitimately contain it.
 */
function parseEnvFile(path: string): Map<string, string> {
  const abs = resolvePath(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (err) {
    fail(2, `Could not read --env-file ${abs}`, [`  ${String(err)}`]);
  }

  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

function requireValue(map: Map<string, string>, key: string, missing: string[]): string {
  const value = map.get(key);
  if (value === undefined || value === '') {
    missing.push(`  ${key}`);
    return '';
  }
  return value;
}

const namedVars = new Map<string, string>();
for (const key of [
  'SPRIGLY_VERIFY_DATABASE_URL',
  'SPRIGLY_VERIFY_AWS_KMS_KEY_ID',
  'SPRIGLY_VERIFY_KMS_AWS_ACCESS_KEY_ID',
  'SPRIGLY_VERIFY_KMS_AWS_SECRET_ACCESS_KEY',
  'SPRIGLY_VERIFY_AWS_REGION',
]) {
  const value = process.env[key];
  if (value !== undefined && value !== '') namedVars.set(key, value);
}

const hasNamed = namedVars.size > 0;
const hasEnvFile = envFileArg !== undefined;

if (hasNamed && hasEnvFile) {
  fail(2, 'Ambiguous target: both --env-file and SPRIGLY_VERIFY_* are set.', [
    '  Use exactly one, so there is no question afterwards which environment',
    '  was actually tested.',
  ]);
}
if (!hasNamed && !hasEnvFile) {
  fail(2, 'No target given — refusing to guess.', [
    '  This script never falls back to the ambient DATABASE_URL, because the',
    '  ambient one is UAT on every developer machine and a UAT pass would be',
    '  read as a production pass.',
    '',
    '  Name the target explicitly:',
    '    --env-file ../.env.prod',
    '  or set SPRIGLY_VERIFY_DATABASE_URL, SPRIGLY_VERIFY_AWS_KMS_KEY_ID,',
    '  SPRIGLY_VERIFY_KMS_AWS_ACCESS_KEY_ID, SPRIGLY_VERIFY_KMS_AWS_SECRET_ACCESS_KEY.',
  ]);
}

const missing: string[] = [];
let target: Target;

if (envFileArg !== undefined) {
  const abs = resolvePath(process.cwd(), envFileArg);
  const map = parseEnvFile(envFileArg);
  target = {
    source:          abs,
    databaseUrl:     requireValue(map, 'DATABASE_URL', missing),
    kmsKeyId:        requireValue(map, 'AWS_KMS_KEY_ID', missing),
    accessKeyId:     requireValue(map, 'KMS_AWS_ACCESS_KEY_ID', missing),
    secretAccessKey: requireValue(map, 'KMS_AWS_SECRET_ACCESS_KEY', missing),
    // .env.prod carries no AWS_REGION; KmsProvider's own default is eu-west-2.
    region:          map.get('AWS_REGION') ?? 'eu-west-2',
  };
} else {
  target = {
    source:          'SPRIGLY_VERIFY_* environment variables',
    databaseUrl:     requireValue(namedVars, 'SPRIGLY_VERIFY_DATABASE_URL', missing),
    kmsKeyId:        requireValue(namedVars, 'SPRIGLY_VERIFY_AWS_KMS_KEY_ID', missing),
    accessKeyId:     requireValue(namedVars, 'SPRIGLY_VERIFY_KMS_AWS_ACCESS_KEY_ID', missing),
    secretAccessKey: requireValue(namedVars, 'SPRIGLY_VERIFY_KMS_AWS_SECRET_ACCESS_KEY', missing),
    region:          namedVars.get('SPRIGLY_VERIFY_AWS_REGION') ?? 'eu-west-2',
  };
}

if (missing.length > 0) {
  fail(2, `Target ${target.source} is missing required values:`, [
    ...missing,
    '',
    '  All four are required. A missing AWS_KMS_KEY_ID in particular would let',
    '  the local-dev provider answer instead of KMS, which passes without',
    '  proving anything.',
  ]);
}

// ── Read-only connection string ──────────────────────────────────────────────
// The guard travels in the URL as a libpq startup parameter so it applies to
// every connection @sprigly/db's pool opens, not just the first. Carried this
// way rather than by building a second client, so the decrypt still runs
// against the same Postgres client the worker uses.

function withReadOnlyGuard(url: string): string {
  const parsed = new URL(url);
  const existing = parsed.searchParams.get('options');
  const guard = '-c default_transaction_read_only=on';
  parsed.searchParams.set('options', existing === null ? guard : `${existing} ${guard}`);
  return parsed.toString();
}

let readOnlyUrl: string;
try {
  readOnlyUrl = withReadOnlyGuard(target.databaseUrl);
} catch (err) {
  fail(2, `DATABASE_URL from ${target.source} is not a parseable URL.`, [`  ${String(err)}`]);
}

// Overwrite rather than default — an ambient UAT value must not survive.
process.env['DATABASE_URL']              = readOnlyUrl;
process.env['AWS_KMS_KEY_ID']            = target.kmsKeyId;
process.env['KMS_AWS_ACCESS_KEY_ID']     = target.accessKeyId;
process.env['KMS_AWS_SECRET_ACCESS_KEY'] = target.secretAccessKey;
process.env['AWS_REGION']                = target.region;
// Remove the local-dev escape hatch entirely: with it present and the KMS
// lookup absent, createEncryptionProvider() would answer from a local key.
delete process.env['LOCAL_DEV_ENCRYPTION_KEY'];

// ── Imports (after the environment is settled) ───────────────────────────────
// @sprigly/db parses DATABASE_URL at module scope, so these cannot be static.

const [{ db, sql, clients, oauthConnections }, oauthTokens, { eq, and }] = await Promise.all([
  import('@sprigly/db'),
  import('@sprigly/oauth-tokens'),
  import('drizzle-orm'),
]);

const { getTokens, createEncryptionProvider, KmsProvider } = oauthTokens;
type EncryptionProvider = import('@sprigly/oauth-tokens').EncryptionProvider;

// ── Banner ───────────────────────────────────────────────────────────────────
// Printed before anything is contacted, and repeated in the verdict. A pass can
// never be read without seeing which environment produced it — prod and UAT
// differ in database host, KMS key and IAM user.

function describeDbTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

const dbTarget = describeDbTarget(target.databaseUrl);
const targetSummary = [
  `  config source   ${target.source}`,
  `  database        ${dbTarget}`,
  `  KMS region      ${target.region}`,
  `  IAM access key  ${target.accessKeyId}`,
  `  AWS_KMS_KEY_ID  ${target.kmsKeyId}`,
];

out('');
out('verify-oauth-decrypt — read-only credential decryption check');
out('');
out(`  client          ${slug}`);
out(`  provider        ${provider}`);
for (const line of targetSummary) out(line);
out('');
// AWS_KMS_KEY_ID is listed because it identifies the environment, not because
// the decrypt uses it: KmsProvider.decryptDataKey sends CiphertextBlob and
// EncryptionContext only (providers.ts:52), so KMS resolves the key from the
// ciphertext. That key governs sealing. The key actually exercised here is
// whichever one sealed the row — which is the whole point after a restore.
out('  AWS_KMS_KEY_ID seals new credentials; kms:Decrypt resolves the key from');
out('  the ciphertext, so the key exercised below is the one that sealed the row.');
out('');

// ── Confirm the read-only guard actually took ────────────────────────────────
// Asked of the server rather than assumed, because this is the guarantee that
// makes the script safe to point at production.

let readOnly: string | undefined;
try {
  const rows = await sql<{ ro: string }[]>`
    SELECT current_setting('default_transaction_read_only') AS ro
  `;
  readOnly = rows[0]?.ro;
} catch (err) {
  fail(1, `Could not connect to ${dbTarget}`, describeError(err));
}

if (readOnly !== 'on') {
  fail(1, 'Refusing to continue: the read-only session guard is not active.', [
    `  current_setting('default_transaction_read_only') returned '${readOnly ?? 'nothing'}', not 'on'.`,
    '  Without it this process is not provably read-only, and it is meant to be',
    '  run against production.',
  ]);
}

out('  read-only       on (confirmed server-side)');
out('');

// ── Resolve client ───────────────────────────────────────────────────────────

const clientRows = await db
  .select({ id: clients.id, name: clients.name })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const clientRow = clientRows[0];
if (clientRow === undefined) {
  fail(2, `No client with slug '${slug}' in ${dbTarget}.`);
}

out(`  client id       ${clientRow.id}  (${clientRow.name})`);

// ── Inspect the connection row ───────────────────────────────────────────────
// Read separately from getTokens() so "no row at all" and "row will not
// decrypt" can never be confused for one another.

const connRows = await db
  .select({
    id:               oauthConnections.id,
    status:           oauthConnections.status,
    emailAddress:     oauthConnections.emailAddress,
    lastOkAt:         oauthConnections.lastOkAt,
    lastError:        oauthConnections.lastError,
    lastErrorAt:      oauthConnections.lastErrorAt,
    updatedAt:        oauthConnections.updatedAt,
    encryptedDataKey: oauthConnections.encryptedDataKey,
  })
  .from(oauthConnections)
  .where(and(
    eq(oauthConnections.clientId, clientRow.id),
    eq(oauthConnections.provider, provider),
  ))
  .limit(1);

const conn = connRows[0];
if (conn === undefined) {
  fail(2, `No ${provider} connection row for '${slug}' in ${dbTarget}.`, [
    '  Nothing to decrypt. The client has not completed the OAuth flow in this',
    '  environment, which is a different problem from a key mismatch.',
  ]);
}

out(`  connection id   ${conn.id}`);
out(`  row status      ${conn.status}`);
out(`  row updated     ${conn.updatedAt?.toISOString() ?? '(null)'}`);
out(`  wrapped DEK     ${conn.encryptedDataKey.length} base64 chars`);
out('');

// ── Provider ─────────────────────────────────────────────────────────────────

let baseProvider: EncryptionProvider;
try {
  baseProvider = createEncryptionProvider();
} catch (err) {
  fail(2, 'createEncryptionProvider() refused to build a provider.', describeError(err));
}

if (!(baseProvider instanceof KmsProvider)) {
  fail(2, 'Refusing to continue: the resolved provider is not KmsProvider.', [
    `  Got ${baseProvider.constructor.name} instead.`,
    '  Only a KMS decrypt answers the question being asked here; any other',
    '  provider reports success without the key ever being exercised.',
  ]);
}

/**
 * Delegates to the real provider and records what happened, so a failure can be
 * attributed to KMS or to the AES-GCM unwrap that follows it. It decides
 * nothing and decrypts nothing itself.
 *
 * generateDataKey throws by construction: it is the entry point storeTokens()
 * needs, and this script must never be able to write.
 */
class ObservedProvider implements EncryptionProvider {
  kmsSucceeded = false;
  kmsError: unknown = undefined;
  kmsMs = 0;

  constructor(private readonly inner: EncryptionProvider) {}

  async generateDataKey(): Promise<{ plaintext: Buffer; encrypted: string }> {
    throw new Error('verify-oauth-decrypt is read-only: generateDataKey() must never be called');
  }

  async decryptDataKey(encryptedKey: string, context: Record<string, string>): Promise<Buffer> {
    const started = process.hrtime.bigint();
    try {
      const dek = await this.inner.decryptDataKey(encryptedKey, context);
      this.kmsSucceeded = true;
      return dek;
    } catch (err) {
      this.kmsError = err;
      throw err;
    } finally {
      this.kmsMs = Number(process.hrtime.bigint() - started) / 1e6;
    }
  }
}

const observed = new ObservedProvider(baseProvider);

// ── The decrypt ──────────────────────────────────────────────────────────────
// getTokens() is the function gmail-send-notification.ts:45 calls. The
// encryption context it builds ({ clientId, provider }) has to match what
// storeTokens() sealed the key with, so that is exercised here too.

out(`  decrypting via getTokens(db, KmsProvider, ${clientRow.id}, '${provider}') ...`);

let tokens: Awaited<ReturnType<typeof getTokens>>;
try {
  tokens = await getTokens(db, observed, clientRow.id, provider);
} catch (err) {
  if (observed.kmsError !== undefined) {
    fail(1, `FAIL — KMS could not decrypt the data key (after ${observed.kmsMs.toFixed(0)}ms).`, [
      ...targetSummary,
      '',
      '  This is the failure that was invisible on UAT. In full:',
      '',
      ...describeError(observed.kmsError),
      '',
      '  The key named in that message is the one that SEALED the row, which is',
      '  not necessarily AWS_KMS_KEY_ID above. If the two differ, this row was',
      '  written in a different environment and carried here by a restore.',
      '',
      '  Common causes:',
      '    AccessDeniedException       the IAM user above has no kms:Decrypt grant on',
      '                                the sealing key — identity policy or key policy',
      '    NotFoundException           the sealing key does not exist in this region',
      '    InvalidCiphertextException  the wrapped key is corrupt, or the encryption',
      '                                context ({ clientId, provider }) does not match',
      '                                what sealed it',
      '    KMSInvalidStateException    the sealing key is disabled or pending deletion',
    ]);
  }

  if (observed.kmsSucceeded) {
    fail(1, 'FAIL — KMS returned a data key, but the token blob would not unwrap.', [
      ...targetSummary,
      '',
      '  KMS access is fine. The AES-256-GCM unwrap of encrypted_tokens then',
      '  failed, so that column and encrypted_data_key are out of step —',
      '  typically one was restored without the other.',
      '',
      ...describeError(err),
    ]);
  }

  fail(1, 'FAIL — could not read the connection row.', [...targetSummary, '', ...describeError(err)]);
}

if (tokens === null) {
  fail(2, `getTokens() returned null for '${slug}' / ${provider}.`, [
    '  The row was visible a moment ago, so this is a race or a provider mismatch.',
  ]);
}

// ── Report ───────────────────────────────────────────────────────────────────
// The decrypted bundle is described, never printed. No access or refresh token
// value reaches stdout.

const expiresAt = tokens.expiresAt !== undefined ? new Date(tokens.expiresAt) : undefined;
const expired = expiresAt !== undefined && expiresAt.getTime() < Date.now();

out('');
out(`PASS — ${provider} credentials for '${slug}' decrypt successfully.`);
out('');
out(`  account         ${tokens.emailAddress ?? '(not stored in bundle)'}`);
out(`  scopes          ${tokens.scopes.length > 0 ? tokens.scopes.join(', ') : '(none recorded)'}`);
out(`  access token    present (${tokens.accessToken.length} chars, not shown)`);
out(`  refresh token   ${tokens.refreshToken !== undefined ? 'present (not shown)' : 'ABSENT'}`);
out(`  expires at      ${expiresAt?.toISOString() ?? '(not recorded)'}${expired ? '  — expired, refreshes on first use' : ''}`);
out(`  kms decrypt     ${observed.kmsMs.toFixed(0)}ms (key resolved from ciphertext)`);
out('');
out('  verified against:');
for (const line of targetSummary) out(line);
out('');

// Decryption is the verdict; connection health is context. Kept below the PASS
// so a revoked-but-decryptable credential is not mistaken for a key problem,
// nor a key problem hidden behind a healthy-looking row.
const notes: string[] = [];
if (conn.status !== 'active') {
  notes.push(`status is '${conn.status}', not 'active' — pollers skip this connection`);
}
if (conn.lastError !== null && conn.lastError !== '') {
  notes.push(`last error: ${conn.lastError} (${conn.lastErrorAt?.toISOString() ?? 'time unknown'})`);
}
if (tokens.refreshToken === undefined) {
  notes.push('no refresh token stored — the credential dies when the access token expires');
}
if (conn.emailAddress === null && tokens.emailAddress !== undefined) {
  notes.push('oauth_connections.email_address is NULL though the bundle carries one');
}

if (notes.length > 0) {
  out('  Notes (decryption still passed):');
  for (const note of notes) out(`    ${note}`);
  out(`    last ok: ${conn.lastOkAt?.toISOString() ?? 'never'}`);
  out('');
}

await sql.end({ timeout: 5 });
process.exit(0);
