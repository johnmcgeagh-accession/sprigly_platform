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
  clients, clientChannels, clientConfigs, clientPlanningConfig, clientProductCatalogue,
  contentCycles, contentCyclePosts, igPosts, voiceSnapshots, excludeDraftPosts,
  POST_STATUS_DRAFT, PRE_PLANNING_STATUSES,
  type NewContentCyclePostRow,
} from '@sprigly/db';
import {
  assembleDraft, applyPhrasing, phraseDraftTitles, loadDurableInputs, readDraftFlowFlag,
  approveDraftCore, cadenceFloorSlots, resolveRecurringSeries, observeProductCoverage,
  catalogueProductNames, STALE_TRAWL_DAYS, DRAFT_DEFAULT_TEMPERATURE,
  type DraftPlan, type ExperimentCandidate, type HistoryPost, type PlannedPostRef,
  type ResolvedSeries, type ProductCoverage,
} from '@sprigly/engine';
import type { Pillar, RecurringSeries } from '@sprigly/engine';
import { deriveBrandTokens } from '../catalogue/validate-catalogue.js';
import type { Queue } from 'bullmq';
import type { PlanningDeps } from './planning.js';
import { GENERATION_JOB_OPTIONS } from './job-options.js';

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

/**
 * The client's own plan history, for dating their recurring series.
 *
 * THROUGH THE DRAFT FENCE. `excludeDraftPosts()` is the whole reason this read is safe: a
 * draft is a proposal the client has not accepted, so a draft beat proposing Sunday Style is
 * not evidence that Sunday Style ran. Without the predicate the assembler would read its OWN
 * previous proposal back as history and date every series to the month it just invented —
 * and it re-runs on every Ask touch, so the error would compound rather than show. Soft-
 * deleted rows are excluded for the same reason: a removed beat did not happen.
 *
 * Every month, not a window: a monthly feature needs several months to date at all, and the
 * payload is small (ivy-t: 92 rows, ~12 kB for these three columns).
 *
 * Never throws — a history read that fails costs the series their dates, not the month.
 */
async function loadSeriesHistory(
  deps: PlanningDeps, clientId: string, channel: string,
): Promise<PlannedPostRef[]> {
  const rows = await deps.db
    .select({
      date:       contentCyclePosts.scheduledDate,
      sourceMeta: contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.channel, channel),
      excludeDraftPosts(),
      isNull(contentCyclePosts.deletedAt),
    ));

  return rows.map((r) => {
    const meta = (r.sourceMeta ?? {}) as Record<string, unknown>;
    return {
      date:     r.date,
      category: typeof meta['category'] === 'string' ? meta['category'] : null,
      title:    typeof meta['title'] === 'string' ? meta['title'] : null,
    };
  });
}

/**
 * Is the draft-plan arc enabled for this client?
 *
 * Checked BEFORE any assembly work, so a flag-off client's Ask touch is byte-identical to
 * its pre-arc behaviour: no reads, no model call, no draft rows, plain Ask email. "Enabled
 * but it silently did nothing" and "not enabled" should not be the same code path.
 */
export async function draftFlowEnabled(deps: PlanningDeps, clientId: string): Promise<boolean> {
  const [cfg] = await deps.db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, clientId))
    .limit(1);
  return readDraftFlowFlag(cfg?.settings);
}

export interface AssembleAndPersistResult {
  draft:       DraftPlan;
  beatsWritten: number;
  phrasing:    'phrased' | 'fallback';
}

/**
 * Refuse assembly outside the pre-planning window.
 *
 * Assembly is a PRE-PLANNING act: it proposes a month the client has not seen. Building a draft
 * into a cycle that has moved past planning (workbook_built, generating, scheduled-and-approved,
 * …) writes status='draft' rows into a month whose surface renders them UNEDITABLE — the
 * rehearsal did exactly this, assembling into workbook_built and producing a dead surface with
 * no editable controls (docs/reports/ivy-t-rehearsal-failures.md F3). PRE_PLANNING_STATUSES is
 * the same set every draft mutation and the intake route gate on, so "can this month still be
 * shaped" cannot come to mean two different things in two places.
 *
 * Pure and exported so both branches are testable without a database. Throws — the Ask-touch
 * caller already catches a throw and degrades to the ordinary Ask email (consumer.ts), and the
 * CLI surfaces it.
 */
export function assertCycleAssemblable(status: string): void {
  if (!PRE_PLANNING_STATUSES.has(status)) {
    throw new Error(
      `draft-plan: cycle status is '${status}', which is past planning — a draft can only be ` +
      `assembled while the cycle is pre-planning (${[...PRE_PLANNING_STATUSES].join(', ')}). ` +
      `Reset the cycle first: pnpm --filter @sprigly/worker cycle-reset <cycleId>.`,
    );
  }
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
              cycleMonth: contentCycles.cycleMonth, status: contentCycles.status,
              structuredBrief: contentCycles.structuredBrief, intakeJson: contentCycles.intakeJson })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, params.cycleId), eq(contentCycles.clientId, params.clientId)))
    .limit(1);
  if (!cycle) throw new Error(`draft-plan: cycle ${params.cycleId} not found for client ${params.clientId}`);

  // Refuse to assemble into a cycle that has moved past planning — the draft rows would render
  // an uneditable surface. Named status, named remedy. (See assertCycleAssemblable.)
  assertCycleAssemblable(cycle.status);

  const { clientId, channel } = cycle;
  const month = nextMonth(cycle.cycleMonth);          // the cycle plans the month AFTER its own
  const logCtx = { cycleId: cycle.id, clientId, channel, month };

  // recurringSeries and categories ride the query that already ran for `pillars`. The four
  // standing features on this row (Sunday Style, WSG, and two monthlies) were configured
  // before the draft arc existed and scheduled by the old planner; the assembler selected
  // `pillars` and nothing else, so September came out with none of them.
  const [planConfig] = await db
    .select({
      pillars:         clientPlanningConfig.pillars,
      recurringSeries: clientPlanningConfig.recurringSeries,
      categories:      clientPlanningConfig.categories,
    })
    .from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, clientId), eq(clientPlanningConfig.channel, channel)))
    .limit(1);

  // The catalogue BODY, not an existence probe. This select used to read `id` and nothing
  // else, so a 49-family blob was queried on every assembly to answer one boolean — and the
  // assumption built on that boolean then told the client, by omission, that their products
  // had been considered (docs/reports/beat-grounding.md §1.6, §2.1).
  const [catalogue] = await db
    .select({ id: clientProductCatalogue.id, catalogue: clientProductCatalogue.catalogue })
    .from(clientProductCatalogue)
    .where(and(eq(clientProductCatalogue.clientId, clientId), eq(clientProductCatalogue.channel, channel)))
    .limit(1);

  // The client's own brand words, so the catalogue matcher does not read "Ivy" in 84 captions
  // as the Ivy product family. deriveBrandTokens is the SAME function the caption validator
  // and the planner already use for this — one definition of "that word is the brand".
  const [clientRow] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const brandTokens = deriveBrandTokens(clientRow?.name ?? '');

  const [chan] = await db
    .select({ postsPerWeek: clientChannels.postsPerWeek })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
    .limit(1);

  const { posts } = await loadHistory(deps, clientId, channel);
  const stale = await staleTrawlWarning(deps, clientId, channel, now);
  if (stale) logger.warn({ ...logCtx, stale }, 'draft-plan: stale IG history — assembling anyway (D2)');

  // Experiment candidates: the ideas backlog.
  //
  // This used to synthesise `id: 'idea-0'` from the array index, because loadDurableInputs
  // did not select the primary key — so beat_meta.sourceRef, documented as a plan_inputs.id
  // (schema.ts), was an array position and a beat could not be traced back to the sentence it
  // came from. It selects `id` now, and `lifecycle` with it, so an idea she has never seen run
  // outranks one that has (rankCandidates).
  let candidates: ExperimentCandidate[] = [];
  try {
    const durable = await loadDurableInputs(db, clientId, month);
    candidates = durable
      .filter((d) => d.type === 'idea')
      .map((d) => ({ id: d.id, content: d.content, origin: 'client' as const, lifecycle: d.lifecycle }));
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'draft-plan: could not load idea backlog — proceeding with none');
  }

  // Temperature: still no per-client dial (D4's dial has not landed), but `null` is not the
  // honest stand-in for "unset" — it is an instruction to ignore the backlog entirely, and it
  // was being followed. The default is a ceiling, clamped by allocateSlots to the candidates
  // that actually exist, so a client with no backlog still gets an all-proven month.
  const temperature: number = DRAFT_DEFAULT_TEMPERATURE;

  const briefSchedule = (cycle.structuredBrief as { schedule?: unknown[]; products?: unknown[] } | null);
  const hasBriefedLaunch = Array.isArray(briefSchedule?.products) && briefSchedule.products.length > 0;

  // A client-stated cadence floor (kind:'cadence' intake) lives on intake_json — the same
  // cycle-scoped intake record the receipts do (draft-apply.ts). It outranks observed cadence:
  // a client telling us "7 a week" beats what their history happened to show. Read here so
  // EVERY re-assembly for this cycle honours the floor, not just the one that set it.
  const cadenceFloor = ((cycle.intakeJson ?? {}) as { cadenceFloor?: { postsPerWeek?: number | null; postsPerMonth?: number | null } }).cadenceFloor;
  const floorSlots = cadenceFloor ? cadenceFloorSlots(month, cadenceFloor) : 0;

  // Recurring series, dated from the client's own plan history. Best-effort: a failed history
  // read costs the series their dates, never the month — resolveRecurringSeries with an empty
  // history still places them, it just reports lastPlanned: null, which is honest.
  let series: ResolvedSeries[] = [];
  try {
    const configured = (planConfig?.recurringSeries ?? []) as unknown as RecurringSeries[];
    if (configured.length > 0) {
      let history: PlannedPostRef[] = [];
      try {
        history = await loadSeriesHistory(deps, clientId, channel);
      } catch (err) {
        logger.warn({ ...logCtx, err: String(err) }, 'draft-plan: could not read plan history — series will carry no dates');
      }
      series = resolveRecurringSeries(configured, (planConfig?.categories ?? []) as string[], history);
    }
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'draft-plan: could not resolve recurring series — proceeding without them');
  }

  // Product coverage: the cached catalogue against the captions ALREADY in memory (loadHistory
  // maps them and the history observation never reads them), so this costs no extra I/O at all.
  // Names excluded as brand words, ordinary words she writes, or parser artefacts are logged
  // rather than dropped in silence — a product missing from the month for a reason nobody can
  // see is how a coverage claim stops being checkable.
  let coverage: ProductCoverage[] = [];
  try {
    const names = catalogueProductNames(catalogue?.catalogue);
    if (names.length > 0) {
      const result = observeProductCoverage({ names, posts, brandTokens });
      coverage = result.coverage;
      if (result.excluded.length > 0) {
        logger.info({ ...logCtx, excluded: result.excluded }, 'draft-plan: catalogue names kept out of the beat vocabulary');
      }
    }
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'draft-plan: could not observe product coverage — no beat will name a product');
  }

  const draft = assembleDraft({
    clientId, cycleId: cycle.id, channel, month, posts,
    pillars: (planConfig?.pillars ?? []) as unknown as Pillar[],
    candidates, temperature,
    hasCatalogue: !!catalogue,
    hasBriefedLaunch,
    configPostsPerWeek: chan?.postsPerWeek ?? null,
    ...(floorSlots > 0 ? { floorSlots } : {}),
    ...(series.length > 0 ? { series } : {}),
    ...(coverage.length > 0 ? { productCoverage: coverage } : {}),
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
    // The names the model may be POLICED on: naming one of these on a beat whose own evidence
    // does not carry it fails the whole batch. The product list is the FILTERED one — brand
    // words, ordinary words and parser artefacts are already out — because a name in this list
    // that she also uses as an English word would reject honest titles, not catch fabrications.
    vocab: { seriesNames: series.map((s) => s.name), productNames: coverage.map((c) => c.product) },
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
    // category / whoPosts / postingTime come from the beat's recurring series when it has
    // one — the columns the old planner wrote and the assembler used to drop, so a Sunday
    // Style beat again says who posts it and at what time. `title` last so it always wins.
    sourceMeta:    { ...(b.sourceMeta ?? {}), title: b.title },
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

// ── D3: auto-approve at cutoff ────────────────────────────────────────────────

/** Live, unapproved draft beats on a cycle. */
export async function countDraftBeats(deps: PlanningDeps, cycleId: string): Promise<number> {
  const rows = await deps.db
    .select({ id: contentCyclePosts.id })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ));
  return rows.length;
}

/**
 * Approve a cycle's draft on the client's behalf and start phase 2. (D3.)
 *
 * The RULES are not here — they are in approveDraftCore (@sprigly/engine), shared with the
 * client-approved path so the two cannot drift. Build D implemented them twice because the
 * worker cannot import from app/; the shared core is the fix. What remains here is the one
 * thing that genuinely differs: the worker enqueues on the BullMQ handle it already holds,
 * where the app goes through its own queue helpers.
 */
export async function autoApproveAndGenerate(
  deps: PlanningDeps, queue: Queue, clientId: string, cycleId: string,
): Promise<{ approved: number; captionsQueued: number }> {
  const { db, logger } = deps;

  const approval = await approveDraftCore(db, { clientId, cycleId, auto: true });
  if (!approval.ok) {
    // 'already_approved' is the ordinary race, not an error: the client got there first.
    logger.info({ cycleId, reason: approval.error }, 'draft-plan: no auto-approval at cutoff');
    return { approved: 0, captionsQueued: 0 };
  }

  // Re-read the approved rows for the fields the fan-out needs (format for hook eligibility,
  // title for the caption instruction). The core returns ids only, deliberately: what a
  // caller needs AFTER approval is its own business, not the approval rule's.
  const posts = await db
    .select({ id: contentCyclePosts.id, format: contentCyclePosts.format, pillar: contentCyclePosts.pillar, sourceMeta: contentCyclePosts.sourceMeta })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId), isNull(contentCyclePosts.deletedAt)));
  const approvedIds = new Set(approval.postIds);

  let captionsQueued = 0;
  for (const post of posts.filter((p) => approvedIds.has(p.id))) {
    const meta = (post.sourceMeta ?? {}) as Record<string, unknown>;
    const title = typeof meta['title'] === 'string' ? meta['title'] : '';
    try {
      await queue.add('shape', {
        type: 'shape', scope: 'post', clientId, cycleId, targetPostId: post.id,
        instruction: `Write the caption for this post. It is the "${title}" slot in this month's plan${post.pillar ? `, under the ${post.pillar} pillar` : ''}. Keep it to that subject.`,
        source: 'web',
      }, { jobId: `shape_${cycleId}_${post.id}`, ...GENERATION_JOB_OPTIONS });
      captionsQueued++;
      // Carousels get a standalone hook job. Reels do NOT — their hook is written by the
      // combined hook+script job (script.ts), which the worker enqueues once the caption lands
      // (enqueueScriptIfReady). A reel with both would have its hook written twice, incoherently.
      if (post.format === 'carousel') {
        // autoSelect: same reason as the app fan-out — nobody is here to pick a candidate.
        await queue.add('hook', { type: 'hook', clientId, cycleId, targetPostId: post.id, autoSelect: true },
          { jobId: `hook_${cycleId}_${post.id}`, ...GENERATION_JOB_OPTIONS });
      }
    } catch (err) {
      // One post failing to enqueue must not abort the month — mark it and move on.
      logger.warn({ cycleId, postId: post.id, err: String(err) }, 'draft-plan: auto-approve could not enqueue a post');
      await db.update(contentCyclePosts)
        .set({ status: 'generation_failed', sourceMeta: { ...meta, generationError: `Couldn't start: ${String(err)}` } })
        .where(eq(contentCyclePosts.id, post.id));
    }
  }

  logger.info({ cycleId, approved: approval.approved, captionsQueued }, 'draft-plan: auto-approved at cutoff and started phase 2');
  return { approved: approval.approved, captionsQueued };
}
