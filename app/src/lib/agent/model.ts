/**
 * agent/model.ts — lazy singletons for the model + embedding clients.
 *
 * The client app now makes synchronous Bedrock calls (the intent router and the
 * query answerer). Build the clients lazily on first use so importing this module
 * never crashes at cold start if the Bedrock env isn't present (e.g. a route that
 * only touches proposals). Requires MODEL_PROVIDER + AWS/Bedrock env in the app
 * runtime — the same config the engine uses.
 */
import { createModelClientFromEnv, type ModelClient } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv, type EmbeddingClient } from '@sprigly/embedding-client';
import { e2eFakeEnabled, makeFakeModelClient } from '@/lib/e2e-fake';

let modelClient: ModelClient | null = null;
let embeddingClient: EmbeddingClient | null = null;

export function getModelClient(): ModelClient {
  // e2e (non-prod, flag set): a canned client — never calls Bedrock.
  if (e2eFakeEnabled()) return makeFakeModelClient();
  if (!modelClient) modelClient = createModelClientFromEnv();
  return modelClient;
}

export function getEmbeddingClient(): EmbeddingClient {
  if (!embeddingClient) embeddingClient = createEmbeddingClientFromEnv();
  return embeddingClient;
}

/** Logical model for the agent's synchronous calls (fast + cheap). */
export const AGENT_MODEL = 'haiku';
