/**
 * scope-eval-cli.ts — measure the MONTH_SCOPED/EVERGREEN decision against a tagged corpus.
 *
 *   pnpm --filter @sprigly/worker scope-eval                       # 5 runs per case
 *   pnpm --filter @sprigly/worker scope-eval --runs=20             # tighter
 *   pnpm --filter @sprigly/worker scope-eval --escalate            # re-run unstable cases at 20
 *   pnpm --filter @sprigly/worker scope-eval --out=baseline.json   # record, for diffing later
 *   pnpm --filter @sprigly/worker scope-eval --model=haiku
 *
 * ── Why this is not classify-check ───────────────────────────────────────────────
 *
 * classify-check runs each fixture ONCE and prints pass/fail. That is the right shape for
 * "does the model still recognise a series", where the answer is stable. It is the wrong
 * shape for the scope decision, where the answer is per-string noise: "more of the school run
 * stuff please" routes month_scoped 3 times in 3, and "more of the morning routine please" —
 * same shape, same topic class — routes evergreen 3 times in 3, each reproducible. A single
 * run cannot tell a fix from a re-roll, and a prompt change that merely moved that noise floor
 * would read as a fix.
 *
 * So this runs each case N times and reports the DISTRIBUTION, flags any case that is not
 * unanimous, and scores `real` and `constructed` cases separately.
 *
 * ── It will not print one number ─────────────────────────────────────────────────
 *
 * Deliberately. The corpus is part real client input and part our invention, and on the
 * evergreen side the discriminating cases are mostly ours. One aggregate would hide exactly
 * that, and would let a change be justified by cases written in anticipation of it. The
 * corpus README is printed above every run for the same reason.
 *
 * SPENDS BEDROCK — runs x cases classify calls, operator-invoked only, never wired to a job.
 * A 51-case pass at 5 runs is ~250 calls, about £1.25 at the ledger's observed 0.4933p per
 * classify call. Reads env from ../.env.local via the package.json script wrapper, same as
 * classify-check. Status chatter -> stderr; the report -> stdout.
 *
 * ── A LONG PASS CAN LOOK WEDGED. IT IS NOT ───────────────────────────────────────
 *
 * Recording the first baseline stalled twice, at ~110 and ~180 calls, and the commit that added
 * this file said the model client "sets no request timeout". THAT WAS WRONG, and the correction
 * belongs here because it is the note someone will read next time a pass goes quiet.
 *
 * `complete()` has been bounded since it was written — bedrock-client.ts wraps every send in an
 * AbortController at DEFAULT_TIMEOUT_MS (180s). What was actually observed is arithmetic, not a
 * hang: one stalled call costs 180s, this runner then retries a model_error twice, so a single
 * bad case sits silently for up to nine minutes. Both stalls were given one to two minutes
 * before being killed — inside the first window.
 *
 * So: a quiet pass is not necessarily a dead one. Watch the call count rather than the clock.
 * (The real gap the investigation did find was on the STREAMING path, which this runner never
 * touches, and it is fixed — stream initiation is now bounded too.)
 */
import pino from 'pino';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { classifyIntake, parseBeatSpec, parsePlanQuestion, resolveEmphasisIntent, type IntakeRouting } from '@sprigly/engine';

interface ResolvedExpect { kind: string; name?: string }
interface Expect {
  scope: 'month_scoped' | 'evergreen';
  kind?: string;
  reason?: string;
  /** Assert what a FIELD resolves to downstream, not what string it holds. See the corpus README. */
  resolves?: { emphasis?: ResolvedExpect };
}
interface Case {
  id: string;
  text: string;
  origin: 'real' | 'constructed';
  provenance: string;
  surface: 'reshape' | 'other';
  clause: string | null;
  expect: Expect | null;
  unscored?: string;
  why?: string;
  planMonth?: string;
}
interface Corpus { planMonth?: string; readme: string[]; pillars?: string[]; cases: Case[] }

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`) || args.some((a) => a.startsWith(`--${name}=`));

const here = dirname(fileURLToPath(import.meta.url));
const fixtureArg = args.find((a) => !a.startsWith('--') && a.endsWith('.json'));
const corpusPath = fixtureArg ? resolve(process.cwd(), fixtureArg) : resolve(here, 'scope-eval-corpus.json');

const RUNS = Number(flag('runs') ?? 5);
const ESCALATE_RUNS = 20;
const escalate = has('escalate');
const modelArg = flag('model');
const outPath = flag('out');
if (has('model') && !modelArg) { console.error('scope-eval: --model needs a value'); process.exit(1); }
if (!Number.isInteger(RUNS) || RUNS < 1) { console.error('scope-eval: --runs must be a positive integer'); process.exit(1); }
const modelOverride = modelArg ? { modelName: modelArg } : {};

const logger = pino({ name: 'scope-eval', level: 'warn' }, pino.destination(2));

let corpus: Corpus;
try {
  corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as Corpus;
} catch (err) {
  console.error(`scope-eval: could not read ${corpusPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const defaultMonth = corpus.planMonth ?? '2026-09';
/** The client's REAL configured pillars. Resolution against invented ones proves nothing, so a
 *  corpus that asserts `resolves` without supplying them is a corpus error, not a soft default. */
const pillars = corpus.pillars ?? [];
if (!pillars.length && corpus.cases.some((c) => c.expect?.resolves)) {
  console.error('scope-eval: corpus asserts `resolves` but supplies no `pillars`');
  process.exit(1);
}
const model = createModelClientFromEnv();

/**
 * The routing collapsed to one comparable string.
 *
 * An emphasis carries its RESOLUTION as well, because scope and kind were never the interesting
 * part of an emphasis and reading a pass rate could not tell you the month had not moved. It is
 * appended after an arrow so a reader — and `compare.py` — can still see the routing alone.
 */
function verdictOf(r: IntakeRouting): string {
  if (r.scope === 'evergreen') return `evergreen/${r.reason}`;
  if (r.scope === 'question') return `question/${r.kind}`;
  if (r.intent.kind === 'emphasis' && pillars.length) {
    const t = resolveEmphasisIntent(r.intent, pillars).target;
    return `month_scoped/emphasis→${t.kind}${'name' in t ? ':' + t.name : ''}`;
  }
  return `month_scoped/${r.intent.kind}`;
}

/**
 * Does one routing satisfy the case's expectation?
 *
 * `reason` is asserted when the case names one — the honest-failure distinction is a thing this
 * corpus measures, not a detail.
 *
 * `resolves` asserts a FIELD'S VALUE, and does it through the function production calls rather
 * than against a literal. The model paraphrases freely — 'increase reels', 'increase reels
 * content' and 'increase reels this month' are one answer in three wordings — so pinning a
 * string would fail on wording and pass on meaning, which is exactly backwards. What has to hold
 * is what the phrase resolves to, and `resolveEmphasisIntent` is a pure function of the phrase
 * and the pillar list. Asserting through it is why the corpus can now see a field that satisfies
 * its schema and carries nothing.
 */
function satisfies(r: IntakeRouting, e: Expect): boolean {
  if (r.scope !== e.scope) return false;
  if (e.kind !== undefined && !(r.scope === 'month_scoped' && r.intent.kind === e.kind)) return false;
  if (e.reason !== undefined && !(r.scope === 'evergreen' && r.reason === e.reason)) return false;

  const want = e.resolves?.emphasis;
  if (want !== undefined) {
    if (r.scope !== 'month_scoped') return false;
    const got = resolveEmphasisIntent(r.intent, pillars).target;
    if (got.kind !== want.kind) return false;
    if (want.name !== undefined && !('name' in got && got.name === want.name)) return false;
  }
  return true;
}

interface Result {
  id: string; text: string; origin: Case['origin']; surface: Case['surface']; clause: string | null;
  expect: Expect | null; unscored?: string;
  runs: number; tally: Record<string, number>;
  hits: number;              // runs satisfying `expect` (0 when unscored)
  errors: number;            // runs that failed the model call after retries — NOT verdicts
  unanimous: boolean;
  preParsed: boolean;        // parseBeatSpec claimed it — no model call
  gateClaimed: boolean;      // parsePlanQuestion claimed it — no model call
}

const results: Result[] = [];
let calls = 0;

async function measure(c: Case, runs: number): Promise<Result> {
  const planMonth = c.planMonth ?? defaultMonth;
  const preParsed = parseBeatSpec(c.text, planMonth) !== null;
  const gateClaimed = parsePlanQuestion(c.text) !== null;
  const tally: Record<string, number> = {};
  let hits = 0;
  let errors = 0;

  // A deterministic pre-parse or gate claim cannot vary between runs, so one call is the whole
  // answer and N of them would be N times the spend for the same row. Reported as N/N so the
  // column still reads the same as every other case.
  const deterministic = preParsed || gateClaimed;
  const iterations = deterministic ? 1 : runs;

  for (let n = 0; n < iterations; n++) {
    // A model_error is Bedrock being unreachable, NOT a classification — the run did not
    // happen. Counting it as a verdict is how the first baseline came back with two cases
    // "unstable" on the strength of one transient failure each, which is precisely the
    // instability signal this corpus exists to keep clean. So it is retried, and only a
    // run that fails every attempt is recorded — as an error, outside the distribution.
    let r = await classifyIntake({ text: c.text, planMonth, model, logger, ...modelOverride });
    if (!deterministic) calls++;
    for (let attempt = 0; attempt < 2 && r.scope === 'evergreen' && r.reason === 'model_error'; attempt++) {
      r = await classifyIntake({ text: c.text, planMonth, model, logger, ...modelOverride });
      if (!deterministic) calls++;
    }
    if (r.scope === 'evergreen' && r.reason === 'model_error') { errors += deterministic ? runs : 1; continue; }

    const v = verdictOf(r);
    tally[v] = (tally[v] ?? 0) + (deterministic ? runs : 1);
    if (c.expect && satisfies(r, c.expect)) hits += deterministic ? runs : 1;
  }

  return {
    id: c.id, text: c.text, origin: c.origin, surface: c.surface, clause: c.clause,
    expect: c.expect, ...(c.unscored ? { unscored: c.unscored } : {}),
    runs, tally, hits, errors,
    unanimous: Object.keys(tally).length === 1, preParsed, gateClaimed,
  };
}

// ── Run ──────────────────────────────────────────────────────────────────────────
console.log(corpus.readme.join('\n'));
console.log(`\n${'─'.repeat(96)}`);
console.log(`planMonth ${defaultMonth} · ${RUNS} runs per case · model ${modelArg ?? 'sonnet (default)'} · corpus ${corpusPath}`);
console.log(`${'─'.repeat(96)}`);

for (const c of corpus.cases) {
  process.stderr.write(`  ${c.id}\n`);
  results.push(await measure(c, RUNS));
}

/**
 * Escalation ADDS runs; it does not replace them.
 *
 * Replacing was the first version and it was wrong in the one way that matters here: a case
 * that came back 4/5 and then 20/20 would be recorded as unanimous, and the wobble that caused
 * the escalation in the first place would vanish from the record. The whole reason this corpus
 * measures distributions is that a verdict which moves 20% of the time is the hardest thing to
 * tell from a fix. So the tallies are summed and the case is reported over all 25 runs.
 */
function merge(a: Result, b: Result): Result {
  const tally = { ...a.tally };
  for (const [k, v] of Object.entries(b.tally)) tally[k] = (tally[k] ?? 0) + v;
  return { ...a, runs: a.runs + b.runs, hits: a.hits + b.hits, errors: a.errors + b.errors, tally,
           unanimous: Object.keys(tally).length === 1 };
}

if (escalate) {
  const unstable = results.filter((r) => !r.unanimous && !r.preParsed && !r.gateClaimed);
  if (unstable.length) {
    console.log(`\n── escalating ${unstable.length} non-unanimous case(s) by ${ESCALATE_RUNS} further runs`);
    for (const u of unstable) {
      const c = corpus.cases.find((x) => x.id === u.id)!;
      process.stderr.write(`  ${c.id} (escalate)\n`);
      results[results.indexOf(u)] = merge(u, await measure(c, ESCALATE_RUNS));
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────
const dist = (r: Result) =>
  Object.entries(r.tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}/${r.runs}`).join(' · ');

function section(title: string, rows: Result[], scored: boolean) {
  console.log(`\n\n══ ${title} — ${rows.length} case(s)`);
  for (const r of rows) {
    const mark = !scored ? '  ·' : r.hits === r.runs - r.errors ? '  ✓' : r.hits === 0 ? '  ✗' : '  ~';
    const wr = r.expect?.resolves?.emphasis;
    const want = r.expect
      ? `${r.expect.scope}${r.expect.kind ? `/${r.expect.kind}` : ''}${r.expect.reason ? ` reason=${r.expect.reason}` : ''}`
        + (wr ? ` resolves=${wr.kind}${wr.name ? ':' + wr.name : ''}` : '')
      : '—';
    const tag = r.preParsed ? ' [pre-parse]' : r.gateClaimed ? ' [question gate]' : '';
    console.log(`${mark} ${r.id}${tag}`);
    console.log(`     ${JSON.stringify(r.text).slice(0, 108)}`);
    const err = r.errors ? `  [${r.errors} model_error, retried and excluded]` : '';
    console.log(`     want ${want.padEnd(34)} got ${dist(r)}${scored ? `   (${r.hits}/${r.runs - r.errors})` : ''}${err}`);
    if (r.unscored) console.log(`     UNSCORED: ${r.unscored.slice(0, 400)}`);
  }
}

const scoredReal = results.filter((r) => r.expect && r.origin === 'real');
const scoredCx   = results.filter((r) => r.expect && r.origin === 'constructed');
const unscored   = results.filter((r) => !r.expect);

section('REAL — traceable to client input', scoredReal, true);
section('CONSTRUCTED — written by us; cannot on its own justify a change', scoredCx, true);
section('UNSCORED — findings, asserting nothing', unscored, false);

const unstable = results.filter((r) => !r.unanimous);
console.log(`\n\n══ NOT UNANIMOUS — ${unstable.length} case(s)`);
if (!unstable.length) console.log('  none — every case returned one verdict on every run');
for (const r of unstable) console.log(`  ${r.id.padEnd(44)} ${dist(r)}`);

const line = (label: string, rows: Result[]) => {
  const full = rows.filter((r) => r.hits === r.runs - r.errors).length;
  const none = rows.filter((r) => r.hits === 0).length;
  console.log(`  ${label.padEnd(14)} ${full} of ${rows.length} unanimous-correct · ${none} never correct · ${rows.length - full - none} partial`);
};
console.log(`\n\n══ SCORE — reported separately, on purpose`);
line('real', scoredReal);
line('constructed', scoredCx);
console.log(`  unscored       ${unscored.length} case(s) — behaviour recorded, no pass/fail`);
console.log(`\n  There is deliberately NO combined figure. The evergreen side of this corpus is`);
console.log(`  mostly our invention (see the README above); one number would hide that, and would`);
console.log(`  let a change be justified by cases written in anticipation of it.`);
console.log(`\n  ${calls} Bedrock classify calls this pass.`);

if (outPath) {
  const path = resolve(process.cwd(), outPath);
  await writeFile(path, JSON.stringify({
    corpus: corpusPath, planMonth: defaultMonth, runs: RUNS,
    model: modelArg ?? 'sonnet (default)', calls,
    results: results.map(({ id, origin, surface, expect, tally, hits, runs, errors, unanimous, preParsed, gateClaimed }) =>
      ({ id, origin, surface, expect, tally, hits, runs, errors, unanimous, preParsed, gateClaimed })),
  }, null, 2) + '\n', 'utf8');
  console.log(`\n  recorded to ${path}`);
}

// Always exits 0. This is a measurement, not a gate: at HEAD the corpus is EXPECTED to fail
// on the cases it was built to measure, and a red exit would train someone to ignore it.
process.exit(0);
