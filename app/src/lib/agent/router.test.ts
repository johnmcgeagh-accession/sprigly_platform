/**
 * router.test.ts — the two-tier router.
 *
 * Fast-path decisions (regex for typed, LLM for voice/unconfident) are fully
 * deterministic and tested directly. The LLM classification itself can't be
 * asserted against a live model, so we mock the model client to return canned
 * JSON (including for messy dictated-speech inputs) and assert the router parses,
 * validates, and falls back safely.
 */
import { describe, it, expect, vi } from 'vitest';

// Keep the @sprigly clients out of the test (model.ts imports their factories).
vi.mock('@sprigly/model-client', () => ({ createModelClientFromEnv: () => ({ complete: async () => ({}), completeStreaming: async () => ({}) }) }));
vi.mock('@sprigly/embedding-client', () => ({ createEmbeddingClientFromEnv: () => ({ embed: async () => [] }) }));

import { runLlmRouter, routeInstruction, type RouterContext } from './router';
import type { ModelClient } from '@sprigly/model-client';
import type { PlanPost } from '../types';

function post(id: string, date: string, format: PlanPost['format'] = 'single', pillar = 'Product'): PlanPost {
  return { id, cycleId: 'CY', clientId: 'C', channel: 'instagram', date, format, pillar, caption: 'c', status: 'planned', reviewState: null };
}
const POSTS: PlanPost[] = [post('P1', '2026-09-01'), post('P2', '2026-09-04', 'reel', 'Styling')];

const CTX: RouterContext = { today: '2026-08-20', cycleMonths: [{ month: '2026-09', label: 'September 2026', status: 'planning', isHome: true }] };

/** A model that returns a fixed string, and records whether it was called. */
function fakeModel(content: string): ModelClient & { calls: number } {
  const m = {
    calls: 0,
    async complete() { m.calls++; return { content, inputTokens: 0, outputTokens: 0, modelId: 'haiku', stopReason: 'end_turn' }; },
    async completeStreaming() { return { content, inputTokens: 0, outputTokens: 0, modelId: 'haiku', stopReason: 'end_turn' }; },
  };
  return m;
}
const throwingModel: ModelClient = {
  async complete() { throw new Error('model should not be called'); },
  async completeStreaming() { throw new Error('nope'); },
};

describe('routeInstruction fast path', () => {
  it('typed structural input uses the regex classifier and does NOT call the model', async () => {
    const out = await routeInstruction('move the Tuesday post to Friday', POSTS, undefined, 'web', CTX, throwingModel);
    expect(out.via).toBe('regex');
    if (out.via === 'regex') expect(out.plan.kind).toBe('structural');
  });

  it('typed but unconfident input escalates to the LLM router', async () => {
    const model = fakeModel('{"intent":"clarify","content":"could you clarify?","target_month":null,"channel":null}');
    const out = await routeInstruction('hmm i dunno really', POSTS, undefined, 'web', CTX, model);
    expect(out.via).toBe('llm');
    expect(model.calls).toBe(1);
  });

  it('voice input always goes to the LLM router even when it looks structural', async () => {
    const model = fakeModel('{"intent":"structural","content":"move the tuesday post to friday","target_month":null,"channel":null}');
    const out = await routeInstruction('move the tuesday post to friday', POSTS, undefined, 'voice', CTX, model);
    expect(out.via).toBe('llm');
    expect(model.calls).toBe(1);
  });
});

describe('runLlmRouter parsing (messy dictated-speech fixtures)', () => {
  it('parses a dictated note with a target month', async () => {
    const model = fakeModel('{"intent":"note_for_month","content":"The wool coat launches on the 14th.","target_month":"2026-09","channel":null}');
    const r = await runLlmRouter('um so like remember the wool coat its launching on the fourteenth', CTX, model);
    expect(r.intent).toBe('note_for_month');
    expect(r.content).toBe('The wool coat launches on the 14th.');
    expect(r.targetMonth).toBe('2026-09');
  });

  it('parses a next-cycle idea with a channel', async () => {
    const model = fakeModel('json here: {"intent":"next_cycle_input","content":"Lean into knitwear next month.","target_month":"2026-10","channel":"instagram"} thanks');
    const r = await runLlmRouter('for next month yeah do more of the knitwear stuff on insta', CTX, model);
    expect(r.intent).toBe('next_cycle_input');
    expect(r.channel).toBe('instagram');
    expect(r.targetMonth).toBe('2026-10');
  });

  it('parses a query', async () => {
    const model = fakeModel('{"intent":"query","content":"What is scheduled this week?","target_month":null,"channel":null}');
    const r = await runLlmRouter('whats on this week again', CTX, model);
    expect(r.intent).toBe('query');
  });

  it('malformed JSON degrades to clarify', async () => {
    const r = await runLlmRouter('gibberish', CTX, fakeModel('not json at all'));
    expect(r.intent).toBe('clarify');
  });

  it('an invalid intent degrades to clarify', async () => {
    const r = await runLlmRouter('x', CTX, fakeModel('{"intent":"delete_everything","content":"x"}'));
    expect(r.intent).toBe('clarify');
  });

  it('a model error degrades to clarify', async () => {
    const r = await runLlmRouter('x', CTX, throwingModel);
    expect(r.intent).toBe('clarify');
  });

  it('drops an invalid target_month and channel', async () => {
    const model = fakeModel('{"intent":"note_for_month","content":"note","target_month":"September","channel":"tiktok"}');
    const r = await runLlmRouter('x', CTX, model);
    expect(r.targetMonth).toBeNull();
    expect(r.channel).toBeNull();
  });
});
