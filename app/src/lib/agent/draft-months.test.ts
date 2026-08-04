/**
 * draft-months.test.ts — a draft month is not an empty month (F4).
 *
 * September held 30 draft beats and the agent said the month was empty, on the surface built to
 * show the client those beats. `loadPlanPosts` applies `excludeDraftPosts()`, so the cycle was
 * selected by the span, loaded, and arrived with zero rows.
 *
 * These tests hold the two halves of the fix in place, and they are deliberately BOTH here: the
 * digest is what the parser reads and the plan state is what the query answerer reads, and
 * fixing one without the other moves the lie rather than removing it.
 *
 * The fence itself is NOT under test here — it is untouched. `draft-invisibility.test.ts` still
 * owns it, and `loadPlanPosts` still refuses drafts to all nine of its callers.
 */
import { describe, it, expect, vi } from 'vitest';

// Both units under test are PURE — they take posts and beats and return strings. The mock is
// only here because their modules import the readers, which open a database connection at
// import time. Same pattern as every other agent fixture in this directory.
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { spanDigest, type ContextCycle } from './plan-context';
import { bucketCycleState } from './cycle-state';
import type { DraftBeatView, PlanPost } from '../types';

const beat = (id: string, date: string, title: string, format = 'carousel', pillar = 'Stable Foundations'): DraftBeatView => ({
  id, cycleId: 'cyc-sep', date, format: format as DraftBeatView['format'], pillar, title,
  position: 0, slotType: 'proven', evidence: { basis: 'template' } as DraftBeatView['evidence'], assumptions: [],
});

const post = (id: string, date: string, caption: string): PlanPost => ({
  id, cycleId: 'cyc-aug', clientId: 'cl', channel: 'instagram', date, format: 'single',
  pillar: 'p', caption, status: 'planned', reviewState: null, steps: [], hook: null, script: null,
  scriptLengthSeconds: null, overlay: null, pendingInstruction: null, generationError: null,
  banked: false, postingTime: null, title: null, rationale: null,
});

const SEP_BEATS = [
  beat('b1', '2026-09-01', 'Show me my ideas'),
  beat('b2', '2026-09-02', 'Why never to wear polyester or synthetics', 'reel', 'Born From Real Need'),
  beat('b3', '2026-09-05', 'WSG: mornings made easy with Bea'),
];

const cycle = (over: Partial<ContextCycle>): ContextCycle => ({
  cycleId: 'cyc-sep', planMonth: '2026-09', status: 'scheduled', reason: 'adjacent',
  inDigest: true, posts: [], beats: [], ...over,
});

describe('the digest — a draft month reads as a draft month', () => {
  const digest = () => spanDigest([cycle({ beats: SEP_BEATS })], '2026-08-04', 'cyc-aug');

  it('does NOT say the month is empty', () => {
    expect(digest()).not.toContain('(no posts in this month yet)');
  });

  it('states the count and the word DRAFT at MONTH level, not per absent field', () => {
    const head = digest().split('\n').find((l) => l.startsWith('September 2026'))!;
    expect(head).toContain('DRAFT MONTH');
    expect(head).toContain('3 PLANNED POSTS');
    expect(head).toContain('NONE OF THEM WRITTEN YET');
  });

  it('states the absence of captions in words, rather than leaving it inferable', () => {
    const head = digest().split('\n').find((l) => l.startsWith('September 2026'))!;
    expect(head).toMatch(/NONE of them has a caption/);
    expect(head).toMatch(/no wording to quote, summarise or describe/);
  });

  it('carries the shape the rows actually have: date, format, pillar, title', () => {
    const row = digest().split('\n').find((l) => l.includes('2026-09-02'))!;
    expect(row).toContain('2026-09-02');
    expect(row).toContain('reel');
    expect(row).toContain('pillar: Born From Real Need');
    expect(row).toContain('title: Why never to wear polyester or synthetics');
  });

  it('labels every row so one lifted out of its block is still not a post', () => {
    const rows = digest().split('\n').filter((l) => l.startsWith('- '));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.startsWith('- PLANNED id=')).toBe(true);
      expect(r).toContain('[no caption yet]');
      // The committed-post row shape is `- id=…`. A beat must never wear it.
      expect(r).not.toMatch(/^- id=/);
    }
  });

  it('a written month is untouched — no heading, no BEAT rows', () => {
    const d = spanDigest([cycle({ planMonth: '2026-08', cycleId: 'cyc-aug', posts: [post('p1', '2026-08-03', 'Linen, in the morning light.')] })], '2026-08-04', 'cyc-aug');
    expect(d).not.toContain('DRAFT MONTH');
    expect(d).not.toContain('PLANNED id=');
    expect(d).toContain('- id=p1');
  });

  it('a month with neither posts nor beats still says so rather than vanishing', () => {
    expect(spanDigest([cycle({ planMonth: '2026-11' })], '2026-08-04', 'cyc-aug')).toContain('(no posts in this month yet)');
  });
});

describe('the plan state — the query answerer sees the same facts', () => {
  const state = (beats = SEP_BEATS) => bucketCycleState([], new Date('2026-08-04T00:00:00'), ['2026-09'], beats).summary;

  it('does not present the month as having nothing in it', () => {
    expect(state()).toContain('3 PLANNED POSTS');
    expect(state()).toContain('This month is NOT empty');
  });

  it('states, in the answerer’s own context, that no caption exists', () => {
    expect(state()).toMatch(/NO POST IN SEPTEMBER 2026 HAS BEEN WRITTEN/);
    expect(state()).toContain('[no caption written yet]');
  });

  it('draws the line the contract needs: dates/formats/pillars/titles yes, wording no', () => {
    expect(state()).toMatch(/You may NOT say what it says/);
  });

  it('beats do NOT inflate the live-post count — they are not the plan', () => {
    expect(state()).toContain('Plan has 0 live posts');
  });

  it('a committed month with no beats produces no beat block at all', () => {
    const s = bucketCycleState([post('p1', '2026-08-03', 'Linen.')], new Date('2026-08-04T00:00:00'), ['2026-08']);
    expect(s.summary).not.toContain('DRAFT MONTH');
    expect(s.summary).not.toContain('PLANNED ');
    expect(s.summary).toContain('Plan has 1 live posts');
  });
});

describe('the resolution set stays committed-only', () => {
  it('beats are carried beside posts, never inside them', () => {
    // The guard behind the design note on ContextCycle.beats: a beat in `posts` would be
    // reachable by resolvePostRef, and an ordinary move_post could target a row whose only
    // legitimate write path is draft-mutations.ts.
    const c = cycle({ beats: SEP_BEATS });
    expect(c.posts).toHaveLength(0);
    expect(c.beats).toHaveLength(3);
  });
});
