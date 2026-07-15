/**
 * task-parser.test.ts — the single LLM parse step.
 *
 * The model itself can't be asserted against live, so we mock it to return canned
 * JSON (including messy dictated fixtures) and assert parseTasks preserves order,
 * normalises/validates each task, and degrades malformed output to a single
 * clarify — never throwing.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@sprigly/model-client', () => ({ createModelClientFromEnv: () => ({ complete: async () => ({}), completeStreaming: async () => ({}) }) }));
vi.mock('@sprigly/embedding-client', () => ({ createEmbeddingClientFromEnv: () => ({ embed: async () => [] }) }));

import { parseTasks, type ParserContext } from './task-parser';
import { resolveMoveSource } from './selectors';
import type { PlanPost } from '../types';
import type { ModelClient } from '@sprigly/model-client';

const CTX: ParserContext = { today: '2026-09-01', cycleMonths: '- September 2026 (2026-09) [current, editable] — planning', planDigest: '- id=post-9 | Thu 3 Sep | instagram/reel | Autumn layers', productIndex: '- Maebelle (Wrap Dress) — Ecru, Navy' };

function fakeModel(content: string): ModelClient {
  return {
    async complete() { return { content, inputTokens: 0, outputTokens: 0, modelId: 'haiku', stopReason: 'end_turn' }; },
    async completeStreaming() { return { content, inputTokens: 0, outputTokens: 0, modelId: 'haiku', stopReason: 'end_turn' }; },
  };
}
const throwingModel: ModelClient = { async complete() { throw new Error('boom'); }, async completeStreaming() { throw new Error('boom'); } };

describe('compound messages', () => {
  it('yields tasks in message order', async () => {
    const model = fakeModel(JSON.stringify({ tasks: [
      { action: 'move_post', postId: 'post-9', toDate: '2026-09-05', reason: 'move the Thursday post to Saturday' },
      { action: 'add_note', content: 'Linen restock coming.', reason: 'add a note about the linen restock' },
      { action: 'query', question: 'What do I need to film this week?', reason: 'what do I need to film' },
    ] }));
    const tasks = await parseTasks('move the thursday post to saturday and note the linen restock and what do I film this week', CTX, model);
    expect(tasks.map((t) => t.action)).toEqual(['move_post', 'add_note', 'query']);
    expect(tasks[0]!.postId).toBe('post-9');
    expect(tasks[0]!.toDate).toBe('2026-09-05');
  });
});

describe('ambiguous / dictated / question fixtures', () => {
  it('an ambiguous reference is a clarify task', async () => {
    const model = fakeModel(JSON.stringify({ tasks: [{ action: 'clarify', question: 'Which reel — Tuesday or Friday?', reason: 'make the reel warmer' }] }));
    const [t] = await parseTasks('make the reel warmer', CTX, model);
    expect(t!.action).toBe('clarify');
    expect(t!.question).toContain('Which reel');
  });

  it('a pure question is a query task', async () => {
    const [t] = await parseTasks("what's our returns policy", CTX, fakeModel(JSON.stringify({ tasks: [{ action: 'query', question: 'What is our returns policy?' }] })));
    expect(t!.action).toBe('query');
  });

  it('messy dictated speech resolves to a move with a selector', async () => {
    const model = fakeModel(JSON.stringify({ tasks: [{ action: 'move_post', selector: 'the Wednesday post', toDate: '2026-09-04', reason: 'push the Wednesday one to Friday' }] }));
    const [t] = await parseTasks('um yeah push the wednesday one back to like the friday i mean', CTX, model);
    expect(t!.action).toBe('move_post');
    expect(t!.selector).toBe('the Wednesday post');
  });
});

describe('validation + resilience', () => {
  it('captures an add_post instruction (what the post is about)', async () => {
    const model = fakeModel(JSON.stringify({ tasks: [{ action: 'add_post', toDate: '2026-07-15', channel: 'instagram', instruction: 'the linen restock landing this week', reason: 'add a post about the linen restock' }] }));
    const [t] = await parseTasks('add a post this week about the linen restock', CTX, model);
    expect(t!.action).toBe('add_post');
    expect(t!.instruction).toBe('the linen restock landing this week');
  });

  it('a bare add_post carries no instruction', async () => {
    const [t] = await parseTasks('add a post on friday', CTX, fakeModel(JSON.stringify({ tasks: [{ action: 'add_post', toDate: '2026-07-17' }] })));
    expect(t!.action).toBe('add_post');
    expect(t!.instruction ?? null).toBeNull();
  });

  it('a move with no post reference becomes clarify', async () => {
    const [t] = await parseTasks('move it', CTX, fakeModel(JSON.stringify({ tasks: [{ action: 'move_post', toDate: '2026-09-04' }] })));
    expect(t!.action).toBe('clarify');
  });

  it('a rewrite with no instruction becomes clarify', async () => {
    const [t] = await parseTasks('reword the reel', CTX, fakeModel(JSON.stringify({ tasks: [{ action: 'rewrite_post', postId: 'post-9' }] })));
    expect(t!.action).toBe('clarify');
  });

  it('an add_note with no content becomes clarify', async () => {
    const [t] = await parseTasks('note', CTX, fakeModel(JSON.stringify({ tasks: [{ action: 'add_note' }] })));
    expect(t!.action).toBe('clarify');
  });

  it('an unknown action becomes clarify', async () => {
    const [t] = await parseTasks('x', CTX, fakeModel(JSON.stringify({ tasks: [{ action: 'nuke_everything' }] })));
    expect(t!.action).toBe('clarify');
  });

  it('drops an invalid toDate to null', async () => {
    const [t] = await parseTasks('x', CTX, fakeModel(JSON.stringify({ tasks: [{ action: 'move_post', postId: 'post-9', toDate: 'Saturday' }] })));
    expect(t!.action).toBe('move_post');
    expect(t!.toDate).toBeNull();
  });

  it('malformed JSON degrades to a single clarify task', async () => {
    const tasks = await parseTasks('x', CTX, fakeModel('not json'));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.action).toBe('clarify');
  });

  it('an empty tasks array degrades to clarify', async () => {
    const tasks = await parseTasks('x', CTX, fakeModel(JSON.stringify({ tasks: [] })));
    expect(tasks[0]!.action).toBe('clarify');
  });

  it('a model error degrades to clarify (never throws)', async () => {
    const tasks = await parseTasks('x', CTX, throwingModel);
    expect(tasks[0]!.action).toBe('clarify');
  });
});

// FIX 1 — the source resolution layer between parse and proposal. These run the RAW ask string
// through the real parser (model canned) → resolveMoveSource, proving a date-named source resolves
// even when the model mis-copied the id, and that multiple posts on a date come back as ambiguous.
const P = (id: string, date: string, caption: string): PlanPost =>
  ({ id, cycleId: 'c', clientId: 'cl', channel: 'instagram', date, format: 'reel', pillar: 'x', caption, status: 'planned', reviewState: null, steps: [] }) as PlanPost;

describe('move source resolution (raw ask → parse → resolve)', () => {
  it('resolves the date-named source even when the model copied a WRONG id', async () => {
    const model = fakeModel(JSON.stringify({ tasks: [
      { action: 'move_post', postId: 'not-a-real-uuid', selector: 'the post on the 1st August', fromDate: '2026-08-01', toDate: '2026-08-22', reason: 'move the post on the 1st August to the 22nd August' },
    ] }));
    const [task] = await parseTasks('move the post on the 1st August to the 22nd August', CTX, model);
    expect(task!.fromDate).toBe('2026-08-01');   // parser extracted the source DATE
    expect(task!.toDate).toBe('2026-08-22');
    const posts = [P('p-1', '2026-08-01', 'The boxes have arrived'), P('p-2', '2026-08-15', 'Midmonth note')];
    const ref = resolveMoveSource(task!, posts);
    expect(ref && 'post' in ref ? ref.post.id : null).toBe('p-1');   // via fromDate, despite the bad id
  });

  it('multiple posts on the named date → ambiguous set (to be LISTED, not a blind clarify)', () => {
    const posts = [P('p-a', '2026-08-01', 'The boxes have arrived'), P('p-b', '2026-08-01', 'Founder note')];
    const ref = resolveMoveSource({ postId: 'bad', fromDate: '2026-08-01', selector: 'the 1st' }, posts);
    expect(ref && 'ambiguous' in ref ? ref.ambiguous.map((p) => p.id) : null).toEqual(['p-a', 'p-b']);
  });

  it('no post on the date → null (caller acknowledges what was understood)', () => {
    const posts = [P('p-2', '2026-08-15', 'Midmonth note')];
    expect(resolveMoveSource({ fromDate: '2026-08-01', selector: 'the 1st', postId: 'bad' }, posts)).toBeNull();
  });
});
