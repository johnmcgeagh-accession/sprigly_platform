import type { WorkflowOutcome } from '@sprigly/engine';

export interface QuestionAnswererInput {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  /** topicId from Triage classification, if Triage already ran on this event. */
  triageTopicId?: string;
}

export interface QuestionAnswererOutput {
  outcome: WorkflowOutcome;
  cleanQuestion: string;
  topicId: string | null;
  chunkIds: string[];
  draftText: string;
  noChunksFound: boolean;
  // Carried for WorkflowRunner draft creation — not sent externally.
  from: string;
  subject: string;
  threadId?: string;
  rfcMessageId?: string;
}
