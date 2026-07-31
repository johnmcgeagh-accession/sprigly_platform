# Investigation — post-add blocked after planner run, and the IVY-t August plan anomaly

**Date:** 2026-07-20
**Mode:** read-only. All DB access via `psql` with `PGOPTIONS='-c default_transaction_read_only=on'` (verified: `default_transaction_read_only = on`).
**Scope:** no fixes applied, no code/DB/config changed. Report only.

## Identification of the subject cycle

`cycle_month` is the month the cycle is **planned in**; its posts schedule into the **following** month. There is **no `2026-08` cycle row** for Ivy T. The "August plan" is:

| field | value |
|---|---|
| client | `Ivy T` / `ivy-t` / `c79cf1c5-b51d-4a9b-aedc-48577df43e8f` |
| cycle id | `efae0950-7e01-4a11-a119-cd29a0d64eeb` |
| cycle_month | `2026-07` (posts dated `2026-08-01` … `2026-08-31`) |
| status | `workbook_built` |
| posts_sync_status | `synced` |
| posts_synced_at | `2026-07-17 17:09:08.584` |
| posts_synced_run_id | `fe972538-6697-41a7-a09a-e5a89d4b5d1c` |

---

# PART 1 — Cannot add a new post after the planner has run

## Answer: the blocking condition

**CONFIRMED.** The guard is a **client-only, one-post-per-day cap** in the redesign shell. It is not a status guard, not a capacity guard, not a date-window guard.

`app/src/components/plan/PlanDesktop.tsx:256`

```tsx
{data.canEdit(isoOf(day)) && dayPosts.length === 0 && (
  <button data-testid="add-on-day" onClick={() => data.addPost(isoOf(day))} ...
```

Mobile equivalent, same rule expressed as the *else* branch of "has posts" — `app/src/components/plan/PlanMobile.tsx:212-214`:

```tsx
{postsOn(iso).length
  ? postsOn(iso).map((p) => <SwipeCard ... />)
  : data.canEdit(iso) && <button onClick={() => data.addPost(iso)} data-testid="add-on-day" ...>＋ Plan a post for this day</button>}
```

The sub-predicates — `app/src/components/plan/usePlanData.ts:73-74`:

```ts
const readOnly = false;
const canEdit = useCallback((dateIso: string | undefined) => !!dateIso && dateIso >= init.today, [init.today]);
```

## Walking the guard with the real prod row values

Ivy T resolves to the **redesign** shell, so the legacy whole-cycle rule does not apply:

```
=== Q28 ===
client_id | c79cf1c5-b51d-4a9b-aedc-48577df43e8f
settings  | {"plan_redesign": true}
```

`resolveSurfaceKind` (`app/src/lib/surface-state.ts:47-49`) → `committed-redesign` (session present, `committedPostCount = 26 > 0`, `planRedesign = true`).

Evaluating each sub-condition against the live cycle:

| condition | value | result |
|---|---|---|
| `readOnly` | hard-coded `false` (`usePlanData.ts:73`) | never blocks |
| `canEdit(iso)` = `iso >= today` | today = `2026-07-20`; every August date ≥ that | **passes for all 31 days** |
| `dayPosts.length === 0` | 24 of 31 August days hold ≥1 live post | **fails on 24 of 31 days** |

```
=== Q30: every Aug 2026 day — occupied (add hidden) vs free (add shown) ===
 days_add_hidden | days_add_shown |      free_days
-----------------+----------------+----------------------
              24 |              7 | 03,06,10,12,17,20,24
```

**The condition that evaluates to reject is `dayPosts.length === 0`.** Before the planner runs the month is empty, so the affordance appears on every day. After it runs, 24 of 31 days carry a post and the add button is not rendered on any of them — with no message, no disabled state, and no error. The affordance simply is not in the DOM. This is exactly the shape of "I cannot add a post after the planner has run".

### Corroborating evidence from prod

The one manual add on this cycle **succeeded**, and it landed on a then-free day:

```
 2026-08-27 | reel | New idea | position 25 | status 'edited' | created_at 2026-07-19 13:53:56.687999
```

At that moment the free days were `03,06,10,12,17,20,24,27`. The client added on `27` — one of the eight empty days. This is consistent with the guard: adding works on empty days and is unavailable on occupied ones.

## Guards that do NOT fire (each checked explicitly, as requested)

| candidate guard | verdict |
|---|---|
| cycle status transition / planner sets a locked status | **Does not exist on this path.** `POST /api/posts` (`app/src/app/api/posts/route.ts`) selects only `contentCycles.channel`; it never reads `status`. A cycle in `workbook_built` (the live value) — or `delivered`, `active`, `finalised`, `closed` — accepts adds. |
| "plan finalised/approved" flag | **No such flag exists** anywhere on the `/api/posts` path. |
| slot-capacity / max posts per cycle | **Not enforced.** `addDraft` (`app/src/lib/mutations.ts:111-143`) applies no capacity check. `cadence.postsPerMonthMax` is never read at write time. |
| date-window (cycle month vs current date) | **Passes.** `isEditableDate` (`app/src/lib/edit-scope.ts`) is `scheduledDate >= today`; all August dates are future. Note there is *no* check binding a post's date to its cycle's month at all. |
| `posts_sync_status` | Value is `synced`; the only reader is a month-menu *visibility* filter, not a write guard. |

The `PRE_PLANNING_STATUSES` hard block (`packages/db/src/structured-brief-invalidate.ts:28-30`) — which *would* reject a post-planner add — governs only the **draft-beat** surface (`addBeat`, `app/src/lib/draft-mutations.ts:211`), a different endpoint (`POST /api/plan/draft`). It is not on the committed-plan add path.

## Parallel derivation of "can add post" — CONFIRMED, and they disagree

The predicate is derived independently in **11 places**. They do not agree.

| # | site | predicate | status check | capacity |
|---|---|---|---|---|
| 1 | `usePlanData.ts:74` | `dateIso >= init.today` | no | no |
| 2 | `PlanDesktop.tsx:256` | `canEdit(day) && dayPosts.length === 0` | no | **1/day** |
| 3 | `PlanMobile.tsx:212` | `postsOn(iso).length === 0 && canEdit(iso)` | no | **1/day** |
| 4 | `PlanApp.tsx:375` + `api/plan/route.ts:65` | `!readOnly`, `readOnly = !isHome` | no | no |
| 5 | `api/posts/route.ts:32` | `isEditableDate(date, today)` | no | no |
| 6 | `mutations.ts:112` | `isEditableDate(date, today)` | no | no |
| 7 | `agent/proposals.ts:233` | `isEditableDate(payload.date, today)` | no | no |
| 8 | `draft-mutations.ts:211` | `cycleIsPreCutoff() && isEditableDate()` | **yes** | no |
| 9 | `page.tsx:127` | `await cycleIsPreCutoff(initialCycleId)` | **yes** | no |
| 10 | `DraftPlanView.tsx:345` | `pillars.length !== 0` | no | no |
| 11 | `lib/plan.ts:229-231` | `liveCount === 0 \|\| syncStatus === 'out_of_sync'` | no | n/a |

Material disagreements:

- **#2/#3 vs #5/#6** — the client enforces one post per day; **the server does not**. `POST /api/posts` will happily create a second post on an occupied day. The cap exists only where the button is drawn.
- **#4 vs #1** — the legacy shell forbids adding to a non-home month (`readOnly = !isHome`); the redesign shell allows every month. Behaviour depends purely on the `plan_redesign` flag. Ivy T is flag-on, so #4 is not in play here — but a flag-off tenant fails for a *completely different* reason.
- **#8/#9 vs #5/#6/#7** — the draft surface hard-blocks once the cycle leaves pre-planning; the committed surface has no status check at all.
- **#11** is the only `posts_sync_status` reader, and it removes a month from the menu — making a cycle un-addable by *unreachability*, silently.

## Intended vs actual behaviour

**Intent is discoverable and explicit** for the date policy — `app/src/lib/edit-scope.ts:1-11`:

> "editability is by `scheduled_date`, not by which cycle the token is homed on … Every write path funnels its date check through here so the rule is defined in one place."

and it is asserted in an e2e test (`app/e2e/desktop.spec.ts:144-166`):

> "Editability is date-based, not whole-cycle — every August day is future (>= today), so the month is fully editable and its empty days offer the add affordance."

Note the test's own wording — *"its **empty** days offer the add affordance"*. The one-post-per-day cap is baked into the expectation but never stated as a rule.

**Intent for the cap itself is AMBIGUOUS — flagged, not assumed.** The `dayPosts.length === 0` condition carries **no comment, no doc, and no test asserting it as policy**. Nothing in `docs/` states whether a day may hold more than one post. This matters because:

- the **planner itself** writes two posts onto one day (08-14 and 08-28 — see Part 2), so the generator does not honour the cap the UI enforces;
- the prompt **explicitly authorises** it (`engine/src/content-cycles/planning.ts:229`): *"Two beats may legitimately share a date."*
- there is **no DB uniqueness constraint** on `(cycle_id, scheduled_date)`.

So three layers hold three different opinions, and the UI's is the strictest. Whether the cap or the planner is correct is **not determinable from the code** and needs a product decision.

---

# PART 2 — IVY-t August plan: repeated beats + multi-post days

## 2.1 The plan rows

26 live posts (25 generated + 1 manual), 24 distinct dates, 0 soft-deleted, 0 drafts.

**Posts-per-day distribution:** 22 days × 1 post, 2 days × 2 posts, 7 days × 0 posts.

```
=== Q31: multi-post days ===
 scheduled_date | dow | n |                 beats
----------------+-----+---+---------------------------------------
 2026-08-14     | Fri | 2 | WSG + Product launch or offer related
 2026-08-28     | Fri | 2 | WSG + Product launch or offer related
```

**Beat distribution** (`source_meta.category`):

| beat | count |
|---|---|
| Product launch or offer related | 7 |
| Sunday Style | 5 |
| WSG | 5 |
| Educational | 3 |
| Brand | 2 |
| Regular feature | 2 |
| Testimonials | 1 |
| *(null — the manually added post)* | 1 |

## 2.2 Did the planner run more than once? — **NO. It ran exactly once.**

**CONFIRMED, three independent ways.**

**(a) `created_at` clustering — one cluster, to the microsecond.** All 25 generated rows share `created_at = 2026-07-17 17:09:08.536485`, positions 0–24 contiguous. The only other row is the manual add two days later.

```
=== Q23 (Ivy T, all cycles) ===
 cycle_month |       cluster       | rows | soft_deleted
-------------+---------------------+------+--------------
 2026-07     | 2026-07-17 17:09:08 |   25 |            0
 2026-07     | 2026-07-19 13:53:56 |    1 |            0
```

**(b) `planning_trace` — one run's phases, one timestamp.**

```
=== Q18 ===
   phase   | attempt | rows |          first_at          |          last_at
-----------+---------+------+----------------------------+----------------------------
 catalogue |         |    2 | 2026-07-17 17:09:08.485276 | 2026-07-17 17:09:08.485276
 critic    |       0 |   25 | 2026-07-17 17:09:08.485276 | 2026-07-17 17:09:08.485276
 critic    |       1 |    4 | 2026-07-17 17:09:08.485276 | 2026-07-17 17:09:08.485276
 gate      |       0 |   25 | 2026-07-17 17:09:08.485276 | 2026-07-17 17:09:08.485276
 gate      |       1 |    4 | 2026-07-17 17:09:08.485276 | 2026-07-17 17:09:08.485276
 repair    |       1 |    4 | 2026-07-17 17:09:08.485276 | 2026-07-17 17:09:08.485276
```

25 posts through gate/critic attempt 0; 4 repaired at attempt 1. A single generation with one repair pass.

**(c) `posts_synced_run_id` — one verified write.** `fe972538-…` at `2026-07-17 17:09:08.584`, matching the insert cluster. `posts_sync_status = 'synced'`.

**The repair pass did not touch scheduling.** All four repairs were voice/register corrections (sign-off form, first-person vs brand register), `detail = {"changed": true, "triggeredBy": "critic"}`.

### Contrast: the June cycle *did* double-run, and it replaced correctly

Worth recording because it shows the replace path works. Cycle `d502f22d` (2026-06) has two generation clusters — `2026-07-01 10:21:16` and `2026-07-02 08:31:15` — and **every surviving row from the earlier cluster is soft-deleted** (`soft_deleted = 2` of 2). So a second run replaces; it does not append. This is not the August mechanism.

## 2.3 Since only one run occurred — the actual mechanism

**Item 3 of the brief (two runs / append-vs-replace) does not apply.** For completeness, the write is **delete-then-insert inside a transaction** (`engine/src/content-cycles/planning.ts:1057-1065`), with `deleteIds = [...dec.drop, ...dec.replace]` at `:1028`. A re-run replaces un-edited rows and preserves client-edited ones. There is no dedupe defect here.

The anomalies are the output of **one generation**. Three distinct defects, all tracing to the same architectural fact: **date and volume are model-chosen, and the entire validation layer is per-post.**

### (A) Repeated beats — partly by design, partly a selection defect

**By design:** `Sunday Style ×5` and `WSG ×5` are configured **weekly recurring series**:

```
recurring_series | [{"name":"Sunday Style","dayOfWeek":"Sunday",...},
                    {"name":"WSG (Weekend Style Guide)","dayOfWeek":"Saturday",...}, ...]
```

Five of each in a 31-day month is correct behaviour, not duplication.

**The genuine defect** is `Product launch or offer related ×7` — the largest beat in the month and not a recurring series. **CONFIRMED cause:** the launch-cluster rule mandates a **fixed six-post block per launch, on top of the cadence budget**, with no reconciliation. Seeded prompt, `packages/db/migrations/0043_planning_prompt.sql:33-41`:

```
3. LAUNCH CLUSTERS. For each product launch or return in the intake, build a cluster
   across the surrounding real dates:
   - Tease (about a week before) ...
   - Value post (day before) ...
   - Launch post (launch day, launch time) ...
   - Ours vs theirs (day after) ...
   - Weekend feature (that Saturday's recurring guide) ...
   - Sunday feature (that Sunday's recurring style post) ...
```

Ivy T had a "Navy Edit" launch in August. The structured brief compounds it — `planning.ts:221`, `:226`, `:232` instruct *"Build the month from these items first"*, *"the ONLY launches and restocks this month — feature these"*, and *"each MUST appear once … do NOT drop any"*.

Note bullets 5 and 6 deliberately **overload the recurring Saturday/Sunday slots with launch content** — this is the origin of WSG and a launch post competing for the same weekend.

### (B) 25 posts against a configured max of 20 — `postsPerMonthMax` is never enforced

```
cadence | {"maxPerWeek":5,"minPerWeek":3,"postsPerMonthMax":20,"postsPerMonthMin":16}
```

**CONFIRMED:** `postsPerMonthMax` is read at plan time **only as JSON inside a prompt string** (`planning.ts:292`) plus the prose rule *"Aim for the middle of the range"* (`0043_planning_prompt.sql:45`). There is **no truncation and no gate**. Both validators are strictly per-post — `plan-validation.ts:353` and `:643` each loop `for (let index = 0; index < rows.length; index++)` and check caption quality, instruction leak, em-dashes and vocab. **Neither ever evaluates `rows.length` as a quantity.** 25 against a max of 20 passes silently; the count appears only in a log line (`planning.ts:869`).

### (C) Multi-post days — the collision check only covers preserved edits

**CONFIRMED. This is the direct mechanism for the doubled 08-14 and 08-28.**

`engine/src/content-cycles/plan-merge.ts:153-164`:

```ts
export function dropCollidingInserts<T extends { scheduledDate: string }>(
  incoming:  T[],
  preserved: Array<{ post: { scheduledDate: string } }>,
): { kept: T[]; dropped: T[] } {
  const preservedDates = new Set(preserved.map((d) => d.post.scheduledDate));
  ...
  for (const row of incoming) {
    (preservedDates.has(row.scheduledDate) ? dropped : kept).push(row);
  }
```

The set is built **only from preserved rows**. `kept` is never checked against itself, so **two freshly generated posts on the same date both land**. The intent is stated narrowly at `planning.ts:1032-1033` — *"preserved edits OWN their dates … so the regen never double-books a kept edit"*. Same-date pairs within a single generation were out of scope.

Reinforcing this: the prompt explicitly permits it (`planning.ts:229` — *"Two beats may legitimately share a date"*), and there is **no unique index on `(cycle_id, scheduled_date)`**.

### (D) Bonus defect found while verifying (C): WSG is scheduled on the wrong weekday

Config says `"dayOfWeek": "Saturday"`. Actual placement:

```
=== Q15 (extract) ===
 scheduled_date | actual_dow | stored_day | beat
 2026-08-01     | Sat        | Sat        | WSG      ← correct
 2026-08-07     | Fri        | Fri        | WSG      ← wrong
 2026-08-14     | Fri        | Fri        | WSG      ← wrong
 2026-08-21     | Fri        | Fri        | WSG      ← wrong
 2026-08-28     | Fri        | Fri        | WSG      ← wrong
```

Sunday Style is correct on all five (08-02/09/16/23/30, all Sundays).

**CONFIRMED cause:** `dayOfWeek` **is never read by any scheduling code.** It exists as a type (`packages/engine/src/types.ts:133-144`) and is JSON-dumped into the prompt as free text — its only consumer is `planning.ts:296`. `grep -rn "dayOfWeek"` across `engine/src` and `packages/*/src` returns zero hits outside the type and its barrel re-export. There is no weekday map and no date arithmetic, so **there is no off-by-one and no locale bug — placement is 100% model-chosen.**

The error then survives because the weekday is discarded on write — `engine/src/content-cycles/post-mapping.ts:25-30` regexes the day *number* out of the model's date label and pastes it onto the target month; the model's `day` string is stored verbatim into `sourceMeta.day` and **never cross-checked** against the real weekday of the ISO date. That is why `stored_day` reads "Fri" consistently: the record is internally consistent and externally wrong.

**And it is permanently sticky.** The slot guard from commit `613030e` (`mergeStructuralFields`, `plan-validation.ts:191`, `:220-241`) pins `['date','day','format','pillar']` from input to output, so no downstream stage can correct a bad placement. This is correct behaviour for its purpose — but it means weekday drift cannot be repaired by the critic.

**This is not confined to August.** The June cycle shows the identical pattern: WSG on 2026-07-17 (Fri), 07-24 (Fri), 07-31 (Fri). Systematic, not a one-off.

## 2.4 Railway deploy history around the run — NOT VERIFIED

**Flagged as unverified.** I could not check Railway deploy/restart history from a read-only DB session; it requires the Railway API/CLI, which was outside the granted access. However, the question it was meant to answer is **already settled by stronger evidence**: `planning_trace` shows one `attempt 0` per post and a single microsecond-identical timestamp cluster, so no retry re-executed generation regardless of deploy activity.

## 2.5 UAT cross-check — NOT POSSIBLE

**Flagged as unverified.** Only the prod `DATABASE_URL` was available in `.env.prod`; no UAT connection string was present, and I did not attempt to obtain one. The prod-vs-UAT comparison requested in Part 2.6 was therefore not performed.

That said, the prod-only / migration-related hypothesis is **weakened** by two findings: the defects are all in code paths (prompt-only enforcement, `dropCollidingInserts` scope) that are environment-independent, and the same WSG-on-Friday pattern appears in the June cycle, predating the recent migration work.

---

# Summary

**Part 1.** `PlanDesktop.tsx:256` / `PlanMobile.tsx:212` — the condition `dayPosts.length === 0`. After the planner runs, 24 of 31 August days hold a post, and the add affordance is not rendered on any of them. `canEdit` passes on all 31 days (today `2026-07-20`, all August dates future). No cycle-status, capacity, finalised-flag or date-window guard is involved — none exists on this path. The cap is client-only; `POST /api/posts` has no equivalent. "Can add" is derived in 11 places and they disagree.

**Part 2.** The planner ran **exactly once** — run `fe972538-6697-41a7-a09a-e5a89d4b5d1c`, insert cluster `2026-07-17 17:09:08.536485`, `planning_trace` attempt 0 across 25 posts with a 4-post repair pass. No second run, no append, no dedupe failure.

The anomalies are one run's output, from three defective mechanisms:
1. **Repeated beats** — `Sunday Style ×5` / `WSG ×5` are correct recurring series. `Product launch ×7` comes from the launch-cluster rule mandating six posts per launch on top of the cadence budget, never reconciled against it.
2. **Volume (25 vs max 20)** — `cadence.postsPerMonthMax` reaches the model only as prompt text; both validators are per-post and never evaluate `rows.length`.
3. **Multi-post days (08-14, 08-28)** — `dropCollidingInserts` (`plan-merge.ts:153-164`) builds its collision set only from *preserved* rows and never checks `kept` against itself, so two freshly generated posts on one date both land. No DB unique constraint; the prompt explicitly permits shared dates.

Plus a fourth, found in passing: **`recurringSeries.dayOfWeek` is never read by scheduling code** — WSG is configured Saturday and landed Friday 4× in August and 3× in June.

---

# Anomalies observed but out of scope

1. **Unapplied migrations vs. pending schema mappings.** Prod lacks `content_cycle_posts.beat_meta` (0084), the `plan_inputs` columns `origin` / `lifecycle` / `used_in_cycle_id` (0086), and the `ask_drafted` email template key (0085 — only `ask` v1/v2 present). The `dev` branch maps `beatMeta` in `schema.ts` (commit `981d0b2`). **Not currently breaking prod** — that commit is on `dev` only, not `main` — but 0084's own header warns *"APPLY-BEFORE-DEPLOY … the mapped column must exist before the schema change deploys"*, and a Drizzle `select()` emits every mapped column. Merging `dev` without first applying 0084 would make **every** `content_cycle_posts` read error. (I hit exactly this locally: `ERROR: column "beat_meta" does not exist`.)
2. **Migration tracking is stale.** `drizzle.__drizzle_migrations` stops at id 27, applied `2026-05-22`. Migrations 0073–0086 are applied manually via `psql` and are untracked, so there is no queryable record of what prod has.
3. **Placeholder prefix mismatch — likely live bug.** `engine/src/content-cycles/plan-merge.ts:44` defines `PLACEHOLDER_PREFIX = 'Draft idea — tell Sprigly'` (em dash, lowercase "tell"), but `app/src/lib/mutations.ts:19` writes `'Draft idea. Tell Sprigly what this post should be about…'` (full stop, capital T). The `startsWith` at `plan-merge.ts:54` can never match, so unfilled placeholder posts are not classified as disposable and survive a re-merge contrary to the documented intent.
4. **June cycle spills into August.** Cycle `d502f22d` (2026-06) has posts dated `2026-08-03`, `08-05`, `08-06` — they render in the August grid alongside the August cycle's posts, and on those days they suppress the add affordance for a *different* cycle's month.
5. **Cycle `c702fac2` (2026-05)** sits at `status = 'workbook_built'` with `prior_status = 'failed'` and `posts_sync_status = NULL`.
6. **Worker queues were paused.** Untracked working-tree files `pause-state.txt` / `resume-state.txt` show `content-cycles`, `calendar-events` and `incoming-events` paused and later resumed, alongside uncommitted `scripts/pause-queues.ts`, `scripts/inspect-queue.ts`, `scripts/remove-planning-job.ts`. Live queue state **not verified** (no Redis inspection performed).
7. **`clients.settings` vs `client_configs.settings`.** Two settings blobs exist; `plan_redesign` is read only from `client_configs`. `clients.settings` is `{}` for Ivy T. An easy mis-read for anyone debugging flags.
8. **A re-run is a no-op without a status reset.** `planning.ts:776-779` returns early unless `status === 'intake_confirmed'`; the live cycle is `workbook_built`. Also `ensureStructuredBrief` (`planning.ts:702`) is extract-once, so a re-run reuses the persisted brief and would reproduce the launch-post volume identically unless `structured_brief` is cleared.

---

# Queries run

All executed with `PGOPTIONS='-c default_transaction_read_only=on'` against prod. Q1–Q31 are reproduced inline above where their output is cited; the full set covered: client/cycle identification (Q1–Q3), post status/deleted/beat breakdown (Q4–Q5), prod column and migration state (Q6–Q10b), full plan dump (Q11), `source_meta` and planning config (Q12–Q13), beat and weekday distribution (Q14–Q15), `planning_trace` (Q16–Q20), June-cycle comparison and cluster analysis (Q21–Q23), flags and magic-link tokens (Q24–Q29), and the day-occupancy computation (Q30–Q31).
