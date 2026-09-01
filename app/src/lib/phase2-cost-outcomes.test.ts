/**
 * phase2-cost-outcomes.test.ts — a refusal that spent nothing is not a failed generation.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────────────
 *
 * `postsFailed` counted every post at `generation_failed`. A quota refusal carries that status
 * and no model call was ever made for it — `startPostGeneration` refuses before the spend, the
 * same way the ungrounded decline does, and the decline was already excluded for exactly this
 * reason. So the fan-out was booked as having failed on events that cost nothing and broke
 * nothing, in the one report used to judge whether generation is working.
 *
 * ── What these pin ───────────────────────────────────────────────────────────────────
 *
 * That the four buckets stay mutually exclusive, that a refusal lands in its own, and — the
 * regression that matters most — that a genuine failure is completely unaffected.
 */
import { describe, it, expect } from 'vitest';
import { countOutcomes, type CostPost } from './phase2-cost';

const post = (status: string, sourceMeta: unknown = {}): CostPost => ({ status, sourceMeta });

describe('a quota refusal', () => {
  it('is counted as refused, not as failed', () => {
    const r = countOutcomes([post('generation_failed', { quotaBanked: true })]);
    expect(r.postsRefused).toBe(1);
    expect(r.postsFailed).toBe(0);
  });

  it('a RETIRED refusal counts the same way — it is the same event, later', () => {
    const r = countOutcomes([post('generation_expired', { quotaExpiredAt: '2026-09-01T05:00:00Z' })]);
    expect(r.postsRefused).toBe(1);
    expect(r.postsFailed).toBe(0);
  });

  it('is not counted as generated either — there is no caption', () => {
    const r = countOutcomes([post('generation_failed', { quotaBanked: true })]);
    expect(r.postsGenerated).toBe(0);
  });
});

describe('a genuine failure', () => {
  it('is still counted as failed — the flag is what changes the answer, nothing else', () => {
    const r = countOutcomes([
      post('generation_failed', { generationError: 'the request timed out' }),
      post('generation_failed', { generationError: 'could not produce a clean caption' }),
      post('generation_failed', {}),
    ]);
    expect(r.postsFailed).toBe(3);
    expect(r.postsRefused).toBe(0);
  });

  it('a post with no source_meta at all is a failure, not a refusal', () => {
    // The safe direction: absence of the flag means it was not a refusal. Guessing the other
    // way would quietly shrink the failure rate whenever metadata went missing.
    const r = countOutcomes([post('generation_failed', null)]);
    expect(r.postsFailed).toBe(1);
    expect(r.postsRefused).toBe(0);
  });
});

describe('the other two buckets are unchanged', () => {
  it('a declined launch beat is still declined, and still not generated', () => {
    const r = countOutcomes([post('new', { subjectUngrounded: true })]);
    expect(r.postsDeclined).toBe(1);
    expect(r.postsGenerated).toBe(0);
    expect(r.postsFailed).toBe(0);
  });

  it('a written post is still generated', () => {
    const r = countOutcomes([post('new'), post('edited')]);
    expect(r.postsGenerated).toBe(2);
  });

  it('a planned post is none of the four — it was never part of this run', () => {
    const r = countOutcomes([post('planned'), post('draft'), post('generating')]);
    expect(r).toEqual({ postsGenerated: 0, postsFailed: 0, postsDeclined: 0, postsRefused: 0 });
  });
});

describe('the buckets are mutually exclusive', () => {
  it('a month of mixed outcomes sums to no more than the posts in it', () => {
    const posts = [
      post('new'), post('edited'), post('new'),
      post('generation_failed', { generationError: 'timed out' }),
      post('generation_failed', { quotaBanked: true }),
      post('generation_expired', {}),
      post('new', { subjectUngrounded: true }),
      post('planned'),
    ];
    const r = countOutcomes(posts);

    expect(r).toEqual({ postsGenerated: 3, postsFailed: 1, postsDeclined: 1, postsRefused: 2 });
    const counted = r.postsGenerated + r.postsFailed + r.postsDeclined + r.postsRefused;
    expect(counted).toBeLessThanOrEqual(posts.length);
  });

  it('a banked post that is ALSO ungrounded is counted once, as declined', () => {
    // Ordering is asserted rather than left to chance: both predicates match, and double
    // counting would make the buckets overlap and the totals meaningless.
    const r = countOutcomes([post('generation_failed', { quotaBanked: true, subjectUngrounded: true })]);
    expect(r.postsDeclined).toBe(1);
    expect(r.postsRefused).toBe(0);
    expect(r.postsFailed).toBe(0);
  });
});
