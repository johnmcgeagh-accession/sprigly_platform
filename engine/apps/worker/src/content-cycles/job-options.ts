import type { JobsOptions } from 'bullmq';

export const IG_TRAWL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff:  { type: 'exponential', delay: 5_000 },
};

export const REQUEST_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff:  { type: 'fixed', delay: 15_000 },
};

// BullMQ forbids colons in custom jobIds (Redis namespace separator). Use underscore as separator.
export function igTrawlJobId(clientId: string, channel: string, dataMonth: string): string {
  return `ig-trawl_${clientId}_${channel}_${dataMonth}`;
}

export function requestEmailJobId(clientId: string, channel: string, dataMonth: string): string {
  return `request-email_${clientId}_${channel}_${dataMonth}`;
}
