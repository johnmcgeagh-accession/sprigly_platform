/**
 * steps.ts — production-checklist data layer (redesign Stage 1). All access is scoped
 * server-side by (clientId, cycleId, postId); a step is only ever touched if its post
 * belongs to the caller's client+cycle and isn't soft-deleted. Reads are batched (no
 * N+1). Step ticks and checklist generation append to the plan_activity ledger.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db, postSteps, stepTemplates, contentCyclePosts } from '@sprigly/db';
import type { PostStepRow } from '@sprigly/db';
import type { PostStepView, StepActor } from './types.js';
import { recordActivity, USER_ACTOR, type ActivityActor } from '@/lib/activity';
import { e2eTodayIso } from '@/lib/e2e-fake';
import { isEditableDate, editScopeToday } from '@/lib/edit-scope';

/**
 * "Today" for at-risk / bucket derivations, in the tenant's timezone. No per-tenant
 * timezone is stored (client_configs has only a location NAME, for the weather audit),
 * so we default to Europe/London — recorded in design/DECISIONS.md. `en-CA` formats as
 * 'YYYY-MM-DD'. Impure by design; the derivations in checklist.ts take this as input.
 */
export function resolveTodayIso(timeZone = 'Europe/London'): string {
  const frozen = e2eTodayIso();   // non-prod e2e override, else null
  if (frozen) return frozen;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function stepView(r: PostStepRow): PostStepView {
  return {
    id:        r.id,
    label:     r.label,
    leadDays:  r.leadDays,
    done:      r.done,
    doneAt:    r.doneAt ? r.doneAt.toISOString() : null,
    sort:      r.sort,
    createdBy: (r.createdBy === 'agent' ? 'agent' : 'user') as StepActor,
  };
}

/** Verify the post is owned by this client+cycle and live; returns its format + date, else null. */
async function ownedPostFormat(clientId: string, cycleId: string, postId: string): Promise<{ format: string; scheduledDate: string } | null> {
  const [row] = await db
    .select({ format: contentCyclePosts.format, scheduledDate: contentCyclePosts.scheduledDate })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, postId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.cycleId, cycleId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  return row ?? null;
}

/** Owned + editable (scheduled_date >= today London). A read (listStepsForPost) uses
 *  ownedPostFormat directly (viewing past checklists is allowed); a WRITE uses this. */
function editableStepPost(
  owned: { format: string; scheduledDate: string } | null,
  today: string,
): { format: string } | null {
  if (!owned) return null;
  if (!isEditableDate(owned.scheduledDate, today)) return null;   // past-dated → read-only
  return owned;
}

/**
 * Steps for many posts in ONE query, grouped by post id (batched — no N+1). Ordered by
 * sort then created_at so the checklist reads top-to-bottom. Used to fold steps into
 * the month/plan payload.
 */
export async function listStepsForPosts(postIds: string[]): Promise<Map<string, PostStepView[]>> {
  const grouped = new Map<string, PostStepView[]>();
  if (postIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(postSteps)
    .where(inArray(postSteps.postId, postIds))
    .orderBy(asc(postSteps.postId), asc(postSteps.sort), asc(postSteps.createdAt));
  for (const r of rows) {
    const list = grouped.get(r.postId) ?? [];
    list.push(stepView(r));
    grouped.set(r.postId, list);
  }
  return grouped;
}

/** Steps for a single owned post (empty array if none). null if not owned. */
export async function listStepsForPost(clientId: string, cycleId: string, postId: string): Promise<PostStepView[] | null> {
  if (!(await ownedPostFormat(clientId, cycleId, postId))) return null;
  return (await listStepsForPosts([postId])).get(postId) ?? [];
}

/** Next sort index for a post's checklist (append to the end). */
async function nextSort(postId: string): Promise<number> {
  const rows = await db.select({ sort: postSteps.sort }).from(postSteps).where(eq(postSteps.postId, postId));
  return rows.reduce((m, r) => Math.max(m, r.sort), -1) + 1;
}

/** Add one step to an owned post. null if not owned. (No ledger row — only ticks and
 *  generation are ledgered per Stage 1 scope.) */
export async function addStep(
  clientId: string, cycleId: string, postId: string,
  input: { label: string; leadDays: number }, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<PostStepView[] | null> {
  if (!editableStepPost(await ownedPostFormat(clientId, cycleId, postId), today)) return null;
  await db.insert(postSteps).values({
    postId, label: input.label, leadDays: Math.trunc(input.leadDays),
    sort: await nextSort(postId), createdBy: actor.origin,
  });
  return (await listStepsForPosts([postId])).get(postId) ?? [];
}

/** Toggle a step's done state and append a step_completed / step_uncompleted ledger
 *  row (atomically). null if the post isn't owned or the step isn't on it. */
export async function setStepDone(
  clientId: string, cycleId: string, postId: string, stepId: string,
  done: boolean, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<PostStepView[] | null> {
  if (!editableStepPost(await ownedPostFormat(clientId, cycleId, postId), today)) return null;
  const [step] = await db
    .select({ id: postSteps.id, label: postSteps.label })
    .from(postSteps)
    .where(and(eq(postSteps.id, stepId), eq(postSteps.postId, postId)))
    .limit(1);
  if (!step) return null;

  await db.transaction(async (tx) => {
    await tx.update(postSteps)
      .set({ done, doneAt: done ? new Date() : null })
      .where(and(eq(postSteps.id, stepId), eq(postSteps.postId, postId)));
    await recordActivity(tx, {
      clientId, cycleId, postId, actor,
      action: done ? 'step_completed' : 'step_uncompleted',
      payload: { stepId, label: step.label },
    });
  });
  return (await listStepsForPosts([postId])).get(postId) ?? [];
}

/** Rename a step's label and append a step_renamed ledger row (atomically). null if the
 *  post isn't owned or the step isn't on it; a blank label is rejected upstream (route). */
export async function renameStep(
  clientId: string, cycleId: string, postId: string, stepId: string,
  label: string, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<PostStepView[] | null> {
  if (!editableStepPost(await ownedPostFormat(clientId, cycleId, postId), today)) return null;
  const [step] = await db
    .select({ id: postSteps.id, label: postSteps.label })
    .from(postSteps)
    .where(and(eq(postSteps.id, stepId), eq(postSteps.postId, postId)))
    .limit(1);
  if (!step) return null;
  const next = label.trim().slice(0, 120);
  if (!next || next === step.label) return (await listStepsForPosts([postId])).get(postId) ?? []; // no-op, no ledger row

  await db.transaction(async (tx) => {
    await tx.update(postSteps)
      .set({ label: next })
      .where(and(eq(postSteps.id, stepId), eq(postSteps.postId, postId)));
    await recordActivity(tx, {
      clientId, cycleId, postId, actor,
      action: 'step_renamed',
      payload: { stepId, from: step.label, to: next },
    });
  });
  return (await listStepsForPosts([postId])).get(postId) ?? [];
}

/** Remove a step from an owned post. null if not owned. */
export async function removeStep(clientId: string, cycleId: string, postId: string, stepId: string, today: string = editScopeToday()): Promise<PostStepView[] | null> {
  if (!editableStepPost(await ownedPostFormat(clientId, cycleId, postId), today)) return null;
  await db.delete(postSteps).where(and(eq(postSteps.id, stepId), eq(postSteps.postId, postId)));
  return (await listStepsForPosts([postId])).get(postId) ?? [];
}

export type GenerateResult =
  | { status: 'created'; steps: PostStepView[] }
  | { status: 'not_found' }
  | { status: 'exists' }        // idempotency: steps already present → 409 at the route
  | { status: 'no_template' };  // e.g. an 'email' post has no checklist template

/**
 * Instantiate a checklist from the step_templates row for the post's format. Idempotent
 * by refusal: if the post already has steps it returns 'exists' (the route answers 409),
 * so a double-click never doubles the checklist. Appends a checklist_generated ledger
 * row. This is also the endpoint an agent "build checklist" proposal applies through
 * (actor.origin = 'agent').
 */
export async function generateChecklist(
  clientId: string, cycleId: string, postId: string, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<GenerateResult> {
  const owned = editableStepPost(await ownedPostFormat(clientId, cycleId, postId), today);
  if (!owned) return { status: 'not_found' };
  const { format } = owned;

  const existing = await db.select({ id: postSteps.id }).from(postSteps).where(eq(postSteps.postId, postId)).limit(1);
  if (existing.length > 0) return { status: 'exists' };

  const [template] = await db.select().from(stepTemplates).where(eq(stepTemplates.contentType, format)).limit(1);
  if (!template || template.steps.length === 0) return { status: 'no_template' };

  await db.transaction(async (tx) => {
    await tx.insert(postSteps).values(
      template.steps.map((s, i) => ({
        postId, label: s.label, leadDays: s.leadDays, sort: i, createdBy: actor.origin,
      })),
    );
    await recordActivity(tx, {
      clientId, cycleId, postId, actor,
      action: 'checklist_generated',
      payload: { format, count: template.steps.length },
    });
  });

  return { status: 'created', steps: (await listStepsForPosts([postId])).get(postId) ?? [] };
}

/**
 * REPLACE a post's checklist with its current format's template (Stage 6 format editing).
 * Unlike generateChecklist, this deletes existing steps first. For a format with no
 * template (email) it clears the checklist and returns 'no_template'. Ledgers
 * checklist_generated (replaced=true).
 */
export async function regenerateChecklist(
  clientId: string, cycleId: string, postId: string, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<GenerateResult> {
  const owned = editableStepPost(await ownedPostFormat(clientId, cycleId, postId), today);
  if (!owned) return { status: 'not_found' };
  const { format } = owned;

  const [template] = await db.select().from(stepTemplates).where(eq(stepTemplates.contentType, format)).limit(1);
  if (!template || template.steps.length === 0) {
    // No template for this format (e.g. email) — clear the checklist to match.
    await db.delete(postSteps).where(eq(postSteps.postId, postId));
    return { status: 'no_template' };
  }

  await db.transaction(async (tx) => {
    await tx.delete(postSteps).where(eq(postSteps.postId, postId));
    await tx.insert(postSteps).values(
      template.steps.map((s, i) => ({ postId, label: s.label, leadDays: s.leadDays, sort: i, createdBy: actor.origin })),
    );
    await recordActivity(tx, {
      clientId, cycleId, postId, actor,
      action: 'checklist_generated',
      payload: { format, count: template.steps.length, replaced: true },
    });
  });

  return { status: 'created', steps: (await listStepsForPosts([postId])).get(postId) ?? [] };
}
