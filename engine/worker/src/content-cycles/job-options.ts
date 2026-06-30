import type { JobsOptions } from 'bullmq';

export const IG_TRAWL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff:  { type: 'exponential', delay: 5_000 },
};

export const REQUEST_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff:  { type: 'fixed', delay: 15_000 },
};

// Planning is enqueued once per cycle when intake is confirmed. Gentle retry —
// the big work (Stage 2 Bedrock call) is expensive, and Drive/DB hiccups self-heal.
export const PLANNING_JOB_OPTIONS: JobsOptions = {
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

// Keyed by cycleId — one planning run per cycle. The dedup key makes a repeated
// intake-confirm a no-op while the job is still queued/running.
export function planningJobId(cycleId: string): string {
  return `planning_${cycleId}`;
}
