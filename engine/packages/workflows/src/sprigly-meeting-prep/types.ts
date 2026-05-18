export interface SpriglyMeetingPrepInput {
  topic: string;
  notes?: string;
  // TODO: add body fields your workflow needs
}

export interface SpriglyMeetingPrepOutput {
  text: string;
  // TODO: replace with your actual output shape (add pdf: Buffer for PDF workflows)
}
