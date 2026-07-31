/**
 * cache-check.ts — DEMONSTRATE that the parser's prompt cache is actually working.
 *
 *   pnpm --filter @sprigly/app cache-check
 *   pnpm --filter @sprigly/app cache-check --turns=4
 *
 * Runs under vite-node, not tsx. It has to: the app package is CommonJS while @sprigly/model-client
 * publishes an ESM-only exports map, so a plain node/tsx run of anything under app/src fails to
 * resolve it (ERR_PACKAGE_PATH_NOT_EXPORTED). vite-node applies the same resolution Vitest and Next
 * already use, which is what lets this harness import the REAL parser rather than a copy of it —
 * and importing the real one is the whole point: a copy could not prove anything about production's
 * prompt. It lives in scripts/ rather than src/, so Vitest never collects it and CI never spends.
 *
 * Why this exists, and why it is a LIVE call rather than a unit test: a Bedrock `cachePoint` that
 * lands on a model without caching, or on a prefix below that model's minimum cacheable length,
 * fails COMPLETELY SILENTLY. No error, no warning — the request succeeds, costs full price, and
 * looks identical to one that worked. The only evidence either way is `usage.cacheReadInputTokens`
 * coming back from the real service, so the only honest verification is a real call.
 *
 * WHAT IT DOES. Builds a realistic parser context (a month of plan digest, a product catalogue,
 * a growing conversation thread) and sends N turns through the SAME code path the sheet uses —
 * `parseTasks` — varying only what a real turn varies: the thread, and the client's utterance.
 * Then it prints the token shape of each turn:
 *
 *   turn 1  should WRITE the cache (cacheWrite > 0, cacheRead = 0)
 *   turn 2+ should READ it        (cacheRead > 0, and inputTokens collapses to the tail)
 *
 * A run where every turn reads 0 is the failure this is looking for. The most likely causes, in
 * order: the invariant prefix is below the model's minimum cacheable length; the model on this
 * path does not support caching; something in the "invariant" prefix is not actually invariant.
 *
 * SPENDS BEDROCK — a handful of Haiku calls, pennies. Operator-invoked only, never wired into a
 * job or a test. It writes NOTHING: no audit rows, no database access at all.
 */
import { parseTasks, type ParserContext } from '../src/lib/agent/task-parser';
import { createModelClientFromEnv, type ModelClient, type ModelCompleteParams, type ModelCompleteResult } from '@sprigly/model-client';

const args = process.argv.slice(2);
const turnsArg = args.find((a) => a.startsWith('--turns='))?.slice('--turns='.length);
const TURNS = Math.max(2, Math.min(10, Number(turnsArg ?? 3) || 3));

/** A month of plan digest, roughly the size a real August carries. */
function digest(): string {
  const rows: string[] = [];
  for (let d = 1; d <= 28; d++) {
    const iso = `2026-08-${String(d).padStart(2, '0')}`;
    if (d % 3 !== 0) continue;
    rows.push(`- ${iso} | id=post-${d} | reel | "Linen, styled three ways (${d})" | planned`);
  }
  return rows.join('\n');
}

function catalogue(): string {
  return [
    '- Maebelle (dress) — navy, cream, sage',
    '- Anna (vest) — oat, black',
    '- Atlas Cedar (candle) — single colourway',
    '- Harlow (linen shirt) — chalk, clay',
    '- Wren (knit) — moss, ecru, charcoal',
  ].join('\n');
}

const BASE: Omit<ParserContext, 'recentThread'> = {
  today: '2026-08-01',
  viewedMonth: 'August 2026',
  cycleMonths: '- August 2026 (drafting)\n- September 2026 (intake open)',
  planDigest: digest(),
  productIndex: catalogue(),
};

/** The utterances, one per turn. Ordinary sheet traffic — nothing that changes the digest. */
const UTTERANCES = [
  'move the post on the 3rd to the 8th',
  'actually make it a carousel',
  'add a reel about the Maebelle on the 21st',
  'and give it a good hook',
  'what have I got on this week?',
  'tighten the hook on the Tuesday reel',
  'move the 12th back a day',
  'add a note about the linen restock',
  'make the 15th a single image',
  'and one more about the Atlas Cedar',
];

/** Wraps the real client to capture the token shape of each call without changing behaviour. */
function observing(inner: ModelClient, sink: ModelCompleteResult[]): ModelClient {
  return {
    async complete(p: ModelCompleteParams) { const r = await inner.complete(p); sink.push(r); return r; },
    completeStreaming: (p: ModelCompleteParams) => inner.completeStreaming(p),
  };
}

async function main(): Promise<void> {
  const results: ModelCompleteResult[] = [];
  const model = observing(createModelClientFromEnv(), results);

  console.log(`cache-check: ${TURNS} turns through the real parser path.`);
  console.log(`Prefix carries a ${BASE.planDigest.length}-char digest and a ${BASE.productIndex.length}-char catalogue.\n`);

  let thread = '';
  for (let i = 0; i < TURNS; i++) {
    const utterance = UTTERANCES[i % UTTERANCES.length]!;
    const ctx: ParserContext = { ...BASE, recentThread: thread };
    await parseTasks(utterance, ctx, model);
    // Grow the thread the way a real session does — AFTER the breakpoint, so it must not disturb
    // the cached prefix. If it does, that is exactly what this harness is here to reveal.
    thread += `CLIENT: ${utterance}\nASSISTANT: (noted)\n`;
  }

  const pad = (n: number | undefined, w: number) => String(n ?? '—').padStart(w);
  console.log('turn   inputTokens   cacheRead   cacheWrite   outputTokens');
  for (const [i, r] of results.entries()) {
    console.log(`${pad(i + 1, 4)}   ${pad(r.inputTokens, 11)}   ${pad(r.cacheReadTokens, 9)}   ${pad(r.cacheWriteTokens, 10)}   ${pad(r.outputTokens, 12)}`);
  }

  const reported = results.some((r) => r.cacheReadTokens !== undefined || r.cacheWriteTokens !== undefined);
  const everRead = results.some((r) => (r.cacheReadTokens ?? 0) > 0);
  const wrote    = results.some((r) => (r.cacheWriteTokens ?? 0) > 0);

  console.log('');
  if (!reported) {
    console.log('RESULT: the provider reported NO cache counters at all.');
    console.log('        Either MODEL_PROVIDER is not bedrock (the Anthropic client drops the');
    console.log('        breakpoint — see anthropic-client.ts), or this model ignores cachePoint.');
  } else if (everRead) {
    const first = results[0]!, later = results.slice(1);
    const avgLater = Math.round(later.reduce((a, r) => a + r.inputTokens, 0) / Math.max(1, later.length));
    console.log(`RESULT: CACHING WORKS. Turn 1 wrote ${first.cacheWriteTokens ?? 0} tokens;`);
    console.log(`        later turns read the prefix back and paid full price on ~${avgLater} input tokens.`);
  } else if (wrote) {
    console.log('RESULT: the cache was WRITTEN but never READ. The prefix is changing between turns —');
    console.log('        something before the breakpoint is not invariant. Diff two rendered prefixes.');
  } else {
    console.log('RESULT: NO caching. Most likely the prefix is below this model’s minimum cacheable');
    console.log('        length. Compare the prefix size above against the model’s documented minimum.');
  }
}

// Wrapped rather than top-level await, so the exit code is explicit either way.
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
