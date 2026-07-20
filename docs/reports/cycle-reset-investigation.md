# Cycle reset — investigation

**Date:** 2026-07-20
**Branch:** `dev`
**Mode (Part 1):** read-only. All DB access via `psql` with `PGOPTIONS='-c default_transaction_read_only=on'` (verified `default_transaction_read_only = on` on both targets). SELECTs only.
**Targets:** UAT `hayabusa.proxy.rlwy.net:24746` (`.env.local`), prod `yamabiko.proxy.rlwy.net:59459` (`.env.prod`) — used only for a migration-state cross-check.

**Purpose being tested against:** repeated end-to-end runs of the draft flow (assemble → intake reshape → approve → phase 2) on UAT sandbox clients. "Fresh" must mean the next run behaves as a *first* run.

---

## Verdict

**No existing path is sufficient. Part 2 is warranted.**

Three affordances are named "reset"/"prepare" and all three perform the *same two-column status poke*. Nothing in the repo deletes cycle-scoped rows as a reset. Details in §1.

---

## 1. Existing reset paths — all insufficient

Three call sites, one behaviour:

| # | site | reachable via |
|---|---|---|
| 1 | `admin/src/app/admin/clients/[id]/actions.ts:451-461` `resetCycle` | admin UI, "Danger zone → Reset cycle" |
| 2 | `admin/src/app/admin/clients/[id]/actions.ts:218-223` inside `triggerCycle` | admin UI, "Start cycle & fetch inputs" |
| 3 | `engine/src/reset-cycle.ts:9-13` | CLI `pnpm --filter @sprigly/worker reset-cycle <clientId> <cycleMonth>` (`engine/package.json:34`) |

```ts
// admin/src/app/admin/clients/[id]/actions.ts:451-461
await db.update(contentCycles)
  .set({ status: 'scheduled', requestSentAt: null })
  .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, dataMonth)));
```

**Total written: `content_cycles.status` → `'scheduled'`, `content_cycles.request_sent_at` → `NULL`.** That is the complete list. The admin confirm dialog says so itself (`CardActions.tsx:237-239`): *"The content_cycles row is retained; only the status is reset."*

**"Start & prepare"** is `startCycleForMonth` (`actions.ts:387-449`). It resolves `dataMonth`, frees BullMQ slots, applies the same two-column update (`:430-435`) and enqueues `ig-trawl`. It stops at `'requested'` and never enqueues planning. Its own comment (`actions.ts:428-429`):

> `// (This only resets cycle STATUS; content_cycle_posts are untouched — those are`
> `// only ever rewritten by the planning worker, so no other month's plan is at risk.)`

So "prepare" is a fetch-trigger, not a re-prepare.

**Corroborating grep** — no writer anywhere nulls the cycle payload columns:

```
grep -rn "intakeJson: null|draftCsvRef: null|workbookRef: null|postsSyncStatus: null|
igInputStatus: null|leanLine: null|deliveredAt: null|approvedAt: null|failedStep: null|
pendingDeltasJson: null" app/src admin/src engine/src packages/*/src   →  ZERO hits
```

**The one true "never ran" reset in the repo** is `packages/db/src/seed-e2e.ts:66-72` — `TRUNCATE TABLE clients CASCADE`. Whole-database, every tenant, no cycle scoping, no teardown function, and guarded only by convention. Unusable here, but see §3.9 — its comment is load-bearing evidence.

### Why status-only is not enough

Two survivors are hard blockers, not cosmetic:

- **`approved_at` is indelible.** Written only at `packages/engine/src/draft-approval-core.ts:141-143`; cleared nowhere. `draft-approval-core.ts:100` (`if (cycle.approvedAt) return fail('already_approved')`) and `app/src/lib/draft-mutations.ts:81` (`if (row.approvedAt) return false`) mean a status-reset cycle is **permanently locked out of re-approval and draft edits**.
- **`ask_sent_at` suppresses the whole intake sequence.** `engine/src/content-cycles/scheduler.ts:388-389` — *"the timestamp IS the state"*. A status-reset cycle never re-sends Ask/Nudge/Last-call.

---

## 2. Assembly idempotency

**Naming correction, because three things share a name:** there is no `assembleDraftPlan`. The DB-facing orchestrator is **`assembleAndPersistDraft`** (`engine/src/content-cycles/draft-plan.ts:121`). `assembleDraft` (`packages/engine/src/draft-assembly.ts:142`) is the pure, DB-free assembler; a third `assembleDraft` is a local closure in `scheduler.ts:365`.

### Existing draft rows → delete-before-insert. No duplication.

`engine/src/content-cycles/draft-plan.ts:225-231`:

```ts
await db.transaction(async (tx) => {
  await tx.delete(contentCyclePosts).where(and(
    eq(contentCyclePosts.cycleId, cycle.id),
    eq(contentCyclePosts.status, POST_STATUS_DRAFT),
  ));
  if (rows.length > 0) await tx.insert(contentCyclePosts).values(rows);
});
```

Stated intent (`:113-116`): *"Replaces any existing draft rows for the cycle (a re-run supersedes its own previous proposal — drafts are not history). Only ever touches status='draft' rows."*

So re-running is **idempotent in row count but not in content** — the phrasing pass is non-deterministic, so beat titles change between runs.

Two observations, recorded not fixed:
- The delete is **not** `deletedAt`-filtered, unlike every read helper (`cycleHasDraft:248`, `countDraftBeats:276`, both `isNull(deletedAt)`). A re-run hard-deletes soft-deleted draft rows too.
- **No cycle-status precondition.** The lookup (`:128-134`) filters on `id` + `clientId` only. Any status will assemble.

### Ask touch fired twice → guarded, but upstream of assembly

`engine/src/content-cycles/scheduler.ts:388-389`:

```ts
const alreadySent = touch === 'ask' ? cycle.askSentAt : touch === 'nudge' ? cycle.nudgeSentAt : cycle.lastCallSentAt;
if (alreadySent != null) { logger.info(logCtx, '[touch:skipped reason=already_sent]'); return 'skipped'; }  // the timestamp IS the state
```

The second invocation returns `'skipped'` before reaching the assembly call at `:424-432`, so no second assembly.

**Recorded, not fixed:** the guard sits *upstream* of assembly, and the stamp happens only *after* a confirmed send (`:459-460`). If assembly succeeds but the email send fails (`:451-455`), the function returns without stamping — draft rows are written and the next tick re-assembles from scratch. This is safe **only** because of the delete-before-insert above. The two mechanisms are load-bearing together.

---

## 3. Contamination inventory

**Enumeration method (both applied):**

1. **Schema walk** — `information_schema.columns` on UAT for every table carrying `cycle_id` / `used_in_cycle_id`; then `information_schema.table_constraints` + `referential_constraints` for the FK/cascade graph; then `pg_trigger` + `pg_get_triggerdef` for triggers on the affected tables. Cross-read against `packages/db/src/schema.ts`.
2. **Writer grep** — every `.insert(`, `.update(`, `.set({`, `.delete(` and raw-SQL site touching each table/column, traced to file:line.

**Tables carrying a cycle reference (schema walk, UAT):**

```
app_magic_link_tokens.cycle_id      content_cycle_posts.cycle_id
conversations.cycle_id              plan_activity.cycle_id
plan_inputs.cycle_id                plan_inputs.used_in_cycle_id
planning_trace.cycle_id             post_edits.cycle_id
weekly_sessions.cycle_id
```

**FK graph (UAT), with delete rules:**

```
plan_activity.post_id        → content_cycle_posts   ON DELETE SET NULL
post_edits.post_id           → content_cycle_posts   NO ACTION      ← blocks post delete
post_steps.post_id           → content_cycle_posts   CASCADE
(everything .cycle_id)       → content_cycles        NO ACTION
```

### 3.1 `content_cycle_posts` — CLEAR (hard delete)

**Six status values are written in code**, not the three the schema comment claims (`schema.ts:1023` is stale). Canonical union at `app/src/lib/types.ts:18`:

```ts
export type PostStatus = 'planned' | 'edited' | 'new' | 'generating' | 'generation_failed' | 'draft';
```

`generation_failed` **confirmed** (writers: `mutations.ts:230`, `phase2.ts:121-122`, `shape.ts:196-197`, `draft-plan.ts:329`), and `generating` is a sixth the brief did not list (`mutations.ts:200-203,221`, `draft-approval-core.ts:133`). Both observed live in UAT — cycle `040d6a1a` holds 9 × `new` + 1 × `generation_failed`.

`deleted_at` has two writers (`mutations.ts:240`, `:257-259`) and **nothing ever clears it**. Reset must hard-delete, not un-soft-delete.

### 3.2 `content_cycles` cycle-level stamps — CLEAR

The Build D approval core stamps exactly three columns — `packages/engine/src/draft-approval-core.ts:141-143`:

```ts
await tx.update(contentCycles)
  .set({ approvedAt: now, approvedBy: auto ? 'auto' : 'client', updatedAt: now })
  .where(eq(contentCycles.id, cycleId));
```

Columns to clear, with the writer that sets each:

| column | writer |
|---|---|
| `status`, `prior_status` | `machine.ts:95-110` |
| `intake_source`, `intake_json` | `intake-actions.ts:36-39,85-88`; `intake/route.ts:191`; `draft-apply.ts:146-148` |
| `structured_brief` | `intake/route.ts:60`; `planning.ts:773-776` |
| `pending_deltas_json` | `extract.ts:175-178` |
| `lean_line`, `draft_csv_ref` | `planning.ts:1213` |
| `workbook_ref` | `engine/src/index.ts:122` |
| `request_sent_at` | `request-email.ts:214` |
| `ask/nudge/last_call_sent_at` | `scheduler.ts:459-460` |
| `ask/nudge/last_call_skip_reason` | `scheduler.ts:490-493` |
| `reply_received_at`, `delivered_at`, `finalised_at` | `extract.ts:120,136` |
| `voice_merged_at`, `closed_at` | `apply.ts:167,224` |
| `failed_step` | `planning.ts:1228`, `extract.ts:241`, `apply.ts:230` |
| `ig_input_status/detail/checked_at` | `ig-producer.ts:235-236` |
| `posts_sync_status/at/run_id` | `packages/db/src/sync-status.ts:32` |
| **`approved_at`, `approved_by`** | `draft-approval-core.ts:141` |

`reminded_at` is mapped in schema (`:728`) but **has no writer** — a dead column.

### 3.3 Intake records + `intake_json` — CLEAR

**There is no separate intake table.** Build C receipts live on `content_cycles.intake_json` under key `draftApplications` — `app/src/lib/draft-apply.ts:146-148`:

```ts
await db.update(contentCycles)
  .set({ intakeJson: { ...intake, draftApplications: next } as unknown, updatedAt: new Date() })
  .where(eq(contentCycles.id, cycleId));
```

`loadReceipts` (`draft-apply.ts:153-161`) reads it back. Nulling `intake_json` clears receipts, answers and free notes together.

### 3.4 `structured_brief` — CLEAR (mandatory)

Set by `intake/route.ts:60` and `planning.ts:773-776`. Cleared only by `packages/db/src/structured-brief-invalidate.ts:59-61`, and **only when status is pre-planning** (`:47`, `PRE_PLANNING_STATUSES` at `:31-33`).

`ensureStructuredBrief` is **extract-once**: non-null → returned as-is, never re-extracted. On extraction failure it returns `EMPTY_STRUCTURED_BRIEF` in-memory only (`planning.ts:1068-1069`, *"NOT persisted, so a later run retries"*).

**Implication:** a reset MUST null `structured_brief` explicitly. Setting status back to `scheduled` is not sufficient — nothing re-clears it once it is set.

### 3.5 `plan_inputs` — MIXED SCOPE. **Decision taken: delete created, un-consume consumed.**

Writers and scope:

| column | writer | scope |
|---|---|---|
| `cycle_id` | `agent/notes.ts:25-33` (`saveNote`). **`saveDurableInput:53-60` writes `cycleId: null`**; `draft-apply.ts:166` also `cycleId: null` (with `void cycleId;` at `:174`) | cycle-scoped only when non-null |
| `origin`, `lifecycle` | `draft-apply.ts:171-172` (`'client'` / `'candidate'`) | client-scoped |
| `used_in_cycle_id` | **single writer** `draft-apply.ts:307-309` | cycle-scoped pointer on a client-scoped row |
| `consumed_by_proposal_id`, `status` | `agent/notes.ts:137`, `:24,93,124` | client-scoped |

```ts
// app/src/lib/draft-apply.ts:306-309 — addBacklogItemToMonth
await db.update(planInputs)
  .set({ lifecycle: 'used', usedInCycleId: cycleId })
  .where(and(eq(planInputs.id, planInputId), eq(planInputs.clientId, clientId)));
```

**Recommendation, confirmed by the user before building:**

- `DELETE FROM plan_inputs WHERE cycle_id = :cycleId` — rows the run *created*.
- `UPDATE plan_inputs SET used_in_cycle_id = NULL, lifecycle = 'candidate' WHERE used_in_cycle_id = :cycleId` — rows the run *consumed*. These pre-dated the run, so a faithful "never ran" state returns them to the backlog unconsumed rather than destroying them.

**Must NOT delete** rows with `cycle_id IS NULL` and no `used_in_cycle_id` — durable client backlog that the run never touched.

### 3.6 `post_edits` — CLEAR (mandatory, and this one is a live behaviour gate)

Writers: `shape.ts:169-172`, `refine.ts:102`, `weekly-session.ts:174`.

This is **not** merely history. `app/src/lib/usage.ts:44-55` counts `post_edits` rows to enforce the monthly AI-change cap:

```ts
.from(postEdits)
.innerJoin(contentCycles, eq(postEdits.cycleId, contentCycles.id))
.where(and(
  eq(contentCycles.clientId, clientId),
  eq(contentCycles.channel,  channel),
  eq(postEdits.passed, true),
  gte(postEdits.createdAt, start),        // start = 1st of the CURRENT CALENDAR month
));
```

gated at `usage.ts:76-78` (`used >= limit`, default 30) and consumed at `agent/proposals.ts:264-268`.

**The window is the current calendar month across all cycles for that client+channel — not the cycle.** A generated 30-post month writes ~30 `post_edits` rows (one per caption, `shape.ts:169`), which is exactly the default limit. **Leaving `post_edits` in place means the next test run's rewrites fail as quota-exhausted.** Deleting `WHERE cycle_id = :cycleId` is both mandatory and cycle-scoped-safe.

`post_edits.post_id` is `NO ACTION`, so **post_edits must be deleted before posts**.

### 3.7 `audit_log` / cost-guard — **KEEP** (confirmed correct)

`audit_log` (`schema.ts:292-303`) has **no `cycle_id`** — it is client-scoped. Single writer `packages/audit/src/audit-logger.ts:11`.

The only read that consults it is `app/src/lib/phase2-cost.ts:88-104`:

```ts
const since = cycle?.approvedAt ?? new Date(0);
...
.from(auditLog).where(and(eq(auditLog.clientId, clientId), gte(auditLog.createdAt, since)))
```

This is **reporting only — it gates nothing**. Clearing `approved_at` is therefore sufficient to reset cost attribution; the rows themselves must stay (spend history is history, and they are shared across cycles).

**One caveat worth stating:** between reset and the next approval, `approvedAt` is NULL so `since = new Date(0)` and `measurePhase2Cost` would report *all* historical spend for that client. It self-corrects the moment the cycle is re-approved. Reporting artefact, not contamination of the run.

No monthly *spend* cap exists anywhere — `costPence` is written but never read as a gate. The in-process rate limiter (`app/src/lib/rate-limit.ts:8`) is an in-memory `Map`, per Node instance; nothing to clear.

### 3.8 Email send records — CLEAR (mandatory)

All live on `content_cycles`; there is no email-log table.

| column | gates re-sending? |
|---|---|
| `ask_sent_at` / `nudge_sent_at` / `last_call_sent_at` | **YES — hard at-most-once gate** (`scheduler.ts:388-389`) |
| `*_skip_reason` | No — diagnostic only (`schema.ts:735-740`) |
| `request_sent_at` | Legacy draft-creation stamp |

**Recorded, not fixed:** the `plan_ready` / `plan_ready_auto` emails have **no send stamp at all**, so they re-send on every completed run with no guard.

### 3.9 `plan_activity` — **UNDELETABLE by default. This is the central design constraint.**

Migration `packages/db/migrations/0068_plan_activity.sql`:

```sql
-- Append-only: block UPDATE and DELETE at the data layer, not just by convention.
CREATE OR REPLACE FUNCTION plan_activity_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'plan_activity is append-only (% is blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "plan_activity_no_mutate"
  BEFORE UPDATE OR DELETE ON "plan_activity"
  FOR EACH ROW EXECUTE FUNCTION plan_activity_append_only();
```

Verified live on UAT via `pg_get_triggerdef`.

**The trap:** `plan_activity.post_id` is `ON DELETE SET NULL`. Deleting a post fires an internal **UPDATE** on `plan_activity`, which the trigger blocks — aborting the entire transaction. On UAT cycle `040d6a1a`, all 10 `plan_activity` rows carry a non-null `post_id`, so this fires immediately in practice.

**Therefore any hard-delete reset requires bypassing the trigger.** There is no trigger-respecting route: deleting the activity rows first is equally blocked. The seed's own comment confirms the authors hit this and chose `TRUNCATE` specifically to route around it (`seed-e2e.ts:69-71`):

> *"CASCADE handles FK order and — unlike DELETE — bypasses plan_activity's append-only row trigger."*

**Decision taken (user-confirmed):** inside the reset transaction, `SET LOCAL session_replication_role = 'replica'`, then delete the cycle's `plan_activity` rows alongside the posts. `SET LOCAL` reverts at transaction end. We are `postgres` (superuser, and table owner) on UAT — verified. The bypass sits behind the sandbox guard, so it can never reach a non-sandbox client.

Readers, for completeness: `agent/proposals.ts:117-120` (scoped by `refProposalId`, so old rows cannot contaminate a new run) and `app/src/app/api/e2e/activity/route.ts:26` (reads **all** rows for the client — this one *would* contaminate an e2e assertion, which is the practical argument for deleting rather than retaining).

### 3.10 Remaining cycle-scoped tables — CLEAR

| table | writer | note |
|---|---|---|
| `planning_trace` | `planning-trace.ts:117` | delete by `cycle_id` |
| `weekly_sessions` | `weekly-session.ts:225` | delete by `cycle_id` |
| `conversations` | `agent/conversation.ts:28`, `weekly-session.ts:212` | delete by `cycle_id`, plus dependent `agent_messages` |
| `post_steps` | `app/src/lib/steps.ts:107,129,158,173,204,235` | **no `cycle_id`** — cascades automatically from post delete |
| `agent_proposals` | `agent/proposals.ts:51,86,187,256,277,313` | **no `cycle_id` column** — cycle lives inside `payload->>'cycleId'`; must filter on the JSONB |

### 3.11 `app_magic_link_tokens` — **KEEP** (recommendation)

`planning.ts:653-668` **reuses** an existing unrevoked, unexpired token rather than minting a new one. Deleting it kills any link already emailed to the client; keeping it means the re-run reuses it cleanly. Recommend leaving these rows and **not** blanket-revoking.

### 3.12 BullMQ — CLEAR the cycle-keyed jobs, KEEP the global ticks

Queue carrying cycle work: **`content-cycles`** (`engine/src/index.ts:204-206`; app connects at `app/src/lib/queue.ts:25`).

Job ids are deterministic and mostly cycle-derivable (`job-options.ts:20` — *"BullMQ forbids colons in custom jobIds… Use underscore as separator"*, so prefix scans are safe):

| helper | pattern | cycle-derivable |
|---|---|---|
| `shapeJobId` `queue.ts:28` | `shape_${cycleId}_${postId}` | yes |
| `hookJobId` `queue.ts:128` | `hook_${cycleId}_${postId}` | yes |
| `scriptJobId` `queue.ts:185` | `script_${cycleId}_${postId}` | yes |
| `weeklySessionJobId` `queue.ts:245` | `weekly_${cycleId}_${weekStart}` | yes (prefix scan) |
| `planningJobId` `job-options.ts:31` | `planning_${cycleId}` | yes |
| `igTrawlJobId` `job-options.ts:21` | `ig-trawl_${clientId}_${channel}_${dataMonth}` | derive from cycle row |
| `requestEmailJobId` `job-options.ts:25` | `request-email_${clientId}_${channel}_${dataMonth}` | derive from cycle row |

**Why removal is mandatory, not optional** — `consumer.ts:168-179`:

> *"BullMQ silently deduplicates queue.add() against jobs already in the completed set — queue.add() returns without error and without enqueuing."*

So a leftover completed `planning_<cycleId>` key makes the *next* run's enqueue a silent no-op. Retry backoff compounds it: `GENERATION_JOB_OPTIONS` (`job-options.ts:44-49`) is `attempts: 3`, exponential 5s — an in-flight shape/hook/script job can land on a just-reset cycle up to ~15s later and write `generation_failed` or a caption into it.

**Must NOT be removed:** the repeatable ticks — `scheduler-tick` (cron `0 5 * * *` Europe/London, `engine/src/index.ts:236-240`) and `weekly-session-tick` (cron `0 6 * * 1`, `weekly-cron.ts:30-34`). These are **global, not cycle-keyed**. The reset must simply be idempotent against them firing.

---

## 4. Manual invocation path

**No draft-assembly CLI exists.** Checked all 40 entries in `engine/package.json` scripts, `scripts/`, admin actions and app API routes. Near-misses that are *not* assembly: `api/plan/draft/route.ts` (reader + mutations), `draft/apply/route.ts:40`, `draft/approve/route.ts:29`. The only production caller is the closure at `consumer.ts:212-223`.

**Cleanest path — call the function directly** (mirroring `planning-trace-cli.ts` / `trigger-plan-cli.ts`):

```ts
assembleAndPersistDraft(
  params: { clientId: string; cycleId: string; now?: Date },
  deps:   PlanningDeps,
): Promise<AssembleAndPersistResult>   // { draft, beatsWritten, phrasing }
```

`PlanningDeps` (`planning.ts:80-93`) requires `db, encProvider, googleClientId, googleClientSecret, model, prompts, audit, logger`; only `db`, `model`, `logger` are exercised on this path.

**Timing is already moot.** All the window gates live in the *scheduler*, not in `assembleAndPersistDraft`:

- `dueTouch` (`scheduler.ts:368-370`) → `deriveTouchSchedule` / `dueTouchForDay` (`packages/engine/src/touch-schedule.ts:32-58`) — exact day-of-month equality against `askDay = reminderDay`, `lastCallDay = cutoffDay - 1`, `nudgeDay = cutoffDay - 3`.
- cohort-month match (`scheduler.ts:376-385`, `:525`).

Calling `assembleAndPersistDraft` directly **bypasses `dueTouch`, the `ask_sent_at` guard, the `hasSuppressibleInput` check and the cohort-month match entirely.** No date faking or `content_cycle_schedule` edit is needed.

**Bedrock is optional.** `phraseDraftTitles` (`packages/engine/src/draft-phrasing.ts:128`) is the sole model call; per its contract (`:123-126`) it *"NEVER throws"*, retries once (`:143`), and on failure returns `outcome: 'fallback'`, after which `applyPhrasing` (`:163-165`) returns beats untouched. **With no Bedrock credentials assembly still completes**, persisting deterministic assembler titles and reporting `phrasing: 'fallback'` — which makes it *more* suitable for a structural test.

**Flag lookup to reuse** — `engine/src/content-cycles/draft-plan.ts:95-102`:

```ts
export async function draftFlowEnabled(deps: PlanningDeps, clientId: string): Promise<boolean> {
  const [cfg] = await deps.db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, clientId))
    .limit(1);
  return readDraftFlowFlag(cfg?.settings);
}
```

over the pure predicate `readDraftFlowFlag` (`packages/engine/src/client-flags.ts:23-27`), storage `client_configs.settings` JSON key `draft_flow_enabled`, strict `=== true`.

**Note:** `assembleAndPersistDraft` does **not** check the flag itself — the gate lives only in the consumer closure (`consumer.ts:217-220`).

---

## 5. Live UAT state (evidence for the reset design)

**Flag-on sandbox clients** (`client_configs.settings`):

```
 earl-of-east | {"plan_redesign": true, "draft_flow_enabled": true}
 sprigly      | {..., "plan_redesign": true, "draft_flow_enabled": true}
 ivy-t        | {"plan_redesign": true}                                ← flag ABSENT
```

`ivy-t` lacks `draft_flow_enabled` on both UAT and prod, so the flag check alone already refuses it. The explicit IVY-t exclusion is defence-in-depth.

**Contaminated cycle** — `earl-of-east` 2026-09 (`040d6a1a`), post-run:

```
 content_cycle_posts | 10    (9 × new, 1 × generation_failed, 10 with beat_meta)
 post_edits          |  9
 plan_activity       | 10    (all 10 with non-null post_id)
 app_magic_link_tokens| 1
 approved_at         | 2026-07-20 19:51:07.258   approved_by | client
```

**Never-run baseline** — `sprigly` 2026-08 (`67ce6f39`): every child table `0`, every stamp `NULL`, `status = 'scheduled'`.

The single exception: `ig_input_status = 'empty_month'` / `ig_input_checked_at` are set even on the never-run cycle — the IG probe runs *before* the draft flow. Reset clears them anyway (they are cycle-scoped run state); a subsequent trawl repopulates them.

---

## 6. Anomalies observed, recorded not fixed

1. **Assembly hard-deletes soft-deleted drafts.** `draft-plan.ts:225-231` omits the `isNull(deletedAt)` filter that every read helper applies.
2. **Ask-touch guard is upstream of assembly.** A send failure after a successful assembly leaves rows written and `ask_sent_at` unstamped, so the next tick re-assembles. Safe only because of the delete-before-insert.
3. **`schema.ts:1023` post-status comment is stale** — lists three of the six values actually written.
4. **`content_cycles.reminded_at` is a dead column** — mapped, never written.
5. **`plan_ready` / `plan_ready_auto` emails have no send stamp**, so they re-send on every completed run with no at-most-once guard.
6. **`engine/src/reset-cycle.ts` omits the `channel` predicate**, so it resets every channel for that month — unlike the admin action, which scopes by channel.
7. **Prod is missing three manual-apply migrations that `schema.ts` already maps: 0084 (`beat_meta`), 0086 (`plan_inputs` backlog columns), 0087 (`approved_at`/`approved_by`).** Verified by `information_schema` on both targets — UAT has all three, prod has none. Because Drizzle `select()` emits every mapped column, promoting `dev` to prod without applying these first makes **every `content_cycles` and `content_cycle_posts` read error**. `drizzle.__drizzle_migrations` stops at id 27 (2026-05-22), so there is no machine-readable record of what prod has. Out of scope here, but it gates any promotion.

---

## 7. Reset specification (what Part 2 builds)

**Clear — cycle-scoped:**
`plan_activity WHERE cycle_id` (trigger bypassed); `post_edits WHERE cycle_id`; `content_cycle_posts WHERE cycle_id` (hard, after post_edits; `post_steps` cascades); `planning_trace WHERE cycle_id`; `weekly_sessions WHERE cycle_id`; `conversations WHERE cycle_id` + dependent `agent_messages`; `agent_proposals WHERE payload->>'cycleId'`; `plan_inputs WHERE cycle_id` (delete) and `WHERE used_in_cycle_id` (un-consume); and on `content_cycles` the columns listed in §3.2.

**Keep:** `audit_log`, `ui_events`, `app_magic_link_tokens`, `client_channels.ai_change_limit*`, `plan_inputs` durable backlog (`cycle_id IS NULL` and untouched by this cycle), `client_planning_config`, and all other client-scoped reference data.

**Redis:** remove `planning_<cycleId>`, `shape_<cycleId>_*`, `hook_<cycleId>_*`, `script_<cycleId>_*`, `weekly_<cycleId>_*`, plus `ig-trawl_` / `request-email_` keys derived from the cycle row. Never remove the repeatable `scheduler-tick` / `weekly-session-tick`.

**Guard:** refuse unless `readDraftFlowFlag(client_configs.settings) === true` for the cycle's client AND the client is not the protected production tenant. Guard failure = loud error, zero writes.
