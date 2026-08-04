/**
 * classify-check-cli.ts — run the REAL intake classifier over a fixture of sentences and print
 * intent kind + extracted fields against what each one is expected to be.
 *
 *   pnpm --filter @sprigly/worker classify-check
 *   pnpm --filter @sprigly/worker classify-check path/to/other-fixtures.json
 *   pnpm --filter @sprigly/worker classify-check --model=haiku
 *
 * --model=<logical|physical> runs the fixture against a DIFFERENT tier than production's. The
 * classifier defaults to sonnet (`ClassifyParams.modelName`), and the question of whether haiku
 * could do this job has so far been answered by argument rather than evidence. This flag makes
 * it answerable: run the fixture on both, compare pass counts, and let the fixtures decide.
 *
 * IT CHANGES NOTHING BUT THIS RUN. The flag is read here and passed per call; no default moves,
 * and production keeps classifying on sonnet until someone changes the default deliberately.
 *
 * Why this exists: the series fix (and now beat_spec and cadence) shipped with the classifier's
 * recognition ARGUED in a report, not DEMONSTRATED — every transform test feeds a
 * correctly-classified intent, so whether the live model returns the right `kind` for real text
 * was never pinned (docs/reports/rehearsal-fixes.md, "Live-classifier check — NOT done"). This
 * closes that gap permanently and cheaply: one deliberate pass over the fixture, operator-run.
 *
 * SPENDS BEDROCK. Every non-pre-parsed case is one classify call against the configured model
 * — so this is operator-invoked only, never wired into a job or a test. Date-leading beat_spec
 * rows are caught by the deterministic pre-parse and cost nothing; the harness marks those.
 *
 * Reads env from ../.env.local via the package.json script wrapper, same as draft-assemble.
 * Status chatter → stderr; the result table → stdout.
 */
import pino from 'pino';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { classifyIntake, parseBeatSpec, decomposeInput, isDocumentShaped, type IntakeRouting } from '@sprigly/engine';

interface FixtureCase {
  label?: string;
  text: string;
  planMonth?: string;
  /** Classify this case WITH the brief framing (as a decomposed segment would be). */
  decomposeContext?: boolean;
  /** kindOneOf pins "any of these kinds is correct" — e.g. event OR beat_spec for a fully
   *  specified single post — without a single-value kind forcing a false fail. */
  expect: { scope: 'month_scoped' | 'evergreen'; kind?: string; kindOneOf?: string[]; has?: string[] };
}
interface BriefCase { label?: string; text: string; planMonth?: string }
interface Fixture { planMonth?: string; cases: FixtureCase[]; briefs?: BriefCase[] }

const args = process.argv.slice(2);
const fixtureArg = args.find((a) => !a.startsWith('--'));
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = fixtureArg ? resolve(process.cwd(), fixtureArg) : resolve(here, 'classify-check-fixtures.json');

/**
 * The tier under test. `--model=haiku` / `--model haiku`; omitted means the production default,
 * which is whatever `classifyIntake` and `decomposeInput` choose for themselves (sonnet) — so an
 * un-flagged run is byte-identical to what it always was, including the prompt.
 *
 * Passed through as `modelName`, which the resolver maps to a physical id, so a full Bedrock
 * inference-profile id works here too when a specific snapshot needs pinning.
 */
const modelFlagIdx = args.findIndex((a) => a === '--model');
const modelEqArg = args.find((a) => a.startsWith('--model='))?.slice('--model='.length);
const modelArg = modelEqArg ?? (modelFlagIdx >= 0 ? args[modelFlagIdx + 1] : undefined);
// A flag that was TYPED but carries no usable value is an error, not a silent fall-back to the
// default. Someone writing `--model` meant to test another tier; running sonnet anyway and
// reporting a pass would be the exact "tier faith" this flag exists to replace.
const modelFlagTyped = modelEqArg !== undefined || modelFlagIdx >= 0;
if (modelFlagTyped && (!modelArg || modelArg.startsWith('--'))) {
  console.error('classify-check: --model needs a value, e.g. --model=haiku');
  process.exit(1);
}
/** Spread into each call so an absent flag leaves the call site EXACTLY as it was. */
const modelOverride = modelArg ? { modelName: modelArg } : {};

const logger = pino({ name: 'classify-check', level: 'warn' }, pino.destination(2));

let fixture: Fixture;
try {
  fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;
} catch (err) {
  console.error(`classify-check: could not read fixture ${fixturePath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  console.error(`classify-check: fixture ${fixturePath} has no cases`);
  process.exit(1);
}

const defaultMonth = fixture.planMonth ?? '2026-08';
const model = createModelClientFromEnv();

/** The month-scoped fields worth showing, extracted from a routing for eyeballing. */
function fieldsOf(routing: IntakeRouting): string {
  if (routing.scope === 'evergreen') return `reason=${routing.reason}`;
  // A question is decided before the model is asked, so it has no intent fields to show — only
  // which answerer it went to (intake-classify.ts, `parsePlanQuestion`).
  if (routing.scope === 'question') return `question=${routing.kind}`;
  const i = routing.intent as Record<string, unknown>;
  const parts: string[] = [];
  const show = (k: string, v: unknown) => { if (v !== null && v !== undefined) parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`); };
  show('subject', typeof i['subject'] === 'string' ? `"${(i['subject'] as string).slice(0, 40)}"` : undefined);
  show('dateRange', i['dateRange']);
  if (Array.isArray(i['instances'])) parts.push(`instances=${(i['instances'] as unknown[]).length}`);
  show('recurrence', i['recurrence']);
  show('format', i['format']);
  show('postsPerWeek', i['postsPerWeek']);
  show('postsPerMonth', i['postsPerMonth']);
  show('correctionOf', i['correctionOf']);
  show('emphasis', i['emphasis']);
  show('beatRef', i['beatRef']);
  return parts.join(' ');
}

/** Does the routing carry a non-null value for every field the fixture said to expect? */
function missingExpectedFields(routing: IntakeRouting, has: string[] | undefined): string[] {
  if (!has || routing.scope !== 'month_scoped') return [];
  const i = routing.intent as Record<string, unknown>;
  return has.filter((f) => i[f] === null || i[f] === undefined || (Array.isArray(i[f]) && (i[f] as unknown[]).length === 0));
}

let pass = 0, fail = 0, spent = 0, preParsed = 0;
const lines: string[] = [];

for (const c of fixture.cases) {
  const planMonth = c.planMonth ?? defaultMonth;
  const wasPreParsed = parseBeatSpec(c.text, planMonth) !== null;
  if (wasPreParsed) preParsed++; else spent++;

  const routing = await classifyIntake({ text: c.text, planMonth, model, logger, ...modelOverride,
    ...(c.decomposeContext ? { context: 'brief_segment' as const } : {}) });

  const actualScope = routing.scope;
  const actualKind = routing.scope === 'month_scoped' ? routing.intent.kind : null;

  const scopeOk = actualScope === c.expect.scope;
  const kindOk = c.expect.kindOneOf
    ? actualKind !== null && c.expect.kindOneOf.includes(actualKind)
    : c.expect.kind === undefined || actualKind === c.expect.kind;
  const missing = missingExpectedFields(routing, c.expect.has);
  const ok = scopeOk && kindOk && missing.length === 0;
  ok ? pass++ : fail++;

  const expectedKind = c.expect.kindOneOf ? `(${c.expect.kindOneOf.join('|')})` : (c.expect.kind ?? '(any)');
  const expected = c.expect.scope === 'evergreen' ? 'evergreen' : `month_scoped/${expectedKind}`;
  const actual = actualScope === 'evergreen' ? 'evergreen' : `month_scoped/${actualKind}`;
  const tag = wasPreParsed ? '[pre-parse] ' : c.decomposeContext ? '[brief]     ' : '[model]     ';
  lines.push(
    `${ok ? '  PASS' : '✗ FAIL'}  ${tag} ${(c.label ?? c.text).slice(0, 56).padEnd(56)}` +
    `\n          expect: ${expected}` +
    `\n          actual: ${actual}   ${fieldsOf(routing)}` +
    (missing.length > 0 ? `\n          MISSING expected field(s): ${missing.join(', ')}` : ''),
  );
}

console.log(lines.join('\n\n'));
console.log(`\n${pass}/${pass + fail} passed  ·  ${spent} classify calls (Bedrock), ${preParsed} pre-parsed (no spend)  ·  model: ${modelArg ?? 'sonnet (default)'}  ·  fixture: ${fixturePath}`);

// ── decompose-check: run the REAL decomposer over each full brief, print segments + kinds ────
// The operator live-verifies decomposition the same way they verify classification. Each brief
// is one decompose call plus one classify call per segment — deliberate Bedrock spend.
let decomposeSpent = 0;
for (const b of fixture.briefs ?? []) {
  const planMonth = b.planMonth ?? defaultMonth;
  console.log(`\n\n=== DECOMPOSE: ${b.label ?? b.text.slice(0, 48)} ===`);
  console.log(`document-shaped: ${isDocumentShaped(b.text)}`);
  const decomposition = await decomposeInput({ text: b.text, model, logger, ...modelOverride });
  decomposeSpent++;
  if (!decomposition) {
    console.log('  decomposition FAILED the coverage contract (would fall back to the whole-input path)');
    continue;
  }
  console.log(`  ${decomposition.segments.length} segments, ${decomposition.discarded.length} discarded:`);
  for (const [n, seg] of decomposition.segments.entries()) {
    // Classify WITH the brief framing — exactly as the production decompose path does.
    const routing = await classifyIntake({ text: seg, planMonth, model, logger, ...modelOverride, context: 'brief_segment' });
    decomposeSpent++;
    const kind = routing.scope === 'evergreen' ? `evergreen(${routing.reason})`
      : routing.scope === 'question' ? `question/${routing.kind}`
      : `month_scoped/${routing.intent.kind}`;
    console.log(`   ${String(n + 1).padStart(2)}. [${kind}]  ${seg.slice(0, 80)}`);
  }
}
if ((fixture.briefs ?? []).length > 0) {
  console.log(`\n${decomposeSpent} decompose+classify calls (Bedrock) across ${(fixture.briefs ?? []).length} brief(s) on ${modelArg ?? 'sonnet (default)'}.`);
}

process.exit(fail > 0 ? 1 : 0);
