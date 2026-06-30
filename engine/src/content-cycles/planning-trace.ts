/**
 * planning-trace.ts — diagnostic instrumentation for the planning validation loop.
 *
 * PURELY OBSERVATIONAL. The tracer accumulates one entry per loop STEP (gate check,
 * critic verdict, repair, catalogue rewrite) entirely in memory during the run, then
 * `flush()` writes them all in a single insert at the end. Nothing here is on the hot
 * path of generation, and every persistence path is wrapped so a trace failure can
 * NEVER fail (or slow) the planning run — the loop does not change behaviour whether a
 * tracer is present or not (the tracer is optional everywhere it is threaded).
 *
 * Why it exists: the audit ledger keeps token counts + title only, never the caption
 * before/after or the critic's issue text. Without that we cannot tell whether a
 * repair was substantive (a real voice/grounding/sign-off fix) or marginal (cosmetic),
 * nor see oscillation. This records exactly those intermediate states so a run can be
 * judged after the fact (`pnpm --filter @sprigly/worker planning-trace <cycleId>`).
 *
 * `seq` is a monotonic per-run ordinal: ordering by it reconstructs the interleaved
 * gate→repair→critic sequence precisely, even when wall-clock timestamps collide.
 */

import { planningTrace } from '@sprigly/db';
import type { NewPlanningTraceRow } from '@sprigly/db';
import type { Logger } from 'pino';
import type { CriticVerdict, PostIssue } from './plan-validation.js';

// Minimal DB surface needed to flush (avoids importing the worker's concrete Db type).
interface TraceDb {
  insert: (table: typeof planningTrace) => {
    values: (rows: NewPlanningTraceRow[]) => Promise<unknown>;
  };
}

/** Captions are stored verbatim for diffing, but cap the stored size so a runaway
 *  caption can never bloat a trace row. 4k chars is ~10× a normal caption. */
const MAX_CAPTION = 4000;
function clip(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.length <= MAX_CAPTION ? s : s.slice(0, MAX_CAPTION) + '…[clipped]';
}

export class PlanningTracer {
  private seq = 0;
  private entries: NewPlanningTraceRow[] = [];

  constructor(
    private readonly cycleId: string,
    private readonly targetMonth: string,
    private readonly logger: Logger,
    private readonly logMeta: Record<string, unknown>,
  ) {}

  private push(e: Omit<NewPlanningTraceRow, 'cycleId' | 'seq' | 'targetMonth'>): void {
    this.entries.push({ cycleId: this.cycleId, seq: this.seq++, targetMonth: this.targetMonth, ...e });
  }

  /** A code-gate evaluation of one post (initial check or a post-repair re-check). */
  gate(index: number, title: string | undefined, attempt: number, issues: PostIssue[]): void {
    this.push({
      postIndex: index, postTitle: title ?? '', phase: 'gate', attempt,
      pass: issues.length === 0,
      issues: issues.map((i) => ({ code: i.code, detail: i.detail })),
      detail: { codes: issues.map((i) => i.code) },
    });
  }

  /** A critic verdict on one post, with token cost. */
  critic(
    index: number, title: string | undefined, attempt: number,
    verdict: CriticVerdict,
    tokens: { inputTokens: number; outputTokens: number; modelId: string },
  ): void {
    this.push({
      postIndex: index, postTitle: title ?? '', phase: 'critic', attempt,
      pass: verdict.pass,
      issues: verdict.issues,
      detail: { suggested_fix: verdict.suggested_fix },
      inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens, modelId: tokens.modelId,
    });
  }

  /** A per-post regeneration: the caption before → after, what triggered it, cost. */
  repair(args: {
    index: number; title: string | undefined; attempt: number;
    triggeredBy: 'gate' | 'critic'; trigger: string;
    before: string; after: string;
    inputTokens: number; outputTokens: number; modelId: string;
  }): void {
    this.push({
      postIndex: args.index, postTitle: args.title ?? '', phase: 'repair', attempt: args.attempt,
      issues: [args.trigger],
      detail: { triggeredBy: args.triggeredBy, changed: args.before !== args.after },
      captionBefore: clip(args.before), captionAfter: clip(args.after),
      inputTokens: args.inputTokens, outputTokens: args.outputTokens, modelId: args.modelId,
    });
  }

  /** A deterministic HARD-catalogue rewrite (invalid product/colourway → placeholder). */
  catalogue(index: number, title: string | undefined, before: string, after: string, violations: string[]): void {
    this.push({
      postIndex: index, postTitle: title ?? '', phase: 'catalogue', attempt: null,
      pass: violations.length === 0,
      issues: violations,
      detail: { changed: before !== after, violations: violations.length },
      captionBefore: clip(before), captionAfter: clip(after),
    });
  }

  get size(): number {
    return this.entries.length;
  }

  /** Persist all buffered entries in one insert. Best-effort: a failure is logged and
   *  swallowed — the planning run has already succeeded by the time this is called. */
  async flush(db: TraceDb): Promise<void> {
    if (this.entries.length === 0) return;
    try {
      await db.insert(planningTrace).values(this.entries);
      this.logger.info({ ...this.logMeta, traceEntries: this.entries.length }, 'planning-trace: persisted');
    } catch (err) {
      this.logger.warn({ ...this.logMeta, err: String(err) }, 'planning-trace: flush failed — non-fatal (trace lost, run unaffected)');
    }
  }
}
