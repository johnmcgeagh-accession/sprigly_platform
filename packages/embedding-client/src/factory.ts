import { z } from 'zod';
import { BedrockTitanClient } from './bedrock-titan-client.js';
import { EMBEDDING_DIMENSIONS } from './types.js';
import type { EmbeddingClient } from './types.js';

// Anthropic has no embeddings endpoint. Embeddings always use Bedrock Titan,
// regardless of MODEL_PROVIDER. This schema is therefore not branched on
// MODEL_PROVIDER — it is always required.
const embeddingSchema = z.object({
  AWS_REGION:                    z.string().default('eu-west-2'),
  BEDROCK_AWS_ACCESS_KEY_ID:     z.string().optional(),
  BEDROCK_AWS_SECRET_ACCESS_KEY: z.string().optional(),
  BEDROCK_EMBED_MODEL_ID:        z.string().default('amazon.titan-embed-text-v2:0'),
  BEDROCK_EMBED_CONCURRENCY:     z.coerce.number().int().positive().default(5),
}).refine(
  (d) => !!d.BEDROCK_AWS_ACCESS_KEY_ID === !!d.BEDROCK_AWS_SECRET_ACCESS_KEY,
  {
    message:
      'BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY must both be set or both be absent — ' +
      'omit both to use an IAM role, or set both to use an explicit IAM user',
  },
);

/**
 * Assert that the client's output dimension matches EMBEDDING_DIMENSIONS.
 * Throws at startup if a different model is configured, preventing silent
 * schema/provider mismatches from reaching the database.
 */
function assertDimensions(client: EmbeddingClient): void {
  if (client.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `[embedding] Dimension mismatch: provider reports ${client.dimensions}D but the ` +
      `knowledge_chunks schema expects ${EMBEDDING_DIMENSIONS}D (vector(${EMBEDDING_DIMENSIONS})). ` +
      `Update BEDROCK_EMBED_MODEL_ID to a ${EMBEDDING_DIMENSIONS}-dimension model or ` +
      `re-create the vector column with the correct dimensions.`,
    );
  }
}

export function createEmbeddingClientFromEnv(): EmbeddingClient {
  const env = embeddingSchema.parse(process.env);

  const credentials =
    env.BEDROCK_AWS_ACCESS_KEY_ID && env.BEDROCK_AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: env.BEDROCK_AWS_ACCESS_KEY_ID, secretAccessKey: env.BEDROCK_AWS_SECRET_ACCESS_KEY }
      : undefined;

  console.info(
    `[embedding] Provider: bedrock/titan model=${env.BEDROCK_EMBED_MODEL_ID} ` +
    `region=${env.AWS_REGION} dimensions=${EMBEDDING_DIMENSIONS} concurrency=${env.BEDROCK_EMBED_CONCURRENCY}`,
  );

  const client = new BedrockTitanClient(
    env.AWS_REGION,
    EMBEDDING_DIMENSIONS,
    env.BEDROCK_EMBED_MODEL_ID,
    env.BEDROCK_EMBED_CONCURRENCY,
    credentials,
  );

  assertDimensions(client);

  return client;
}
