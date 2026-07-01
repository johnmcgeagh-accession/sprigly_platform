#!/usr/bin/env tsx
/**
 * Parity eval harness.
 *
 * Runs every fixture in eval-inputs/ through both Anthropic and Bedrock,
 * evaluates assertions per provider independently, and writes a markdown report.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker eval:harness           # both providers
 *   pnpm --filter @sprigly/worker eval:harness:anthropic  # Anthropic only
 *   pnpm --filter @sprigly/worker eval:harness:bedrock    # Bedrock only
 *
 * Env (from .env.local):
 *   ANTHROPIC_API_KEY
 *   BEDROCK_MODEL_ID_HAIKU, BEDROCK_MODEL_ID_SONNET, BEDROCK_MODEL_ID_OPUS
 *   AWS_REGION (default eu-west-2)
 *   BEDROCK_AWS_ACCESS_KEY_ID, BEDROCK_AWS_SECRET_ACCESS_KEY (or IAM role)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  AnthropicClient,
  BedrockClient,
  ResolvedModelClient,
  ANTHROPIC_DEFAULTS,
  type ModelClient,
} from '@sprigly/model-client';
import {
  WorkflowRegistry,
  type WorkflowContext,
  type AuditLogger,
  type PromptResolver,
  type ClientConfig,
} from '@sprigly/engine';
import {
  spriglyBlogPostWorkflow,
  spriglyProspectResearchWorkflow,
  workflowMeta,
} from '@sprigly/workflows';
import type { BlogPostOutput } from '@sprigly/workflows';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_INPUTS_DIR  = join(__dirname, '..', 'eval-inputs');
const EVAL_RESULTS_DIR = join(__dirname, '..', 'eval-results');

// ── Provider flag ─────────────────────────────────────────────────────────────

const PROVIDER_FLAG = process.argv[2]; // 'anthropic' | 'bedrock' | undefined (= both)
const RUN_ANTHROPIC = PROVIDER_FLAG !== 'bedrock';
const RUN_BEDROCK   = PROVIDER_FLAG !== 'anthropic';

// ── Env ───────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  ANTHROPIC_API_KEY:             z.string().optional(),
  AWS_REGION:                    z.string().default('eu-west-2'),
  BEDROCK_AWS_ACCESS_KEY_ID:     z.string().optional(),
  BEDROCK_AWS_SECRET_ACCESS_KEY: z.string().optional(),
  BEDROCK_MODEL_ID_HAIKU:        z.string().optional(),
  BEDROCK_MODEL_ID_SONNET:       z.string().optional(),
  BEDROCK_MODEL_ID_OPUS:         z.string().optional(),
});

// ── GBP cost rates (approximate, informational only) ─────────────────────────
// Based on published USD rates converted at ~0.79 GBP/USD

const GBP_RATES: Record<string, Record<string, { in: number; out: number }>> = {
  anthropic: {
    haiku:  { in: 0.0000006,  out: 0.0000032  }, // £0.63/MTok in, £3.15/MTok out
    sonnet: { in: 0.0000024,  out: 0.0000118  }, // £2.37/MTok in, £11.85/MTok out
    opus:   { in: 0.0000118,  out: 0.0000593  }, // £11.85/MTok in, £59.25/MTok out
  },
  bedrock: {
    // Cross-region inference ~1.15× markup on direct rates
    haiku:  { in: 0.00000069, out: 0.00000368 },
    sonnet: { in: 0.00000275, out: 0.00001361 },
    opus:   { in: 0.00001361, out: 0.00006821 },
  },
};

function costGbp(provider: string, model: string, inTok: number, outTok: number): number {
  const r = GBP_RATES[provider]?.[model];
  if (!r) return 0;
  return inTok * r.in + outTok * r.out;
}

// ── Fixture types ─────────────────────────────────────────────────────────────

interface FixtureAssertions {
  lengthMin?:       number;
  lengthMax?:       number;
  mustContain?:     string[];
  mustNotContain?:  string[];
  requiredSections?: string[];
  isValidJson?:     boolean;
}

interface EvalFixture {
  id:           string;
  workflowId:   string;
  input:        Record<string, unknown>;
  assertions:   FixtureAssertions;
}

// ── Result types ──────────────────────────────────────────────────────────────

type ResultStatus = 'pass' | 'fail' | 'skip' | 'error';

interface AssertionResult {
  name:    string;
  passed:  boolean;
  detail:  string;
}

interface FixtureResult {
  fixtureId:    string;
  provider:     string;
  status:       ResultStatus;
  skipReason?:  string;
  error?:       string;
  durationMs:   number;
  inputTokens:  number;
  outputTokens: number;
  costGbp:      number;
  modelId:      string;
  assertions:   AssertionResult[];
  outputBody:   string;
}

// ── Built-in prompt resolver ──────────────────────────────────────────────────
// These are the default prompts used when no client-specific template exists.
// The blog post workflow injects variables via {{placeholder}} syntax.

const BUILTIN_PROMPTS: Record<string, string> = {
  'sprigly-blog-post/research': [
    'CRITICAL RULES — FOLLOW EXACTLY:',
    '- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.',
    '  BAD: "Your work isn\'t good—it is." GOOD: "Your work is good. That is not the problem."',
    '  Use commas, full stops, or parentheses instead.',
    '',
    'Research the following blog post topic. Identify SEO angles, common reader questions, and supporting data.',
    '',
    'Topic: {{topic}}',
    '',
    'Respond ONLY with valid JSON:',
    '{',
    '  "targetKeyword": "primary SEO keyword phrase",',
    '  "angles": ["angle 1", "angle 2", "angle 3"],',
    '  "faq": [',
    '    {"question": "Specific question readers ask?", "answer": "Direct, practical answer."},',
    '    {"question": "Another common question?", "answer": "Another answer."}',
    '  ],',
    '  "researchNotes": "key supporting points, stats, and examples"',
    '}',
    '',
    'Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.',
  ].join('\n'),

  'sprigly-blog-post/structure': [
    'CRITICAL RULES — FOLLOW EXACTLY:',
    '- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.',
    '  BAD: "Your work isn\'t good—it is." GOOD: "Your work is good. That is not the problem."',
    '  Use commas, full stops, or parentheses instead.',
    '',
    'Generate a title, excerpt, meta description, category, and CTA for this blog post.',
    '',
    'Topic: {{topic}}',
    'Research: {{research}}',
    '',
    'Respond ONLY with valid JSON:',
    '{',
    '  "title": "Compelling, specific blog title (no em dashes)",',
    '  "excerpt": "2-3 sentence excerpt that stands alone.",',
    '  "metaDescription": "Under 160 characters. Specific and useful.",',
    '  "category": "Category name",',
    '  "cta": "Single sentence call to action"',
    '}',
    '',
    'Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.',
  ].join('\n'),

  'sprigly-blog-post/write': [
    'CRITICAL RULES — FOLLOW EXACTLY:',
    '- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.',
    '  BAD: "Your work isn\'t good—it is." GOOD: "Your work is good. That is not the problem."',
    '  Use commas, full stops, or parentheses instead.',
    '- Do not use: "seamlessly", "unlock", "empower", "leverage", "game-changer", "delve", "in today\'s", "it\'s worth noting".',
    '',
    'Write the full blog post body in Markdown. Target 700-900 words.',
    'Do not include a title heading. Write for the owner of a small professional services firm.',
    'Style: professional, practical, direct. No corporate filler. Every sentence earns its place.',
    '',
    'Title: {{title}}',
    'Target keyword: {{keyword}}',
    'Research: {{research}}',
    '',
    'Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.',
  ].join('\n'),
};

class EvalPromptResolver implements PromptResolver {
  async resolve(_clientId: string, workflowId: string, stepName: string): Promise<string> {
    const key    = `${workflowId}/${stepName}`;
    const prompt = BUILTIN_PROMPTS[key];
    if (prompt === undefined) {
      throw new Error(`No built-in eval prompt for ${workflowId}/${stepName} — add it to BUILTIN_PROMPTS`);
    }
    return prompt;
  }
}

// ── Eval audit logger ─────────────────────────────────────────────────────────

function makeConsoleAuditLogger(fixtureId: string): AuditLogger {
  return {
    async logModelCall(params) {
      process.stdout.write(
        `    [audit:${fixtureId}] ${params.action ?? 'model'} ${params.modelId} ` +
        `in=${params.inputTokens} out=${params.outputTokens}\n`,
      );
    },
  };
}

// ── Default eval client config ────────────────────────────────────────────────

const EVAL_CLIENT_CONFIG: ClientConfig = {
  id:          'eval',
  clientId:    'eval',
  brandVoice:  'Professional, practical, direct. Polished without being corporate. Every sentence earns its place.',
  signature:   'The Sprigly Team',
  authorName:  'Sprigly',
  settings:    { model: 'haiku' },
};

// ── Assertion evaluation ──────────────────────────────────────────────────────

function getAssertionTarget(workflowId: string, output: unknown): string {
  if (workflowId === 'sprigly-blog-post') {
    return (output as BlogPostOutput).body ?? '';
  }
  // For structured JSON outputs (prospect research etc.) — stringify the whole object
  return typeof output === 'string' ? output : JSON.stringify(output);
}

function hasRequiredSection(workflowId: string, output: unknown, section: string): boolean {
  if (workflowId === 'sprigly-blog-post') {
    // 'faq' → output.faq must be a non-empty array
    const o = output as Record<string, unknown>;
    const val = o[section];
    return Array.isArray(val) && val.length > 0;
  }
  // For prospect research: section is a top-level field that must be a non-empty array
  const o = output as Record<string, unknown>;
  const val = o[section];
  return Array.isArray(val) && val.length > 0;
}

function evaluateAssertions(
  fixture: EvalFixture,
  output: unknown,
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const a = fixture.assertions;
  const target = getAssertionTarget(fixture.workflowId, output);

  if (a.lengthMin !== undefined) {
    const passed = target.length >= a.lengthMin;
    results.push({
      name:   'lengthMin',
      passed,
      detail: `${target.length} chars (min ${a.lengthMin})`,
    });
  }

  if (a.lengthMax !== undefined) {
    const passed = target.length <= a.lengthMax;
    results.push({
      name:   'lengthMax',
      passed,
      detail: `${target.length} chars (max ${a.lengthMax})`,
    });
  }

  if (a.mustContain) {
    for (const phrase of a.mustContain) {
      const passed = target.toLowerCase().includes(phrase.toLowerCase());
      results.push({
        name:   'mustContain',
        passed,
        detail: passed ? `"${phrase}" ✓` : `"${phrase}" NOT FOUND`,
      });
    }
  }

  if (a.mustNotContain) {
    for (const phrase of a.mustNotContain) {
      const idx = target.toLowerCase().indexOf(phrase.toLowerCase());
      const passed = idx === -1;
      results.push({
        name:   'mustNotContain',
        passed,
        detail: passed ? `"${phrase}" absent ✓` : `"${phrase}" found at position ${idx}`,
      });
    }
  }

  if (a.requiredSections) {
    for (const section of a.requiredSections) {
      const passed = hasRequiredSection(fixture.workflowId, output, section);
      results.push({
        name:   'requiredSections',
        passed,
        detail: passed ? `${section} present ✓` : `${section} missing or empty`,
      });
    }
  }

  if (a.isValidJson === true) {
    let passed = false;
    let detail = '';
    try {
      const candidate = typeof output === 'object' ? output : JSON.parse(target);
      passed = candidate !== null && typeof candidate === 'object';
      detail = passed ? 'valid JSON object ✓' : 'not an object';
    } catch {
      detail = 'JSON parse failed';
    }
    results.push({ name: 'isValidJson', passed, detail });
  }

  return results;
}

// ── Fixture runner ────────────────────────────────────────────────────────────

async function runFixture(
  fixture: EvalFixture,
  provider: string,
  client: ModelClient,
  registry: WorkflowRegistry,
  logicalModel: string,
): Promise<FixtureResult> {
  const base: Omit<FixtureResult, 'status' | 'assertions' | 'outputBody' | 'durationMs' | 'inputTokens' | 'outputTokens' | 'costGbp' | 'modelId'> = {
    fixtureId: fixture.id,
    provider,
  };

  // Opus skip on Bedrock
  if (provider === 'bedrock') {
    const meta = workflowMeta.find((w) => w.id === fixture.workflowId);
    const needsOpus = meta?.steps.some((s) => s.model === 'opus') ?? false;
    if (needsOpus) {
      console.log(`    SKIPPED: ${fixture.id} requires opus, not available on Bedrock`);
      return { ...base, status: 'skip', skipReason: 'requires opus, not available on Bedrock', durationMs: 0, inputTokens: 0, outputTokens: 0, costGbp: 0, modelId: '—', assertions: [], outputBody: '' };
    }
  }

  const workflow = registry.get(fixture.workflowId);
  if (!workflow) {
    return { ...base, status: 'error', error: `Workflow not registered: ${fixture.workflowId}`, durationMs: 0, inputTokens: 0, outputTokens: 0, costGbp: 0, modelId: '—', assertions: [], outputBody: '' };
  }

  // Track cumulative tokens across all model calls in the run
  let totalIn  = 0;
  let totalOut = 0;
  let lastModelId = '';

  const trackingClient: ModelClient = {
    async complete(params) {
      const result = await client.complete(params);
      totalIn     += result.inputTokens;
      totalOut    += result.outputTokens;
      lastModelId  = result.modelId;
      return result;
    },
  };

  const ctx: WorkflowContext = {
    clientId:     'eval',
    clientConfig: EVAL_CLIENT_CONFIG,
    model:        trackingClient,
    audit:        makeConsoleAuditLogger(fixture.id),
    prompts:      new EvalPromptResolver(),
    eventId:      'eval',
    runId:        `eval-${Date.now()}`,
    dryRun:       true,
  };

  const t0 = Date.now();
  try {
    const output    = await workflow.run(fixture.input as never, ctx);
    const durationMs = Date.now() - t0;
    const cost      = costGbp(provider, logicalModel, totalIn, totalOut);
    const assertions = evaluateAssertions(fixture, output);
    const passed    = assertions.every((a) => a.passed);
    const target    = getAssertionTarget(fixture.workflowId, output);

    return {
      ...base,
      status:       passed ? 'pass' : 'fail',
      durationMs,
      inputTokens:  totalIn,
      outputTokens: totalOut,
      costGbp:      cost,
      modelId:      lastModelId,
      assertions,
      outputBody:   target.slice(0, 300),
    };
  } catch (err) {
    return {
      ...base,
      status:       'error',
      error:        String(err),
      durationMs:   Date.now() - t0,
      inputTokens:  totalIn,
      outputTokens: totalOut,
      costGbp:      0,
      modelId:      lastModelId,
      assertions:   [],
      outputBody:   '',
    };
  }
}

// ── Report generator ──────────────────────────────────────────────────────────

function generateReport(
  fixtures: EvalFixture[],
  results: FixtureResult[],
  providers: string[],
  startTime: Date,
  elapsedMs: number,
): string {
  const byProvider = (p: string) => results.filter((r) => r.provider === p);

  const summary = providers.map((p) => {
    const rs      = byProvider(p);
    const passed  = rs.filter((r) => r.status === 'pass').length;
    const failed  = rs.filter((r) => r.status === 'fail').length;
    const skipped = rs.filter((r) => r.status === 'skip').length;
    const totalCost = rs.reduce((s, r) => s + r.costGbp, 0);
    const perRun  = rs.length > 0 ? totalCost / rs.filter(r => r.status !== 'skip').length : 0;
    return { p, passed, failed, skipped, total: rs.length, totalCost, perRun };
  });

  // Regression / improvement analysis (only when both providers ran)
  let regressions  = 0;
  let improvements = 0;
  if (providers.length === 2) {
    for (const f of fixtures) {
      const a = results.find((r) => r.fixtureId === f.id && r.provider === 'anthropic');
      const b = results.find((r) => r.fixtureId === f.id && r.provider === 'bedrock');
      if (!a || !b) continue;
      if (a.status === 'pass' && b.status === 'fail') regressions++;
      if (a.status === 'fail' && b.status === 'pass') improvements++;
    }
  }

  const lines: string[] = [];

  lines.push(`# Eval run — ${startTime.toISOString()}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  for (const s of summary) {
    lines.push(`- **${s.p}**: ${s.passed}/${s.total} passed, ${s.failed} failed, ${s.skipped} skipped`);
  }
  if (providers.length === 2) {
    lines.push(`- **Regressions** (passed on Anthropic, failed on Bedrock): ${regressions}`);
    lines.push(`- **Improvements** (failed on Anthropic, passed on Bedrock): ${improvements}`);
  }
  lines.push(`- **Duration**: ${(elapsedMs / 1000).toFixed(1)}s`);
  lines.push('');

  // Cost
  lines.push('## Cost');
  lines.push('');
  for (const s of summary) {
    const pct = summary.length === 2 && s.p === 'bedrock' && summary[0]!.totalCost > 0
      ? ` (+${(((s.totalCost / summary[0]!.totalCost) - 1) * 100).toFixed(0)}%)`
      : '';
    lines.push(`- **${s.p}**: £${s.totalCost.toFixed(4)} total, avg £${s.perRun.toFixed(4)}/run${pct}`);
  }
  lines.push('*(Approximate GBP rates at ~0.79 GBP/USD. Informational only.)*');
  lines.push('');

  // Per-fixture
  lines.push('## Per-fixture results');
  lines.push('');

  for (const fixture of fixtures) {
    const fixtureResults = results.filter((r) => r.fixtureId === fixture.id);
    const allPass = fixtureResults.every((r) => r.status === 'pass' || r.status === 'skip');
    const icon = allPass ? '✅' : '❌';

    lines.push(`### ${icon} ${fixture.id} — ${fixture.input['topic'] ?? fixture.input['brandName'] ?? fixture.id}`);
    lines.push('');

    for (const r of fixtureResults) {
      if (r.status === 'skip') {
        lines.push(`- **${r.provider}**: SKIPPED — ${r.skipReason}`);
      } else if (r.status === 'error') {
        lines.push(`- **${r.provider}**: ERROR — ${r.error}`);
      } else {
        const label   = r.status === 'pass' ? 'PASS' : 'FAIL';
        const timeS   = (r.durationMs / 1000).toFixed(1);
        lines.push(`- **${r.provider}**: ${label} (${timeS}s, ${r.inputTokens.toLocaleString()} in / ${r.outputTokens.toLocaleString()} out tokens, £${r.costGbp.toFixed(4)})`);
      }
    }
    lines.push('');

    // Assertion summary for first non-skip result (they share the same assertion names)
    const referenceResult = fixtureResults.find((r) => r.assertions.length > 0);
    if (referenceResult) {
      const names = [...new Set(referenceResult.assertions.map((a) => a.name))];
      const checkLine = names.map((name) => {
        const allProvidersPassed = fixtureResults.every(
          (r) => r.status === 'skip' || r.assertions.filter((a) => a.name === name).every((a) => a.passed),
        );
        return `${name} ${allProvidersPassed ? '✓' : '✗'}`;
      });
      lines.push(`Assertions: ${checkLine.join('  ')}`);
      lines.push('');
    }
  }

  // Failed assertions detail
  const failures = results.filter((r) => r.status === 'fail');
  if (failures.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Failed assertions');
    lines.push('');
    for (const r of failures) {
      lines.push(`### ${r.fixtureId} (${r.provider}) — FAIL`);
      lines.push('');
      for (const a of r.assertions.filter((a) => !a.passed)) {
        lines.push(`- **${a.name}**: ${a.detail}`);
      }
      if (r.outputBody) {
        lines.push('');
        lines.push(`Output preview (first 300 chars):`);
        lines.push('```');
        lines.push(r.outputBody.replace(/```/g, '~~~'));
        lines.push('```');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = new Date();
  const env = envSchema.parse(process.env);

  // Build model clients
  const activeProviders: Array<{ name: string; client: ModelClient; logicalModel: string }> = [];

  if (RUN_ANTHROPIC) {
    if (!env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }
    activeProviders.push({
      name: 'anthropic',
      client: new ResolvedModelClient(new AnthropicClient(env.ANTHROPIC_API_KEY), ANTHROPIC_DEFAULTS),
      logicalModel: 'haiku',
    });
  }

  if (RUN_BEDROCK) {
    if (!env.BEDROCK_MODEL_ID_HAIKU || !env.BEDROCK_MODEL_ID_SONNET || !env.BEDROCK_MODEL_ID_OPUS) {
      console.error('BEDROCK_MODEL_ID_HAIKU/SONNET/OPUS required for Bedrock runs');
      process.exit(1);
    }
    const bedrockCreds =
      env.BEDROCK_AWS_ACCESS_KEY_ID && env.BEDROCK_AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: env.BEDROCK_AWS_ACCESS_KEY_ID, secretAccessKey: env.BEDROCK_AWS_SECRET_ACCESS_KEY }
        : undefined;
    activeProviders.push({
      name: 'bedrock',
      client: new ResolvedModelClient(
        new BedrockClient(env.AWS_REGION, bedrockCreds),
        { haiku: env.BEDROCK_MODEL_ID_HAIKU, sonnet: env.BEDROCK_MODEL_ID_SONNET, opus: env.BEDROCK_MODEL_ID_OPUS },
      ),
      logicalModel: 'haiku',
    });
  }

  if (activeProviders.length === 0) { console.error('No providers selected'); process.exit(1); }

  // Load fixtures
  const fixtureFiles = readdirSync(EVAL_INPUTS_DIR).filter((f) => f.endsWith('.json')).sort();
  const fixtures: EvalFixture[] = fixtureFiles.flatMap((file) => {
    const raw = JSON.parse(readFileSync(join(EVAL_INPUTS_DIR, file), 'utf-8')) as unknown;
    return Array.isArray(raw) ? (raw as EvalFixture[]) : [raw as EvalFixture];
  });

  console.log(`[eval-harness] ${fixtures.length} fixtures, ${activeProviders.map((p) => p.name).join(' + ')}`);

  // Build workflow registry
  const registry = new WorkflowRegistry();
  registry.register(spriglyBlogPostWorkflow);
  registry.register(spriglyProspectResearchWorkflow);

  // Run
  const results: FixtureResult[] = [];

  for (const fixture of fixtures) {
    console.log(`\n[${fixture.id}] workflowId=${fixture.workflowId}`);
    for (const { name, client, logicalModel } of activeProviders) {
      process.stdout.write(`  ${name}... `);
      const result = await runFixture(fixture, name, client, registry, logicalModel);
      results.push(result);

      if (result.status === 'skip') {
        console.log(`SKIP — ${result.skipReason}`);
      } else if (result.status === 'error') {
        console.log(`ERROR — ${result.error?.slice(0, 80)}`);
      } else {
        const failNames = result.assertions.filter((a) => !a.passed).map((a) => a.name);
        const label = result.status === 'pass'
          ? `PASS (${(result.durationMs / 1000).toFixed(1)}s, ${result.inputTokens}+${result.outputTokens} tok, £${result.costGbp.toFixed(4)})`
          : `FAIL [${failNames.join(', ')}]`;
        console.log(label);
      }
    }
  }

  // Report
  const providerNames = activeProviders.map((p) => p.name);
  const elapsedMs = Date.now() - startTime.getTime();
  const report = generateReport(fixtures, results, providerNames, startTime, elapsedMs);

  const timestamp = startTime.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath   = join(EVAL_RESULTS_DIR, `${timestamp}.md`);
  mkdirSync(EVAL_RESULTS_DIR, { recursive: true });
  writeFileSync(outPath, report, 'utf-8');

  // Stdout summary
  console.log('\n' + '═'.repeat(60));
  for (const s of providerNames) {
    const rs      = results.filter((r) => r.provider === s);
    const passed  = rs.filter((r) => r.status === 'pass').length;
    const failed  = rs.filter((r) => r.status === 'fail').length;
    const skipped = rs.filter((r) => r.status === 'skip').length;
    const cost    = rs.reduce((sum, r) => sum + r.costGbp, 0);
    console.log(`${s}: ${passed}/${rs.length} passed, ${failed} failed, ${skipped} skipped  £${cost.toFixed(4)}`);
  }
  console.log(`Report: ${outPath}`);
  console.log('═'.repeat(60));

  // Exit code
  if (providerNames.length === 2) {
    const aFails = results.filter((r) => r.provider === 'anthropic' && r.status === 'fail').length;
    const bFails = results.filter((r) => r.provider === 'bedrock'   && r.status === 'fail').length;
    if (bFails > aFails) {
      console.error(`\nREGRESSION: Bedrock has ${bFails - aFails} more failure(s) than Anthropic`);
      process.exit(1);
    }
    if (bFails < aFails) {
      console.warn(`\nIMPROVEMENT: Bedrock has ${aFails - bFails} fewer failure(s) than Anthropic`);
    }
  } else {
    const fails = results.filter((r) => r.status === 'fail').length;
    if (fails > 0) process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('[eval-harness] FATAL:', err);
  process.exit(1);
});
