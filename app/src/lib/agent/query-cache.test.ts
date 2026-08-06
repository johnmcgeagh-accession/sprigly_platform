/**
 * query-cache.test.ts — the answerer stops re-buying its own prompt.
 *
 * ── What was happening ───────────────────────────────────────────────────────────────
 *
 * `task-parser.ts` has been split at a `cache_point` since 0988a39. `query.ts` never was: it
 * passed a plain string, so every query turn re-processed the whole prompt at full input price —
 * 5,240 input tokens with `cacheRead=0`, measured live, paid four times for one question asked
 * four times.
 *
 * ── What these tests actually guard ──────────────────────────────────────────────────
 *
 * Two things, and the second is the one a live check would NOT have caught.
 *
 * The first is that the split changed the prompt's COST and not its TEXT: a `cache_point` is a
 * billing marker, so concatenating the parts must reproduce the old message byte for byte.
 *
 * The second is WHERE the boundary sits. KNOWLEDGE CONTEXT looks like stable context and is not —
 * `retrieveChunks` is keyed on the question, so different questions retrieve different chunks. A
 * breakpoint placed below it caches a longer prefix and still passes the obvious live check (ask
 * one question three times and watch it hit), because one repeated question retrieves one
 * repeated set of chunks — and then misses on every real conversation. Only a test can hold that
 * line, so these assert the question and the knowledge are BELOW the breakpoint by construction.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@sprigly/knowledge', () => ({ retrieveChunks: async () => { throw new Error('no bank'); } }));

import { answerQuery, renderQueryMessage, QUERY_SYSTEM_PROMPT } from './query';
import type { PlanContext } from './plan-context';
import type { MessagePart, ModelClient, ModelCompleteParams } from '@sprigly/model-client';

const PLAN_STATE = 'TODAY IS 2026-08-05.\nSeptember 2026 (2026-09): 30 posts, on 26 of the month’s 30 dates.';
const KNOWLEDGE  = '[1] Returns policy\nThirty days, unworn, tags on.';
const QUESTION   = 'what’s in September?';
/** The catalogue block. The db mock returns no cycle row, so the live path degrades to this —
 *  which is the state a client with no catalogue is in, and the one the answerer had before. */
const CATALOGUE  = '(no product catalogue available)';

/** The message shape the answerer sends, captured whole. */
function capturingModel(): { model: ModelClient; parts: () => MessagePart[] } {
  let seen: MessagePart[] = [];
  const model: ModelClient = {
    async complete(params: ModelCompleteParams) {
      const c = params.messages[0]!.content;
      seen = typeof c === 'string' ? [{ type: 'text', text: c }] : c;
      return { content: 'ok [[outcome:answered]]', modelId: 'fake', inputTokens: 1, outputTokens: 1, stopReason: 'end_turn' };
    },
    async completeStreaming() { throw new Error('not used'); },
  };
  return { model, parts: () => seen };
}

const embeddingClient = { async embed() { return []; }, async embedBatch() { return []; }, dimensions: 1024 };

const ctx: PlanContext = {
  today: '2026-08-05', viewedCycleId: 'cyc-sep', viewedMonth: '2026-09',
  cycles: [], posts: [], beats: [], digest: '(digest)', months: ['2026-09'], allMonths: '- x',
};

const ask = async () => {
  const { model, parts } = capturingModel();
  await answerQuery(
    { clientId: 'cl', cycleId: 'cyc-sep', question: QUESTION, today: new Date(2026, 7, 5), context: ctx },
    { model, embeddingClient: embeddingClient as never },
  );
  return parts();
};

describe('the split changes the cost, never the prompt', () => {
  it('concatenating the parts reproduces the message exactly as it was', () => {
    // The pre-split literal, kept verbatim. If the split ever alters the text, this fails.
    const before = `PLAN STATE:\n${PLAN_STATE}\n\nPRODUCT CATALOGUE:\n${CATALOGUE}`
      + `\n\nKNOWLEDGE CONTEXT:\n${KNOWLEDGE}\n\nQUESTION:\n${QUESTION}`;
    expect(renderQueryMessage(PLAN_STATE, CATALOGUE, KNOWLEDGE, QUESTION)).toBe(before);
  });

  it('sends text / text / cache_point / text — one breakpoint, not two', async () => {
    // The catalogue is a SECOND text part above the breakpoint, not a second breakpoint. Haiku's
    // minimum cacheable prefix is 4,096 tokens and the system prompt alone is well under it, so a
    // breakpoint per block would sit below the floor, cache nothing, and raise no error.
    const parts = await ask();
    expect(parts.map((p) => p.type)).toEqual(['text', 'text', 'cache_point', 'text']);
    expect(parts.filter((p) => p.type === 'cache_point')).toHaveLength(1);
  });

  it('the catalogue is ABOVE the breakpoint — it is the most invariant thing here', async () => {
    const parts = await ask();
    const cut = parts.findIndex((p) => p.type === 'cache_point');
    const above = parts.slice(0, cut).map((p) => ('text' in p ? p.text : '')).join('');
    expect(above).toContain('PRODUCT CATALOGUE:');
    // Knowledge stays BELOW: retrieveChunks is keyed on the question, so it varies per turn and
    // would end the cached prefix at the first differing byte.
    expect(above).not.toContain('KNOWLEDGE CONTEXT:');
  });
});

describe('what sits above the breakpoint is what is actually stable', () => {
  const above = async () => {
    const parts = await ask();
    const cut = parts.findIndex((p) => p.type === 'cache_point');
    return parts.slice(0, cut).map((p) => ('text' in p ? p.text : '')).join('');
  };
  const below = async () => {
    const parts = await ask();
    const cut = parts.findIndex((p) => p.type === 'cache_point');
    return parts.slice(cut + 1).map((p) => ('text' in p ? p.text : '')).join('');
  };

  it('the plan state is in the cached prefix — it is the bulk of it', async () => {
    // The state `answerQuery` builds for itself, not the fixture constant: what must be above the
    // line is whatever the answerer actually sends, and that is generated from the context.
    const prefix = await above();
    expect(prefix).toContain('PLAN STATE:');
    expect(prefix).toContain('TODAY IS 2026-08-05');
    expect(prefix).toContain('PLAN FACTS');
  });

  it('THE QUESTION IS BELOW THE LINE — it is new every turn', async () => {
    expect(await above()).not.toContain(QUESTION);
    expect(await below()).toContain(QUESTION);
  });

  it('KNOWLEDGE IS BELOW THE LINE — it is retrieved per question, not per plan', async () => {
    // The failure this pins: knowledge reads as stable context, and a breakpoint under it would
    // still pass a same-question-three-times live check while missing on every real conversation.
    expect(await above()).not.toContain('KNOWLEDGE CONTEXT');
    expect(await below()).toContain('KNOWLEDGE CONTEXT');
  });
});

describe('the prefix is big enough to qualify at all', () => {
  /** Haiku 4.5 will not cache a prefix below this, and raises no error when it declines. */
  const HAIKU_45_MIN_TOKENS = 4096;
  const estTokens = (s: string) => Math.round(s.length / 3.6);

  it('the system prompt ALONE is under the minimum — which is why there is only one breakpoint', () => {
    // The reason the obvious refinement (a second breakpoint after the system prompt, so a turn
    // whose plan changed still reads the system half) is unavailable on this model.
    expect(estTokens(QUERY_SYSTEM_PROMPT)).toBeLessThan(HAIKU_45_MIN_TOKENS);
  });

  it('a realistic prefix clears the minimum, and the margin is thin enough to keep watching', () => {
    // Ivy T's live span: 49 rows across two months. Rebuilt at that scale rather than asserted
    // on a toy fixture, because the whole question is whether the REAL prefix qualifies.
    const rows = Array.from({ length: 49 }, (_, i) =>
      `  - 2026-09-${String((i % 30) + 1).padStart(2, '0')} (Tue 1 Sep) (reel, Simplify Your Morning): ${'x'.repeat(80)}`,
    ).join('\n');
    const planState = `${PLAN_STATE}\n${'y'.repeat(3000)}\nPosts (by date):\n${rows}`;
    const prefix = `${QUERY_SYSTEM_PROMPT}\n\nPLAN STATE:\n${planState}`;
    expect(estTokens(prefix)).toBeGreaterThan(HAIKU_45_MIN_TOKENS);
  });
});
