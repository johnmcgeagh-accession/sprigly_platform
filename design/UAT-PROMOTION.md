# Plan Redesign — UAT Promotion Runbook

Promotes the `plan_redesign` surface to the UAT database + environment. Ordered, copy-paste
steps. **Read the "Scope of this promotion" note before running** — it states exactly which
Stage-6 features are live vs still in build.

> Flow reminder: work lands on `dev` → `uat` (this runbook) → John pushes `main` (live).
> Nothing here touches production. Down-migrations are **emergency/local only**.

---

## Scope of this promotion

Live through this promotion: the full redesign shell (calendar / timeline / tasks / approvals /
notes), the editor (caption, checklist, revert, **shape via the real engine worker**), the agent
(real Bedrock proposals → approvals), month-nav across sibling cycles, magic-link sessions, the
brand palette + mark, and the **0070 hooks/scripts schema + hook_patterns library (42 patterns)**.

Also live (Stage-6b): **hook generation** (reels + carousels), **reel script generation**,
**format editing** (with checklist reconcile + hook/script hide-and-retain), and **deviation-3 is
closed** (worker `caption_saved` / `script_saved` ledger rows). These need the **0070 schema** and
the **0071 prompts** applied (above) plus real Bedrock + Redis.

**Not yet in this build:** the **weather overlay** (Slice 4) — independent, calendar-decoration only.

---

## 1. Migrations — apply order 0066 → 0071

All are hand-authored psql (repo convention; NOT drizzle-kit). Apply **in order**, each is
idempotent (`IF NOT EXISTS`). Set the UAT connection string once:

```bash
export UAT_DB="postgresql://<user>:<pass>@<uat-host>:<port>/<db>?sslmode=require"
cd packages/db/migrations
```

Apply (skip any already applied — the guards make re-runs safe):

```bash
psql "$UAT_DB" -f 0066_post_steps.sql
psql "$UAT_DB" -f 0067_step_templates.sql
psql "$UAT_DB" -f 0068_plan_activity.sql
psql "$UAT_DB" -f 0069_ui_events.sql
psql "$UAT_DB" -f 0070_hooks_scripts.sql
psql "$UAT_DB" -f 0071_generation_prompts.sql
```

Verify:

```bash
psql "$UAT_DB" -tAc "SELECT count(*) FROM hook_patterns WHERE active;"          # expect 42
psql "$UAT_DB" -tAc "SELECT count(distinct category) FROM hook_patterns;"       # expect 10
psql "$UAT_DB" -tAc "SELECT column_name FROM information_schema.columns
  WHERE table_name='content_cycle_posts' AND column_name IN ('hook','script','script_length_seconds');"  # 3 rows
psql "$UAT_DB" -tAc "SELECT to_regclass('plan_activity'), to_regclass('post_steps'), to_regclass('ui_events');"  # all non-null
# 0071: the generation prompts must be present for hooks + scripts to work.
psql "$UAT_DB" -tAc "SELECT workflow_id, step_name FROM prompt_templates
  WHERE client_id IS NULL AND workflow_id IN ('plan_hooks','plan_scripts') ORDER BY 1;"  # 2 rows: plan_hooks/generate, plan_scripts/generate
```

## 2. Enable the flag for Ivy T

Per-tenant `plan_redesign` lives in `client_configs.settings` (jsonb). Enable for Ivy T only,
non-destructively (merge, don't overwrite other settings):

```bash
psql "$UAT_DB" -c "
UPDATE client_configs
   SET settings = coalesce(settings, '{}'::jsonb) || '{\"plan_redesign\": true}'::jsonb
 WHERE client_id = (SELECT id FROM clients WHERE slug = 'ivy-t');"       -- confirm the real Ivy-T slug first
psql "$UAT_DB" -tAc "
SELECT c.slug, cc.settings->'plan_redesign'
  FROM clients c JOIN client_configs cc ON cc.client_id = c.id
 WHERE c.slug = 'ivy-t';"                                                 -- expect: ivy-t | true
```

(If Ivy T has no `client_configs` row yet, `INSERT ... (client_id, settings) VALUES (…, '{"plan_redesign":true}')`.)

## 3. Required environment (UAT app + engine)

The e2e fakes are **hard-gated** and must be OFF in UAT so real Bedrock + BullMQ run:

- **`SPRIGLY_E2E_FAKE` — MUST be unset** (any truthy value activates the fake model/shape/PLAN_TODAY
  and the `/api/e2e/*` routes; the gate also requires `NODE_ENV !== 'production'`, but do not rely on
  that alone — leave the var unset).
- **`PLAN_TODAY` — MUST be absent** (it freezes "today" for deterministic tests; absence = real clock).
- `DATABASE_URL` → the UAT Postgres. `REDIS_URL` → the UAT Redis (engine worker + shape/script jobs).
- Bedrock creds/region as per the existing engine deploy (AWS Bedrock, eu-west-2).

Quick assertion after boot:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<uat-app>/api/e2e/activity   # expect 404 (fakes inert)
```

## 4. Deviation-3 status

**Closed (Stage 6b, Slice 2).** The worker now emits its `plan_activity` rows via a shared engine
ledger helper (`engine/src/content-cycles/ledger.ts`): `shape.ts` writes `caption_saved` / origin
`agent` / `ref_proposal_id` (the proposal id threads through from the approved-proposal enqueue), and
the script worker writes `script_saved` / origin `agent` from day one. Because the e2e fakes bypass
the real worker, the emission is verified by a worker-level integration test against the container
(`engine/src/content-cycles/ledger.integration.test.ts`) which also proves the ledger stays
append-only. Run it in UAT prep with:
```bash
DATABASE_URL="$UAT_DB" TEST_DATABASE_URL="$UAT_DB" \
  pnpm --filter @sprigly/worker exec vitest run src/content-cycles/ledger.integration.test.ts
```
(Only against a disposable/UAT DB — it writes a throwaway client. Never production.)

## 5. Post-deploy smoke (~10 min)

Do these against the UAT app as a real Ivy-T magic-link session:

1. **Magic link in** — open the Ivy-T link → lands on the plan (not `/expired`), month renders.
2. **Month renders** — calendar shows the cycle's posts with rings; rail badges match; `Today` works;
   month-nav disables at the ends.
3. **Caption save** — edit a caption → Save → status flips to EDITED; reload → persists.
4. **Checklist tick** — tick a step → ring advances; reload → persists.
5. **Real-Bedrock agent ask** — "move the Tuesday post to Friday" → a proposal appears in Approvals
   (real model, ~seconds); approve → the post moves; discard on another works.
6. **Real hook generate** — open a reel or carousel editor → "✨ Generate hooks" → 3 candidates from
   real Bedrock (~seconds) → pick one → Save → the hook persists on reload.
7. **Real script generate** — on a reel with a hook + caption, pick a length (e.g. 30s) → "Generate
   script" → a structured script (hook line, beats, CTA) lands → edit → Save → persists.
8. **Format edit** — change a post's format in the editor; with progress the keep/replace prompt
   appears; the checklist reconciles; hook/script hide but are retained on switch-back.

If 1–8 pass, the promotion is good for the shipped scope.

## 6. Rollback

- **Fastest (no data change):** flip the flag off — Ivy T falls straight back to the existing PlanApp:
  ```bash
  psql "$UAT_DB" -c "UPDATE client_configs
     SET settings = settings || '{\"plan_redesign\": false}'::jsonb
   WHERE client_id = (SELECT id FROM clients WHERE slug = 'ivy-t');"
  ```
- **Env:** revert the app/engine deploy to the prior image.
- **Down-migrations — EMERGENCY / LOCAL ONLY.** Each migration ships a paired `*.down.sql`; they DROP
  tables/columns and are destructive. Do not run against UAT to "undo" a promotion — flip the flag
  instead. Only use a down-migration if a migration itself is broken and blocking, in reverse order
  (`0070.down` → `0069.down` → …), and only with a fresh backup.
