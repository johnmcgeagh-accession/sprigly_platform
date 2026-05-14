import { describe, it, expect } from 'vitest';
import { extractField, evaluateCondition, evaluateConditions } from './event-router.js';
import type { IncomingEvent, MatchCondition } from './types.js';

const makeEvent = (overrides?: Partial<IncomingEvent>): IncomingEvent => ({
  id: 'evt-1',
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: { subject: 'Blog: AI Tools', from: 'john@example.com' },
  receivedAt: new Date(),
  content: { text: 'Blog: AI Tools in Healthcare' },
  reply: { channel: 'email', data: {} },
  ...overrides,
});

describe('extractField', () => {
  it('returns content.text for field "body"', () => {
    const event = makeEvent();
    expect(extractField(event, 'body')).toBe('Blog: AI Tools in Healthcare');
  });

  it('returns sourceMetadata value for other fields', () => {
    const event = makeEvent();
    expect(extractField(event, 'subject')).toBe('Blog: AI Tools');
    expect(extractField(event, 'from')).toBe('john@example.com');
  });

  it('returns empty string for missing fields', () => {
    const event = makeEvent();
    expect(extractField(event, 'missing-field')).toBe('');
  });
});

describe('evaluateCondition — equals', () => {
  it('matches exact value', () => {
    const cond: MatchCondition = { field: 'subject', op: 'equals', value: 'Blog: AI Tools', caseSensitive: true };
    expect(evaluateCondition(cond, makeEvent())).toBe(true);
  });

  it('does not match partial value', () => {
    const cond: MatchCondition = { field: 'subject', op: 'equals', value: 'Blog:', caseSensitive: true };
    expect(evaluateCondition(cond, makeEvent())).toBe(false);
  });
});

describe('evaluateCondition — contains', () => {
  it('matches substring', () => {
    const cond: MatchCondition = { field: 'body', op: 'contains', value: 'Healthcare' };
    expect(evaluateCondition(cond, makeEvent())).toBe(true);
  });

  it('does not match absent substring', () => {
    const cond: MatchCondition = { field: 'body', op: 'contains', value: 'Prospect' };
    expect(evaluateCondition(cond, makeEvent())).toBe(false);
  });
});

describe('evaluateCondition — startsWith / endsWith', () => {
  it('matches prefix', () => {
    const cond: MatchCondition = { field: 'subject', op: 'startsWith', value: 'Blog:' };
    expect(evaluateCondition(cond, makeEvent())).toBe(true);
  });

  it('matches suffix', () => {
    const cond: MatchCondition = { field: 'subject', op: 'endsWith', value: 'Tools' };
    expect(evaluateCondition(cond, makeEvent())).toBe(true);
  });
});

describe('evaluateCondition — regex', () => {
  it('matches regex pattern', () => {
    const cond: MatchCondition = { field: 'subject', op: 'regex', value: '^Blog:' };
    expect(evaluateCondition(cond, makeEvent())).toBe(true);
  });

  it('is case-insensitive by default', () => {
    const cond: MatchCondition = { field: 'subject', op: 'regex', value: '^blog:' };
    expect(evaluateCondition(cond, makeEvent())).toBe(true);
  });

  it('respects caseSensitive flag', () => {
    const cond: MatchCondition = { field: 'subject', op: 'regex', value: '^blog:', caseSensitive: true };
    expect(evaluateCondition(cond, makeEvent())).toBe(false);
  });
});

describe('evaluateCondition — case sensitivity', () => {
  it('is case-insensitive by default', () => {
    const cond: MatchCondition = { field: 'subject', op: 'contains', value: 'blog:' };
    expect(evaluateCondition(cond, makeEvent())).toBe(true);
  });

  it('is case-sensitive when caseSensitive: true', () => {
    const cond: MatchCondition = { field: 'subject', op: 'contains', value: 'blog:', caseSensitive: true };
    expect(evaluateCondition(cond, makeEvent())).toBe(false);
  });
});

describe('evaluateConditions', () => {
  it('returns true for empty conditions array (match all)', () => {
    expect(evaluateConditions([], makeEvent())).toBe(true);
  });

  it('returns true when all conditions match', () => {
    const conditions: MatchCondition[] = [
      { field: 'subject', op: 'startsWith', value: 'Blog:' },
      { field: 'body', op: 'contains', value: 'Healthcare' },
    ];
    expect(evaluateConditions(conditions, makeEvent())).toBe(true);
  });

  it('returns false when any condition fails', () => {
    const conditions: MatchCondition[] = [
      { field: 'subject', op: 'startsWith', value: 'Blog:' },
      { field: 'body', op: 'contains', value: 'Prospect' },
    ];
    expect(evaluateConditions(conditions, makeEvent())).toBe(false);
  });
});
