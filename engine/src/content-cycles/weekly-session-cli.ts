/**
 * weekly-session-cli.ts — run the weekly planning session against ONE named cycle.
 *
 *   pnpm --filter @sprigly/worker weekly-session <cycleId>
 *   pnpm --filter @sprigly/worker weekly-session <cycleId> --week 2026-08-10
 *   pnpm --filter @sprigly/worker weekly-session <cycleId> --generate
 *
 * ── IT BYPASSES THE STATUS FILTER, DELIBERATELY ──────────────────────────────────────
 *
 * The weekly session has never run. Not once, on either environment — `weekly_sessions` is
 * empty on both. The cron flag (WEEKLY_SESSION_CRON_ENABLED) gets the blame, but it was never
 * the blocker: the fan-out only picks cycles whose status is in AUDITABLE_STATUSES —
 * ['active', 'delivered', 'finalised'] (weekly-cron.ts:22, mirrored at
 * app/src/app/api/plan/weekly-session/route.ts:27) — and until 2026-09-01 nothing in the
 * codebase ever WROTE 'delivered'. Every cycle sat at scheduled, intake_confirmed or
 * workbook_built. The filter was a correct query over an empty set, so turning the cron on
 * would have changed nothing.
 *
 * A delivery transition has since landed, but only on the baseline path; auto-approved cycles
 * still never reach 'delivered'. So the feature remains unreachable through the cron, and
 * nobody has ever seen what it produces.
 *
 * This tool exists to answer that — to exercise a path the cron cannot currently reach, so its
 * output can be judged BEFORE the lifecycle work that would make it reachable. It therefore
 * ignores AUDITABLE_STATUSES entirely. That is the point of it, not an oversight, and it is
 * why this is a CLI an operator runs by hand rather than anything the scheduler can call.
 *
 * ── AUDIT ONLY BY DEFAULT ────────────────────────────────────────────────────────────
 *
 * Default runs PASS 1 and stops. Pass 1 is `runWeeklyAudit` — three selects, one weather
 * request, one Haiku call — and it WRITES NOTHING: `runAudit` takes no db handle and no audit
 * logger, and the model client records no audit_log row of its own. No proposals, no
 * weekly_sessions row, no assistant message, no post_edits. Those are all written by
 * `runWeeklySession` AFTER Pass 2 (weekly-session.ts:295-320), so stopping here produces none
 * of them.
 *
 * It reads through `runWeeklyAudit` rather than rebuilding the queries, because the rules in
 * them are easy to reproduce slightly wrong — the draft fence, the seven-day window, a note
 * whose NULL relevance bound means "always in window" — and a tool that drifts from the
 * session reports on a week the session would never audit.
 *
 * ── --generate SPENDS MONEY ──────────────────────────────────────────────────────────
 *
 * Pass 2 is regeneratePost -> applyCodeGate -> applyCritic per actioned finding
 * (weekly-session.ts), Sonnet through the critic and repair loop. It prints a costed estimate
 * and requires typed confirmation first. It also persists: proposals, an assistant message, a
 * weekly_sessions row, and one post_edits row per successful rewrite.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────────────
 *
 * No default cycle id and no fallback of any kind — a tool that guesses which cycle it is
 * auditing is how you spend a real client's budget on the wrong month. Status chatter to
 * stderr; result JSON to stdout.
 */
import pino from 'pino';
import { createInterface } from 'node:readline/promises';
import { eq } from 'drizzle-orm';
import { db, sql, contentCycles, clients } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createAuditLogger } from '@sprigly/audit';
import { DbPromptResolver } from '@sprigly/prompts';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { env } from '../env.js';
import { runWeeklyAudit, runWeeklySession } from './weekly-session.js';
import { londonWeekStart } from './weekly-cron.js';
import type { Finding } from './weekly-audit.js';

const args     = process.argv.slice(2);
const cycleId  = args.find((a) => !a.startsWith('--'));
const generate = args.includes('--generate');
const weekArg  = (() => {
  const i = args.indexOf('--week');
  return i >= 0 ? args[i + 1] : undefined;
})();

const USAGE = 'usage: pnpm --filter @sprigly/worker weekly-session <cycleId> [--week YYYY-MM-DD] [--generate]';

if (!cycleId) {
  console.error('weekly-session: missing required argument <cycleId>.');
  console.error(USAGE);
  console.error('\nThere is no default cycle. This tool bypasses the status filter the cron applies,');
  console.error('so it will happily audit any cycle you name — which is exactly why it names none for you.');
  process.exit(1);
}

if (weekArg !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(weekArg)) {
  console.error(`weekly-session: --week must be YYYY-MM-DD, got ${JSON.stringify(weekArg)}.`);
  console.error(USAGE);
  process.exit(1);
}

/**
 * The week the session would audit. Defaults to the Monday of the current London week — the
 * same helper the cron's fan-out uses, so an unqualified run previews what next Monday's tick
 * would have looked at.
 */
const weekStart = weekArg ?? londonWeekStart();

const logger = pino({ name: 'weekly-session', level: 'warn' }, pino.destination(2));

/**
 * STDOUT IS THE RESULT, AND NOTHING ELSE MAY WRITE TO IT.
 *
 * `@sprigly/model-client` narrates on `console.info` — the model-resolution line at
 * construction (factory.ts) and per-turn detail during Bedrock calls (bedrock-client.ts) —
 * and `console.info` goes to stdout. That is right for the worker, whose logs are collected
 * from stdout, and wrong for a CLI whose stdout is a JSON document somebody will pipe into
 * `jq`. Measured: without this, the first line of "JSON" is a model-resolution banner.
 *
 * Redirected HERE rather than fixed in the package, because the package is not wrong — the
 * stream contract belongs to the process, and this process is the one making a promise about
 * stdout. `writeResult` keeps a handle on the real stream so the result still lands there.
 */
const writeResult = (s: string) => process.stdout.write(`${s}\n`);
console.log   = (...a: unknown[]) => console.error(...a);
console.info  = (...a: unknown[]) => console.error(...a);
console.debug = (...a: unknown[]) => console.error(...a);

const err = (s = '') => console.error(s);

async function fail(message: string): Promise<never> {
  console.error(`\nweekly-session: ${message}`);
  await sql.end().catch(() => {});
  process.exit(1);
}

// ── THE COST MODEL ───────────────────────────────────────────────────────────────────
/**
 * Measured on prod audit_log for one client over August 2026. Stated as constants rather than
 * a sentence so the estimate below can be re-derived when they change.
 *
 * A rewrite is ONE critic pass plus, on average, 0.74 repairs — the repair loop reruns until
 * the critic accepts, and 0.74 is the observed mean, not a cap. So the per-rewrite figure is
 * a MEAN and a bad week costs more; the range printed below spans the observed spread rather
 * than pretending to a single number.
 */
const CRITIC_GBP        = 0.0244;
const REPAIR_GBP        = 0.0450;
const REPAIRS_PER_CRITIC = 0.74;
const PER_REWRITE_GBP   = CRITIC_GBP + REPAIR_GBP * REPAIRS_PER_CRITIC;   // ≈ £0.0577

const gbp = (n: number) => `£${n.toFixed(2)}`;
/** The per-call rates are SUB-PENNY; £0.0244 printed to 2dp reads as £0.02 and understates
 *  the input to a number somebody is about to authorise. Rates get 4dp, totals get 2. */
const rate = (n: number) => `£${n.toFixed(4)}`;

/**
 * What Pass 2 would spend on this audit's actioned findings.
 *
 * Sized from the findings THEMSELVES rather than from the caps, because the caps are a
 * ceiling and the audit usually comes in under them — quoting the ceiling would overstate a
 * quiet week by several times and teach an operator to ignore the number.
 *
 * Only generating findings count. `date_conflict` becomes a move proposal with no model call
 * at all (weekly-session.ts), so it is listed and costed at zero rather than silently dropped.
 */
function estimate(actioned: Finding[]): { generating: number; free: number; low: number; high: number } {
  const generating = actioned.filter((f) => f.type !== 'date_conflict').length;
  const free       = actioned.length - generating;
  return {
    generating, free,
    // The spread is the observed £0.06–0.10 per rewrite, not a confidence interval: the low
    // end is a clean critic pass, the high end one that needed more than the mean repairs.
    low:  generating * 0.06,
    high: generating * 0.10,
  };
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    err('\nweekly-session: --generate needs an interactive terminal to confirm the spend.');
    err('Refusing to spend money on a decision nobody was present to make.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'yes';
  } finally {
    rl.close();
  }
}

// ── Resolve the cycle ────────────────────────────────────────────────────────────────
const [cycle] = await db
  .select({
    id: contentCycles.id, clientId: contentCycles.clientId,
    cycleMonth: contentCycles.cycleMonth, status: contentCycles.status, channel: contentCycles.channel,
  })
  .from(contentCycles)
  .where(eq(contentCycles.id, cycleId))
  .limit(1);

if (!cycle) await fail(`no content_cycles row with id ${cycleId}`);

const [client] = await db
  .select({ name: clients.name, lat: clients.lat, lon: clients.lon })
  .from(clients)
  .where(eq(clients.id, cycle!.clientId))
  .limit(1);

const deps = {
  db,
  encProvider:        createEncryptionProvider(),
  googleClientId:     env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  model:              createModelClientFromEnv(),
  prompts:            new DbPromptResolver(db),
  audit:              createAuditLogger(db),
  logger,
};

const job = { type: 'weekly-session' as const, clientId: cycle!.clientId, cycleId: cycleId!, weekStart };

// ── Header: say what this is about to do, and what it is ignoring ────────────────────
const AUDITABLE = ['active', 'delivered', 'finalised'];
err('');
err(`  cycle    ${cycle!.id}  (${cycle!.cycleMonth}, ${cycle!.channel})`);
err(`  client   ${client?.name ?? cycle!.clientId}`);
err(`  status   ${cycle!.status}${AUDITABLE.includes(cycle!.status) ? '' : `  — NOT in AUDITABLE_STATUSES [${AUDITABLE.join(', ')}]; the cron would skip this cycle`}`);
err(`  week     ${weekStart} .. (7 days)${weekArg ? '' : '  (default: Monday of the current London week)'}`);
// Monday is not REQUIRED — weekEnd is weekStart+6 and works from any date — but the cron only
// ever emits Mondays, so a non-Monday start previews a window the session would never see.
// Warned rather than refused: reaching weeks the cron cannot is the point of this tool.
if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) {
  err(`           note: ${weekStart} is not a Monday. Nothing requires one, but the cron only ever`);
  err('           produces Mondays, so this is a window the session would never really see.');
}
err(`  mode     ${generate ? 'AUDIT + GENERATE (Pass 2 spends money and writes)' : 'AUDIT ONLY (Pass 1; writes nothing)'}`);
if (client?.lat == null || client?.lon == null) {
  err('           note: this client has no lat/lon, so no forecast is fetched and no');
  err('           weather_opportunity finding can be raised (they are dropped in code).');
}
err('');

// ── Pass 1 ───────────────────────────────────────────────────────────────────────────
const pass1 = await runWeeklyAudit(job, deps).catch(async (e: unknown): Promise<never> => {
  await fail(e instanceof Error ? e.message : String(e));
  throw e;   // unreachable; satisfies never
});

const describe = (f: Finding) => {
  const ref = [f.postId ? `post=${f.postId}` : null, f.noteId ? `note=${f.noteId}` : null, f.toDate ? `→ ${f.toDate}` : null]
    .filter(Boolean).join(' ');
  return `    [${f.severity}] ${f.type}${ref ? `  ${ref}` : ''}\n      ${f.trigger}`;
};

err(`  posts in window      ${pass1.posts.length}${pass1.posts.length === 0 ? '  — nothing to critique; only weather findings are possible' : ''}`);
err(`  active notes         ${pass1.notes.length}`);
err(`  notable weather      ${pass1.flags.any ? pass1.flags.lines.join('; ') : 'none'}`);
err(`  caps                 ${pass1.caps.maxRewrite} rewrites, ${pass1.caps.maxWeather} weather`);
err('');
err(`  FINDINGS  ${pass1.findings.length}`);
if (pass1.findings.length === 0) {
  err('    (none — a quiet week. The audit is deliberately conservative: an unremarkable');
  err('     week with no maturing notes is meant to produce nothing.)');
}
if (pass1.actioned.length) {
  err(`\n  ACTIONED  ${pass1.actioned.length}  (Pass 2 would act on these)`);
  for (const f of pass1.actioned) err(describe(f));
}
if (pass1.skipped.length) {
  err(`\n  SKIPPED  ${pass1.skipped.length}  (over cap — reported, never actioned)`);
  for (const f of pass1.skipped) err(describe(f));
}

/**
 * date_conflict cannot fire, and an operator judging this output needs to know that before
 * concluding the model never finds one. `cycleDates` is hardcoded `[]` (weekly-session.ts) and
 * nothing populates it, so the prompt always reads "KNOWN CYCLE DATES: (none)" — one of the
 * four finding types is structurally unreachable. Stated on every run rather than only when it
 * matters, because its absence is invisible.
 */
err('');
err('  NOTE  date_conflict findings cannot occur: the audit is always given an empty');
err('        KNOWN CYCLE DATES list (cycleDates is hardcoded [] and nothing fills it),');
err('        so that finding type is unreachable regardless of what this cycle contains.');

const est = estimate(pass1.actioned);

if (!generate) {
  err('');
  err('  AUDIT ONLY — nothing was written. No proposals, no weekly_sessions row, no');
  err('  assistant message, no post_edits.');
  if (est.generating > 0) {
    err(`  Running --generate would generate ${est.generating} caption${est.generating === 1 ? '' : 's'}, costing roughly ${gbp(est.low)}–${gbp(est.high)}.`);
  }
  err('');
  writeResult(JSON.stringify({
    mode: 'audit', cycleId: cycle!.id, clientId: cycle!.clientId, cycleStatus: cycle!.status,
    weekStart, weekEnd: pass1.weekEnd,
    postsInWindow: pass1.posts.length, activeNotes: pass1.notes.length,
    weather: { any: pass1.flags.any, lines: pass1.flags.lines },
    caps: pass1.caps,
    findings: pass1.findings, actioned: pass1.actioned, skipped: pass1.skipped,
    wouldGenerate: est.generating, estimateGbp: { low: est.low, high: est.high },
    wrote: null,
  }, null, 2));
  await sql.end();
  process.exit(0);
}

// ── Pass 2, behind confirmation ──────────────────────────────────────────────────────
err('');
err('  ── --generate ────────────────────────────────────────────────────────────────');
err(`  ${est.generating} caption${est.generating === 1 ? '' : 's'} would be generated through the full pipeline`);
err('  (regeneratePost → applyCodeGate → applyCritic — Sonnet, with a repair loop).');
if (est.free > 0) err(`  ${est.free} date_conflict move${est.free === 1 ? '' : 's'} cost nothing — no model call is made for them.`);
err('');
err(`  Measured on prod, August 2026: ${rate(CRITIC_GBP)} per critic call, ${rate(REPAIR_GBP)} per repair,`);
err(`  ${REPAIRS_PER_CRITIC} repairs per critic — about £0.06–0.10 per rewrite.`);
err(`  ESTIMATE: ${gbp(est.low)} – ${gbp(est.high)}   (mean ≈ ${gbp(est.generating * PER_REWRITE_GBP)})`);
err('');
err('  It will also WRITE: one conversation, one assistant message, one proposal per');
err('  actioned finding, one weekly_sessions row, and one post_edits row per rewrite.');
err('');
/**
 * `runWeeklySession` re-runs Pass 1 itself — it is one function and this tool does not change
 * its logic. So the audit printed above is a PREVIEW, and the findings Pass 2 acts on come
 * from a second call. The audit runs at temperature 0 over the same rows, so they normally
 * match; what can legitimately move between the two is the forecast, and with it any
 * weather_opportunity. Said plainly here because an operator confirming a number deserves to
 * know it was priced from a different call than the one being paid for.
 */
err('  NB the estimate is priced from the audit above. Pass 2 re-runs the audit (one');
err('  function, unchanged), so the actioned set is re-derived and could differ if the');
err('  forecast has moved. It costs one extra Haiku call, which is negligible.');
err('');

if (est.generating === 0 && pass1.actioned.length === 0) {
  err('  Nothing to generate — the audit found nothing to act on. Not running Pass 2.');
  err('');
  writeResult(JSON.stringify({ mode: 'generate', ran: false, reason: 'no actioned findings', weekStart, findings: pass1.findings }, null, 2));
  await sql.end();
  process.exit(0);
}

if (!(await confirm('  Type "yes" to spend this and write the proposals: '))) {
  err('\n  Not confirmed — nothing was generated and nothing was written.');
  err('');
  await sql.end();
  process.exit(0);
}

err('\n  Running Pass 2…');
const result = await runWeeklySession(job, deps).catch(async (e: unknown): Promise<never> => {
  await fail(e instanceof Error ? e.message : String(e));
  throw e;
});

writeResult(JSON.stringify({
  mode: 'generate', ran: true, cycleId: cycle!.id, weekStart, weekEnd: pass1.weekEnd,
  audit: { findings: pass1.findings, actioned: pass1.actioned, skipped: pass1.skipped },
  result,
}, null, 2));

await sql.end();
process.exit(0);
