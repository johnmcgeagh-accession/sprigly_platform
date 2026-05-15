import { describe, it, expect } from 'vitest';
import { extractField, evaluateCondition, evaluateConditions, matchRules } from './event-router.js';
import type { IncomingEvent, IncomingEventDraft, MatchCondition, RoutingRule } from './types.js';

const makeDraft = (overrides?: Partial<IncomingEventDraft>): IncomingEventDraft => ({
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: { subject: 'Blog: AI Tools', from: 'john@example.com' },
  content: { text: 'Blog: AI Tools in Healthcare' },
  ...overrides,
});

function makeRule(overrides?: Partial<RoutingRule>): RoutingRule {
  return {
    id:             'rule-1',
    clientId:       'client-1',
    enabled:        true,
    match:          { source: 'email', conditions: [{ field: 'subject', op: 'startsWith', value: 'Blog:' }] },
    workflowId:     'blog-post',
    destinations:   [],
    clientConfigId: '',
    priority:       10,
    isFallback:     false,
    ...overrides,
  };
}

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
    // Array.every on [] is vacuously true — this is intentional for match-all rules
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

describe('matchRules — match-all (empty conditions)', () => {
  it('rule with empty conditions matches any draft', () => {
    const rule = makeRule({ match: { source: 'email', conditions: [] } });
    const draft = makeDraft({ sourceMetadata: { subject: 'Random subject' } });
    expect(matchRules(draft, [rule])).toHaveLength(1);
  });
});

describe('matchRules — primary vs fallback', () => {
  const blogDraft = makeDraft();
  const invoiceDraft = makeDraft({ sourceMetadata: { subject: 'Invoice: Q2' } });

  it('returns only primary rules when primary rules match', () => {
    const primary  = makeRule({ id: 'p1', isFallback: false });
    const fallback = makeRule({ id: 'f1', isFallback: true, match: { source: 'email', conditions: [] } });
    const result = matchRules(blogDraft, [primary, fallback]);
    expect(result.map((r) => r.id)).toEqual(['p1']);
  });

  it('returns fallback rules when no primary rules match', () => {
    const primary  = makeRule({ id: 'p1', isFallback: false, match: { source: 'email', conditions: [{ field: 'subject', op: 'startsWith', value: 'Prospect:' }] } });
    const fallback = makeRule({ id: 'f1', isFallback: true, match: { source: 'email', conditions: [] } });
    const result = matchRules(invoiceDraft, [primary, fallback]);
    expect(result.map((r) => r.id)).toEqual(['f1']);
  });

  it('returns empty when no primary and no fallback match', () => {
    const primary = makeRule({ id: 'p1', match: { source: 'email', conditions: [{ field: 'subject', op: 'startsWith', value: 'Prospect:' }] } });
    expect(matchRules(invoiceDraft, [primary])).toHaveLength(0);
  });

  it('returns both matching primaries, ignoring the fallback', () => {
    const p1 = makeRule({ id: 'p1', isFallback: false, priority: 20 });
    const p2 = makeRule({ id: 'p2', isFallback: false, priority: 10, match: { source: 'email', conditions: [{ field: 'subject', op: 'contains', value: 'AI' }] } });
    const f1 = makeRule({ id: 'f1', isFallback: true, match: { source: 'email', conditions: [] } });
    const result = matchRules(blogDraft, [p1, p2, f1]);
    expect(result.map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('preserves priority order within the fallback group', () => {
    const f1 = makeRule({ id: 'f1', isFallback: true, priority: 5,  match: { source: 'email', conditions: [] } });
    const f2 = makeRule({ id: 'f2', isFallback: true, priority: 20, match: { source: 'email', conditions: [] } });
    // rules already sorted desc by priority (as loadRules does)
    const result = matchRules(invoiceDraft, [f2, f1]);
    expect(result.map((r) => r.id)).toEqual(['f2', 'f1']);
  });
});
