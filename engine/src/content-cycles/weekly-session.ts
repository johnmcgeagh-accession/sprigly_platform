/**
 * weekly-session.ts — the weekly planning session (engine job).
 *
 * Pass 1 audits the upcoming week (weather + maturing notes + date conflicts) via
 * Haiku (see weekly-audit.ts). Pass 2 GENERATES content for the capped, actioned
 * findings through the existing engine pipeline (voice critic + catalogue
 * validation) so the client reviews real words: rewrites embed the full new
 * caption in the proposal (approval applies deterministically — no second
 * generation), and a weather opportunity embeds a whole validated draft. Every
 * proposal shares one change_set_id. A weekly_sessions row records the run, and an
 * assistant message (the change summary, or the quiet-week message) is posted.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import {
  clients, contentCycles, contentCyclePosts, conversations, agentMessages,
  agentProposals, planInputs, postEdits, weeklySessions, excludeDraftPosts,
} from '@sprigly/db';
import { fetchForecast } from '@sprigly/weather';
import { assembleShapeContext, type PlanningDeps } from './planning.js';
import {
  regeneratePost, applyCodeGate, applyCritic,
  type PlanPostRow, type PlanRepairContext, type CriticContext, type RegisterMap,
} from './plan-validation.js';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import { indexCatalogue, applyCatalogueValidation, deriveBrandTokens } from '../catalogue/validate-catalogue.js';
import {
  buildWeatherFlags, runAudit, applyCaps, quietMessage, changeMessage,
  type AuditNote, type Finding,
} from './weekly-audit.js';

const PLANNING_MODEL = 'sonnet';
const FORMAT_LABEL: Record<string, string> = { reel: 'Reel', carousel: 'Carousel', single: 'Static', email: 'Email' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface WeeklySessionJob {
  type:      'weekly-session';
  clientId:  string;
  cycleId:   string;
  weekStart: string;   // Monday, 'YYYY-MM-DD'
}

export interface WeeklySessionResult {
  status: 'proposed' | 'quiet';
  actioned: number;
  skipped: number;
  changeSetId: string | null;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}
function postTitle(caption: string | null, pillar: string | null): string {
  const firstLine = (caption ?? '').split(/\n/)[0]?.trim() ?? '';
  const base = firstLine || (pillar ?? '').trim() || 'post';
  return base.length > 44 ? `${base.slice(0, 43)}…` : base;
}

type CycleRow = typeof contentCycles.$inferSelect;

/**
 * Generate + validate a caption through the SAME pipeline as a chat-turn shape.
 * Mirrors shape.ts (assembleShapeContext → regeneratePost → code gate → critic →
 * catalogue). Throws on an unrecoverable validation failure — the caller skips
 * that finding.
 */
async function generateCaption(cycle: CycleRow, planPost: PlanPostRow, feedback: string, deps: PlanningDeps): Promise<string> {
  const ctx = await assembleShapeContext(cycle, deps);
  const logMeta = { cycleId: cycle.id, weeklySession: true };

  const repairCtx: PlanRepairContext = {
    vocab: ctx.vocab, model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
    systemPrompt: ctx.systemPrompt, userMessage: ctx.userMessage, clientId: cycle.clientId, logger: deps.logger, logMeta,
  };
  const criticCtx: CriticContext = {
    criticPrompt: ctx.criticPrompt, voiceMd: ctx.voiceMd,
    planConfig: {
      pillars: ctx.planConfigRow?.pillars ?? [],
      categories: ctx.planConfigRow?.categories ?? [],
      registerMap: (ctx.planConfigRow?.registerMap ?? {}) as RegisterMap,
    },
    historicPosts: ctx.historicPosts, voiceEdits: ctx.voiceEdits,
    model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
    clientId: cycle.clientId, logger: deps.logger, logMeta, exampleCount: 4,
  };

  let revised = await regeneratePost(planPost, feedback, repairCtx);
  const gate = await applyCodeGate([revised], repairCtx);
  if (gate.acceptedWithWarning.length > 0) throw new Error('code gate could not produce a clean caption');
  const critic = await applyCritic(gate.rows, criticCtx, repairCtx);
  if (critic.acceptedWithWarning.length > 0) throw new Error('critic could not get the caption on-brand');
  revised = critic.rows[0] ?? revised;

  let finalCaption = revised.draftCaption ?? planPost.draftCaption ?? '';
  if (ctx.catalogue) {
    const idx = indexCatalogue(ctx.catalogue as Catalogue, ctx.structuredBrief, deriveBrandTokens(ctx.clientName));
    finalCaption = applyCatalogueValidation(finalCaption, '', idx).caption;
  }
  return finalCaption;
}

function planPostFromRow(row: typeof contentCyclePosts.$inferSelect): PlanPostRow {
  const sm = (row.sourceMeta ?? {}) as Record<string, unknown>;
  return {
    date: isoLabel(row.scheduledDate), day: String(sm['day'] ?? ''), title: String(sm['title'] ?? ''),
    category: String(sm['category'] ?? ''), pillar: row.pillar ?? '', format: FORMAT_LABEL[row.format] ?? 'Static',
    postingTime: String(sm['postingTime'] ?? ''), whoPosts: String(sm['whoPosts'] ?? ''),
    competitorInsight: String(sm['competitorInsight'] ?? ''), draftCaption: row.caption ?? '',
    notes: String(sm['notes'] ?? ''), clientWritesOwn: sm['clientWritesOwn'] === true,
  };
}

interface ProposalSpec { intent: string; payload: Record<string, unknown>; summary: string }

/** Run a weekly planning session for (client, cycle, weekStart). */
export async function runWeeklySession(job: WeeklySessionJob, deps: PlanningDeps): Promise<WeeklySessionResult> {
  const { db, logger } = deps;
  const { clientId, cycleId, weekStart } = job;
  const weekEnd = addDays(weekStart, 6);
  const caps = {
    maxWeather: Number(process.env.WEEKLY_SESSION_MAX_WEATHER ?? 1),
    maxRewrite: Number(process.env.WEEKLY_SESSION_MAX_REWRITE ?? 3),
  };

  const [cycle] = await db.select().from(contentCycles).where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId))).limit(1);
  if (!cycle) throw new Error(`weekly-session: cycle ${cycleId} not found for client ${clientId}`);
  const [client] = await db.select({ lat: clients.lat, lon: clients.lon }).from(clients).where(eq(clients.id, clientId)).limit(1);

  const posts = await db.select().from(contentCyclePosts).where(and(
    eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId), isNull(contentCyclePosts.deletedAt),
    excludeDraftPosts(),   // the weekly audit critiques the PLAN, never unapproved draft beats
    gte(contentCyclePosts.scheduledDate, weekStart), lte(contentCyclePosts.scheduledDate, weekEnd),
  ));

  const noteRows = await db.select({
    id: planInputs.id, content: planInputs.content, relevantFrom: planInputs.relevantFrom, relevantTo: planInputs.relevantTo,
  }).from(planInputs).where(and(
    eq(planInputs.clientId, clientId), eq(planInputs.type, 'note'), eq(planInputs.status, 'active'),
    or(isNull(planInputs.relevantFrom), lte(planInputs.relevantFrom, weekEnd)),
    or(isNull(planInputs.relevantTo), gte(planInputs.relevantTo, weekStart)),
  ));
  const notes: AuditNote[] = noteRows.map((n) => ({ id: n.id, content: n.content, relevantFrom: n.relevantFrom, relevantTo: n.relevantTo }));

  const forecast = client?.lat != null && client?.lon != null ? await fetchForecast(client.lat, client.lon) : [];
  const flags = buildWeatherFlags(forecast);

  // ── Pass 1: audit ──────────────────────────────────────────────────────────
  const findings = await runAudit({
    weekStart, weekEnd, flags, cycleDates: [],
    posts: posts.map((p) => ({ id: p.id, date: p.scheduledDate, channel: p.channel, text: p.caption ?? '' })),
    notes,
  }, deps.model);
  const { actioned, skipped } = applyCaps(findings, caps);
  logger.info({ clientId, cycleId, weekStart, findings: findings.length, actioned: actioned.length, skipped: skipped.length }, 'weekly-session: audit complete');

  // ── Pass 2: generate content for actioned findings ─────────────────────────
  const specs: ProposalSpec[] = [];
  const notableDate = forecast.find((d) => d.date >= weekStart && d.date <= weekEnd && d.category !== 'clear')?.date;

  for (const f of actioned) {
    try {
      if (f.type === 'clanger' || f.type === 'note_integration') {
        const post = posts.find((p) => p.id === f.postId);
        if (!post) continue;
        const feedback = `Address this reviewer finding: "${f.trigger}". Rewrite the caption to resolve it while keeping the post on-brand for this client (voice, register, sign-off, products). If the finding's rationale references the weather or season, weave that context in naturally so the post feels timely. Keep the post's core subject; make the smallest change that fully addresses the finding.`;
        const caption = await generateCaption(cycle, planPostFromRow(post), feedback, deps);
        // Quota: count the pre-generated rewrite at generation time.
        // The weekly session runs on a schedule with nobody in the room: actor 'agent'.
        try { await db.insert(postEdits).values({ postId: post.id, cycleId, scope: 'post', instruction: f.trigger, captionBefore: post.caption ?? '', captionAfter: caption, passed: true, actor: 'agent' }); } catch { /* audit best-effort */ }
        specs.push({
          intent: 'rewrite_post',
          payload: { kind: 'apply_caption', cycleId, postId: post.id, caption, noteId: f.type === 'note_integration' ? f.noteId ?? null : null },
          summary: `Rewrite “${postTitle(post.caption, post.pillar)}” (${isoLabel(post.scheduledDate)}): ${f.trigger}`,
        });
      } else if (f.type === 'weather_opportunity') {
        const date = notableDate ?? weekStart;
        const skeleton: PlanPostRow = {
          date: isoLabel(date), day: '', title: '', category: '', pillar: 'Weather', format: 'Static',
          postingTime: '', whoPosts: '', competitorInsight: '', draftCaption: '', notes: f.trigger, clientWritesOwn: false,
        };
        const feedback = `Write a fresh, on-brand caption for a NEW ${cycle.channel} post that speaks directly to the current weather and connects it to a genuine brand benefit — how the client's fabrics (e.g. organic GOTS cotton, linen) perform in these conditions. Weather trigger: "${f.trigger}". Keep it in the client's voice; do not invent products, certifications, or claims beyond what the brand actually offers.`;
        const caption = await generateCaption(cycle, skeleton, feedback, deps);
        specs.push({
          intent: 'add_post',
          payload: { kind: 'add_generated', cycleId, date, channel: cycle.channel, format: 'single', pillar: 'Weather', caption },
          summary: `Add a post (${isoLabel(date)}): ${f.trigger}`,
        });
      } else if (f.type === 'date_conflict') {
        const post = posts.find((p) => p.id === f.postId);
        if (!post || !f.toDate) continue;
        specs.push({
          intent: 'move_post',
          payload: { kind: 'move', cycleId, postId: post.id, toDate: f.toDate },
          summary: `Move “${postTitle(post.caption, post.pillar)}” from ${isoLabel(post.scheduledDate)} → ${isoLabel(f.toDate)}: ${f.trigger}`,
        });
      }
    } catch (err) {
      logger.warn({ clientId, cycleId, finding: f.type, err: String(err) }, 'weekly-session: generation failed for a finding — skipped');
    }
  }

  // ── Persist: conversation + assistant message + proposals + session row ─────
  const changeSetId = randomUUID();
  const quiet = specs.length === 0;
  const message = quiet ? quietMessage(weekStart) : changeMessage(weekStart, specs.map((s) => s.summary), skipped.length);

  const [conv] = await db.insert(conversations).values({ clientId, cycleId }).returning({ id: conversations.id });
  const [msg] = await db.insert(agentMessages).values({
    conversationId: conv!.id, role: 'assistant', content: message, source: 'web',
    metadata: { weeklySession: true, weekStart, changeSetId: quiet ? null : changeSetId },
  }).returning({ id: agentMessages.id });

  for (const spec of specs) {
    await db.insert(agentProposals).values({
      clientId, conversationId: conv!.id, messageId: msg!.id, changeSetId,
      intent: spec.intent, payload: spec.payload, summary: spec.summary,
    });
  }

  await db.insert(weeklySessions).values({
    clientId, cycleId, weekStart, changeSetId: quiet ? null : changeSetId,
    findings, actionedCount: specs.length, skippedCount: skipped.length, status: quiet ? 'quiet' : 'proposed',
  });

  logger.info({ clientId, cycleId, weekStart, status: quiet ? 'quiet' : 'proposed', actioned: specs.length }, 'weekly-session: complete');
  return { status: quiet ? 'quiet' : 'proposed', actioned: specs.length, skipped: skipped.length, changeSetId: quiet ? null : changeSetId };
}

// Re-export the finding type for the tick/consumer.
export type { Finding };
