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

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function safeString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// Coerces the raw LLM JSON into a shape the renderer can safely consume.
// Required because the write step can produce malformed output (too-short
// response, partially populated object, wrong types) when it receives
// insufficient research context.
function normalizeBriefData(raw: unknown): ProspectBriefData {
  const d = (raw ?? {}) as Record<string, unknown>;
  const founder = (d.founder ?? {}) as Record<string, unknown>;
  const voiceAndTone = (founder.voiceAndTone ?? {}) as Record<string, unknown>;
  const publicProfile = (founder.publicProfile ?? {}) as Record<string, unknown>;
  const ct = (d.callTactics ?? {}) as Record<string, unknown>;
  const tq = (ct.theOneQuestion ?? {}) as Record<string, unknown>;
  const es = (d.execSummary ?? {}) as Record<string, unknown>;
  const location = (d.location ?? {}) as Record<string, unknown>;
  const spelling = (d.spelling ?? {}) as Record<string, unknown>;

  return {
    brandName:   safeString(d.brandName, 'Unknown'),
    url:         safeString(d.url),
    preparedAt:  safeString(d.preparedAt),
    positioning: safeString(d.positioning),
    ...(typeof d.meetingDate === 'string' && { meetingDate: d.meetingDate }),
    spelling: {
      correctName: safeString(spelling.correctName, safeString(d.brandName, 'Unknown')),
      ...(typeof spelling.providedName === 'string' && { providedName: spelling.providedName }),
      ...(typeof spelling.note === 'string'          && { note: spelling.note }),
    },
    location: {
      registered: safeString(location.registered),
      ...(typeof location.trading  === 'string' && { trading: location.trading }),
      ...(typeof location.localHook === 'string' && { localHook: location.localHook }),
    },
    stats: safeArray(d.stats),
    founder: {
      name:       safeString(founder.name),
      background: safeString(founder.background),
      employers:  safeArray(founder.employers),
      ...(typeof founder.education === 'string' && { education: founder.education }),
      publicProfile: {
        ...(typeof publicProfile.linkedIn === 'string'          && { linkedIn: publicProfile.linkedIn }),
        ...(Array.isArray(publicProfile.podcasts)               && { podcasts: publicProfile.podcasts as string[] }),
        ...(Array.isArray(publicProfile.interviews)             && { interviews: publicProfile.interviews as string[] }),
      },
      voiceAndTone: {
        description: safeString(voiceAndTone.description),
        examples:    safeArray(voiceAndTone.examples),
      },
      selfNamedPainPoints: safeArray(founder.selfNamedPainPoints),
      caresAbout:          safeArray(founder.caresAbout),
    },
    execSummary: {
      whatTheyActuallyDo:     safeString(es.whatTheyActuallyDo),
      revenueModel:           safeString(es.revenueModel),
      distinctiveVsCorporate: safeString(es.distinctiveVsCorporate),
      ...(typeof es.localOrSpellingIntel === 'string' && { localOrSpellingIntel: es.localOrSpellingIntel }),
    },
    opsTells:  safeArray(d.opsTells),
    pipelines: safeArray(d.pipelines),
    risks:     safeArray(d.risks),
    callTactics: {
      homeworkHooks: safeArray(ct.homeworkHooks),
      dontMention:   safeArray(ct.dontMention),
      theOneQuestion: {
        question:        safeString(tq.question),
        whyThisQuestion: safeString(tq.whyThisQuestion),
      },
    },
  };
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
    console.info(`[prospect-research] resolvedPromptHead=${JSON.stringify(researchPrompt.slice(0, 500))}`);
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

    const data = normalizeBriefData(extractJson(writeResult.content));

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
