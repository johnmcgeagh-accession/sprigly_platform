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
  data?: import('@sprigly/pdf-render').ProspectBriefData;
  pdf: Buffer;
  noDataAvailable?: boolean;
  // Derived fields for destination template substitution.
  // These are coupled to the gmail-reply-with-attachment template configured in
  // defaultDestinations. Update both in lockstep if the template changes.
  brandName?: string;
  summaryBullet1?: string;
  summaryBullet2?: string;
  summaryBullet3?: string;
}
