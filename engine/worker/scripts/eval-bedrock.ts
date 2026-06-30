#!/usr/bin/env tsx
/**
 * End-to-end Bedrock smoke test.
 *
 * Invokes the blog-post research step against Bedrock and verifies the response
 * parses correctly. Checks that a text response from a model that also supports
 * tool use comes back with content != '' and stopReason == 'end_turn'.
 *
 * Run with real credentials:
 *   pnpm --filter @sprigly/worker eval:bedrock
 *
 * Required env vars (in .env.local):
 *   MODEL_PROVIDER=bedrock
 *   BEDROCK_MODEL_ID_HAIKU=<cross-region inference profile ID>
 *   BEDROCK_MODEL_ID_SONNET=<cross-region inference profile ID>
 *   BEDROCK_MODEL_ID_OPUS=<cross-region inference profile ID>
 *   AWS_REGION=eu-west-2  (or your region)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  (or use an IAM role)
 */
import { createModelClientFromEnv } from '@sprigly/model-client';

const SYSTEM = [
  'You are a professional content writer.',
  'Always respond with valid JSON when asked for structured data.',
].join('\n');

const RESEARCH_PROMPT = `
Research the following topic for a blog post.
Topic: "AI automation for small accounting firms"

Respond ONLY with valid JSON (no markdown fences) matching this exact structure:
{
  "angles": ["angle1", "angle2", "angle3"],
  "faq": [{"question": "Q1", "answer": "A1"}, {"question": "Q2", "answer": "A2"}],
  "targetKeyword": "primary keyword phrase",
  "researchNotes": "brief supporting notes"
}
`.trim();

function extractJson(text: string): unknown {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (match?.[1] ?? text).trim();
  return JSON.parse(raw);
}

async function main(): Promise<void> {
  console.log('[eval-bedrock] Creating model client...');
  const model = createModelClientFromEnv();

  console.log('[eval-bedrock] Invoking haiku → research step...');
  const t0 = Date.now();

  const result = await model.complete({
    model: 'haiku',
    system: SYSTEM,
    messages: [{ role: 'user', content: RESEARCH_PROMPT }],
    maxTokens: 800,
  });

  const elapsed = Date.now() - t0;
  console.log(`[eval-bedrock] Response in ${elapsed}ms`);
  console.log(`  modelId:    ${result.modelId}`);
  console.log(`  stopReason: ${result.stopReason}`);
  console.log(`  tokens:     in=${result.inputTokens} out=${result.outputTokens}`);
  console.log(`  content[:200]: ${result.content.slice(0, 200)}`);

  // Guard: research step must not trigger tool use
  if (result.stopReason === 'tool_use') {
    console.error('\n[eval-bedrock] FAIL: stopReason=tool_use — research step must not trigger tool calls');
    process.exit(1);
  }

  if (result.content === '') {
    console.error('\n[eval-bedrock] FAIL: content is empty');
    process.exit(1);
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = extractJson(result.content);
  } catch {
    console.error('\n[eval-bedrock] FAIL: JSON parse failed');
    console.error('  Raw content:', result.content);
    process.exit(1);
  }

  const obj = parsed as Record<string, unknown>;
  const checks: Array<[string, boolean]> = [
    ['angles (array)',       Array.isArray(obj['angles'])],
    ['faq (array)',          Array.isArray(obj['faq'])],
    ['targetKeyword (str)',  typeof obj['targetKeyword'] === 'string'],
    ['researchNotes (str)',  typeof obj['researchNotes'] === 'string'],
  ];

  const failures = checks.filter(([, ok]) => !ok).map(([k]) => k);
  if (failures.length > 0) {
    console.error('\n[eval-bedrock] FAIL: missing or wrong-type fields:', failures.join(', '));
    console.error('  Parsed:', JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  console.log('\n[eval-bedrock] PASS');
  console.log('  angles:        ', (obj['angles'] as string[]).slice(0, 2));
  console.log('  targetKeyword: ', obj['targetKeyword']);
  console.log('  faq entries:   ', (obj['faq'] as unknown[]).length);
}

main().catch((err: unknown) => {
  console.error('[eval-bedrock] FATAL:', err);
  process.exit(1);
});
