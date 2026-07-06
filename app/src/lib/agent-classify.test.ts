/**
 * agent-classify.test.ts — regression guard for audit §7.7 plus baseline
 * coverage of the deterministic classifier (which had no tests).
 *
 * The key regression: a bare plural with no resolvable target ("make these
 * warmer") must NOT default to rewriting the entire plan — it must clarify.
 * Explicit all-selectors ("them all", "the whole plan", "all") still resolve
 * to every post.
 */
import { describe, it, expect } from 'vitest';
import { classifyAgentInstruction } from './agent-classify';
import type { PlanPost } from './types';

function post(id: string, date: string, format: PlanPost['format'] = 'single', pillar = 'Product'): PlanPost {
  return { id, cycleId: 'CY', clientId: 'C', channel: 'instagram', date, format, pillar, caption: 'c', status: 'planned', reviewState: null };
}

// P1 = Tuesday 2026-09-01 (the only Tuesday); P2/P3 = Fridays.
const POSTS: PlanPost[] = [
  post('P1', '2026-09-01', 'single', 'Product'),
  post('P2', '2026-09-04', 'reel', 'Styling'),
  post('P3', '2026-09-11', 'carousel', 'Launch'),
];

describe('unresolved plural rewrites (regression)', () => {
  it('a bare plural with no resolvable target clarifies instead of rewriting the whole plan', () => {
    const r = classifyAgentInstruction('make these warmer', POSTS);
    expect(r.kind).toBe('clarify');
  });

  it('"make those punchier" also clarifies rather than defaulting to all', () => {
    expect(classifyAgentInstruction('make those punchier', POSTS).kind).toBe('clarify');
  });
});

describe('explicit all-selectors still rewrite every post', () => {
  it('"make them all warmer" rewrites all posts', () => {
    const r = classifyAgentInstruction('make them all warmer', POSTS);
    expect(r.kind).toBe('rewrite');
    if (r.kind === 'rewrite') expect(r.targetPostIds).toEqual(['P1', 'P2', 'P3']);
  });

  it('"rewrite the whole plan" rewrites all posts', () => {
    const r = classifyAgentInstruction('rewrite the whole plan', POSTS);
    expect(r.kind).toBe('rewrite');
    if (r.kind === 'rewrite') expect(r.targetPostIds).toEqual(['P1', 'P2', 'P3']);
  });

  it('"make all the posts warmer" rewrites all posts', () => {
    const r = classifyAgentInstruction('make all the posts warmer', POSTS);
    expect(r.kind).toBe('rewrite');
    if (r.kind === 'rewrite') expect(r.targetPostIds).toEqual(['P1', 'P2', 'P3']);
  });
});

describe('rewrite target resolution', () => {
  it('resolves a weekday to the single matching post', () => {
    const r = classifyAgentInstruction('make the Tuesday post warmer', POSTS);
    expect(r.kind).toBe('rewrite');
    if (r.kind === 'rewrite') expect(r.targetPostIds).toEqual(['P1']);
  });

  it('resolves "it" to the selected post', () => {
    const r = classifyAgentInstruction('make it warmer', POSTS, 'P2');
    expect(r.kind).toBe('rewrite');
    if (r.kind === 'rewrite') expect(r.targetPostIds).toEqual(['P2']);
  });

  it('"make it warmer" with no selection and no target clarifies', () => {
    expect(classifyAgentInstruction('make it warmer', POSTS).kind).toBe('clarify');
  });
});

describe('structural intents unchanged', () => {
  it('move the Tuesday post to Friday → structural date patch in the same week', () => {
    const r = classifyAgentInstruction('move the Tuesday post to Friday', POSTS);
    expect(r.kind).toBe('structural');
    if (r.kind === 'structural') {
      expect(r.actions).toEqual([{ type: 'patch', postId: 'P1', patch: { date: '2026-09-04' } }]);
    }
  });

  it('change the Tuesday post to a carousel → structural format patch', () => {
    const r = classifyAgentInstruction('change the Tuesday post to a carousel', POSTS);
    expect(r.kind).toBe('structural');
    if (r.kind === 'structural') {
      expect(r.actions).toEqual([{ type: 'patch', postId: 'P1', patch: { format: 'carousel' } }]);
    }
  });

  it('remove the Tuesday post → structural delete', () => {
    const r = classifyAgentInstruction('remove the Tuesday post', POSTS);
    expect(r.kind).toBe('structural');
    if (r.kind === 'structural') expect(r.actions).toEqual([{ type: 'delete', postId: 'P1' }]);
  });

  it('add a post about X → add with an extracted caption', () => {
    const r = classifyAgentInstruction('add a post about autumn knitwear', POSTS);
    expect(r.kind).toBe('add');
    if (r.kind === 'add') expect(r.caption).toBe('autumn knitwear');
  });

  it('empty instruction clarifies', () => {
    expect(classifyAgentInstruction('   ', POSTS).kind).toBe('clarify');
  });
});
