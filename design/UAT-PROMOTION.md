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

**Not yet in this build (Stage-6 generation features):** the Hook field + "Generate hooks", the
"Generate script" flow, format-editing in the editor, and **deviation-3 closure** (the shape/script
worker `caption_saved` / `script_saved` ledger rows). The 0070 schema + seed ship now so the
generation build lands as app/engine code only, no further UAT migration. Smoke items that depend
on those features are marked **(pending generation build)** below.

---

## 1. Migrations — apply order 0066 → 0070

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
```

Verify:

```bash
psql "$UAT_DB" -tAc "SELECT count(*) FROM hook_patterns WHERE active;"          # expect 42
psql "$UAT_DB" -tAc "SELECT count(distinct category) FROM hook_patterns;"       # expect 10
psql "$UAT_DB" -tAc "SELECT column_name FROM information_schema.columns
  WHERE table_name='content_cycle_posts' AND column_name IN ('hook','script','script_length_seconds');"  # 3 rows
psql "$UAT_DB" -tAc "SELECT to_regclass('plan_activity'), to_regclass('post_steps'), to_regclass('ui_events');"  # all non-null
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

**Open.** The shape worker (`engine/src/content-cycles/shape.ts`) writes the caption + `post_edits`
audit but still emits no `plan_activity` (`caption_saved` / origin `agent` / `ref_proposal_id`) row.
It closes together with the script-worker path in the generation build (the script worker emits its
`script_saved` equivalent from day one), because both share the worker ledger helper and the e2e
fakes bypass the real worker — so the fix is verified with the script-worker e2e, not before.

## 5. Post-deploy smoke (~10 min)

Do these against the UAT app as a real Ivy-T magic-link session:

1. **Magic link in** — open the Ivy-T link → lands on the plan (not `/expired`), month renders.
2. **Month renders** — calendar shows the cycle's posts with rings; rail badges match; `Today` works;
   month-nav disables at the ends.
3. **Caption save** — edit a caption → Save → status flips to EDITED; reload → persists.
4. **Checklist tick** — tick a step → ring advances; reload → persists.
5. **Real-Bedrock agent ask** — "move the Tuesday post to Friday" → a proposal appears in Approvals
   (real model, ~seconds); approve → the post moves; discard on another works.
6. **Real hook generate — (pending generation build)** — once shipped: open a reel/carousel editor →
   "Generate hooks" → 3 candidates from real Bedrock → pick → Save → hook persists.

If 1–5 pass, the promotion is good for the shipped scope.

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
