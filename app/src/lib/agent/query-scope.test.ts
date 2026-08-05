/**
 * query-scope.test.ts — the answerer is told about the months it says it can see, and no others.
 *
 * ── The contradiction this removes ───────────────────────────────────────────────────
 *
 * `answerQuery` was handed `PlanContext.posts` — the RESOLUTION SET, every month from last month
 * onward, because a reference has to be able to reach a month the client is not looking at — while
 * being handed `PlanContext.months`, the far narrower span the state actually describes. For Ivy T
 * on 2026-08-05 that built a plan state which announced *"YOU CAN SEE 2 MONTHS OF THIS PLAN, IN
 * FULL"*, then *"Plan has 78 live posts"* (July's 29 included), over 78 date-sorted rows carrying
 * no month headings — in which September's own figure, 30, appeared nowhere at all.
 *
 * So the model counted, and returned 27, 15, 26, 30 and then 28 for a month that had not changed
 * between any two of those turns.
 *
 * These tests assert on the STRING THE MODEL IS SENT, because that is the only thing the answerer
 * actually reasons over — the same argument `weeks.ts` makes about the buckets that held the right
 * answer and were thrown away before the prompt was built.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
// Retrieval is a database + Bedrock call and is not what is under test. Its failure path is
// already the graceful one, so a throwing stub exercises the same branch a sparse bank does.
vi.mock('@sprigly/knowledge', () => ({ retrieveChunks: async () => { throw new Error('no bank'); } }));

import { answerQuery, QUERY_SYSTEM_PROMPT } from './query';
import type { PlanContext } from './plan-context';
import type { PlanPost } from '../types';
import type { ModelClient } from '@sprigly/model-client';

let seq = 0;
const post = (date: string, over: Partial<PlanPost> = {}): PlanPost => ({
  id: `p${++seq}`, cycleId: 'cyc', clientId: 'cl', channel: 'instagram', date, format: 'reel',
  pillar: 'Simplify Your Morning', caption: 'words', status: 'new', reviewState: null, steps: [],
  hook: null, script: null, scriptLengthSeconds: null, overlay: null, pendingInstruction: null,
  generationError: null, banked: false, postingTime: null, title: null, rationale: null, ...over,
});

/** The message the answerer actually sends, captured. */
function capturingModel(): { model: ModelClient; sent: () => string } {
  let seen = '';
  const model: ModelClient = {
    async complete(params) {
      const msg = params.messages[0]!.content;
      seen = typeof msg === 'string' ? msg : msg.map((p) => ('text' in p ? p.text : '')).join('');
      return { content: 'ok [[outcome:answered]]', modelId: 'fake', inputTokens: 1, outputTokens: 1, stopReason: 'end_turn' };
    },
    async completeStreaming() { throw new Error('not used'); },
  };
  return { model, sent: () => seen };
}

const embeddingClient = { async embed() { return []; }, async embedBatch() { return []; }, dimensions: 1024 };

const JULY = Array.from({ length: 29 }, (_, i) => post(`2026-07-${String(i + 1).padStart(2, '0')}`));
const AUG  = Array.from({ length: 19 }, (_, i) => post(`2026-08-${String(i + 1).padStart(2, '0')}`));
const SEP  = [
  // 30 posts on 26 dates — the doubling that made "days minus posts" the wrong answer.
  ...[1, 2, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
    .map((d) => post(`2026-09-${String(d).padStart(2, '0')}`)),
  ...[1, 13, 18, 23].map((d) => post(`2026-09-${String(d).padStart(2, '0')}`)),
];

/** Ivy T's context on 2026-08-05: three months reachable, two of them in the digest. */
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  today: '2026-08-05', viewedCycleId: 'cyc-sep', viewedMonth: '2026-09',
  cycles: [], posts: [...JULY, ...AUG, ...SEP].sort((a, b) => a.date.localeCompare(b.date)),
  beats: [], digest: '(digest)', months: ['2026-08', '2026-09'], allMonths: '- x',
  ...over,
});

const ask = async (context: PlanContext) => {
  const { model, sent } = capturingModel();
  await answerQuery(
    { clientId: 'cl', cycleId: 'cyc-sep', question: 'what’s in September?', today: new Date(2026, 7, 5), context },
    { model, embeddingClient: embeddingClient as never },
  );
  return sent();
};

describe('the plan state describes the months it claims to describe', () => {
  it('drops the months the digest does not name — July is reachable, not described', async () => {
    const sent = await ask(ctx());
    expect(sent).not.toContain('2026-07-');
    expect(sent).toContain('2026-09-');
    expect(sent).toContain('2026-08-');
  });

  it('the window line and the total now agree about how many months are in view', async () => {
    const sent = await ask(ctx());
    expect(sent).toContain('YOU CAN SEE 2 MONTHS OF THIS PLAN');
    expect(sent).toContain('ACROSS ALL 2 MONTHS IN VIEW, COMBINED: 49 live posts');
    // The sentence that was read back as September's count. 78 was never any month's number.
    expect(sent).not.toContain('78 live posts');
  });

  it('September’s own figure is IN the state now, rather than nowhere', async () => {
    const sent = await ask(ctx());
    expect(sent).toContain('September 2026 (2026-09): 30 posts, on 26 of the month’s 30 dates.');
  });

  it('so are the two figures that were derived and got wrong', async () => {
    const sent = await ask(ctx());
    expect(sent).toContain('EMPTY DATES (4): 2026-09-03, 2026-09-05, 2026-09-06, 2026-09-07.');
    expect(sent).toContain('PILLARS: 30 Simplify Your Morning.');
  });

  it('scoping is BY DATE — an August-owned post moved into September counts as September’s', async () => {
    const moved = post('2026-09-03', { cycleId: 'cyc-aug' });
    const sent = await ask(ctx({ posts: [...JULY, ...AUG, ...SEP, moved].sort((a, b) => a.date.localeCompare(b.date)) }));
    expect(sent).toContain('September 2026 (2026-09): 31 posts');
    expect(sent).toContain('EMPTY DATES (3): 2026-09-05, 2026-09-06, 2026-09-07.');
  });

  it('a context naming no months describes everything rather than nothing', async () => {
    const sent = await ask(ctx({ months: [] }));
    expect(sent).toContain('2026-07-');
    expect(sent).toContain('2026-09-');
  });

  it('the resolution set itself is untouched — this narrows what is DESCRIBED, not what is reachable', async () => {
    const c = ctx();
    const before = c.posts.length;
    await ask(c);
    expect(c.posts).toHaveLength(before);
    expect(before).toBe(78);
  });
});

describe('the prompt tells the model the counting is already done', () => {
  it('forbids counting a figure the block already carries', () => {
    expect(QUERY_SYSTEM_PROMPT).toContain('NUMBERS ARE READ, NEVER COUNTED');
    expect(QUERY_SYSTEM_PROMPT).toMatch(/where they differ the block is right and you are wrong/);
  });

  it('names the subtraction specifically, because that is the one it actually did', () => {
    expect(QUERY_SYSTEM_PROMPT).toContain('EMPTY DATES ARE LISTED, NOT CALCULATED');
    expect(QUERY_SYSTEM_PROMPT).toMatch(/a date can hold TWO posts/);
  });

  it('and forbids giving a combined total as one month’s count', () => {
    expect(QUERY_SYSTEM_PROMPT).toMatch(/never quote a combined across-all-months total as a single month's count/);
  });
});
