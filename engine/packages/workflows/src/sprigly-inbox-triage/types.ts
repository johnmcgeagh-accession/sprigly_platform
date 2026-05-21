import type { WorkflowOutcome } from '@sprigly/engine';

export interface TriageInput {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
}

export interface TriageOutput {
  outcome: WorkflowOutcome;
  category: string;
  action: string;
  draftText?: string;
  escalationReason?: string;
  captureLogId: string;
}
