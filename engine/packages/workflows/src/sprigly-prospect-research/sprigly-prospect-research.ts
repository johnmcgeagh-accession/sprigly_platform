import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import { render, renderNoData, registerFonts } from '@sprigly/pdf-render';
import type { ProspectBriefData } from '@sprigly/pdf-render';
import type { ProspectInput, ProspectOutput } from './types.js';
import { parseProspectInput } from './parse-input.js';

registerFonts();

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: 'Search the web for information about a company, person, or topic.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'A short, specific search query (1-6 words). Use source-specific terms like "site:linkedin.com" when appropriate. Do not repeat a query you have already used.',
      },
    },
    required: ['query'],
  },
};

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
    // ── Step 1: Research (Sonnet + custom web_search via Tavily) ─────────────
    const searchCount = { total: 0, empty: 0 };

    const toolHandlers: Record<string, (input: unknown) => Promise<unknown>> = {
      web_search: async (rawInput: unknown): Promise<unknown> => {
        const { query } = rawInput as { query: string };
        searchCount.total++;
        if (ctx.search === undefined) return { results: '(no results)' };
        const results = await ctx.search.search(query);
        if (results.length === 0) {
          searchCount.empty++;
          return { results: '(no results)' };
        }
        return {
          results: results.map((r) => `**${r.title}**\n${r.url}\n${r.content}`).join('\n\n---\n\n'),
        };
      },
    };

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
      toolHandlers,
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

    // If Tavily was available but every search returned nothing, skip the write
    // step and return a minimal fallback rather than a blank brief.
    const noDataAvailable =
      ctx.search !== undefined &&
      searchCount.total >= 10 &&
      searchCount.empty === searchCount.total;

    if (noDataAvailable) {
      const pdf = await renderNoData(input.brandName);
      return { pdf, noDataAvailable: true };
    }

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
