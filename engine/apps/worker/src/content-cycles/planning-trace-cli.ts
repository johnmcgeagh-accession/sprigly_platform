/**
 * planning-trace-cli.ts — read back a planning run's validation-loop trace.
 *
 * Prints the per-post loop history (gate → repair → critic → catalogue, in order)
 * plus a run summary that answers the four questions the trace exists to settle:
 *   1. Per run: how many gate-repairs, what issues, critic no-op passes vs fails.
 *   2. Per repair: before → after — substantive or marginal? (shows the diff)
 *   3. Churn: which posts repaired >once, and did they oscillate (fail→pass→fail)?
 *   4. Cost attribution: tokens / £ per phase, tied to the issues being fixed.
 *
 * Usage: pnpm --filter @sprigly/worker planning-trace <cycleId> [--full]
 *   --full  print complete before/after captions (default: a trimmed diff)
 */
import { eq, asc } from 'drizzle-orm';
import { db, planningTrace, contentCycles, clients } from '@sprigly/db';
import type { PlanningTraceRow } from '@sprigly/db';
import { computeCostPence } from '@sprigly/audit';

const args = process.argv.slice(2);
const full = args.includes('--full');
const cycleId = args.find((a) => !a.startsWith('--'));
if (!cycleId) {
  console.error('Usage: pnpm --filter @sprigly/worker planning-trace <cycleId> [--full]');
  process.exit(1);
}

const rows = (await db
  .select()
  .from(planningTrace)
  .where(eq(planningTrace.cycleId, cycleId))
  .orderBy(asc(planningTrace.seq))) as PlanningTraceRow[];

if (rows.length === 0) {
  console.error(`No planning_trace rows for cycle ${cycleId}.`);
  console.error('(Either the cycle predates trace instrumentation, or the run produced no trace.)');
  process.exit(1);
}

const [cycle] = await db
  .select({ clientId: contentCycles.clientId, channel: contentCycles.channel, cycleMonth: contentCycles.cycleMonth })
  .from(contentCycles).where(eq(contentCycles.id, cycleId)).limit(1);
const [client] = cycle
  ? await db.select({ name: clients.name }).from(clients).where(eq(clients.id, cycle.clientId)).limit(1)
  : [undefined];

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m', bold: '\x1b[1m', rst: '\x1b[0m' };
const pence = (p: number) => `£${(p / 100).toFixed(4)}`;
const trim = (s: string | null, n = 240) => !s ? '' : s.length <= n ? s : s.slice(0, n) + '…';
const oneLine = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

function rowCost(r: PlanningTraceRow): number {
  if (r.inputTokens == null || r.outputTokens == null || !r.modelId) return 0;
  return computeCostPence(r.modelId, r.inputTokens, r.outputTokens);
}

// ── Header ────────────────────────────────────────────────────────────────────
const targetMonth = rows[0]!.targetMonth ?? '?';
console.log(`\n${C.bold}Planning trace — ${client?.name ?? cycle?.clientId ?? '?'} / ${cycle?.channel ?? '?'}${C.rst}`);
console.log(`${C.dim}cycle ${cycleId} · data ${cycle?.cycleMonth ?? '?'} → plan ${targetMonth} · ${rows.length} trace steps${C.rst}`);

// ── Group by post ───────────────────────────────────────────────────────────────
const byPost = new Map<number, PlanningTraceRow[]>();
for (const r of rows) {
  const arr = byPost.get(r.postIndex) ?? [];
  arr.push(r);
  byPost.set(r.postIndex, arr);
}

// ── Per-post loop history ───────────────────────────────────────────────────────
console.log(`\n${C.bold}── Per-post loop history ─────────────────────────────────────────${C.rst}`);
for (const [index, steps] of [...byPost.entries()].sort((a, b) => a[0] - b[0])) {
  const title = steps.find((s) => s.postTitle)?.postTitle ?? '(untitled)';
  const repairs = steps.filter((s) => s.phase === 'repair').length;
  const criticFails = steps.filter((s) => s.phase === 'critic' && s.pass === false).length;
  // Only print posts that DID something (a clean first-pass post = gate pass + critic pass, 2 steps, no repair).
  const didWork = repairs > 0 || criticFails > 0 || steps.some((s) => s.phase === 'catalogue');
  if (!didWork) continue;

  const flag = repairs >= 2 ? `${C.red}● churn${C.rst}`
    : repairs === 1 ? `${C.ylw}● repaired${C.rst}`
    : `${C.cyn}● catalogue rewrite${C.rst}`;
  const tail = repairs > 0 ? ` ${C.dim}(${repairs} repair${repairs === 1 ? '' : 's'})${C.rst}` : '';
  console.log(`\n${C.bold}#${index} ${title}${C.rst}  ${flag}${tail}`);

  for (const s of steps) {
    if (s.phase === 'gate') {
      const codes = (s.detail as { codes?: string[] } | null)?.codes ?? [];
      if (s.pass) console.log(`   ${C.dim}gate#${s.attempt}${C.rst} ${C.grn}pass${C.rst}`);
      else console.log(`   ${C.dim}gate#${s.attempt}${C.rst} ${C.red}fail${C.rst} ${C.dim}[${codes.join(', ')}]${C.rst}`);
    } else if (s.phase === 'critic') {
      const cost = `${C.dim}${s.inputTokens}→${s.outputTokens}tok ${pence(rowCost(s))}${C.rst}`;
      if (s.pass) console.log(`   ${C.dim}critic#${s.attempt}${C.rst} ${C.grn}PASS${C.rst} ${cost}`);
      else {
        const issues = Array.isArray(s.issues) ? (s.issues as string[]) : [];
        console.log(`   ${C.dim}critic#${s.attempt}${C.rst} ${C.red}FAIL${C.rst} ${cost}`);
        for (const i of issues) console.log(`        ${C.red}✗${C.rst} ${oneLine(i)}`);
        const fix = (s.detail as { suggested_fix?: string } | null)?.suggested_fix;
        if (fix) console.log(`        ${C.cyn}→ fix:${C.rst} ${C.dim}${trim(oneLine(fix), 160)}${C.rst}`);
      }
    } else if (s.phase === 'repair') {
      const by = (s.detail as { triggeredBy?: string } | null)?.triggeredBy ?? '?';
      const changed = (s.detail as { changed?: boolean } | null)?.changed;
      const cost = `${C.dim}${s.inputTokens}→${s.outputTokens}tok ${pence(rowCost(s))}${C.rst}`;
      const mark = changed ? '' : ` ${C.ylw}(caption unchanged!)${C.rst}`;
      console.log(`   ${C.ylw}repair#${s.attempt}${C.rst} ${C.dim}via ${by}${C.rst} ${cost}${mark}`);
      if (full) {
        console.log(`        ${C.dim}BEFORE:${C.rst} ${oneLine(s.captionBefore)}`);
        console.log(`        ${C.dim}AFTER :${C.rst} ${oneLine(s.captionAfter)}`);
      } else {
        console.log(`        ${C.dim}before:${C.rst} ${trim(oneLine(s.captionBefore))}`);
        console.log(`        ${C.dim}after :${C.rst} ${trim(oneLine(s.captionAfter))}`);
      }
    } else if (s.phase === 'catalogue') {
      const v = Array.isArray(s.issues) ? (s.issues as string[]) : [];
      console.log(`   ${C.cyn}catalogue${C.rst} ${C.red}rewrote ${v.length} pairing(s)${C.rst} ${C.dim}[${v.join(', ')}]${C.rst}`);
      console.log(`        ${C.dim}before:${C.rst} ${trim(oneLine(s.captionBefore))}`);
      console.log(`        ${C.dim}after :${C.rst} ${trim(oneLine(s.captionAfter))}`);
    }
  }
}

// ── Run summary ─────────────────────────────────────────────────────────────────
const gate = rows.filter((r) => r.phase === 'gate');
const critic = rows.filter((r) => r.phase === 'critic');
const repair = rows.filter((r) => r.phase === 'repair');
const catalogue = rows.filter((r) => r.phase === 'catalogue');

const gateFails = gate.filter((r) => r.pass === false);
const gateIssueCounts = new Map<string, number>();
for (const g of gateFails) for (const c of ((g.detail as { codes?: string[] } | null)?.codes ?? [])) gateIssueCounts.set(c, (gateIssueCounts.get(c) ?? 0) + 1);

const criticPass = critic.filter((r) => r.pass === true).length;
const criticFail = critic.filter((r) => r.pass === false).length;

const unchangedRepairs = repair.filter((r) => (r.detail as { changed?: boolean } | null)?.changed === false).length;

// Churn: posts with ≥2 repairs; oscillation: a critic PASS followed later by a critic FAIL for the same post.
const churn: Array<{ index: number; title: string; repairs: number; oscillated: boolean }> = [];
for (const [index, steps] of byPost.entries()) {
  const reps = steps.filter((s) => s.phase === 'repair').length;
  if (reps < 2) continue;
  const criticSeq = steps.filter((s) => s.phase === 'critic').map((s) => s.pass);
  let oscillated = false;
  for (let i = 1; i < criticSeq.length; i++) if (criticSeq[i] === false && criticSeq.slice(0, i).includes(true)) oscillated = true;
  // also count fail→ (repair) →fail as oscillation
  const fails = criticSeq.filter((p) => p === false).length;
  churn.push({ index, title: steps.find((s) => s.postTitle)?.postTitle ?? '?', repairs: reps, oscillated: oscillated || fails >= 2 });
}

const sumCost = (rs: PlanningTraceRow[]) => rs.reduce((n, r) => n + rowCost(r), 0);
const sumTok = (rs: PlanningTraceRow[]) => rs.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);
const loopCost = sumCost(critic) + sumCost(repair);

console.log(`\n${C.bold}── Run summary ───────────────────────────────────────────────────${C.rst}`);
console.log(`Posts traced            : ${byPost.size}`);
console.log(`Gate checks             : ${gate.length}  (${C.red}${gateFails.length} fail${C.rst}, ${C.grn}${gate.length - gateFails.length} pass${C.rst})`);
if (gateIssueCounts.size > 0) {
  console.log(`  gate issues           : ${[...gateIssueCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(', ')}`);
}
console.log(`Critic calls            : ${critic.length}  (${C.grn}${criticPass} pass${C.rst} / ${C.red}${criticFail} fail${C.rst})`);
console.log(`  no-op passes          : ${C.dim}${criticPass} clean passes re-paying shared context (batching target)${C.rst}`);
console.log(`Repairs                 : ${repair.length}${unchangedRepairs > 0 ? `  ${C.ylw}(${unchangedRepairs} left the caption unchanged)${C.rst}` : ''}`);
console.log(`  via gate / via critic : ${repair.filter((r) => (r.detail as { triggeredBy?: string } | null)?.triggeredBy === 'gate').length} / ${repair.filter((r) => (r.detail as { triggeredBy?: string } | null)?.triggeredBy === 'critic').length}`);
console.log(`Catalogue rewrites      : ${catalogue.length}`);
if (churn.length > 0) {
  console.log(`\n${C.bold}Churn (≥2 repairs)${C.rst}:`);
  for (const c of churn.sort((a, b) => b.repairs - a.repairs)) {
    console.log(`  ${C.red}#${c.index} ${c.title}${C.rst} — ${c.repairs} repairs${c.oscillated ? ` ${C.red}⟳ OSCILLATED (failed critic ≥2×)${C.rst}` : ''}`);
  }
} else {
  console.log(`\nChurn (≥2 repairs)      : none`);
}

console.log(`\n${C.bold}── Cost attribution (loop only; excludes the generation call) ─────${C.rst}`);
console.log(`Critic    : ${String(critic.length).padStart(3)} calls  ${String(sumTok(critic)).padStart(7)} tok  ${pence(sumCost(critic))}`);
console.log(`Repair    : ${String(repair.length).padStart(3)} calls  ${String(sumTok(repair)).padStart(7)} tok  ${pence(sumCost(repair))}`);
console.log(`${C.bold}Loop total: ${String(critic.length + repair.length).padStart(3)} calls  ${String(sumTok([...critic, ...repair])).padStart(7)} tok  ${pence(loopCost)}${C.rst}`);
console.log(`${C.dim}(Generation call cost is in the audit ledger under action 'content-cycle:planning'.)${C.rst}\n`);

process.exit(0);
