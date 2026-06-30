import { z } from 'zod';
import { AnthropicClient } from './anthropic-client.js';
import { BedrockClient } from './bedrock-client.js';
import { ResolvedModelClient, ANTHROPIC_DEFAULTS } from './model-resolver.js';
import type { ModelClient } from './types.js';

const baseSchema = z.object({
  MODEL_PROVIDER: z.enum(['anthropic', 'bedrock']),
});

const anthropicSchema = baseSchema.extend({
  MODEL_PROVIDER: z.literal('anthropic'),
  ANTHROPIC_API_KEY:     z.string({ message: 'ANTHROPIC_API_KEY is required when MODEL_PROVIDER=anthropic' }),
  ANTHROPIC_MODEL_ID_HAIKU:  z.string().optional(),
  ANTHROPIC_MODEL_ID_SONNET: z.string().optional(),
  ANTHROPIC_MODEL_ID_OPUS:   z.string().optional(),
});

// Bedrock: all three model IDs required — no hardcoded defaults (they expire).
const bedrockSchema = baseSchema.extend({
  MODEL_PROVIDER: z.literal('bedrock'),
  AWS_REGION:                    z.string().default('eu-west-2'),
  BEDROCK_AWS_ACCESS_KEY_ID:     z.string().optional(),  // omit when running on an IAM role
  BEDROCK_AWS_SECRET_ACCESS_KEY: z.string().optional(),
  BEDROCK_MODEL_ID_HAIKU:  z.string({ message: 'BEDROCK_MODEL_ID_HAIKU is required — find IDs at: AWS Console → Amazon Bedrock → Model access → Cross-region inference' }),
  BEDROCK_MODEL_ID_SONNET: z.string({ message: 'BEDROCK_MODEL_ID_SONNET is required — find IDs at: AWS Console → Amazon Bedrock → Model access → Cross-region inference' }),
  BEDROCK_MODEL_ID_OPUS:   z.string({ message: 'BEDROCK_MODEL_ID_OPUS is required — find IDs at: AWS Console → Amazon Bedrock → Model access → Cross-region inference' }),
}).refine(
  (d) => !!d.BEDROCK_AWS_ACCESS_KEY_ID === !!d.BEDROCK_AWS_SECRET_ACCESS_KEY,
  { message: 'BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY must both be set or both be absent — create a dedicated IAM user at: AWS Console → IAM → Users → Create user' },
);

export function createModelClientFromEnv(): ModelClient {
  const { MODEL_PROVIDER } = baseSchema.parse(process.env);

  if (MODEL_PROVIDER === 'anthropic') {
    const env = anthropicSchema.parse(process.env);
    const map = {
      haiku:  env.ANTHROPIC_MODEL_ID_HAIKU  ?? ANTHROPIC_DEFAULTS.haiku,
      sonnet: env.ANTHROPIC_MODEL_ID_SONNET ?? ANTHROPIC_DEFAULTS.sonnet,
      opus:   env.ANTHROPIC_MODEL_ID_OPUS   ?? ANTHROPIC_DEFAULTS.opus,
    };
    // Point 1: map is built here at factory construction, not re-read per call.
    console.info(
      `[model-client] Model resolution: haiku→${map.haiku}, sonnet→${map.sonnet}, opus→${map.opus} (provider: anthropic)`,
    );
    return new ResolvedModelClient(new AnthropicClient(env.ANTHROPIC_API_KEY), map);
  }

  // bedrock — validation throws at startup if any ID is missing
  const env = bedrockSchema.parse(process.env);
  const map = {
    haiku:  env.BEDROCK_MODEL_ID_HAIKU,
    sonnet: env.BEDROCK_MODEL_ID_SONNET,
    opus:   env.BEDROCK_MODEL_ID_OPUS,
  };
  const bedrockCredentials =
    env.BEDROCK_AWS_ACCESS_KEY_ID && env.BEDROCK_AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: env.BEDROCK_AWS_ACCESS_KEY_ID, secretAccessKey: env.BEDROCK_AWS_SECRET_ACCESS_KEY }
      : undefined;
  console.info(
    `[model-client] Model resolution: haiku→${map.haiku}, sonnet→${map.sonnet}, opus→${map.opus} (provider: bedrock, region: ${env.AWS_REGION})`,
  );
  return new ResolvedModelClient(new BedrockClient(env.AWS_REGION, bedrockCredentials), map);
}
