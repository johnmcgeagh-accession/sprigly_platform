import { db as _db, routingRules } from '@sprigly/db';
import type { RoutingRule as DbRoutingRule } from '@sprigly/db';
import { eq, and, desc } from 'drizzle-orm';
import type {
  IncomingEventDraft,
  MatchCondition,
  RoutingRule,
  SourceType,
  DestinationConfig,
} from './types.js';

type Db = typeof _db;

export function extractField(draft: IncomingEventDraft, field: string): string {
  if (field === 'body') return draft.content.text;
  return String(draft.sourceMetadata[field] ?? '');
}

export function evaluateCondition(condition: MatchCondition, draft: IncomingEventDraft): boolean {
  const raw = extractField(draft, condition.field);

  if (condition.op === 'regex') {
    return new RegExp(condition.value, condition.caseSensitive ? '' : 'i').test(raw);
  }

  const val = condition.caseSensitive ? raw : raw.toLowerCase();
  const target = condition.caseSensitive ? condition.value : condition.value.toLowerCase();

  switch (condition.op) {
    case 'equals': return val === target;
    case 'contains': return val.includes(target);
    case 'startsWith': return val.startsWith(target);
    case 'endsWith': return val.endsWith(target);
  }
}

export function evaluateConditions(conditions: MatchCondition[], draft: IncomingEventDraft): boolean {
  return conditions.every((c) => evaluateCondition(c, draft));
}

// Pure function — no DB, no side effects. Apply loaded rules against a draft.
// Fallback rules only fire when no non-fallback (primary) rule matched.
export function matchRules(draft: IncomingEventDraft, rules: RoutingRule[]): RoutingRule[] {
  const matched = rules.filter((rule) => evaluateConditions(rule.match.conditions, draft));
  const primary = matched.filter((r) => !r.isFallback);
  if (primary.length > 0) return primary;
  return matched.filter((r) => r.isFallback);
}

function toEngineRule(row: DbRoutingRule): RoutingRule {
  return {
    id: row.id,
    clientId: row.clientId,
    enabled: row.enabled,
    match: {
      source: row.source as SourceType,
      conditions: (row.matchConditions as unknown as MatchCondition[]),
    },
    workflowId: row.workflowId,
    destinations: (row.destinations as unknown as DestinationConfig[]),
    clientConfigId: row.clientConfigId ?? '',
    priority: row.priority,
    isFallback: row.isFallback,
  };
}

export class EventRouter {
  constructor(private db: Db) {}

  // DB-only: fetch active rules for a client+source without evaluating them.
  async loadRules(clientId: string, source: SourceType): Promise<RoutingRule[]> {
    const rows = await this.db
      .select()
      .from(routingRules)
      .where(
        and(
          eq(routingRules.clientId, clientId),
          eq(routingRules.source, source),
          eq(routingRules.enabled, true),
        ),
      )
      .orderBy(desc(routingRules.priority));

    return rows.map(toEngineRule);
  }

  // Convenience wrapper: load rules then match. Works with any IncomingEventDraft (or IncomingEvent).
  async route(draft: IncomingEventDraft): Promise<RoutingRule[]> {
    const rules = await this.loadRules(draft.clientId, draft.source);
    return matchRules(draft, rules);
  }
}
