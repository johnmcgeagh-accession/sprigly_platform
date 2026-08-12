/**
 * receipt-items.test.ts — a draft receipt as the next turn's parser reads it.
 *
 * The pairing that matters is with `threadForParser`: these items exist ONLY to be serialised
 * by it, so the assertions run the real serialiser rather than inspecting the item shapes. An
 * item that is structurally correct and serialises to something a parser cannot resolve against
 * would pass a shape test and fail the client.
 */
import { describe, it, expect, vi } from 'vitest';

// `threadForParser` is a pure function in a module that also holds the table reads, so importing
// it pulls in the db client and its env schema. The serialiser is the point of this file, so the
// db is stubbed rather than the serialiser mocked.
vi.mock('@sprigly/db', () => ({ db: {}, conversations: {}, agentMessages: {} }));

import type { BeatDelta } from '@sprigly/engine';
import { receiptItems } from './receipt-items';
import { threadForParser, type ConversationTurn } from './agent/conversation';

const beat = (id: string, title: string, date = '2026-11-17') =>
  ({ id, date, format: 'reel', pillar: 'brand', title });

const turn = (content: string, items?: ReturnType<typeof receiptItems>): ConversationTurn => ({
  id: 'm1', role: 'assistant', content, source: 'web', createdAt: '2026-11-01T00:00:00Z',
  ...(items?.length ? { items } : {}),
});

describe('a month-scoped receipt becomes one change item per delta', () => {
  it('serialises a move with ISO dates — the form a later reference resolves against', () => {
    const deltas: BeatDelta[] = [
      { type: 'moved', beat: beat('b1', 'Ethical, without cutting corners'), from: '2026-11-17', to: '2026-11-10' },
      { type: 'moved', beat: beat('b2', 'Maybe pushing a product that is a jumper'), from: '2026-11-17', to: '2026-11-10' },
    ];
    const line = threadForParser([turn('Moved: …', receiptItems({ scope: 'month_scoped', deltas }))]);
    expect(line).toBe(
      'ASSISTANT: move "Ethical, without cutting corners" 2026-11-17 → 2026-11-10;'
      + ' move "Maybe pushing a product that is a jumper" 2026-11-17 → 2026-11-10',
    );
  });

  it('carries EVERY beat a multi-beat move touched — "those" has three referents, not one', () => {
    const deltas: BeatDelta[] = ['b1', 'b2', 'b3'].map((id) => (
      { type: 'moved' as const, beat: beat(id, `post ${id}`), from: '2026-11-17', to: '2026-11-10' }
    ));
    expect(receiptItems({ scope: 'month_scoped', deltas })).toHaveLength(3);
  });

  it('maps add, remove, format and rename to their own actions', () => {
    const deltas: BeatDelta[] = [
      { type: 'added', beat: beat('b1', 'Maggie', '2026-11-11') },
      { type: 'removed', beat: beat('b2', 'Old one', '2026-11-04') },
      { type: 'reformatted', beat: beat('b3', 'Jumper'), from: 'reel', to: 'carousel' },
      { type: 'retitled', beat: beat('b4', 'x'), from: 'Was', to: 'Now' },
    ];
    expect(receiptItems({ scope: 'month_scoped', deltas }).map((i) => i.kind === 'change' && i.action))
      .toEqual(['add', 'remove', 'format', 'rewrite']);
  });
});

describe('what is deliberately left as prose', () => {
  it('a question keeps its answer — the answer is what a follow-up refers to', () => {
    const answer = 'November 2026 has 3 empty dates: 2026-11-01, 2026-11-11 and 2026-11-15.';
    expect(receiptItems({ scope: 'question' })).toEqual([]);
    expect(threadForParser([turn(answer)])).toBe(`ASSISTANT: ${answer}`);
  });

  it('a month-scoped receipt with NO deltas keeps its note rather than claiming a failure', () => {
    // `unresolved` is the only other item shape available and threadForParser labels it
    // "could not do:" — which would tell the next turn a kept month context had failed.
    expect(receiptItems({ scope: 'month_scoped', deltas: [] })).toEqual([]);
  });
});

describe('a filing says it was FILED', () => {
  it('becomes an idea item, so the next turn knows nothing on the month moved', () => {
    const items = receiptItems({ scope: 'evergreen', sourceText: 'I only wanted one of those moving' });
    expect(threadForParser([turn('We’ve kept this for later…', items)]))
      .toBe('ASSISTANT: saved idea: "I only wanted one of those moving"');
  });

  it('an evergreen receipt with no source text contributes nothing rather than an empty idea', () => {
    expect(receiptItems({ scope: 'evergreen', sourceText: '   ' })).toEqual([]);
  });

  it('a missing receipt is not an error', () => {
    expect(receiptItems(null)).toEqual([]);
    expect(receiptItems(undefined)).toEqual([]);
  });
});
