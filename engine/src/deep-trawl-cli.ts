/**
 * deep-trawl-cli.ts — the operator's one-off deep trawl.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker deep-trawl <client-slug> <handle> --channel <channel> --limit <n> [--dry-run] [--allow-shrink] [--timeout-s <n>]
 *
 *   e.g. pnpm --filter @sprigly/worker deep-trawl ivy-t ivy_thebrand --channel instagram --limit 300 --dry-run
 *
 * NOTHING is defaulted. The slug, the handle, the channel and the depth are all typed out
 * by the operator, and the handle must MATCH the one stored on that client's channel —
 * this is the whole guard against writing one account's history onto another client, which
 * a slug typo would otherwise do silently. Add --dry-run to see the plan and the projected
 * breakdown without writing a row.
 *
 * Spends Apify credits, in proportion to --limit. Spends no Bedrock: there is no model call
 * anywhere in this path. Writes only ig_posts, only for months the trawl actually reached,
 * and never shrinks a stored month (see deep-trawl.ts).
 *
 * Which database it hits is entirely the DATABASE_URL in the environment — the pnpm script
 * sources ../.env.local (UAT). Running against production means sourcing ../.env.prod
 * deliberately; see docs/reports/deep-trawl-prep.md for the exact command and the
 * fingerprint check to run first.
 */

import pino from 'pino';
import { and, eq } from 'drizzle-orm';
import { db, clients, clientChannels } from '@sprigly/db';
import { runDeepTrawl, type MonthPlan, type TrawlSnapshot } from './deep-trawl.js';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
function has(argv: string[], name: string): boolean { return argv.includes(name); }

const USAGE = 'Usage: pnpm --filter @sprigly/worker deep-trawl <client-slug> <handle> --channel <channel> --limit <n> [--dry-run] [--allow-shrink] [--timeout-s <n>]\n'
  + '  e.g. pnpm --filter @sprigly/worker deep-trawl ivy-t ivy_thebrand --channel instagram --limit 300 --dry-run';

const argv        = process.argv.slice(2);
const slug        = argv[0];
const handleArg   = argv[1];
const channel     = flag(argv, '--channel');
const limitArg    = flag(argv, '--limit');
const timeoutArg  = flag(argv, '--timeout-s');
const dryRun      = has(argv, '--dry-run');
const allowShrink = has(argv, '--allow-shrink');

if (!slug || slug.startsWith('--') || !handleArg || handleArg.startsWith('--') || !channel || !limitArg) {
  console.error(USAGE);
  process.exit(1);
}

const resultsLimit = Number(limitArg);
if (!Number.isInteger(resultsLimit) || resultsLimit < 1) {
  console.error(`--limit must be a positive integer (got "${limitArg}").`);
  process.exit(1);
}

const timeoutMs = timeoutArg === undefined ? undefined : Number(timeoutArg) * 1000;
if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 1000)) {
  console.error(`--timeout-s must be a number of seconds ≥ 1 (got "${timeoutArg}").`);
  process.exit(1);
}

const apifyApiKey = process.env['APIFY_API_KEY'];
if (!apifyApiKey) { console.error('APIFY_API_KEY is not set — a deep trawl cannot run without it.'); process.exit(1); }

const logger = pino({ name: 'deep-trawl', level: 'info' });

// ── Resolve the client, and hold the operator to the handle they typed ───────────────

const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.slug, slug)).limit(1);
if (!client) { console.error(`Client not found: ${slug}`); process.exit(1); }

const [chan] = await db
  .select({ handle: clientChannels.instagramHandle })
  .from(clientChannels)
  .where(and(eq(clientChannels.clientId, client.id), eq(clientChannels.channel, channel)))
  .limit(1);
if (!chan) { console.error(`No ${channel} channel for ${slug}.`); process.exit(1); }
if (!chan.handle) { console.error(`No instagram_handle stored for ${slug}/${channel} — set it before trawling.`); process.exit(1); }

const typed  = handleArg.replace(/^@/, '').trim().toLowerCase();
const stored = chan.handle.replace(/^@/, '').trim().toLowerCase();
if (typed !== stored) {
  console.error(`Handle mismatch: you typed "${handleArg}" but ${slug}/${channel} is stored as "${chan.handle}".`);
  console.error('Refusing — this is the guard that stops one account\'s history landing on another client.');
  process.exit(1);
}

// ── Reporting ────────────────────────────────────────────────────────────────────────

const fmt = (f: Record<string, number>): string =>
  Object.keys(f).length ? Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') : '(none)';

function printSnapshot(label: string, s: TrawlSnapshot): void {
  console.log(`\n── ${label} ──`);
  console.log(`  months=${s.months.length}  posts=${s.posts}  typed=${s.typed}/${s.posts}  range=${s.oldest.slice(0, 10) || '(none)'} .. ${s.newest.slice(0, 10) || '(none)'}`);
  console.log(`  formats: ${fmt(s.formats)}`);
  for (const m of s.months) {
    console.log(`   ${m.month}  posts=${String(m.posts).padStart(3)}  typed=${String(m.typed).padStart(3)}  ${fmt(m.formats)}`);
  }
}

function printPlans(plans: MonthPlan[]): void {
  console.log('\n── Per-month plan ──');
  for (const p of plans) {
    const delta = p.incoming - p.stored;
    console.log(`   ${p.month}  stored=${String(p.stored).padStart(3)} → incoming=${String(p.incoming).padStart(3)}  (${delta >= 0 ? '+' : ''}${delta})  ${p.action}`);
  }
  const skipped = plans.filter((p) => !p.write);
  if (skipped.length) {
    console.log(`\n  ${skipped.length} month(s) SKIPPED to avoid shrinking a stored row: ${skipped.map((p) => p.month).join(', ')}`);
    console.log('  Re-run with --allow-shrink only if you mean to replace them with the shallower set.');
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────────────

console.log(`Deep trawl — ${client.name} (${slug}) / ${channel} / @${chan.handle}`);
console.log(`  depth=${resultsLimit}  dryRun=${dryRun}  allowShrink=${allowShrink}`);

const r = await runDeepTrawl({
  db, clientId: client.id, channel, handle: chan.handle,
  resultsLimit, apifyApiKey, logger, dryRun, allowShrink,
  ...(timeoutMs === undefined ? {} : { timeoutMs }),
});

console.log(`\nApify: raw=${r.rawCount} owned=${r.ownedCount} droppedForeign=${r.droppedForeign} skippedHidden=${r.skippedHidden} droppedInvalid=${r.droppedInvalid}`);
console.log(`Unmapped media types: ${Object.keys(r.unmappedTypes).length ? JSON.stringify(r.unmappedTypes) : '(none — all mapped)'}`);

printSnapshot('BEFORE (stored)', r.before);
printPlans(r.plans);
printSnapshot(dryRun ? 'AFTER (projected — nothing written)' : 'AFTER (re-read from the database)', r.after);

console.log(dryRun
  ? '\nDry run — no rows were written. Drop --dry-run to apply this plan.'
  : '\nWritten. Re-derive with: pnpm --filter @sprigly/worker onboard-client --calibrate ' + slug + ' --channel ' + channel);
process.exit(0);
