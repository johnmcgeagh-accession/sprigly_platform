export interface InboxNoopInput {
  messageId: string;
  subject: string;
  from: string;
}

export interface InboxNoopOutput {
  status: 'seen';
  messageId: string;
  subject: string;
  from: string;
}
