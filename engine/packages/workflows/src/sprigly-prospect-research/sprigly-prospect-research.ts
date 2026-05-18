import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import { render, renderNoData, registerFonts } from '@sprigly/pdf-render';
import type { ProspectBriefData } from '@sprigly/pdf-render';
import type { ProspectInput, ProspectOutput } from './types.js';
import { parseProspectInput } from './parse-input.js';
import { WEB_SEARCH_TOOL_DEFINITION, handleWebSearchTool, WebSearchError } from '@sprigly/web-search';

registerFonts();

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
      destinationId: 'gmail-reply-with-attachment',
      requireApproval: false,
      settings: {
        to: { mode: 'sender' },
        subjectTemplate: 'Prospect brief: {{brandName}}',
        bodyTemplate:
          'Prospect brief ready: {{brandName}}\n\n' +
          '- What they do: {{summaryBullet1}}\n' +
          '- Top pipeline: {{summaryBullet2}}\n' +
          '- Key risk: {{summaryBullet3}}\n\n' +
          'PDF attached.',
        attachmentFilenameTemplate: '{{brandName}}-prospect-brief.pdf',
      },
    },
  ],

  parseInput(event: IncomingEvent): ProspectInput | null {
    return parseProspectInput(event);
  },

  async run(input: ProspectInput, ctx: WorkflowContext): Promise<ProspectOutput> {
    // ── Step 1: Research (Sonnet + web_search via Tavily) ─────────────────────
    const searchCount = { total: 0, empty: 0 };

    const toolHandlers: Record<string, (input: unknown) => Promise<unknown>> = {
      web_search: async (rawInput: unknown): Promise<unknown> => {
        const { query } = rawInput as { query: string };
        searchCount.total++;
        if (ctx.search === undefined) return { results: '(no results)' };
        try {
          const result = await handleWebSearchTool(ctx.search, query);
          if (result.results === '(no results)') searchCount.empty++;
          return result;
        } catch (err) {
          if (err instanceof WebSearchError) {
            // Structured context lands in workflow_runs.error and Railway logs via BullMQ error handler
            throw new WebSearchError(err.message, err.options);
          }
          throw err;
        }
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
      tools: [WEB_SEARCH_TOOL_DEFINITION],
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
      return { pdf, noDataAvailable: true, brandName: input.brandName };
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

    const pipeline = data.pipelines[0];
    const risk = data.risks[0];

    return {
      data,
      pdf,
      brandName: data.brandName,
      summaryBullet1: data.execSummary.whatTheyActuallyDo,
      ...(pipeline !== undefined && { summaryBullet2: `${pipeline.name} — ${pipeline.qualifier}` }),
      ...(risk !== undefined && { summaryBullet3: `${risk.title} — ${risk.detail}` }),
    };
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
