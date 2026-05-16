import { db as _db, approvals } from '@sprigly/db';
import type { Destination, DestinationConfig, IncomingEvent, RoutingRule } from './types.js';
import { stripBuffers } from './strip-buffers.js';

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
    defaultDestinations?: DestinationConfig[],
  ): Promise<void> {
    const configs: DestinationConfig[] =
      rule.destinations.length > 0
        ? rule.destinations
        : (defaultDestinations ?? []);

    if (configs.length === 0) {
      console.warn(
        `[engine] DestinationDispatcher: no destinations for rule=${rule.id} and no workflow defaults`,
      );
      return;
    }

    const deliveryCtx = { runId, workflowId: rule.workflowId, clientId: event.clientId };

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
          outputSnapshot: stripBuffers(output) as Record<string, unknown>,
        });
        continue;
      }

      try {
        await destination.deliver(output, event, config, deliveryCtx);
      } catch (err) {
        console.error(
          `[engine] DestinationDispatcher: delivery failed for destination=${config.destinationId}: ${String(err)}`,
        );
      }
    }
  }
}
