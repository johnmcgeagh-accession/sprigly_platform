#!/usr/bin/env tsx
/**
 * Scaffold a new Sprigly workflow.
 * Usage: pnpm new-workflow <name> [--with-pdf]
 *
 * Generates:
 *   packages/workflows/src/<name>/types.ts
 *   packages/workflows/src/<name>/parse-input.ts
 *   packages/workflows/src/<name>/<name>.ts
 *   packages/workflows/src/<name>/<name>.test.ts
 *   packages/db/migrations/<N>_<name>_prompts.sql
 *   [--with-pdf] packages/pdf-render/src/documents/<PascalName>.tsx
 *
 * Also updates:
 *   packages/workflows/src/index.ts  (appends exports)
 *   packages/workflows/src/meta.ts   (appends workflowMeta entry)
 */
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const withPdf = args.includes('--with-pdf');
const nameArg = args.find(a => !a.startsWith('-'));

if (!nameArg) {
  console.error('Usage: pnpm new-workflow <name> [--with-pdf]');
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(nameArg)) {
  console.error(
    `Error: name must be lowercase kebab-case (letters, digits, hyphens; start with a letter).\n` +
    `Got: "${nameArg}"`,
  );
  process.exit(1);
}

// ── Name derivations ──────────────────────────────────────────────────────────

const nameFull: string = nameArg.startsWith('sprigly-') ? nameArg : `sprigly-${nameArg}`;
const nameShort: string = nameFull.slice('sprigly-'.length);

function toCamel(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
function toPascal(s: string): string {
  const c = toCamel(s);
  return c.charAt(0).toUpperCase() + c.slice(1);
}
function toTitleCase(s: string): string {
  return s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const camelFull: string = toCamel(nameFull);      // spriglyMeetingPrep
const pascalFull: string = toPascal(nameFull);    // SpriglyMeetingPrep
const pascalShort: string = toPascal(nameShort);  // MeetingPrep
const titleCase: string = toTitleCase(nameShort); // Meeting Prep

// ── Paths ─────────────────────────────────────────────────────────────────────

const workflowsDir = resolve(ROOT, 'packages/workflows/src');
const workflowDir = resolve(workflowsDir, nameFull);
const migrationsDir = resolve(ROOT, 'packages/db/migrations');
const pdfDocDir = resolve(ROOT, 'packages/pdf-render/src/documents');

if (existsSync(workflowDir)) {
  console.error(`Error: workflow "${nameFull}" already exists at:\n  ${workflowDir}`);
  process.exit(1);
}

// ── Migration number ──────────────────────────────────────────────────────────

const migFiles = readdirSync(migrationsDir).filter(f => /^\d{4}_/.test(f));
const lastMigNum = migFiles.length > 0
  ? Math.max(...migFiles.map(f => parseInt(f.slice(0, 4), 10)))
  : -1;
const migNum: string = String(lastMigNum + 1).padStart(4, '0');
const migBaseName: string = `${migNum}_${nameFull.replace(/-/g, '_')}_prompts`;

// ── File generators ───────────────────────────────────────────────────────────

function genTypes(): string {
  return `export interface ${pascalFull}Input {
  topic: string;
  notes?: string;
  // TODO: add body fields your workflow needs
}

export interface ${pascalFull}Output {
  text: string;
  // TODO: replace with your actual output shape (add pdf: Buffer for PDF workflows)
}
`;
}

function genParseInput(): string {
  return `import type { IncomingEvent } from '@sprigly/engine';
import type { EmailInputSpec } from '@sprigly/sources';
import { parseEmailInput } from '@sprigly/sources';
import type { ${pascalFull}Input } from './types.js';

const SPEC: EmailInputSpec = {
  subjectPrefix: '${titleCase}:',
  bodyFields: [
    { key: 'notes', aliases: ['Notes'] },
    // TODO: add body fields your workflow needs
  ],
};

export function parse${pascalShort}Input(event: IncomingEvent): ${pascalFull}Input | null {
  const subject =
    (event.sourceMetadata['subject'] as string | undefined) ??
    (event.content.structured?.['subject'] as string | undefined) ??
    '';

  const rawBody = (event.content.text ?? '').replace(subject, '').trim();

  const parsed = parseEmailInput(subject, rawBody, SPEC);
  if (parsed === null) return null;

  const result: ${pascalFull}Input = { topic: parsed.primaryValue };

  const notes = parsed.bodyFields['notes'];
  if (notes !== undefined) result.notes = notes;

  return result;
}
`;
}

function genWorkflow(): string {
  return `import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import type { ${pascalFull}Input, ${pascalFull}Output } from './types.js';
import { parse${pascalShort}Input } from './parse-input.js';

// Duplicates substituteTemplate from @sprigly/destinations — extract to a shared
// utility when a third consumer arrives. See BACKLOG.md.
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\\{\\{(\\w+)\\}\\}/g, (_, key: string) => vars[key] ?? '');
}

export const ${camelFull}Workflow: Workflow<${pascalFull}Input, ${pascalFull}Output> = {
  id: '${nameFull}',
  defaultDestinations: [
    {
      destinationId: 'db-save-output',
      requireApproval: false,
      settings: {},
    },
  ],

  parseInput(event: IncomingEvent): ${pascalFull}Input | null {
    return parse${pascalShort}Input(event);
  },

  async run(input: ${pascalFull}Input, ctx: WorkflowContext): Promise<${pascalFull}Output> {
    // ── Step 1: Generate ──────────────────────────────────────────────────────
    const prompt = await ctx.prompts.resolve(ctx.clientId, '${nameFull}', 'generate');
    if (prompt.includes('__PROMPT_NOT_CUSTOMISED__')) {
      throw new Error(
        'Prompt template for ${nameFull} step "generate" has not been customised. ' +
        'Edit the prompt in the admin UI or in the seed migration before running.',
      );
    }

    const result = await ctx.model.complete({
      model: 'sonnet',
      messages: [{ role: 'user', content: fillTemplate(prompt, {
        topic: input.topic,
        notes: input.notes ?? '',
      }) }],
      maxTokens: 4000,
    });

    await ctx.audit.logModelCall({
      clientId:     ctx.clientId,
      eventId:      ctx.eventId,
      runId:        ctx.runId,
      modelId:      result.modelId,
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
      action:       '${nameShort}-generate',
    });

    // TODO: add further steps (write, render, etc.) here
    return { text: result.content };
  },
};
`;
}

function genTests(): string {
  const titleUpper = titleCase.toUpperCase();
  return `import { describe, it, expect, vi } from 'vitest';
import type { IncomingEvent, WorkflowContext, ClientConfig, ModelCompleteResult } from '@sprigly/engine';
import { parse${pascalShort}Input } from './parse-input.js';
import { ${camelFull}Workflow } from './${nameFull}.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeEvent = (subject: string, body = ''): IncomingEvent => ({
  id: 'evt-1',
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: { subject, from: 'john@example.com' },
  receivedAt: new Date(),
  content: { text: body === '' ? subject : (subject + '\\n' + body), structured: { subject } },
  reply: { channel: 'email', data: {} },
});

const mockModelResult = (content: string): ModelCompleteResult => ({
  content,
  inputTokens: 50,
  outputTokens: 200,
  modelId: 'claude-sonnet',
  stopReason: 'end_turn',
});

const makeCtx = (): WorkflowContext => ({
  clientId: 'client-1',
  clientConfig: {
    id: 'cfg-1', clientId: 'client-1',
    brandVoice: 'Direct and professional.',
    signature: 'John', authorName: 'John', settings: {},
  } satisfies ClientConfig,
  model:   { complete: vi.fn().mockResolvedValue(mockModelResult('Generated output.')) },
  audit:   { logModelCall: vi.fn().mockResolvedValue(undefined) },
  prompts: { resolve: vi.fn().mockResolvedValue('Prepare for: {{topic}}\\nNotes: {{notes}}') },
  eventId: 'evt-1',
  runId:   'run-1',
});

// ─── parse${pascalShort}Input ─────────────────────────────────────────────────

describe('parse${pascalShort}Input', () => {
  it('parses minimal valid input', () => {
    const result = parse${pascalShort}Input(makeEvent('${titleCase}: My Topic'));
    expect(result).toMatchObject({ topic: 'My Topic' });
  });

  it('parses notes body field', () => {
    // TODO: expand once you add more body fields to SPEC
    const result = parse${pascalShort}Input(makeEvent('${titleCase}: My Topic', 'Notes: bring slides'));
    expect(result).toMatchObject({ topic: 'My Topic', notes: 'bring slides' });
  });

  it('returns null for non-matching subject', () => {
    expect(parse${pascalShort}Input(makeEvent('Prospect: some firm'))).toBeNull();
  });

  it('returns null for empty primary value', () => {
    expect(parse${pascalShort}Input(makeEvent('${titleCase}:'))).toBeNull();
    expect(parse${pascalShort}Input(makeEvent('${titleCase}:   '))).toBeNull();
  });

  it('is case-insensitive on the prefix', () => {
    expect(parse${pascalShort}Input(makeEvent('${titleUpper}: Firm'))?.topic).toBe('Firm');
  });

  it('falls back to content.structured.subject when sourceMetadata has no subject', () => {
    const event: IncomingEvent = {
      ...makeEvent(''),
      sourceMetadata: {},
      content: { text: '${titleCase}: Fallback Firm', structured: { subject: '${titleCase}: Fallback Firm' } },
    };
    expect(parse${pascalShort}Input(event)?.topic).toBe('Fallback Firm');
  });
});

// ─── ${camelFull}Workflow.parseInput ──────────────────────────────────────────

describe('${camelFull}Workflow.parseInput', () => {
  it('delegates to parse${pascalShort}Input', () => {
    expect(${camelFull}Workflow.parseInput(makeEvent('${titleCase}: Firm')))
      .toMatchObject({ topic: 'Firm' });
    expect(${camelFull}Workflow.parseInput(makeEvent('Blog: not this workflow'))).toBeNull();
  });
});

// ─── ${camelFull}Workflow.run ─────────────────────────────────────────────────

describe('${camelFull}Workflow.run', () => {
  it('makes exactly 1 model call', async () => {
    // TODO: update this count when you add more steps
    const ctx = makeCtx();
    await ${camelFull}Workflow.run({ topic: 'My Topic' }, ctx);
    expect(ctx.model.complete).toHaveBeenCalledTimes(1);
  });

  it('resolves the generate prompt', async () => {
    const ctx = makeCtx();
    await ${camelFull}Workflow.run({ topic: 'My Topic' }, ctx);
    expect(vi.mocked(ctx.prompts.resolve).mock.calls[0]?.[2]).toBe('generate');
  });

  it('passes topic and notes into the prompt via template substitution', async () => {
    const ctx = makeCtx();
    await ${camelFull}Workflow.run({ topic: 'My Topic', notes: 'bring slides' }, ctx);
    const sentMessage = vi.mocked(ctx.model.complete).mock.calls[0]?.[0].messages[0]?.content ?? '';
    expect(sentMessage).toContain('My Topic');
    expect(sentMessage).toContain('bring slides');
    expect(sentMessage).not.toContain('{{topic}}');
    expect(sentMessage).not.toContain('{{notes}}');
  });

  it('uses sonnet model', async () => {
    const ctx = makeCtx();
    await ${camelFull}Workflow.run({ topic: 'Firm' }, ctx);
    expect(vi.mocked(ctx.model.complete).mock.calls[0]?.[0].model).toBe('sonnet');
  });

  it('logs audit with correct action name', async () => {
    const ctx = makeCtx();
    await ${camelFull}Workflow.run({ topic: 'Firm' }, ctx);
    expect(vi.mocked(ctx.audit.logModelCall).mock.calls[0]?.[0].action).toBe('${nameShort}-generate');
  });

  it('returns text output', async () => {
    const ctx = makeCtx();
    const output = await ${camelFull}Workflow.run({ topic: 'Firm' }, ctx);
    expect(typeof output.text).toBe('string');
    expect(output.text.length).toBeGreaterThan(0);
  });

  it('routes to db-save-output by default', () => {
    // TODO: add gmail-reply-with-attachment once output shape is confirmed
    const dest = ${camelFull}Workflow.defaultDestinations[0];
    expect(dest?.destinationId).toBe('db-save-output');
  });

  it('throws when prompt contains unedited sentinel', async () => {
    const ctx: WorkflowContext = {
      ...makeCtx(),
      prompts: { resolve: vi.fn().mockResolvedValue('__PROMPT_NOT_CUSTOMISED__\\nTODO: ...') },
    };
    await expect(
      ${camelFull}Workflow.run({ topic: 'Firm' }, ctx),
    ).rejects.toThrow('has not been customised');
  });
});
`;
}

function genMigration(): string {
  const dollarTag = nameFull.replace(/-/g, '_').toUpperCase() + '_GENERATE_PROMPT';
  const dq = '$' + dollarTag + '$';
  return `-- Seed shared default prompts (client_id = NULL) for ${nameFull}.
-- Replace the placeholder prompt text with your actual prompt before running.
--
-- Idempotent: guarded by WHERE NOT EXISTS.

--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "workflow_id", "step_name", "prompt_text", "version")
SELECT
  gen_random_uuid(),
  '${nameFull}',
  'generate',
  ${dq}
__PROMPT_NOT_CUSTOMISED__

TODO: Replace with the actual generate prompt for ${nameFull}.

Input variables available:
  {{topic}}   -- the primary value from the email subject line
  {{notes}}   -- optional notes from the email body

Output: ...
${dq},
  1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = '${nameFull}'
    AND "step_name" = 'generate'
    AND "version" = 1
);
`;
}

function genPdfComponent(): string {
  return `import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '../pdf-elements.js';
import { COLOURS, FONT, SPACING } from '../theme.js';

export interface ${pascalShort}Data {
  brandName: string;
  preparedAt: string;
  // TODO: add fields your document needs
}

const s = StyleSheet.create({
  page: {
    backgroundColor: COLOURS.white,
    paddingTop:        SPACING.xl,
    paddingBottom:     48,
    paddingHorizontal: SPACING.xl,
    fontFamily:        FONT.family,
  },
  header: {
    backgroundColor: COLOURS.coral,
    borderRadius: 6,
    padding: 18,
    marginBottom: SPACING.md,
  },
  eyebrow: {
    fontSize:       FONT.sizes.xs,
    fontFamily:     FONT.family,
    fontWeight:     500,
    color:          COLOURS.white,
    textTransform:  'uppercase',
    letterSpacing:  1.4,
    opacity:        0.8,
    marginBottom:   4,
  },
  title: {
    fontSize:   FONT.sizes.xxl,
    fontFamily: FONT.editorial,
    color:      COLOURS.white,
    lineHeight: 1.1,
  },
  meta: {
    fontSize:   FONT.sizes.sm,
    fontFamily: FONT.family,
    color:      COLOURS.white,
    opacity:    0.9,
    marginTop:  4,
  },
  sectionLabel: {
    fontSize:      FONT.sizes.xs,
    fontFamily:    FONT.family,
    fontWeight:    600,
    color:         COLOURS.navy,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom:  SPACING.sm,
    marginTop:     SPACING.md,
  },
  placeholder: {
    fontSize:   FONT.sizes.body,
    fontFamily: FONT.family,
    color:      COLOURS.midGrey,
    fontStyle:  'italic',
    lineHeight: 1.5,
  },
  footer: {
    position:         'absolute',
    bottom:           16,
    left:             SPACING.xl,
    right:            SPACING.xl,
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    borderTopWidth:   0.5,
    borderTopColor:   COLOURS.lightGrey,
    paddingTop:       6,
  },
  footerBrand: {
    fontSize:      FONT.sizes.xs,
    fontFamily:    FONT.family,
    fontWeight:    600,
    color:         COLOURS.coral,
    letterSpacing: 0.6,
  },
  footerMeta: {
    fontSize:   FONT.sizes.xs,
    fontFamily: FONT.family,
    color:      COLOURS.midGrey,
  },
});

function Footer({ brandName }: { brandName: string }) {
  return (
    <View fixed style={s.footer}>
      <Text style={s.footerBrand}>SPRIGLY</Text>
      <Text style={s.footerMeta}>{brandName} · Confidential</Text>
      <Text style={s.footerMeta} render={({ pageNumber, totalPages }) => String(pageNumber) + ' of ' + String(totalPages)} />
    </View>
  );
}

export function ${pascalShort}({ data }: { data: ${pascalShort}Data }) {
  return (
    <Document title={'${titleCase}: ' + data.brandName} author="Sprigly">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.eyebrow}>Sprigly · ${titleCase.toLowerCase()}</Text>
          <Text style={s.title}>{data.brandName}</Text>
          <Text style={s.meta}>{'Prepared: ' + data.preparedAt}</Text>
        </View>

        <Text style={s.sectionLabel}>Overview</Text>
        <Text style={s.placeholder}>
          TODO: Replace with rendered content from ${pascalShort}Data.
          Add sections here using the same View/Text pattern as ProspectBrief.
        </Text>

        <Footer brandName={data.brandName} />
      </Page>
    </Document>
  );
}
`;
}

// ── Write files ───────────────────────────────────────────────────────────────

mkdirSync(workflowDir, { recursive: true });

const files: Array<[string, string]> = [
  [resolve(workflowDir, 'types.ts'),                      genTypes()],
  [resolve(workflowDir, 'parse-input.ts'),                genParseInput()],
  [resolve(workflowDir, `${nameFull}.ts`),                genWorkflow()],
  [resolve(workflowDir, `${nameFull}.test.ts`),           genTests()],
  [resolve(migrationsDir, `${migBaseName}.sql`),          genMigration()],
];

if (withPdf) {
  files.push([resolve(pdfDocDir, `${pascalShort}.tsx`), genPdfComponent()]);
}

for (const [path, content] of files) {
  writeFileSync(path, content, 'utf-8');
  console.log('  created', path.replace(ROOT + '/', ''));
}

// ── Update packages/workflows/src/index.ts ────────────────────────────────────

const indexPath = resolve(workflowsDir, 'index.ts');
const indexAppend =
  `export { ${camelFull}Workflow } from './${nameFull}/${nameFull}.js';\n` +
  `export type { ${pascalFull}Input, ${pascalFull}Output } from './${nameFull}/types.js';\n`;
writeFileSync(indexPath, readFileSync(indexPath, 'utf-8') + indexAppend, 'utf-8');
console.log('  updated packages/workflows/src/index.ts');

// ── Update packages/workflows/src/meta.ts ─────────────────────────────────────

const metaPath = resolve(workflowsDir, 'meta.ts');
let metaContent = readFileSync(metaPath, 'utf-8');
const metaEntry =
  `  {\n` +
  `    id: '${nameFull}',\n` +
  `    name: '${titleCase}',\n` +
  `    description: 'TODO: describe what this workflow produces.',\n` +
  `    defaultDestinations: [\n` +
  `      { destinationId: 'db-save-output', requireApproval: false, settings: {} },\n` +
  `    ],\n` +
  `    steps: [\n` +
  `      { stepName: 'generate', stepDescription: 'TODO: describe this step.', model: 'sonnet', requiresPrompt: true },\n` +
  `    ],\n` +
  `  },\n`;
const closingBracket = metaContent.lastIndexOf('\n];');
if (closingBracket === -1) {
  console.warn('  warning: could not locate closing ]; in meta.ts — update it manually');
} else {
  metaContent =
    metaContent.slice(0, closingBracket + 1) +
    metaEntry +
    metaContent.slice(closingBracket + 1);
  writeFileSync(metaPath, metaContent, 'utf-8');
  console.log('  updated packages/workflows/src/meta.ts');
}

// ── Next steps ────────────────────────────────────────────────────────────────

const pdfStep = withPdf
  ? `\n8. Wire the PDF component into packages/pdf-render/src/render.ts:\n` +
    `   - Add '${nameFull}' to DocumentType and RenderParams\n` +
    `   - Add the render branch inside render()`
  : '';

console.log(`
✓ Generated ${nameFull} workflow.

Next steps:
1. Edit packages/workflows/src/${nameFull}/types.ts — define your input/output shape
2. Edit packages/workflows/src/${nameFull}/parse-input.ts — adjust subject prefix and body fields
3. Edit packages/workflows/src/${nameFull}/${nameFull}.ts — implement your steps
4. Edit packages/db/migrations/${migBaseName}.sql — write your prompt text
5. Run: pnpm db:migrate
6. Register in apps/worker/src/index.ts — import and call registry.register(${camelFull}Workflow)
7. Run: pnpm build && pnpm test${pdfStep}
`);
