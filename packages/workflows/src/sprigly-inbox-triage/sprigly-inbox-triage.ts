import type { Workflow, IncomingEvent, WorkflowContext } from '@sprigly/engine';
import type { TriageInput, TriageOutput } from './types.js';
import { parseTriageInput } from './parse-input.js';

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function extractJson(text: string): unknown {
  // Accept both raw JSON and fenced code blocks, as the model may include either.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}

function getStepModel(ctx: WorkflowContext, stepName: string): string {
  const stepModels = ctx.clientConfig.settings['stepModels'] as Record<string, Record<string, string>> | undefined;
  return stepModels?.['sprigly-inbox-triage']?.[stepName] ?? 'sonnet';
}

export const spriglyInboxTriageWorkflow: Workflow<TriageInput, TriageOutput> = {
  id: 'sprigly-inbox-triage',

  defaultDestinations: [
    { destinationId: 'db-save-output', requireApproval: false, settings: {} },
  ],

  parseInput(event: IncomingEvent): TriageInput | null {
    return parseTriageInput(event);
  },

  async run(input: TriageInput, ctx: WorkflowContext): Promise<TriageOutput> {
    const { triageConfig, triageStore } = ctx;

    if (triageConfig === undefined) {
      throw new Error(
        `sprigly-inbox-triage: no triageConfig in WorkflowContext for client ${ctx.clientId}` +
        ' — ensure a triage_configs row exists and WorkflowRunner has loaded it',
      );
    }
    if (triageStore === undefined) {
      throw new Error('sprigly-inbox-triage: triageStore not injected into WorkflowContext');
    }

    // Serialize config blocks. Categories use XML tags so the model clearly
    // distinguishes the structured config from the email body and its own
    // JSON output instruction. JSON.stringify with indent for readability.
    const categoriesJson = JSON.stringify(triageConfig.categories, null, 2);
    const replyExamplesJson = JSON.stringify(triageConfig.replyExamples, null, 2);
    const additionalInstructions = triageConfig.additionalInstructions ?? '';

    const template = await ctx.prompts.resolve(ctx.clientId, 'sprigly-inbox-triage', 'classify');

    const prompt = fillTemplate(template, {
      categories: categoriesJson,
      voiceSample: triageConfig.voiceSample,
      replyExamples: replyExamplesJson,
      additionalInstructions,
      from: input.from,
      subject: input.subject,
      body: input.body,
    });

    const result = await ctx.model.complete({
      model: getStepModel(ctx, 'classify'),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
    });

    await ctx.audit.logModelCall({
      clientId: ctx.clientId,
      eventId: ctx.eventId,
      runId: ctx.runId,
      modelId: result.modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      action: 'inbox-triage-classify',
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(result.content) as Record<string, unknown>;
    } catch {
      throw new Error(
        `inbox-triage-classify: model output is not valid JSON. ` +
        `First 300 chars: ${result.content.slice(0, 300)}`,
      );
    }

    const category = typeof parsed['category'] === 'string' ? parsed['category'] : 'unknown';
    const action = typeof parsed['action'] === 'string' ? parsed['action'] : 'escalate';
    const draftText = typeof parsed['draftText'] === 'string' ? parsed['draftText'] : undefined;
    const escalationReason =
      typeof parsed['escalationReason'] === 'string' ? parsed['escalationReason'] : undefined;

    // Write the agent's own seen-log entry, decoupled from Gmail read-state.
    // Uses ON CONFLICT DO NOTHING — safe if somehow called twice for the same message.
    await triageStore.writeSeenMessage({
      clientId: ctx.clientId,
      messageId: input.messageId,
      threadId: input.threadId,
      outcome: 'needs_human',
    });

    // Write the capture-log draft row. ALWAYS written — for every action type
    // (draft_reply, escalate, label, invoke_workflow) — so denominators exist
    // for the quarterly review. decision/correctionType are null until a human
    // resolves via recordResolution().
    const captureLogId = await triageStore.writeCaptureLogDraft({
      clientId: ctx.clientId,
      eventId: ctx.eventId,
      workflowRunId: ctx.runId,
      category,
      suggestedAction: action,
      ...(draftText !== undefined && { draftText }),
      ...(escalationReason !== undefined && { escalationReason }),
    });

    return {
      outcome: 'needs_human',
      category,
      action,
      ...(draftText !== undefined && { draftText }),
      ...(escalationReason !== undefined && { escalationReason }),
      captureLogId,
    };
  },
};
