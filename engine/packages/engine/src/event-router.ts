import { db as _db, routingRules } from '@sprigly/db';
import type { RoutingRule as DbRoutingRule } from '@sprigly/db';
import { eq, and, desc } from 'drizzle-orm';
import type {
  IncomingEvent,
  MatchCondition,
  RoutingRule,
  SourceType,
  DestinationConfig,
} from './types.js';

type Db = typeof _db;

export function extractField(event: IncomingEvent, field: string): string {
  if (field === 'body') return event.content.text;
  return String(event.sourceMetadata[field] ?? '');
}

export function evaluateCondition(condition: MatchCondition, event: IncomingEvent): boolean {
  const raw = extractField(event, condition.field);

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

export function evaluateConditions(conditions: MatchCondition[], event: IncomingEvent): boolean {
  return conditions.every((c) => evaluateCondition(c, event));
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
  };
}

export class EventRouter {
  constructor(private db: Db) {}

  async route(event: IncomingEvent): Promise<RoutingRule[]> {
    const rows = await this.db
      .select()
      .from(routingRules)
      .where(
        and(
          eq(routingRules.clientId, event.clientId),
          eq(routingRules.source, event.source),
          eq(routingRules.enabled, true),
        ),
      )
      .orderBy(desc(routingRules.priority));

    return rows.map(toEngineRule).filter((rule) => evaluateConditions(rule.match.conditions, event));
  }
}
