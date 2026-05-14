import { db as _db, approvals } from '@sprigly/db';
import type { Destination, DestinationConfig, IncomingEvent, RoutingRule } from './types.js';

type Db = typeof _db;

export class DestinationDispatcher {
  private destinations = new Map<string, Destination>();

  constructor(private db: Db) {}

  register(destination: Destination): void {
    this.destinations.set(destination.id, destination);
  }

  async dispatch(
    output: unknown,
    event: IncomingEvent,
    rule: RoutingRule,
    runId: string,
    defaultDestination?: DestinationConfig,
  ): Promise<void> {
    const configs: DestinationConfig[] =
      rule.destinations.length > 0
        ? rule.destinations
        : defaultDestination !== undefined
          ? [defaultDestination]
          : [];

    if (configs.length === 0) {
      console.warn(
        `[engine] DestinationDispatcher: no destinations for rule=${rule.id} and no workflow default`,
      );
      return;
    }

    for (const config of configs) {
      const destination = this.destinations.get(config.destinationId);
      if (destination === undefined) {
        console.error(
          `[engine] DestinationDispatcher: no destination registered for id=${config.destinationId}`,
        );
        continue;
      }

      if (destination.requiresApproval(config)) {
        await this.db.insert(approvals).values({
          workflowRunId: runId,
          status: 'pending',
          outputSnapshot: output as Record<string, unknown>,
        });
        continue;
      }

      try {
        await destination.deliver(output, event, config, runId);
      } catch (err) {
        console.error(
          `[engine] DestinationDispatcher: delivery failed for destination=${config.destinationId}: ${String(err)}`,
        );
      }
    }
  }
}
