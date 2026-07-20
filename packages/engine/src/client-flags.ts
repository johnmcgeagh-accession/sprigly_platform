/**
 * client-flags.ts — per-client feature flags readable from BOTH the app and the worker.
 *
 * `app/src/lib/flags.ts` holds the same pattern for surface-only flags, but the draft-flow
 * flag has to be read by the worker's scheduler as well (it gates the Ask-touch assembly),
 * and the worker cannot import from `app/`. So this predicate lives in the shared package
 * and stays pure — the caller does the `client_configs.settings` read.
 *
 * Same strictness rule as flags.ts: a flag is on only when it is the boolean `true`.
 * Missing settings, `false`, `"true"`, `1` are all off. A stray string must never flip a
 * tenant into a flow that emails their client.
 */

/**
 * Gates the whole draft-plan intake arc for a client: Ask-touch draft assembly, and with
 * it the draft surface and the approval path that follow from a draft existing.
 *
 * DEFAULT OFF, and that default is the point. Build A wired assembly into the Ask touch
 * ungated — harmless on dev, but it would have ridden the next promotion into production
 * and started drafting months for every client with a cutoffDay. A flag is the difference
 * between "we chose to turn this on" and "nobody noticed it was on".
 */
export const DRAFT_FLOW_FLAG = 'draft_flow_enabled';

export function readDraftFlowFlag(settings: Record<string, unknown> | null | undefined): boolean {
  return settings?.[DRAFT_FLOW_FLAG] === true;
}
