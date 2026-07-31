# Prod migration audit — what must be applied before the uat→main promotion

**Date:** 2026-07-21
**Branch:** `dev`
**Mode:** read-only. Prod only (`10.163.89.71`, `railway`), `PGOPTIONS='-c default_transaction_read_only=on'`
verified on connect. SELECTs and catalog queries only. **Nothing was applied.**

**Scope:** `packages/db/migrations/0028*.sql` → `0089*.sql`, excluding `.down.sql` and
unnumbered utility scripts. 63 files.

**Method:** the `__drizzle_migrations` ledger stops at id 27 and is useless here, so every
verdict comes from probing prod's actual state — `information_schema.columns`, `pg_indexes`,
`pg_trigger`, `pg_proc`, `pg_constraint`, and the seeded data itself.

---

## Headline

**Prod is far more current than the ledger, or than my own earlier reports, suggested.
Four migrations are outstanding, all of them small, idempotent and safe.**

```
0030  0087  0088  0089
```

No PARTIALs. No prod-only schema drift. Both safety facts confirmed.

### ⚠️ Correction to earlier reports

`wrong-month-generated.md`, `cycle-reset-investigation.md` and others state that prod lacks
**0084** (`beat_meta`) and **0086** (`plan_inputs` backlog columns). **That is no longer
true** — both are present on prod now, so they were applied between those sessions and this
one. Any promotion planning based on those earlier statements should be re-read against this
report.

---

## 1–2. Per-migration verdicts

Grouped where the evidence is identical; every group names its probe.

### APPLIED — schema objects present

| # | description | verdict | evidence probe |
|---|---|---|---|
| 0028 | voice_edits / voice_ingestion_runs / voice_snapshots + 3 indexes | APPLIED | `information_schema.tables`, `pg_indexes` — all 3 tables, `voice_snapshots_one_current`, `voice_ingestion_runs_unique_month`, `voice_edits_client_channel_month` present |
| 0029 | `client_channels.drive_page_token` | APPLIED | column probe |
| 0032 | index `voice_edits_pending` | APPLIED | `pg_indexes` |
| 0037 | `content_cycles` + `content_cycles_unique` | APPLIED | table + index probe |
| 0039 | `clients.content_cycle_enabled` | APPLIED | column probe |
| 0040 | `client_channels` cycle config (instagram_handle, contact_email, contact_name…) | APPLIED | column probe |
| 0041 | `client_planning_config` + index | APPLIED | table + `client_planning_config_client_idx` |
| 0042 | `competitor_gather_cache` + index | APPLIED | table + index |
| 0045 | `client_product_catalogue` + index | APPLIED | table + index |
| 0046 | `planning_trace` + `planning_trace_cycle_idx` | APPLIED | table + index |
| 0048 | `client_planning_config.register_map` | APPLIED | column probe |
| 0050 | `content_cycle_posts` + index + `set_updated_at()` + trigger | APPLIED | table, `content_cycle_posts_cycle_date_idx`, `pg_proc.set_updated_at`, `pg_trigger.content_cycle_posts_set_updated_at` |
| 0051 | `app_magic_link_tokens` + index | APPLIED | table + index |
| 0052 | `content_cycle_posts.deleted_at`, `client_channels.delivery_surface` | APPLIED | column probe |
| 0053 | `post_edits` + `post_edits_post_idx` | APPLIED | table + index |
| 0054 | `client_channels.posts_per_week`, `post_edits_cycle_created_idx` | APPLIED | column + index |
| 0055 | `oauth_connections` health columns (last_ok_at, last_error, last_error_at) | APPLIED | column probe |
| 0056 | `content_cycles.ig_input_*` | APPLIED | column probe |
| 0058 | `content_cycles.structured_brief` | APPLIED | column probe |
| 0059 | `content_cycle_posts.review_state` | APPLIED | column probe |
| 0060 | `content_cycles.posts_sync_status` | APPLIED | column probe |
| 0061 | `content_cycles.posts_synced_at / _run_id` | APPLIED | column probe |
| 0062 | conversations / agent_messages / agent_proposals / plan_inputs + 5 indexes | APPLIED | tables + `plan_inputs_source_proposal_uniq` etc. |
| 0063 | `agent_proposals.change_set_id` + index | APPLIED | column + `agent_proposals_change_set_idx` |
| 0064 | `clients.lat / lon / location_name` | APPLIED | column probe |
| 0065 | `weekly_sessions` + index | APPLIED | table + index |
| 0066 | `post_steps` + index + trigger | APPLIED | table, index, `post_steps_set_updated_at` |
| 0068 | `plan_activity` + 2 indexes + `plan_activity_append_only()` + trigger | APPLIED | table, indexes, `pg_proc`, `pg_trigger.plan_activity_no_mutate` |
| 0069 | `ui_events` + index | APPLIED | table + index |
| 0074 | `ig_posts` + `ig_posts_unique` | APPLIED | table + index |
| 0079 | `themes` + 2 unique indexes + seed | APPLIED | table, `themes_one_active`, `themes_name_version`; data: `Sprigly Coral v1 (active)`, `Teal v1` |
| 0081 | uat→prod delta (13 tables, constraints, indexes, triggers) | APPLIED | every object it creates probed present; also asserted by 0082's own header |
| 0084 | `content_cycle_posts.beat_meta` | **APPLIED** | column probe — *contradicts earlier reports* |
| 0086 | `plan_inputs.origin / lifecycle / used_in_cycle_id` + `plan_inputs_client_lifecycle_idx` | **APPLIED** | column + index probe — *contradicts earlier reports* |

### APPLIED — data seeds present

| # | description | verdict | evidence probe |
|---|---|---|---|
| 0031, 0033–0036 | voice-ingest merge prompt v1→v5 | APPLIED | `prompt_templates`: `voice-ingest/merge` max version **5**, 5 rows |
| 0038 | lean-line prompt | APPLIED | `content-cycle-request-email/lean-line` v1 present |
| 0043, 0047, 0057, 0075 | planning generate-plan v1→v5 | APPLIED | `planning/generate-plan` max version **5**, 6 rows (1 client-scoped = ivy-t, per 0075) |
| 0044, 0049 | planning validate-plan v1→v2 | APPLIED | `planning/validate-plan` max version **2** |
| 0067 | step_templates seed | APPLIED | `step_templates` = **3 rows** (matches 0082 header) |
| 0070 | hooks/scripts columns + `hook_patterns` + 42-row seed | APPLIED | columns `hook`, `script_length_seconds`; `hook_patterns` = **42 rows**; `hook_patterns_active_idx` |
| 0071, 0072, 0073 | generation + ivy-t + refine prompts | APPLIED | `plan_hooks`/`plan_scripts` × `generate`/`refine` all present, global + client-scoped |
| 0076 | `content_cycles.ask/nudge/last_call_sent_at` | APPLIED | column probe |
| 0077, 0078 | email_templates + ask v2 | APPLIED | `ask v1 (unpublished)`, `ask v2 (published)`, `nudge`, `last_call`, `plan_ready` |
| 0080 | `content_cycles.*_skip_reason` ×3 | APPLIED | column probe |
| 0082 (both files) | prod data seed / reference+prompt seed | APPLIED | every row they seed probed present (templates, prompts, themes, steps, hooks) |
| 0083 | ivy-t hook/script prompt v2 | APPLIED | `plan_hooks/generate v2` and `plan_scripts/generate v2`, both client-scoped |
| 0085 | `ask_drafted` template + `email_templates_key_check` | APPLIED | row present **and** `pg_constraint` shows the CHECK exists |

### MISSING — the apply list

| # | description | verdict | evidence probe |
|---|---|---|---|
| **0030** | `sprigly-calendar-build-workbook` prompt templates | **MISSING** | `SELECT count(*) FROM prompt_templates WHERE workflow_id='sprigly-calendar-build-workbook'` → **0** |
| **0087** | `content_cycles.approved_at` / `approved_by` | **MISSING** | both absent from `information_schema.columns` |
| **0088** | `plan_ready_auto` template + widened key CHECK | **MISSING** | no `plan_ready_auto` row; CHECK array is `['ask','ask_drafted','nudge','last_call','plan_ready']` — **no `plan_ready_auto`** |
| **0089** | `content_cycles.plan_ready_sent_at` | **MISSING** | column absent |

**No PARTIALs.** Every migration probed is either wholly present or wholly absent. Nothing
in the apply list needs hand-adjustment, and no file would half-error.

---

## 2b. Ordered apply list

```
psql "$PROD" -f packages/db/migrations/0030_sprigly_calendar_build_workbook_prompts.sql
psql "$PROD" -f packages/db/migrations/0087_draft_approval.sql
psql "$PROD" -f packages/db/migrations/0088_plan_ready_auto.sql
psql "$PROD" -f packages/db/migrations/0089_plan_ready_sent.sql
```

Numeric order is also dependency order. **0088 must not be split** — it replaces the CHECK
constraint *before* inserting the row the old constraint would reject.

**0030 is optional for the content arc.** It seeds prompts for the
`sprigly-calendar-build-workbook` workflow, which is registered in `engine/src/index.ts` but
is a different product surface from the plan arc being promoted. It is listed because it is
genuinely missing and idempotent to apply; nothing in the arc depends on it. If the calendar
workflow ever runs on prod without it, the prompt resolver throws on a missing row.

**0087, 0088, 0089 are required** — the promoted code maps `approved_at`, `approved_by` and
`plan_ready_sent_at` in `schema.ts`, and Drizzle's `select()` emits every mapped column. Without
them, **every `content_cycles` read errors**, not just the approval path.

---

## 3. Prod-specific hazards

| # | CHECK vs existing data | non-null on populated table | lock risk | verdict |
|---|---|---|---|---|
| 0030 | none | none | none | **safe** — idempotent, guarded by `WHERE NOT EXISTS` |
| 0087 | none | `ADD COLUMN IF NOT EXISTS … timestamp` / `text`, both nullable, no default | 3 rows | **safe** |
| 0088 | **checked** — see below | none | 6 rows | **safe** |
| 0089 | none | `ADD COLUMN IF NOT EXISTS … timestamptz`, nullable, no default | 3 rows | **safe** |

### 0088's CHECK, probed against real prod data

The constraint is dropped and re-added, and `ADD CONSTRAINT` validates every existing row.
Prod's current keys:

```
ask, ask_drafted, last_call, nudge, plan_ready      (6 rows)
```

The new array is `['ask','ask_drafted','nudge','last_call','plan_ready','plan_ready_auto']`
— a strict **superset** of what is there. No existing row can violate it. The insert is
guarded by `WHERE NOT EXISTS (… key='plan_ready_auto' AND version=1)`.

### Other domains checked for out-of-range values

- `content_cycles.status` values on prod: all within the `CycleStatus` union — no new domain
  is introduced by the pending set anyway.
- `content_cycle_posts.status`: no CHECK constraint exists on this column (confirmed against
  `pg_constraint`), and none is added.
- `plan_inputs.origin/lifecycle`: already applied (0086), which deliberately added **no**
  CHECK constraints.

### Lock assessment

Every affected table is tiny — `content_cycles` **3 rows**, `content_cycle_posts` **88**,
`email_templates` **6**, `prompt_templates` **48**. All four migrations are metadata-only
`ADD COLUMN` (no rewrite, since nullable with no default) or small guarded inserts. **No
meaningful lock window.**

---

## 4. The two safety facts — both confirmed

**(a) ivy-t has no `draft_flow_enabled` on prod:**

```
  slug   |                    settings                     | has_draft_flow
---------+-------------------------------------------------+----------------
 ivy-t   | {"plan_redesign": true}                         | f
 sprigly | {"model": "haiku", "stepModels": {…}}           | f
```

Neither prod client has the key, so the entire draft-plan arc stays dark after promotion —
`readDraftFlowFlag` requires the boolean `true` and gets `undefined`. Prod has only these
**two** clients; there is no earl-of-east.

**(b) The delivery pin is in the code being promoted:**

```
engine/src/content-cycles/email-send.ts:24
export const APP_DELIVERY_PIN = 'john.mcgeagh@gmail.com';
```

Every templated send is pinned to that address. Combined with (a), nothing client-facing can
be emitted by the arc on prod.

---

## 5. Reverse direction — prod-only drift

Diffed `information_schema.columns` against `packages/db/src/schema.ts` for the six tables the
arc touches:

| table | prod-only columns | schema.ts-only (i.e. pending) |
|---|---|---|
| `content_cycles` | **none** | `approved_at`, `approved_by`, `plan_ready_sent_at` |
| `content_cycle_posts` | **none** | none |
| `plan_inputs` | **none** | none |
| `email_templates` | **none** | none |
| `plan_activity` | **none** | none |
| `oauth_connections` | **none** | none |

**No prod-only columns anywhere.** No hand-applied hotfix has been left un-backported on
these tables, and the only schema.ts-side gaps are exactly the three columns from 0087/0089.

*(Note: an initial automated diff flagged `plan_activity` and `oauth_connections` as
prod-only across the board. That was a parser artefact — both tables use `...baseColumns`
and a definition style my extractor missed. Verified by reading `schema.ts:104` and the
`plan_activity` block directly: every prod column is declared.)*

---

## Things worth knowing before the promotion

1. **Two files are numbered 0082.** `0082_prod_data_seed.sql` and
   `0082_reference_and_prompt_seed.sql` — and the second is internally titled
   *"0076_reference_and_prompt_seed"* in its own header. They overlap heavily (both seed
   prompt_templates, email_templates, hook_patterns, step_templates, themes). Both are
   already applied so this changes nothing today, but a future `ls | sort` apply loop would
   run them in an arbitrary order relative to each other. Worth renumbering.

2. **The ledger is dead and should be said so out loud.** `drizzle.__drizzle_migrations`
   stops at id 27 / 2026-05-22; everything since has been hand-applied via `psql -f`. Every
   audit like this one has to re-derive state by probing. If promotions continue this way,
   the cheapest fix is a one-row-per-file applied-log table written by the apply script —
   not adopting drizzle-kit wholesale.

3. **My earlier reports are stale on 0084/0086.** Flagged at the top; repeating here because
   those reports are linked from the build commits and will be read again.

4. **0030's absence has been harmless so far**, which is itself informative: the
   calendar-build-workbook workflow evidently has not run on prod, or has not reached its
   prompt resolution. Applying it is cheap insurance either way.

---

## Verification commands used (all read-only)

```sql
SHOW default_transaction_read_only;                        -- on
SELECT inet_server_addr(), current_database();             -- 10.163.89.71 / railway
SELECT table_name FROM information_schema.tables WHERE table_schema='public';
SELECT indexname FROM pg_indexes WHERE schemaname='public';
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='email_templates'::regclass AND contype='c';
SELECT column_name FROM information_schema.columns WHERE table_name=$1;
SELECT key, version, is_published FROM email_templates ORDER BY key, version;
SELECT workflow_id, step_name, max(version), count(*) FROM prompt_templates GROUP BY 1,2;
SELECT count(*) FROM themes / step_templates / hook_patterns / content_cycles / content_cycle_posts;
SELECT c.slug, cc.settings, (cc.settings ? 'draft_flow_enabled') FROM clients c LEFT JOIN client_configs cc ON …;
```
