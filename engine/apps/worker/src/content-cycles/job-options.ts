import type { JobsOptions } from 'bullmq';

export const IG_TRAWL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff:  { type: 'exponential', delay: 5_000 },
};

export const REQUEST_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff:  { type: 'fixed', delay: 15_000 },
};

export function igTrawlJobId(clientId: string, channel: string, dataMonth: string): string {
  return `ig-trawl:${clientId}:${channel}:${dataMonth}`;
}

export function requestEmailJobId(clientId: string, channel: string, dataMonth: string): string {
  return `request-email:${clientId}:${channel}:${dataMonth}`;
}
