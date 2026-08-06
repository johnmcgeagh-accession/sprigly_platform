/**
 * query-eval-cli.mts — measure the QUERY ANSWERER against a tagged corpus of client questions.
 *
 *   pnpm --filter @sprigly/app query-eval                       # 5 runs per question
 *   pnpm --filter @sprigly/app query-eval --runs=1              # one pass, cheap
 *   pnpm --filter @sprigly/app query-eval --escalate            # re-run unstable questions
 *   pnpm --filter @sprigly/app query-eval --group=facts         # one group only
 *   pnpm --filter @sprigly/app query-eval --cycle=<uuid> --today=2026-08-05
 *   pnpm --filter @sprigly/app query-eval --out=baseline.json   # record, for diffing later
 *   pnpm --filter @sprigly/app query-eval --model=sonnet
 *
 * ── Why this exists, and what it does that the app cannot ────────────────────────────
 *
 * Every defect found in the answerer this week was found by typing into the app. That is slow
 * and it is SINGLE-SHOT, and single-shot cannot see the failure mode that produced most of them:
 * an answer that MOVES. September was asked for and came back 27, then 15, then 26, then 30,
 * then 28, for a month that had not changed between any two of those turns. A browser gives you
 * one of those five numbers and no way to tell which.
 *
 * So this is scope-eval-cli's shape applied to the answerer — same flags, same distribution-first
 * reporting, same refusal to collapse a mixed corpus into one figure — with two differences that
 * the answerer forces:
 *
 *   1. IT ASSERTS WHERE AN ASSERTION EXISTS. Since plan-facts.ts, a count, a set of empty dates,
 *      a per-pillar or per-format tally and a week's contents all have one deterministic right
 *      answer. Those are DERIVED HERE from the database — never written into the corpus, which
 *      would be stale the first time somebody adds a post to September — and checked. Register
 *      and phrasing have no such answer, and those cases assert nothing and are printed to read.
 *
 *   2. IT REPORTS STABILITY SEPARATELY FROM CORRECTNESS. A case can be right 5/5 and still be
 *      reported as unstable, because "right five times in five different wordings carrying five
 *      different numbers" is the thing that was actually broken.
 *
 * ── The direct call, and why it is legitimate ────────────────────────────────────────
 *
 * `answerQuery` takes a built `PlanContext` and needs nothing else from the turn loop: it is the
 * whole of what a query turn does after the parser has routed to `query`. `turn.ts:656` passes it
 * `{ clientId, cycleId, question, today, context: planCtx }` and the deps, and that is exactly
 * what this passes. So the harness exercises production's answerer over production's context —
 * not a re-implementation of either. `plan-facts-check.mts` established the pattern; this
 * generalises it to a corpus.
 *
 * ── Runs under vite-node, not tsx ────────────────────────────────────────────────────
 *
 * Same reason as its two neighbours in this directory: the app package is CommonJS while
 * @sprigly/model-client is ESM-only, and only vite's resolution lets a script under app/ import
 * the REAL context builder and the REAL answerer. It lives in scripts/, so Vitest never collects
 * it and CI never spends.
 *
 * READ-ONLY. It writes no posts, no proposals and no approvals. It writes no ledger rows either
 * unless --audit is passed: a diagnostic that put synthetic spend into the table the real spend is
 * read from, every time it ran, would corrupt the thing it is meant to help you read.
 *
 * SPENDS BEDROCK — one Haiku answer and one Titan embed per run, so a 19-case pass at 5 runs is
 * ~190 calls. Pennies, but operator-invoked only and never wired to a job.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { db, contentCycles, contentCyclePosts, POST_STATUS_DRAFT } from '@sprigly/db';
import { createModelClientFromEnv, type ModelClient, type ModelCompleteParams } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { createAuditLogger } from '@sprigly/audit';
import { buildPlanContext, type PlanContext } from '../src/lib/agent/plan-context';
import { answerQuery, type QueryAnswer } from '../src/lib/agent/query';
import { monthFacts, type DatedItem } from '../src/lib/agent/plan-facts';
import { monthLabel } from '../src/lib/agent/cycle-state';
import { weekWindows } from '../src/lib/agent/weeks';

// ── Corpus shape ─────────────────────────────────────────────────────────────────────

type Assertion =
  | { kind: 'count';        months: string[] }
  | { kind: 'empty';        month: string }
  | { kind: 'doubled';      month: string }
  | { kind: 'tally';        month: string; field: 'pillar' | 'format' }
  | { kind: 'week';         which: 'this' | 'next' }
  | { kind: 'outcome';      value: 'answered' | 'declined' }
  | { kind: 'months-named' };

interface Case {
  id: string;
  text: string;
  /** Overrides the corpus `today` for this question alone — see the boundary group. */
  today?: string;
  assert?: Assertion | null;
  note?: string;
  /** Known-failing today, and why. Scored, but reported apart from real failures. */
  knownFail?: string;
}
interface Group { id: string; title: string; note?: string; cases: Case[] }
interface Corpus { cycle?: string; today?: string; readme: string[]; groups: Group[] }

// ── Flags — scope-eval-cli's, plus the three this needs ──────────────────────────────

/**
 * THE REPORT GOES TO STDOUT; EVERYTHING ELSE GOES TO STDERR.
 *
 * scope-eval-cli's convention, and here it takes an override rather than a logger argument.
 * `bedrock-client.ts` narrates every call — model, tokens, and the first thousand characters of
 * the reply — through `console.info`, which is stdout. On a 19-question pass that is a hundred
 * lines of chatter interleaved with the report, and it made `> report.txt` useless.
 *
 * Only the two levels the client actually uses are moved, and only inside this process: the
 * shared package is untouched, so nothing about how production logs changes. The chatter is not
 * suppressed either — it is genuinely useful when a pass goes quiet — it is just on the stream
 * that is for it. `console.log` is left alone; the report is the only thing that uses it.
 */
for (const level of ['info', 'warn', 'debug'] as const) {
  console[level] = (...parts: unknown[]) =>
    process.stderr.write(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ') + '\n');
}

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
const corpusPath = fixtureArg ? resolve(process.cwd(), fixtureArg) : resolve(here, 'query-eval-corpus.json');

const RUNS = Number(flag('runs') ?? 5);
/**
 * Escalation is TEN further runs, not scope-eval's twenty.
 *
 * Not a preference: a run there is one classify call, and a run here is a Haiku answer plus a
 * Titan embed over a ~5,000-token prompt. Ten is enough to tell a 1-in-5 wobble from a fix, and
 * twenty of these on a corpus with several unstable cases is a materially different bill.
 */
const ESCALATE_RUNS = 10;
const escalate  = has('escalate');
const modelArg  = flag('model');
const outPath   = flag('out');
const groupOnly = flag('group');
/**
 * `--audit` writes the cost-ledger rows a real query turn would write.
 *
 * OFF by default, and this is the same decision plan-facts-check.mts made for the same reason: a
 * diagnostic run twenty times while somebody iterates on a prompt would put twenty turns of
 * synthetic spend into the table the real spend is read from. Switch it on deliberately — it is
 * the only path by which `cacheReadTokens` reaches `audit_log`, so verifying that the answerer's
 * prompt cache still works needs it.
 */
const WRITE_AUDIT = has('audit');

if (has('model') && !modelArg)  { console.error('query-eval: --model needs a value');  process.exit(1); }
if (has('group') && !groupOnly) { console.error('query-eval: --group needs a value');  process.exit(1); }
if (!Number.isInteger(RUNS) || RUNS < 1) { console.error('query-eval: --runs must be a positive integer'); process.exit(1); }

let corpus: Corpus;
try {
  corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as Corpus;
} catch (err) {
  console.error(`query-eval: could not read ${corpusPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const CYCLE = flag('cycle') ?? corpus.cycle;
const TODAY = flag('today') ?? corpus.today ?? '2026-08-05';
if (!CYCLE) { console.error('query-eval: no cycle — pass --cycle=<uuid> or set `cycle` in the corpus'); process.exit(1); }

const groups = groupOnly ? corpus.groups.filter((g) => g.id === groupOnly) : corpus.groups;
if (!groups.length) {
  console.error(`query-eval: no group '${groupOnly}' — have ${corpus.groups.map((g) => g.id).join(', ')}`);
  process.exit(1);
}

// ── The client, and the rows the expected values are derived from ────────────────────

const [cycleRow] = await db
  .select({ clientId: contentCycles.clientId, month: contentCycles.cycleMonth })
  .from(contentCycles)
  .where(eq(contentCycles.id, CYCLE))
  .limit(1);
if (!cycleRow) { console.error(`query-eval: no cycle ${CYCLE}`); process.exit(1); }
const clientId = cycleRow.clientId;

/**
 * THE GROUND TRUTH — ONE QUERY, KEYED ON THE DATE.
 *
 * Deliberately not routed through `loadPlanPosts` / `loadDraftBeats`. Those are how the ANSWERER
 * gets its numbers: cycle-keyed, draft-fenced, checklist-folded. Deriving the expected values the
 * same way would make this harness agree with the context builder by construction, and a harness
 * that cannot disagree with the thing it is checking can only ever confirm it.
 *
 * So this reads the rows themselves, filtered on nothing but ownership and not-deleted, and
 * buckets them BY SCHEDULED DATE — which is the rule the client's own calendar uses. The two
 * accounts are then compared before anything is asserted (see the DIVERGENCE block below).
 *
 * `status = 'draft'` splits planned slots from written posts. That is the same predicate
 * `excludeDraftPosts()` is built on, and it is the one distinction the answers turn on: a draft
 * month's content is real and countable, and it has no captions.
 */
interface Row extends DatedItem { status: string }
const rows: Row[] = (await db
  .select({
    date:   contentCyclePosts.scheduledDate,
    format: contentCyclePosts.format,
    pillar: contentCyclePosts.pillar,
    status: contentCyclePosts.status,
  })
  .from(contentCyclePosts)
  .where(and(eq(contentCyclePosts.clientId, clientId), isNull(contentCyclePosts.deletedAt))))
  .map((r) => ({ ...r, status: r.status ?? '' }));

const liveIn    = (m: string) => rows.filter((r) => r.date.slice(0, 7) === m);
const writtenIn = (m: string) => liveIn(m).filter((r) => r.status !== POST_STATUS_DRAFT);
const plannedIn = (m: string) => liveIn(m).filter((r) => r.status === POST_STATUS_DRAFT);

// ── The contexts, one per distinct `today` in play ───────────────────────────────────

const todays = [...new Set([TODAY, ...groups.flatMap((g) => g.cases.map((c) => c.today ?? TODAY))])].sort();
const contexts = new Map<string, PlanContext>();
for (const t of todays) contexts.set(t, await buildPlanContext(clientId, CYCLE, t));

// ── Matching ─────────────────────────────────────────────────────────────────────────

/** Small numbers as clients and models write them. Above twenty a count is always digits. */
const NUMBER_WORDS: Record<number, string[]> = {
  0: ['zero', 'none', 'no'], 1: ['one'], 2: ['two'], 3: ['three'], 4: ['four'], 5: ['five'],
  6: ['six'], 7: ['seven'], 8: ['eight'], 9: ['nine'], 10: ['ten'], 11: ['eleven'], 12: ['twelve'],
  13: ['thirteen'], 14: ['fourteen'], 15: ['fifteen'], 16: ['sixteen'], 17: ['seventeen'],
  18: ['eighteen'], 19: ['nineteen'], 20: ['twenty'],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is `n` stated in this text? Digits, not as part of a longer number; or the English word. */
function hasNumber(text: string, n: number): boolean {
  if (new RegExp(`(?<!\\d)${n}(?!\\d)`).test(text)) return true;
  return (NUMBER_WORDS[n] ?? []).some((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
}

/**
 * Is this date named? ISO, ordinal, or day-and-month either way round.
 *
 * THE BARE ORDINAL DOES NOT CHECK THE MONTH, and that leak is deliberate rather than overlooked:
 * with two months in view, "the 18th" is how a client and a model both refer to a date, and
 * requiring "18 September" would fail correct answers far more often than the leniency passes
 * wrong ones. Every answer is printed, so a lenient pass is still readable.
 */
function hasDate(text: string, iso: string): boolean {
  if (text.includes(iso)) return true;
  const day = Number(iso.slice(8, 10));
  const name = monthLabel(iso.slice(0, 7)).split(' ')[0] ?? '';
  const mon = `${esc(name)}|${esc(name.slice(0, 3))}`;
  return new RegExp(`\\b${day}(?:st|nd|rd|th)\\b`, 'i').test(text)
      || new RegExp(`\\b${day}\\s+(?:${mon})`, 'i').test(text)
      || new RegExp(`\\b(?:${mon})\\.?\\s+${day}(?!\\d)`, 'i').test(text);
}

/**
 * Is "<key>: <n>" stated, however it is laid out?
 *
 * A tally answer is usually one line per key, so the search is per line — with a sixty-character
 * window around the key when the answer came back as prose on one long line. Trailing 's' is
 * optional because "8 carousels" and "carousel: 8" are the same answer.
 */
function hasPair(text: string, key: string, n: number): boolean {
  const keyRe = new RegExp(`${esc(key)}s?`, 'gi');
  for (const line of text.split('\n')) {
    keyRe.lastIndex = 0;
    for (let m = keyRe.exec(line); m; m = keyRe.exec(line)) {
      const from = Math.max(0, m.index - 60);
      const to = Math.min(line.length, m.index + m[0].length + 60);
      if (hasNumber(line.slice(from, to), n)) return true;
    }
  }
  return false;
}

/** Every number the answer states, ascending and deduplicated — the stability fingerprint. */
function figuresIn(text: string): number[] {
  return [...new Set([...text.matchAll(/\d+/g)].map((m) => Number(m[0])))].sort((a, b) => a - b);
}

// ── Expectations, DERIVED — never read off the corpus ────────────────────────────────

interface Expectation {
  /** What the report prints as `want`. */
  want: string;
  check(res: QueryAnswer): { ok: boolean; detail: string };
}

function expectationFor(c: Case): Expectation | null {
  const a = c.assert;
  if (!a) return null;
  const ctx = contexts.get(c.today ?? TODAY)!;

  switch (a.kind) {
    case 'count': {
      const total   = a.months.flatMap(liveIn).length;
      const written = a.months.flatMap(writtenIn).length;
      const planned = a.months.flatMap(plannedIn).length;
      const parts = ([['written', written], ['planned', planned]] as const).filter(([, n]) => n > 0);
      const partStr = parts.map(([l, n]) => `${n} ${l}`).join(' + ');
      return {
        want: `${total} in ${a.months.join(' + ')}${parts.length > 1 ? ` (${partStr})` : ''}`,
        check: (res) => {
          // Either the true total, or — where the plan state carries no single number for it —
          // both component figures stated. Never the written-only total on its own: that is the
          // combined-total line being quoted for a question it does not answer.
          if (hasNumber(res.text, total)) return { ok: true, detail: `states ${total}` };
          if (parts.length > 1 && parts.every(([, n]) => hasNumber(res.text, n))) {
            return { ok: true, detail: `states ${partStr} separately` };
          }
          const near = parts.filter(([, n]) => hasNumber(res.text, n)).map(([l, n]) => `${n} (${l})`);
          return { ok: false, detail: `${total} not stated${near.length ? `; found ${near.join(', ')}` : ''}` };
        },
      };
    }

    case 'empty': {
      const f = monthFacts(a.month, liveIn(a.month));
      const subtraction = f.days - f.total;      // the wrong answer this question has produced
      return {
        want: `${f.empty.length} empty in ${a.month}: ${f.empty.map((d) => d.slice(8)).join(', ') || '—'}`,
        check: (res) => {
          if (hasNumber(res.text, f.empty.length)) return { ok: true, detail: `states ${f.empty.length}` };
          const subtracted = subtraction !== f.empty.length && hasNumber(res.text, subtraction);
          return {
            ok: false,
            detail: `${f.empty.length} not stated`
              + (subtracted ? `; states ${subtraction}, which is days − posts — the subtraction that ignores doubled dates` : ''),
          };
        },
      };
    }

    case 'doubled': {
      const f = monthFacts(a.month, liveIn(a.month));
      if (!f.doubled.length) {
        return {
          want: `no doubled dates in ${a.month}`,
          check: (res) => {
            const named = f.occupied.filter((d) => hasDate(res.text, d));
            return named.length
              ? { ok: false, detail: `names ${named.map((d) => d.slice(8)).join(', ')} — there are none` }
              : { ok: true, detail: 'names no date' };
          },
        };
      }
      return {
        want: `${a.month}: ${f.doubled.map((d) => `${d.date.slice(8)}×${d.n}`).join(', ')}`,
        check: (res) => {
          const missed = f.doubled.filter((d) => !hasDate(res.text, d.date));
          return missed.length
            ? { ok: false, detail: `omits ${missed.map((d) => d.date.slice(8)).join(', ')}` }
            : { ok: true, detail: 'names every doubled date' };
        },
      };
    }

    case 'tally': {
      const f = monthFacts(a.month, liveIn(a.month));
      const t = a.field === 'pillar' ? f.byPillar : f.byFormat;
      return {
        want: `${a.month} by ${a.field}: ${t.map((x) => `${x.key} ${x.n}`).join(', ') || '—'}`,
        check: (res) => {
          const missed = t.filter((x) => !hasPair(res.text, x.key, x.n));
          return missed.length
            ? { ok: false, detail: `wrong or absent: ${missed.map((x) => `${x.key}=${x.n}`).join(', ')}` }
            : { ok: true, detail: `all ${t.length} pairs stated` };
        },
      };
    }

    case 'week': {
      const w = weekWindows(c.today ?? TODAY)[a.which === 'next' ? 'nextWeek' : 'thisWeek'];
      const inWin = rows.filter((r) => r.date >= w.from && r.date <= w.to).sort((x, y) => x.date.localeCompare(y.date));
      const dates = [...new Set(inWin.map((r) => r.date))];
      // Stated because it is the gap this case exists to find: bucketCycleState buckets WRITTEN
      // posts into its week lines, so a week straddling a draft month has planned posts the
      // state's own NEXT WEEK count does not include.
      const nPlanned = inWin.filter((r) => r.status === POST_STATUS_DRAFT).length;
      return {
        want: `${inWin.length} in ${w.from}..${w.to}${nPlanned ? ` (${nPlanned} planned)` : ''}: ${dates.map((d) => d.slice(5)).join(', ') || '—'}`,
        check: (res) => {
          if (!dates.length) {
            return { ok: true, detail: 'window is empty — nothing to name' };
          }
          const missed = dates.filter((d) => !hasDate(res.text, d));
          const counted = hasNumber(res.text, inWin.length);
          return missed.length
            ? { ok: false, detail: `omits ${missed.map((d) => d.slice(5)).join(', ')}${counted ? '' : `; and does not state ${inWin.length}`}` }
            : { ok: true, detail: `names every date${counted ? `, and states ${inWin.length}` : `, but does not state ${inWin.length}`}` };
        },
      };
    }

    case 'outcome':
      return {
        want: `outcome=${a.value}`,
        check: (res) => ({ ok: res.outcome === a.value, detail: `outcome=${res.outcome}` }),
      };

    case 'months-named': {
      const names = ctx.months.map((m) => monthLabel(m).split(' ')[0] ?? m);
      return {
        want: `names ${names.join(' and ')}`,
        check: (res) => {
          const missed = names.filter((n) => !new RegExp(`\\b${esc(n)}\\b`, 'i').test(res.text));
          return missed.length
            ? { ok: false, detail: `does not name ${missed.join(', ')}` }
            : { ok: true, detail: 'names every visible month' };
        },
      };
    }
  }
}

// ── Running ──────────────────────────────────────────────────────────────────────────

/** Rewrites the logical model name on the way through — `answerQuery` hardcodes AGENT_MODEL. */
function usingModel(inner: ModelClient, name: string): ModelClient {
  return {
    complete: (p: ModelCompleteParams) => inner.complete({ ...p, model: name }),
    completeStreaming: (p: ModelCompleteParams) => inner.completeStreaming({ ...p, model: name }),
  };
}

const baseModel = createModelClientFromEnv();
const model = modelArg ? usingModel(baseModel, modelArg) : baseModel;
const embeddingClient = createEmbeddingClientFromEnv();
const audit = WRITE_AUDIT ? createAuditLogger(db) : undefined;

interface Run { text: string; outcome: QueryAnswer['outcome']; ok: boolean; detail: string }
interface Result {
  id: string; group: string; text: string; today: string;
  want: string | null; note?: string; knownFail?: string;
  runs: Run[];
  /** Calls that threw every attempt — NOT answers, and outside every distribution below. */
  errors: number;
  hits: number;
}

let calls = 0;

async function measure(c: Case, group: string, n: number): Promise<Result> {
  const today = c.today ?? TODAY;
  const ctx = contexts.get(today)!;
  const expect = expectationFor(c);
  const runs: Run[] = [];
  let errors = 0;

  for (let i = 0; i < n; i++) {
    let res: QueryAnswer | null = null;
    // A throw is Bedrock being unreachable, not an answer. Recording it as one is how a transient
    // failure comes back as "unstable" — precisely the signal this harness exists to keep clean.
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try {
        res = await answerQuery(
          { clientId, cycleId: CYCLE!, question: c.text, today: new Date(`${today}T00:00:00`), context: ctx },
          { model, embeddingClient, ...(audit ? { audit } : {}) },
        );
      } catch (err) {
        if (attempt === 2) process.stderr.write(`      ! ${c.id}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      calls++;
    }
    if (!res) { errors++; continue; }
    const v = expect ? expect.check(res) : { ok: false, detail: '' };
    runs.push({ text: res.text, outcome: res.outcome, ok: v.ok, detail: v.detail });
  }

  return {
    id: c.id, group, text: c.text, today,
    want: expect?.want ?? null,
    ...(c.note ? { note: c.note } : {}),
    ...(c.knownFail ? { knownFail: c.knownFail } : {}),
    runs, errors,
    hits: expect ? runs.filter((r) => r.ok).length : 0,
  };
}

/**
 * Did the answer HOLD STILL?
 *
 * Three readings, coarsest last, because they fail at different points and the difference matters.
 * `figures` is the load-bearing one: it is the set of numbers the answer stated, and a case whose
 * figures moved between runs is the September defect whether or not any single run was right.
 * `outcome` catches a reply that answered once and declined the next. `text` is reported but never
 * scored — two identical answers phrased differently are not a defect, and at temperature 0 an
 * identical prompt usually returns identical text anyway, so a divergence there is worth seeing
 * and not worth failing on.
 */
function stability(r: Result) {
  const figures = [...new Set(r.runs.map((x) => figuresIn(x.text).join(',')))];
  const outcomes = [...new Set(r.runs.map((x) => x.outcome))];
  const texts = [...new Set(r.runs.map((x) => x.text.replace(/\s+/g, ' ').trim()))];
  return { figures, outcomes, texts, stable: figures.length <= 1 && outcomes.length <= 1 };
}

// ── Report ───────────────────────────────────────────────────────────────────────────

const rule = (n = 100) => '─'.repeat(n);
console.log(corpus.readme.join('\n'));
console.log(`\n${rule()}`);
console.log(`cycle ${CYCLE} · client ${clientId} · today ${TODAY}${todays.length > 1 ? ` (+ ${todays.filter((t) => t !== TODAY).join(', ')} for dated cases)` : ''}`);
console.log(`${RUNS} run(s) per question · model ${modelArg ?? 'haiku (AGENT_MODEL)'} · audit ${WRITE_AUDIT ? 'ON — writing ledger rows' : 'off — writing nothing'}`);
console.log(`corpus ${corpusPath}`);
console.log(rule());

/**
 * ── DO THE TWO ACCOUNTS OF THE PLAN AGREE? ─────────────────────────────────────────
 *
 * The expected values come from raw rows keyed by date; the answerer's come through the cycle-keyed,
 * draft-fenced loaders. They SHOULD agree, and where they do not, one of them is wrong and nothing
 * below this line can be trusted — so it is checked and printed before any question is asked rather
 * than left to be inferred from a wall of failures.
 */
for (const t of todays) {
  const ctx = contexts.get(t)!;
  const diffs: string[] = [];
  for (const m of ctx.months) {
    const ctxW = ctx.posts.filter((p) => p.date.slice(0, 7) === m).length;
    const ctxP = ctx.beats.filter((b) => b.date.slice(0, 7) === m).length;
    const sqlW = writtenIn(m).length, sqlP = plannedIn(m).length;
    if (ctxW !== sqlW) diffs.push(`${m} written: context ${ctxW}, SQL ${sqlW}`);
    if (ctxP !== sqlP) diffs.push(`${m} planned: context ${ctxP}, SQL ${sqlP}`);
  }
  // Counted OVER THE DIGEST MONTHS on both sides. `ctx.posts` is the resolution set — every month
  // from last month onward, deliberately wider than what the state describes (ContextCycle.inDigest)
  // — so comparing its raw length against a two-month SQL total would report a divergence on every
  // client who has a third month, and the number that looked wrong would be the harness's.
  const inDigest = (m: string) => ctx.months.includes(m);
  console.log(`\ntoday ${t} — digest months ${ctx.months.join(', ') || '(none)'}`
    + ` · context ${ctx.posts.filter((p) => inDigest(p.date.slice(0, 7))).length} written`
    + ` + ${ctx.beats.filter((b) => inDigest(b.date.slice(0, 7))).length} planned`
    + ` · SQL ${ctx.months.flatMap(writtenIn).length} written + ${ctx.months.flatMap(plannedIn).length} planned`
    + ` (resolution set holds ${ctx.posts.length} written across ${ctx.cycles.length} cycles, wider on purpose)`);
  if (diffs.length) {
    console.log(`  ⚠ DIVERGENCE — the harness and the answerer disagree about the plan. Every assertion below is suspect.`);
    for (const d of diffs) console.log(`      ${d}`);
  }
}

const results: Result[] = [];
for (const g of groups) {
  for (const c of g.cases) {
    process.stderr.write(`  ${g.id}/${c.id}\n`);
    results.push(await measure(c, g.id, RUNS));
  }
}

/**
 * Escalation ADDS runs; it does not replace them — scope-eval-cli's rule, and for its reason. A
 * case that came back 4/5 and then 10/10 must be reported over all 15, or the wobble that caused
 * the escalation vanishes from the record and a re-roll reads as a fix.
 */
if (escalate) {
  const unstable = results.filter((r) => r.runs.length > 1 && !stability(r).stable);
  if (unstable.length) {
    console.log(`\n── escalating ${unstable.length} unstable question(s) by ${ESCALATE_RUNS} further runs`);
    for (const u of unstable) {
      const g = groups.find((x) => x.cases.some((c) => c.id === u.id))!;
      const c = g.cases.find((x) => x.id === u.id)!;
      process.stderr.write(`  ${c.id} (escalate)\n`);
      const more = await measure(c, g.id, ESCALATE_RUNS);
      results[results.indexOf(u)] = {
        ...u, runs: [...u.runs, ...more.runs], errors: u.errors + more.errors, hits: u.hits + more.hits,
      };
    }
  }
}

const indent = (s: string, pad: string) => s.split('\n').map((l) => `${pad}${l}`).join('\n');

for (const g of groups) {
  const rowsFor = results.filter((r) => r.group === g.id);
  console.log(`\n\n══ ${g.title} — ${rowsFor.length} question(s)`);
  if (g.note) console.log(indent(g.note, '   '));

  for (const r of rowsFor) {
    const scored = r.want !== null;
    const answered = r.runs.length;
    const s = stability(r);
    const mark = !scored ? '·'
      : r.knownFail ? (r.hits > 0 ? '⚠' : '·')
      : r.hits === answered && answered > 0 ? '✓' : r.hits === 0 ? '✗' : '~';

    console.log(`\n  ${mark} ${r.id}${r.today !== TODAY ? `  [today ${r.today}]` : ''}`);
    console.log(`     Q  ${JSON.stringify(r.text)}`);
    if (scored) {
      console.log(`     want  ${r.want}`);
      const detail = [...new Set(r.runs.map((x) => x.detail))].filter(Boolean).join(' | ');
      console.log(`     got   ${r.hits}/${answered}${r.errors ? `  [${r.errors} call(s) failed, excluded]` : ''}${detail ? `  — ${detail}` : ''}`);
    } else if (r.errors) {
      console.log(`     [${r.errors} call(s) failed, excluded]`);
    }
    console.log(`     held  ${s.stable ? 'STABLE' : 'MOVED'}`
      + ` · figures ${s.figures.length === 1 ? 'identical' : `${s.figures.length} distinct`}`
      + ` · outcome ${s.outcomes.join('/') || '—'}`
      + ` · text ${s.texts.length === 1 ? 'identical' : `${s.texts.length} distinct`}`);
    if (r.knownFail) console.log(`     KNOWN GAP: ${r.knownFail}`);
    if (r.note) console.log(indent(`NOTE: ${r.note}`, '     '));

    // The answers themselves. One when every run said the same thing; all of them when they did
    // not — the differences ARE the finding, and summarising them away is what a browser does.
    const variants = [...new Set(r.runs.map((x) => x.text))];
    for (const v of variants) {
      const n = r.runs.filter((x) => x.text === v).length;
      console.log(`     ${variants.length > 1 ? `A (${n}/${answered})` : 'A'}`);
      console.log(indent(v, '       '));
    }
  }
}

// ── Score — per group, never combined ────────────────────────────────────────────────

console.log(`\n\n══ SCORE — by group, on purpose`);
for (const g of groups) {
  const rowsFor = results.filter((r) => r.group === g.id);
  const scored = rowsFor.filter((r) => r.want !== null && !r.knownFail);
  const known  = rowsFor.filter((r) => r.knownFail);
  const printed = rowsFor.filter((r) => r.want === null && !r.knownFail);
  const full = scored.filter((r) => r.runs.length > 0 && r.hits === r.runs.length).length;
  const none = scored.filter((r) => r.hits === 0).length;
  const moved = rowsFor.filter((r) => r.runs.length > 1 && !stability(r).stable).length;
  console.log(`  ${g.id.padEnd(18)} ${scored.length ? `${full} of ${scored.length} right on every run · ${none} never right · ${scored.length - full - none} partial` : 'not scored'}`
    + `${known.length ? ` · ${known.length} known gap` : ''}${printed.length ? ` · ${printed.length} printed only` : ''}`
    + ` · ${moved} moved between runs`);
}

const gaps = results.filter((r) => r.knownFail);
if (gaps.length) {
  console.log(`\n══ KNOWN GAPS — expected to fail today, reported apart so they never read as a regression`);
  for (const r of gaps) {
    // A gap with no assertion is not an unmeasured one — it is one whose failure mode no
    // assertion available here can see (see gap-what-i-told-you: answering an ADJACENT question
    // tags itself `answered`, so the tag reports the gap closed on the behaviour that proves it
    // open). Saying "read the text" is the honest report; a green tick would not be.
    if (r.want === null) { console.log(`  · not assertable  ${r.id}  — read the answer above`); continue; }
    const closed = r.hits > 0;
    console.log(`  ${closed ? '⚠ NOW PASSES' : '· still open'}  ${r.id}  (${r.hits}/${r.runs.length})`);
    if (closed) console.log(`      This gap has closed, or the assertion no longer measures it. Update the corpus before reading the score again.`);
  }
}

const moved = results.filter((r) => r.runs.length > 1 && !stability(r).stable);
console.log(`\n══ MOVED BETWEEN RUNS — ${moved.length} question(s)`);
if (!moved.length) console.log(`  none — every question returned the same figures and the same outcome on every run`);
for (const r of moved) {
  const s = stability(r);
  console.log(`  ${r.id.padEnd(28)} figures ${s.figures.map((f) => `{${f || '—'}}`).join(' · ')}${s.outcomes.length > 1 ? `  outcome ${s.outcomes.join('/')}` : ''}`);
}

console.log(`\n  ${calls} Bedrock answer call(s) this pass (each one also embeds for retrieval).`);
console.log(`  Nothing was written to UAT${WRITE_AUDIT ? ' except the audit_log rows --audit asked for' : ''}.`);
console.log(`\n  There is deliberately NO combined figure. The groups measure different things — an`);
console.log(`  arithmetic assertion and a printed answer are not commensurable — and one number`);
console.log(`  would let a change be justified by the half of the corpus that can be scored.`);

if (outPath) {
  const path = resolve(process.cwd(), outPath);
  await writeFile(path, JSON.stringify({
    corpus: corpusPath, cycle: CYCLE, client: clientId, today: TODAY, runs: RUNS,
    model: modelArg ?? 'haiku (AGENT_MODEL)', calls,
    results: results.map((r) => {
      const s = stability(r);
      return {
        id: r.id, group: r.group, text: r.text, today: r.today, want: r.want,
        ...(r.knownFail ? { knownFail: r.knownFail } : {}),
        hits: r.hits, runs: r.runs.length, errors: r.errors,
        stable: s.stable, figures: s.figures, outcomes: s.outcomes, distinctTexts: s.texts.length,
        answers: [...new Set(r.runs.map((x) => x.text))],
      };
    }),
  }, null, 2) + '\n', 'utf8');
  console.log(`\n  recorded to ${path}`);
}

// Always exits 0. A measurement, not a gate: the corpus is EXPECTED to fail on the cases it was
// built to measure, and a red exit would train someone to stop reading it.
process.exit(0);
