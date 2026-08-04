/**
 * plan-answers.test.ts — the answers are computed, and they agree with the surface.
 *
 * ── What is being guarded ────────────────────────────────────────────────────────────
 *
 * "Which of my ideas made it into September?" is a question about facts we already hold: the
 * Ideas view derives them from `lifecycle`, the month summary counts them with `fromClient`.
 * Answering it through a model would create a fourth account of the same rows, in prose, able to
 * be wrong in ways the other three cannot. So the answer is a derivation, and these tests pin it
 * against the same data the surface renders.
 *
 * The register matters as much as the arithmetic. These strings are the agent speaking, and the
 * agent quotes the client verbatim, names what things became, and says "none" as a word rather
 * than printing a zero.
 */
import { describe, it, expect, vi } from 'vitest';

// `plan-answers` borrows `shortDate` from the engine, whose barrel re-exports `@sprigly/db` and
// its DATABASE_URL-parsing client. These are pure functions and need no database.
vi.mock('@sprigly/db', () => ({ db: {}, sql: {} }));

import { answerIdeasQuestion, answerPlanQuestion, datesNamedIn } from './plan-answers';
import type { IdeaView } from './ideas';
import type { DraftBeatView } from './types';

const CYCLE = 'cyc-sep';

const idea = (over: Partial<IdeaView> = {}): IdeaView => ({
  id: 'i1', content: 'make Fridays more personal', createdAt: '2026-06-14T09:00:00.000Z',
  state: 'waiting', usedInMonth: null, usedInCycleId: null, postId: null, postTitle: null,
  ...over,
});

const used = (content: string, postTitle: string | null = null, over: Partial<IdeaView> = {}): IdeaView =>
  idea({ content, postTitle, state: 'used', usedInMonth: 'September 2026', usedInCycleId: CYCLE, ...over });

const beat = (date: string, title: string, format: DraftBeatView['format'] = 'reel'): DraftBeatView => ({
  id: `b-${date}`, cycleId: CYCLE, date, format, pillar: 'Style', title, position: 1,
  slotType: 'proven', evidence: { basis: 'observed' }, assumptions: [],
});

describe('the ideas answer', () => {
  it('names each idea in her words and the beat it became', () => {
    const lines = answerIdeasQuestion({
      ideas: [used('Shoot the provenance story on film', 'Where the cloth comes from')],
      cycleId: CYCLE, monthLabel: 'September 2026',
    });
    expect(lines[0]).toBe('One of your ideas is in September 2026:');
    expect(lines[1]).toBe('· “Shoot the provenance story on film” — became Where the cloth comes from');
  });

  it('quotes her sentence rather than paraphrasing it', () => {
    // Everywhere else on this surface her words are shown verbatim and in quotation marks. An
    // answer that summarised them would be the one place we rewrote what she said back at her.
    const lines = answerIdeasQuestion({
      ideas: [used('make Fridays more personal')],
      cycleId: CYCLE, monthLabel: 'September 2026',
    });
    expect(lines[1]).toContain('“make Fridays more personal”');
  });

  it('counts and lists several', () => {
    const lines = answerIdeasQuestion({
      ideas: [used('a', 'Post A'), used('b', 'Post B', { id: 'i2' }), used('c', null, { id: 'i3' })],
      cycleId: CYCLE, monthLabel: 'September 2026',
    });
    expect(lines[0]).toBe('3 of your ideas are in September 2026:');
    expect(lines).toHaveLength(4);
  });

  it('drops the "became" clause when no beat recorded the link', () => {
    // `beat_meta.sourceRef` is not guaranteed. Saying "became" with nothing after it, or
    // inventing a title, are both worse than stating the idea alone.
    const lines = answerIdeasQuestion({
      ideas: [used('a thing she said')],
      cycleId: CYCLE, monthLabel: 'September 2026',
    });
    expect(lines[1]).toBe('· “a thing she said”');
    expect(lines[1]).not.toContain('became');
  });

  it('counts only THIS month — the question said "this month"', () => {
    const lines = answerIdeasQuestion({
      ideas: [
        used('in September', 'Post A'),
        idea({ id: 'i2', content: 'in July', state: 'used', usedInCycleId: 'cyc-jul', usedInMonth: 'July 2026' }),
      ],
      cycleId: CYCLE, monthLabel: 'September 2026',
    });
    expect(lines[0]).toBe('One of your ideas is in September 2026:');
    expect(lines.join('\n')).not.toContain('in July');
  });

  it('says none, in words, and offers the ones still waiting', () => {
    const lines = answerIdeasQuestion({
      ideas: [idea({ state: 'waiting' }), idea({ id: 'i2', state: 'deferred' })],
      cycleId: CYCLE, monthLabel: 'September 2026',
    });
    expect(lines[0]).toBe('None of your ideas went into September 2026.');
    expect(lines[1]).toContain('2 are still waiting');
    expect(lines.join(' ')).not.toMatch(/\b0 /);
  });

  it('tells a client who has said nothing yet how it works, not that they have none', () => {
    // Two different nothings. "None of your ideas went in" is true and useless to someone who
    // has never sent one; it reads as a judgement rather than an invitation.
    const lines = answerIdeasQuestion({ ideas: [], cycleId: CYCLE, monthLabel: 'September 2026' });
    expect(lines[0]).toContain('haven’t sent us anything yet');
  });

  it('does not offer "still waiting" when nothing is', () => {
    const lines = answerIdeasQuestion({
      ideas: [idea({ state: 'set-aside' })],
      cycleId: CYCLE, monthLabel: 'September 2026',
    });
    expect(lines).toEqual(['None of your ideas went into September 2026.']);
  });
});

describe('the plan answer', () => {
  const BEATS = [
    beat('2026-09-05', 'Weekend Style Guide', 'carousel'),
    beat('2026-09-14', 'The linen shirt, a year on', 'single'),
    beat('2026-09-22', 'Five ways, one coat', 'carousel'),
  ];

  it('reads the month back, dated and in order', () => {
    const lines = answerPlanQuestion({ beats: BEATS, monthLabel: 'September 2026' });
    expect(lines[0]).toBe('3 posts across September 2026:');
    expect(lines[1]).toBe('· Sat 5 Sep — Weekend Style Guide (carousel)');
  });

  it('narrows to a date the question named', () => {
    const lines = answerPlanQuestion({ beats: BEATS, monthLabel: 'September 2026', dates: ['2026-09-14'] });
    expect(lines[0]).toBe('One post on Mon 14 Sep:');
    expect(lines).toHaveLength(2);
  });

  it('says nothing is planned for a day that holds nothing — the day, not the month', () => {
    const lines = answerPlanQuestion({ beats: BEATS, monthLabel: 'September 2026', dates: ['2026-09-09'] });
    expect(lines).toEqual(['Nothing is planned for Wed 9 Sep.']);
  });

  it('says the month is empty rather than printing a zero', () => {
    const lines = answerPlanQuestion({ beats: [], monthLabel: 'September 2026' });
    expect(lines).toEqual(['Nothing is planned for September 2026 yet.']);
  });
});

describe('the dates a question named', () => {
  it('resolves bare ordinals against the plan month', () => {
    expect(datesNamedIn('is there anything on the 14th?', '2026-09')).toEqual(['2026-09-14']);
    expect(datesNamedIn('what about the 3rd and the 21st?', '2026-09'))
      .toEqual(['2026-09-03', '2026-09-21']);
  });

  it('resolves NOTHING for a relative phrase, on purpose', () => {
    // "Next week" depends on today, not on the month on screen, and getting that wrong is the
    // exact bug X1a was raised for — an answer about October to a question asked on 31 July.
    // Resolving nothing widens the answer to the whole month, which is honest: the client sees
    // everything and finds the day themselves.
    expect(datesNamedIn('what’s planned next week', '2026-09')).toEqual([]);
    expect(datesNamedIn('anything happening this weekend?', '2026-09')).toEqual([]);
  });

  it('ignores an impossible day', () => {
    expect(datesNamedIn('the 41st', '2026-09')).toEqual([]);
  });
});
