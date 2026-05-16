export type { ProspectBriefData } from '@sprigly/pdf-render';

export interface ProspectInput {
  brandName: string;
  url?: string;
  sector?: string;
  meetingDate?: string;
  whyInterested?: string;
  notes?: string;
}

export interface ProspectOutput {
  data: import('@sprigly/pdf-render').ProspectBriefData;
  pdf: Buffer;
}
