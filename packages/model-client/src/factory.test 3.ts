import { describe, it, expect, afterEach } from 'vitest';
import { ResolvedModelClient } from './model-resolver.js';
import { createModelClientFromEnv } from './factory.js';

const BEDROCK_VARS = {
  BEDROCK_MODEL_ID_HAIKU:  'eu.anthropic.claude-haiku-3-5-20251001-v1:0',
  BEDROCK_MODEL_ID_SONNET: 'eu.anthropic.claude-sonnet-4-5-20251001-v1:0',
  BEDROCK_MODEL_ID_OPUS:   'eu.anthropic.claude-opus-4-7-20250514-v1:0',
};

afterEach(() => {
  for (const key of [
    'MODEL_PROVIDER', 'ANTHROPIC_API_KEY', 'AWS_REGION',
    'BEDROCK_MODEL_ID_HAIKU', 'BEDROCK_MODEL_ID_SONNET', 'BEDROCK_MODEL_ID_OPUS',
    'BEDROCK_AWS_ACCESS_KEY_ID', 'BEDROCK_AWS_SECRET_ACCESS_KEY',
  ]) {
    delete process.env[key];
  }
});

describe('createModelClientFromEnv', () => {
  it('returns a ResolvedModelClient for anthropic provider', () => {
    process.env['MODEL_PROVIDER'] = 'anthropic';
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const client = createModelClientFromEnv();
    expect(client).toBeInstanceOf(ResolvedModelClient);
  });

  it('returns a ResolvedModelClient for bedrock provider', () => {
    process.env['MODEL_PROVIDER'] = 'bedrock';
    Object.assign(process.env, BEDROCK_VARS);
    const client = createModelClientFromEnv();
    expect(client).toBeInstanceOf(ResolvedModelClient);
  });

  it('throws when MODEL_PROVIDER is missing', () => {
    expect(() => createModelClientFromEnv()).toThrow();
  });

  it('throws when MODEL_PROVIDER=anthropic but ANTHROPIC_API_KEY missing', () => {
    process.env['MODEL_PROVIDER'] = 'anthropic';
    expect(() => createModelClientFromEnv()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('throws when MODEL_PROVIDER=bedrock but BEDROCK_MODEL_ID_* vars missing', () => {
    process.env['MODEL_PROVIDER'] = 'bedrock';
    expect(() => createModelClientFromEnv()).toThrow(/BEDROCK_MODEL_ID_HAIKU/);
  });
});
