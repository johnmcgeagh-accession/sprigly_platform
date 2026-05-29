import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import type { SpriglyMeetingPrepInput, SpriglyMeetingPrepOutput } from './types.js';
import { parseMeetingPrepInput } from './parse-input.js';

// Duplicates substituteTemplate from @sprigly/destinations — extract to a shared
// utility when a third consumer arrives. See BACKLOG.md.
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function getStepModel(ctx: WorkflowContext, stepName: string): string {
  const stepModels = ctx.clientConfig.settings['stepModels'] as Record<string, Record<string, string>> | undefined;
  return stepModels?.['sprigly-meeting-prep']?.[stepName] ?? 'sonnet';
}

export const spriglyMeetingPrepWorkflow: Workflow<SpriglyMeetingPrepInput, SpriglyMeetingPrepOutput> = {
  id: 'sprigly-meeting-prep',
  defaultDestinations: [
    {
      destinationId: 'db-save-output',
      requireApproval: false,
      settings: {},
    },
  ],

  parseInput(event: IncomingEvent): SpriglyMeetingPrepInput | null {
    return parseMeetingPrepInput(event);
  },

  async run(input: SpriglyMeetingPrepInput, ctx: WorkflowContext): Promise<SpriglyMeetingPrepOutput> {
    // ── Step 1: Generate ──────────────────────────────────────────────────────
    const prompt = await ctx.prompts.resolve(ctx.clientId, 'sprigly-meeting-prep', 'generate');
    if (prompt.includes('__PROMPT_NOT_CUSTOMISED__')) {
      throw new Error(
        'Prompt template for sprigly-meeting-prep step "generate" has not been customised. ' +
        'Edit the prompt in the admin UI or in the seed migration before running.',
      );
    }

    const result = await ctx.model.complete({
      model: getStepModel(ctx, 'generate'),
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
      action:       'meeting-prep-generate',
    });

    // TODO: add further steps (write, render, etc.) here
    return { text: result.content };
  },
};
