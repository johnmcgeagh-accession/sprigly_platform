import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import { render, registerFonts } from '@sprigly/pdf-render';
import type { ProspectBriefData } from '@sprigly/pdf-render';
import type { ProspectInput, ProspectOutput } from './types.js';
import { parseProspectInput } from './parse-input.js';

registerFonts();

// Anthropic built-in web search tool (server-side — Anthropic executes searches).
const WEB_SEARCH_TOOL = {
  type:  'web_search_20250305',
  name:  'web_search',
} as const;

// Enforced on the write step so the JSON output never contains em-dashes.
export const WRITE_SYSTEM =
  'You are a prospect researcher for Sprigly, an AI implementation consultancy. ' +
  'Respond ONLY with valid JSON matching the ProspectBriefData schema. ' +
  'CRITICAL: NEVER USE EM DASHES (—) in any output. No exceptions. ' +
  'Use commas, full stops, or parentheses instead.';

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}

export const spriglyProspectResearchWorkflow: Workflow<ProspectInput, ProspectOutput> = {
  id: 'sprigly-prospect-research',
  defaultDestinations: [
    {
      destinationId: 'db-save-output',
      requireApproval: false,
      settings: {},
    },
    {
      destinationId: 'gmail-reply-prospect-brief',
      requireApproval: false,
      settings: { to: 'sender' },
    },
  ],

  parseInput(event: IncomingEvent): ProspectInput | null {
    return parseProspectInput(event);
  },

  async run(input: ProspectInput, ctx: WorkflowContext): Promise<ProspectOutput> {
    // ── Step 1: Research (Sonnet + web_search) ────────────────────────────────
    const researchPrompt = await ctx.prompts.resolve(
      ctx.clientId,
      'sprigly-prospect-research',
      'research',
    );
    const researchResult = await ctx.model.complete({
      model: 'sonnet',
      messages: [{ role: 'user', content: fillTemplate(researchPrompt, buildTemplateVars(input)) }],
      maxTokens: 8000,
      tools: [WEB_SEARCH_TOOL],
    });
    await ctx.audit.logModelCall({
      clientId:     ctx.clientId,
      eventId:      ctx.eventId,
      runId:        ctx.runId,
      modelId:      researchResult.modelId,
      inputTokens:  researchResult.inputTokens,
      outputTokens: researchResult.outputTokens,
      action:       'prospect-research',
      ...(researchResult.toolTurns !== undefined && {
        metadata: { toolTurns: researchResult.toolTurns },
      }),
    });

    // ── Step 2: Write (Sonnet, no tools) ─────────────────────────────────────
    const writePrompt = await ctx.prompts.resolve(
      ctx.clientId,
      'sprigly-prospect-research',
      'write',
    );
    const writeResult = await ctx.model.complete({
      model:  'sonnet',
      system: WRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: fillTemplate(writePrompt, {
          ...buildTemplateVars(input),
          research: researchResult.content,
        }),
      }],
      maxTokens: 8000,
    });
    await ctx.audit.logModelCall({
      clientId:     ctx.clientId,
      eventId:      ctx.eventId,
      runId:        ctx.runId,
      modelId:      writeResult.modelId,
      inputTokens:  writeResult.inputTokens,
      outputTokens: writeResult.outputTokens,
      action:       'prospect-write',
    });

    const data = extractJson(writeResult.content) as ProspectBriefData;

    // ── Step 3: Render PDF ────────────────────────────────────────────────────
    const pdf = await render('prospect-brief', data);

    return { data, pdf };
  },
};

function buildTemplateVars(input: ProspectInput): Record<string, string> {
  return {
    brandName:     input.brandName,
    url:           input.url           ?? '',
    sector:        input.sector        ?? '',
    meetingDate:   input.meetingDate   ?? '',
    whyInterested: input.whyInterested ?? '',
    notes:         input.notes         ?? '',
  };
}
