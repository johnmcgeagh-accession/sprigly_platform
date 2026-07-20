/**
 * draft-plan.ts — assemble and persist a cycle's draft plan.
 *
 * This is the database-facing half of Build A: the deterministic assembler and the
 * phrasing pass live in @sprigly/engine (pure, directly testable); this module does the
 * reads, calls them, and writes the beats as status='draft' post rows (D1).
 *
 * Draft rows are INVISIBLE to every plan reader — the fence went in first (see
 * excludeDraftPosts in @sprigly/db and the Part 0 audit). They are not the plan; they are
 * a proposal the client has not yet accepted.
 *
 * D2: a stale IG trawl is a logged warning, never a blocker. The whole point of assembling
 * at the Ask touch is that the client gets something to react to; withholding that because
 * the history is a fortnight old would trade a real benefit for a marginal one.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  clientChannels, clientPlanningConfig, clientProductCatalogue, contentCycles,
  contentCyclePosts, igPosts, voiceSnapshots, POST_STATUS_DRAFT,
  type NewContentCyclePostRow,
} from '@sprigly/db';
import {
  assembleDraft, applyPhrasing, phraseDraftTitles, loadDurableInputs,
  STALE_TRAWL_DAYS, type DraftPlan, type ExperimentCandidate, type HistoryPost,
} from '@sprigly/engine';
import type { Pillar } from '@sprigly/engine';
import type { PlanningDeps } from './planning.js';

/** 'YYYY-MM' + 1 month. */
function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Read the client's IG history. Every stored month, newest first — cadence and format mix
 * are more trustworthy over more history, and the volume is trivial (the largest live
 * ig_posts row is ~10KB).
 */
async function loadHistory(deps: PlanningDeps, clientId: string, channel: string): Promise<{ posts: HistoryPost[]; latestMonth: string | null }> {
  const rows = await deps.db
    .select({ month: igPosts.month, posts: igPosts.posts, updatedAt: igPosts.updatedAt })
    .from(igPosts)
    .where(and(eq(igPosts.clientId, clientId), eq(igPosts.channel, channel)))
    .orderBy(desc(igPosts.month));

  const posts: HistoryPost[] = [];
  for (const row of rows) {
    for (const p of row.posts ?? []) {
      const o = p as Record<string, unknown>;
      if (typeof o['timestamp'] !== 'string') continue;
      posts.push({
        timestamp:     o['timestamp'],
        ...(typeof o['caption'] === 'string' ? { caption: o['caption'] } : {}),
        likesCount:    Number(o['likesCount']) || 0,
        commentsCount: Number(o['commentsCount']) || 0,
        ...(typeof o['mediaType'] === 'string' ? { mediaType: o['mediaType'] } : {}),
      });
    }
  }
  return { posts, latestMonth: rows[0]?.month ?? null };
}

/**
 * Warn when the client's IG history looks stale. Uses the newest ig_posts row's updated_at
 * — the closest thing to "when did a trawl last succeed" that survives in the schema (there
 * is no trawl-run table). Returns null when the history is fresh enough or absent entirely
 * (an absent history is a thin-data problem, which the assembler already reports).
 */
async function staleTrawlWarning(deps: PlanningDeps, clientId: string, channel: string, now: Date): Promise<string | null> {
  const [row] = await deps.db
    .select({ updatedAt: igPosts.updatedAt })
    .from(igPosts)
    .where(and(eq(igPosts.clientId, clientId), eq(igPosts.channel, channel)))
    .orderBy(desc(igPosts.updatedAt))
    .limit(1);
  if (!row?.updatedAt) return null;

  const ageDays = Math.floor((now.getTime() - row.updatedAt.getTime()) / 86_400_000);
  return ageDays > STALE_TRAWL_DAYS
    ? `IG history last refreshed ${ageDays} days ago (threshold ${STALE_TRAWL_DAYS}) — the draft is built on data that may be out of date.`
    : null;
}

export interface AssembleAndPersistResult {
  draft:       DraftPlan;
  beatsWritten: number;
  phrasing:    'phrased' | 'fallback';
}

/**
 * Assemble a draft for `cycleId` and persist its beats as status='draft' rows.
 *
 * Replaces any existing draft rows for the cycle (a re-run supersedes its own previous
 * proposal — drafts are not history). Only ever touches status='draft' rows: a real plan
 * post is never deleted by this, which is why the delete is status-scoped rather than
 * cycle-scoped.
 *
 * Throws on failure. The CALLER decides what that means — at the Ask touch it means "send
 * the ordinary Ask email", never "skip the touch".
 */
export async function assembleAndPersistDraft(
  params: { clientId: string; cycleId: string; now?: Date },
  deps:   PlanningDeps,
): Promise<AssembleAndPersistResult> {
  const { db, logger } = deps;
  const now = params.now ?? new Date();

  const [cycle] = await db
    .select({ id: contentCycles.id, clientId: contentCycles.clientId, channel: contentCycles.channel,
              cycleMonth: contentCycles.cycleMonth, structuredBrief: contentCycles.structuredBrief })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, params.cycleId), eq(contentCycles.clientId, params.clientId)))
    .limit(1);
  if (!cycle) throw new Error(`draft-plan: cycle ${params.cycleId} not found for client ${params.clientId}`);

  const { clientId, channel } = cycle;
  const month = nextMonth(cycle.cycleMonth);          // the cycle plans the month AFTER its own
  const logCtx = { cycleId: cycle.id, clientId, channel, month };

  const [planConfig] = await db
    .select({ pillars: clientPlanningConfig.pillars })
    .from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, clientId), eq(clientPlanningConfig.channel, channel)))
    .limit(1);

  const [catalogue] = await db
    .select({ id: clientProductCatalogue.id })
    .from(clientProductCatalogue)
    .where(and(eq(clientProductCatalogue.clientId, clientId), eq(clientProductCatalogue.channel, channel)))
    .limit(1);

  const [chan] = await db
    .select({ postsPerWeek: clientChannels.postsPerWeek })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
    .limit(1);

  const { posts } = await loadHistory(deps, clientId, channel);
  const stale = await staleTrawlWarning(deps, clientId, channel, now);
  if (stale) logger.warn({ ...logCtx, stale }, 'draft-plan: stale IG history — assembling anyway (D2)');

  // Experiment candidates: the ideas backlog. Returns [] for every client today (all live
  // plan_inputs rows are type='note', which loadDurableInputs filters out). Expected.
  let candidates: ExperimentCandidate[] = [];
  try {
    const durable = await loadDurableInputs(db, clientId, month);
    candidates = durable
      .filter((d) => d.type === 'idea')
      .map((d, i) => ({ id: `${d.type}-${i}`, content: d.content, origin: 'client' as const }));
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'draft-plan: could not load idea backlog — proceeding with none');
  }

  // Temperature: no per-client dial exists yet (D4 — the allocator interface lands in this
  // build, the dial does not). null resolves to an all-proven month.
  const temperature: number | null = null;

  const briefSchedule = (cycle.structuredBrief as { schedule?: unknown[]; products?: unknown[] } | null);
  const hasBriefedLaunch = Array.isArray(briefSchedule?.products) && briefSchedule.products.length > 0;

  const draft = assembleDraft({
    clientId, cycleId: cycle.id, channel, month, posts,
    pillars: (planConfig?.pillars ?? []) as unknown as Pillar[],
    candidates, temperature,
    hasCatalogue: !!catalogue,
    hasBriefedLaunch,
    configPostsPerWeek: chan?.postsPerWeek ?? null,
    ...(stale ? { staleTrawlWarning: stale } : {}),
  });

  // Phrasing — the only model call, and never allowed to block. On any failure the beats
  // keep the deterministic titles the assembler already gave them.
  let voiceSummary: string | null = null;
  try {
    const [voice] = await db
      .select({ snapshotMd: voiceSnapshots.snapshotMd })
      .from(voiceSnapshots)
      .where(and(eq(voiceSnapshots.clientId, clientId), eq(voiceSnapshots.channel, channel), eq(voiceSnapshots.isCurrent, true)))
      .limit(1);
    voiceSummary = voice?.snapshotMd?.slice(0, 2_000) ?? null;
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'draft-plan: could not read voice snapshot — phrasing without it');
  }

  const phrasing = await phraseDraftTitles({
    beats: draft.beats, voiceSummary, model: deps.model,
    onWarn: (message) => logger.warn(logCtx, `draft-plan: ${message}`),
  });
  draft.beats = applyPhrasing(draft.beats, phrasing);

  // Persist. Replace this cycle's PREVIOUS draft only — status-scoped, so a real plan post
  // can never be caught by it.
  const rows: NewContentCyclePostRow[] = draft.beats.map((b) => ({
    cycleId: cycle.id, clientId, channel,
    scheduledDate: b.scheduledDate,
    format:        b.format,
    pillar:        b.pillar,
    caption:       null,
    status:        POST_STATUS_DRAFT,
    position:      b.position,
    beatMeta:      b.beatMeta,
    sourceMeta:    { title: b.title },
  }));

  await db.transaction(async (tx) => {
    await tx.delete(contentCyclePosts).where(and(
      eq(contentCyclePosts.cycleId, cycle.id),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
    ));
    if (rows.length > 0) await tx.insert(contentCyclePosts).values(rows);
  });

  logger.info(
    { ...logCtx, beats: rows.length, basis: draft.basis, phrasing: phrasing.outcome, assumptions: draft.assumptions.length },
    'draft-plan: assembled and persisted',
  );
  return { draft, beatsWritten: rows.length, phrasing: phrasing.outcome };
}

/** Does this cycle already hold a persisted draft? Drives the Ask email variant. */
export async function cycleHasDraft(deps: PlanningDeps, cycleId: string): Promise<boolean> {
  const [row] = await deps.db
    .select({ id: contentCyclePosts.id })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  return !!row;
}

/** A short, plain summary of the draft for the Ask email's {{beatsSummary}} slot. */
export function summariseDraft(draft: DraftPlan): string {
  if (draft.beats.length === 0) return '';
  const byFormat = new Map<string, number>();
  for (const b of draft.beats) byFormat.set(b.format, (byFormat.get(b.format) ?? 0) + 1);
  const mix = [...byFormat.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([format, n]) => `${n} ${format}${n === 1 ? '' : 's'}`)
    .join(', ');
  return `${draft.beats.length} posts — ${mix}.`;
}
