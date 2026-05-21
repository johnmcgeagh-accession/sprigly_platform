import type { Workflow, IncomingEvent, WorkflowContext } from '@sprigly/engine';
import type { InboxNoopInput, InboxNoopOutput } from './types.js';
import { parseInboxNoopInput } from './parse-input.js';

// Full-mode catch-all workflow. Intentionally inert:
//   - makes zero model calls
//   - sends nothing, drafts nothing
//   - takes no irreversible action
//
// The only side effect is an audit log entry confirming the email was seen,
// plus the db-save-output destination recording the output object.
//
// This workflow is the default target for the auto-created match-all fallback
// rule when a mailbox is switched to full mode. It will be replaced by the
// triage agent when inbox intelligence is configured (see BACKLOG: inbox-agent phase).
export const spriglyInboxNoopWorkflow: Workflow<InboxNoopInput, InboxNoopOutput> = {
  id: 'sprigly-inbox-noop',

  defaultDestinations: [
    { destinationId: 'db-save-output', requireApproval: false, settings: {} },
  ],

  parseInput(event: IncomingEvent): InboxNoopInput | null {
    return parseInboxNoopInput(event);
  },

  async run(input: InboxNoopInput, ctx: WorkflowContext): Promise<InboxNoopOutput> {
    await ctx.audit.logModelCall({
      clientId:     ctx.clientId,
      eventId:      ctx.eventId,
      runId:        ctx.runId,
      modelId:      'none',
      inputTokens:  0,
      outputTokens: 0,
      action:       'inbox-noop-seen',
      metadata: {
        messageId: input.messageId,
        subject:   input.subject,
        from:      input.from,
      },
    });

    return {
      status:    'seen',
      messageId: input.messageId,
      subject:   input.subject,
      from:      input.from,
    };
  },
};
