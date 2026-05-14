import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import type { ProspectInput, ProspectOutput } from './types.js';

const SYSTEM =
  'You are an AI implementation consultant assessing where AI can save time for owner-managed professional services firms. ' +
  'Be specific and practical. Always respond with valid JSON when asked. ' +
  'CRITICAL: NEVER USE EM DASHES (—) in any output. No exceptions. ' +
  'BAD: "Your work isn\'t good—it is." GOOD: "Your work is good. That is not the problem." ' +
  'Use commas, full stops, or parentheses instead.';

function buildPrompt(input: ProspectInput): string {
  const lines = [
    'Research this prospect firm and identify where AI could save them the most time.',
    '',
    `Firm: ${input.brandName}`,
    `Sector: ${input.sector}`,
  ];
  if (input.url)   lines.push(`Website: ${input.url}`);
  if (input.notes) lines.push(`Notes: ${input.notes}`);
  lines.push(
    '',
    'Respond ONLY with valid JSON matching this exact structure:',
    '{',
    `  "brandName": "${input.brandName}",`,
    `  "sector": "${input.sector}",`,
    '  "painPoints": ["pain point 1", "pain point 2", "pain point 3"],',
    '  "aiUseCases": [',
    '    {"useCase": "description of task", "estimatedHoursSaved": "X hrs/week", "difficulty": "quick-win"}',
    '  ],',
    '  "recommendedFirstStep": "single specific first action to take",',
    '  "callTalkingPoints": ["talking point 1", "talking point 2", "talking point 3"]',
    '}',
    '',
    'difficulty must be one of: "quick-win", "medium", or "complex".',
    '',
    'Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.',
  );
  return lines.join('\n');
}

function extractJson(text: string): unknown {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (match?.[1] ?? text).trim();
  return JSON.parse(raw);
}

export const spriglyProspectResearchWorkflow: Workflow<ProspectInput, ProspectOutput> = {
  id: 'sprigly-prospect-research',
  defaultDestination: {
    destinationId: 'db-save-output',
    requireApproval: true,
    settings: {},
  },

  parseInput(event: IncomingEvent): ProspectInput | null {
    const structured = event.content.structured;
    if (!structured || typeof structured['brandName'] !== 'string') return null;
    const result: ProspectInput = {
      brandName: structured['brandName'] as string,
      sector:    (structured['sector'] as string | undefined) ?? '',
    };
    const url   = structured['url']   as string | undefined;
    const notes = structured['notes'] as string | undefined;
    if (url   !== undefined) result.url   = url;
    if (notes !== undefined) result.notes = notes;
    return result;
  },

  async run(input: ProspectInput, ctx: WorkflowContext): Promise<ProspectOutput> {
    const result = await ctx.model.complete({
      model:     'haiku',
      system:    SYSTEM,
      messages:  [{ role: 'user', content: buildPrompt(input) }],
      maxTokens: 1000,
    });

    await ctx.audit.logModelCall({
      clientId:     ctx.clientId,
      eventId:      ctx.eventId,
      runId:        ctx.runId,
      modelId:      result.modelId,
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
      action:       'prospect-research',
    });

    return extractJson(result.content) as ProspectOutput;
  },
};
