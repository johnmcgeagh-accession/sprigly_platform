# Plan Surface Redesign — Decisions & Reconciliation

**Status:** pre-Phase-1. Records decisions taken with John (2026-07-07), corrections to the
implementation plan's assumptions after reading the current `dev/` monorepo, and the open
questions still blocking work.

This supersedes the plan (`docs/brief/sprigly-redesign-plan.md`) wherever they disagree, per
the plan's own rule ("when either disagrees with an existing backend contract, the backend
contract wins and you flag the mismatch here").

---

## 1. Correction to the plan's premise

The plan was written as if Phase 1 discovery had not happened. Reading the code, most of its
"unknowns" are already answered, and the current client plan surface is **far more built than
the plan assumes**. The redesign is a **rebuild of a live, working component**, not greenfield.

What already exists today:

| Thing | Where | Notes |
|---|---|---|
| Client plan UI | `app/src/components/PlanApp.tsx` | Calendar + timeline, drag-reschedule, detail editor, agent bar, `readOnly` cycles. Ported from `sprigly-client-app.jsx`. |
| Share-link page | `app/src/app/p/[token]/`, `app/src/app/expired/` | Tokenised, no password; `readOnly` for non-home cycles. |
| Posts (per-post rows) | `content_cycle_posts` table | `scheduledDate`, `caption`, `format` (`reel\|carousel\|single\|email`), `pillar`, `position`, `status` (`planned\|edited\|new`), `script`, `overlay`, `deletedAt` (soft-delete), `reviewState`, `sourceMeta` (holds `.original`). |
| Cycles | `content_cycles` table | Rich lifecycle status; `posts_sync_status` (`synced\|out_of_sync\|unknown`) + `postsSyncedRunId` — **live posts are a verified projection of a plan-regen run.** |
| Direct post writes | `PATCH/DELETE /api/posts/:id`, `POST /api/posts` | Reschedule / caption / format / pillar / position / delete / create — immediate, not proposal-gated. |
| Revert-to-original | `POST /api/posts/:id/revert`, `app/src/lib/revert.ts` | Restores from `source_meta.original`; survives successive reshapes (tested). |
| Per-post shape | `POST /api/posts/:id/shape` | Caption rewrite. (Component note says instructed-regen / "make it softer" variant + voice are still stubbed — Phase 3/5.) |
| Agent turn | `POST /api/plan/agent` | Mutations return as **proposals** — nothing applied on the turn. |
| Proposals surface | `GET /api/plan/proposals`, `POST …/[id]/approve`, `…/reject` | Client-session-scoped (`listPendingProposals(clientId)`). `approvals` table exists. Web approval surface **already partly built** — not CLI-only. |
| Notes | `GET /api/plan/notes`, `…/[id]/dismiss` | |
| Feature flags | `client_configs.settings` (jsonb) | Natural home for a per-tenant `plan_redesign` flag. |

**Corrections to the plan's §7 feature-map:**
- "post update endpoints — exists" — TRUE (I initially mis-reported these as missing; they live
  under `/api/posts/*`, not `/api/plan/*`).
- "Approvals — exists as operator CLI, web UI is new, extract to service" — **misleading**: a
  client-scoped web approve/reject surface already ships.
- "Talk to your plan + extraction — exists, new surface" — the agent endpoint + proposal return
  shape already exist; read `app/src/lib/agent/` rather than treating this as unknown.

---

## 2. Decisions taken (John, 2026-07-07)

### D1 — Mutation model: approve step gates AGENT changes only
The agent path is propose→approve today; direct edits (drag-drop, caption save, delete) are
immediate. **Confirmed (John): the approve gate applies to agent changes only — manual
manipulations stay immediate.** So the redesign keeps the current split: `/api/posts/*` writes
fire directly from direct user actions; `/api/plan/agent` changes land as proposals in the
Approvals view. No pending-chip wrapper on drag-drop.

### D2 — Drop tags
No Draft / Scheduled / Needs-approval / Published tag system in the redesign — no current use.
This **resolves the status-enum mismatch**: the mockups' `idea→draft→scheduled→published` does
not exist in the backend (`content_cycle_posts.status` is `planned|edited|new`), and publishing
state is not modelled. We simply don't surface tags. Backend `status` stays internal.

### D3 — Revert: reuse the existing mechanism
Use the shipped `POST /api/posts/:id/revert` (baseline from `source_meta.original`, logic in
`lib/revert.ts`). **No new `original_caption` column needed** — my earlier "no original stored"
finding was wrong. The mockups' Revert wires straight to this.

### D4 — Rename the redesign phases
The platform already uses "Phase 2/3/5" for its own roadmap (see `PlanApp.tsx` header:
Phase 2 = shaping surface, regen/voice = Phase 3/5; `deletedAt` marked "Phase 2"). The redesign
will use **Stage** naming (Stage 0–6) to avoid collision in commits and docs.

### D6 — Publish: parked → replace with "Mark approved" (read-only lock)
Not publishing anything yet. The mockups' Publish action (mobile swipe-right "Publish now",
any desktop equivalent) is **dropped**. In its place, a per-post **"Mark approved" → post
becomes read-only** (client sign-off / lock), tentative. No Instagram integration exposed.
> **Backend note:** `content_cycle_posts.status` is `planned|edited|new` with no "approved"
> state, and there is no `locked` flag. If we ship the lock, it needs a small schema addition
> (an `approved_at` / `locked` column, or a reused `reviewState` value). Low priority — build
> the surface without it first; wire the lock when confirmed.

### D7 — Notes: read-only render of `plan_inputs`, no actions
Notes arrive from **voice capture** (`plan_inputs.source = 'voice'`) — content ideas, possible
date changes, voice-rule hints. **No changes are actioned from notes yet.** The redesign renders
`GET /api/plan/notes` (`listActiveNotes`, already client-scoped) as a **read-only list**. This
fully resolves the old Q3 — the store and endpoint already exist.

### D8 — Legacy / rollout: straight UI swap, same data
This is a **UI change only** — content is pulled from the same tables (`content_cycle_posts`),
unchanged. No data migration, no dual data model. The `plan_redesign` flag exists purely so the
new UI can be validated on IVY-t before becoming the default; once signed off, the old
`PlanApp.tsx` path is removed. No per-tenant "which UI" toggle is a long-term feature.

### D5 — Styling: Tailwind only, no exception
Build in **Tailwind** (the repo convention, e.g. `admin/tailwind.config.ts`). No scoped-CSS
exception. The mockups' `:root` tokens become Tailwind theme extensions; the bespoke component
CSS is re-expressed as Tailwind. **Look and feel must resemble the HTML mockups**, but the code
is idiomatic Tailwind. Note: the current `PlanApp.tsx` uses inline-style objects (a `C` palette
constant) — so introducing Tailwind here is itself a deliberate change from the current surface.

---

## 3. Net-new scope (what genuinely doesn't exist)

1. **Production checklist / Tasks** — `post_steps` + `step_templates` (grep confirms no such
   table). The one net-new data model, per plan §2.3. Rings, at-risk, Tasks view all derive from
   it. Agent-built checklists flow through the proposal→approve path (D1).
2. **`plan_redesign` feature flag** — add to `client_configs.settings`; per-tenant; IVY-t first.
3. **Responsive Tailwind rebuild** of `PlanApp.tsx` into `<PlanDesktop>` / `<PlanMobile>`
   sharing hooks + a component library, matching the mockups.
4. **Playwright e2e** — the web app uses Vitest (endpoint tests exist); no e2e harness yet, so
   `e2e/` is net-new infra, not a conditional.
5. **Voice overlay / mic** — cross-service integration with `sprigly-voice` (a *separate repo*,
   the workspace's `sprigly-voice/`), not in-repo wiring.

---

## 4. Open questions

All the plan's §8 blockers are now resolved (John, 2026-07-07):

- Q1 mutation gate → **D1** (agent-only; manual manipulations stay immediate).
- Q2 publish → **D6** (parked; "Mark approved / read-only" instead of Publish).
- Q3 notes source → **D7** (`plan_inputs`, `source='voice'`, read-only render).
- Q4 legacy cutover → **D8** (straight UI swap; flag for UAT only, then delete the old path).
- Q5 reference files → **done**: moved to `design/reference/` (untracked, ready to commit on the
  Stage-0 branch).
- Channel field (plan §8.4) → already exists on `content_cycle_posts` (`instagram|email`).

**Remaining, non-blocking — decide at the relevant stage:**
- The "Mark approved → read-only" lock (D6) needs a small schema decision *if* built. Deferred;
  build the surface without it first.
- Voice overlay ↔ `sprigly-voice` session contract (open a session, attach a post ID) — resolve
  at the start of the mobile/voice stage by reading the `sprigly-voice` repo.

Resolved by John already: channel field (Q from plan §8.4 — **already exists** on
`content_cycle_posts` as `instagram|email`); tags (dropped, D2); revert (reuse, D3);
styling (Tailwind, D5); phase naming (renamed, D4).

---

## 5. Risks / watch-items

- **R1 — regen vs. direct edits.** Live posts are a projection with `posts_sync_status`; the
  system already tries to preserve user edits across regens (`reviewState: 'preserved_edit'`).
  Any redesign write must respect this or risk clobbering / flipping cycles to `out_of_sync`.
  The plan is silent on this; it needs an explicit rule in Stage 2.
- **R2 — the mockups' stand-in logic must be deleted**, not ported: desktop `classifyAsk()`
  keyword classifier, both files' fake dictation, and the mock `rewriteCaption()` — replaced by
  the real `/api/plan/agent` extraction, `sprigly-voice` streaming, and `/api/posts/:id/shape`.
- **R3 — cross-repo voice.** Mic/overlay depends on `sprigly-voice`; budget it as integration.

---

## 6. Stage 0 addenda (2026-07-07)

### D2 delta vs the reference mockups
Tags are dropped (D2), but the reference mockups **still show them**: editor tag chips, card tag
pills, and the mobile swipe-right action set ("Publish now / Add tag"). **The mockups are
superseded on this point — do not port tags.** Replacement mobile swipe-right actions:
**"Mark approved"** (only once D6's schema lands) and **"Move"** (opens a date picker). Until D6
exists, swipe-right ships with **Move alone — no dead buttons.**

### D1 addendum — unified activity ledger
Manual edits (drag-reschedule, caption save, delete, checklist ticks) stay immediate (D1) but are
written into the **same proposals / activity history** as auto-approved entries, tagged
`origin: user`, so plan history is one stream regardless of actor. The choice between reusing the
proposals table (an `origin` column + approved-on-insert path) vs. a thin `plan_activity` table is
made in `AUDIT.md` §Ledger.

### D8 addendum — deletion gate
The old `PlanApp.tsx` path is deleted **only after IVY-t completes one full production week on the
new surface**, not at UAT sign-off.

---

## 7. Stage 1 — data foundations (2026-07-07)

### Content-type mapping (mockup labels → real enum)
`step_templates.content_type` and the whole checklist use the post **FORMAT** enum values, not the
mockup labels. Reconciliation:

| Mockup label | `content_cycle_posts.format` | Template |
|---|---|---|
| Reel | `reel` | Script & hook (4) · Shoot (3) · Edit (2) · Caption (1) |
| Carousel | `carousel` | Source shots (3) · Design frames (2) · Caption (1) |
| Single image | `single` | Source image (2) · Caption (1) |
| — | `email` | none (email posts have no production checklist) |

Step labels are the human strings; `lead_days` is the number in parentheses.

### Timezone
No per-tenant timezone is stored — `clients` has only `lat`/`lon`/`location_name` (for the weather
audit), not a tz. So "today" for at-risk / bucket derivations defaults to **Europe/London**
(`resolveTodayIso()` in `app/src/lib/steps.ts`). The pure derivations in `checklist.ts` take `today`
as an argument, so this default is the only place tz is assumed and is trivial to revisit if a
per-tenant tz is ever added.

### Migration authoring & the down convention
- Migrations `0066–0068` are **hand-authored SQL** in the existing `0050–0065` style (idempotent
  guards, manual-psql header), added to `schema.ts` for the ORM. `drizzle-kit generate` is **not**
  run — the drizzle journal froze at `0026` and generating would mis-diff. (Reconciliation of a
  pre-existing repo state, not a new choice.)
- **Paired `.down.sql`** files are a new convention for this repo, approved for Stage 1. They exist
  for **local verification and emergency rollback only** — never applied casually against a shared
  DB. The forward runner (`migrate.ts`) is unchanged and still forward-only.

### Ledger: `plan_activity` (recap of AUDIT §3)
Manual writes and approved agent proposals both append to `plan_activity` as one ordered stream,
tagged `origin` (`user`/`agent`) with `ref_proposal_id` set for agent rows. Not the `agent_proposals`
table — that requires `conversation_id`+`message_id` FKs a manual drag has no business inventing.
Emission is centralised in `mutations.ts`/`steps.ts` inside a `db.transaction`, so the ledger row
commits atomically with the write. Append-only is enforced by a DB trigger (0068), not convention.

### Batched query shape (no N+1)
`loadPlanPosts` runs its existing single posts query, then **one** `SELECT … FROM post_steps WHERE
post_id IN (<all post ids>) ORDER BY post_id, sort, created_at` (`listStepsForPosts`), grouped in
memory and folded into each `PlanPost.steps`. Two queries total for a month, regardless of post
count. `applied()` (the mutation response builder) reuses `loadPlanPosts`, so every write response
carries fresh steps at the same cost.

### API / behaviour choices
- **`checklist:generate` → `POST /api/posts/:id/checklist/generate`.** Next.js file routing can't
  express a `:` segment, so the path uses `/checklist/generate`. Idempotency: **409** `checklist_exists`
  if the post already has steps (chosen over silent no-op so a double-click is visible); 422
  `no_template` for a format with no template (e.g. `email`).
- **Step ticks are ledgered** (`step_completed` / `step_uncompleted`, origin user) — cheap now,
  painful to backfill. Individual step add/remove are **not** ledgered (only ticks + generate), to
  match the Stage 1 scope. Checklist generation emits `checklist_generated`.

### Known gap (deferred, not a deviation from intent)
A **rewrite** proposal (`kind:'rewrite'`) applies by enqueuing an async BullMQ shape job — no post
row changes at approve time — so no ledger row is written on approval. The eventual caption write
happens later in the shape worker, which is out of Stage 1's listed write paths. When that worker's
write is wired (a later stage), it should emit `caption_saved` with `origin:'agent'` +
`ref_proposal_id`. Recorded so it isn't mistaken for a ledger hole.

### Verification tooling
`scripts/test-db.sh` stands up a disposable local Postgres (`pgvector/pgvector:pg17` — the schema
has `vector` columns and the dev server is PG17), baselined from a **schema-only** `pg_dump` of the
dev DB (read-only; the dump lives in gitignored `.test-db/` and is never committed). Migrations are
applied on top, and the `plan_activity` integration test targets it via `TEST_DATABASE_URL`.

---

## 8. Stage 2 — responsive rebuild (2026-07-07)

### Architecture
One implementation, real layout split: `PlanRoot` (client) measures `(min-width:1080px)` and
renders `<PlanDesktop>` or `<PlanMobile>`, both driven by one `usePlanData` hook + one component
set (`app/src/components/plan/`). `today` is resolved once server-side (`resolveTodayIso()` in
`PlanRedesign`) and passed down, so the client never imports the server-only `steps.ts`; all
derivations import the Stage 1 pure `checklist.ts`.

### Tailwind
Preflight **disabled** so adding Tailwind doesn't disturb the flag-off `PlanApp` (inline styles);
the redesign gets a scoped `.plan-redesign` reset + `color-scheme: only light` in globals.css.
Mockup `:root` tokens live in `tailwind.config.ts` (text hierarchy reuses Tailwind's native
slate-700/600 which match `--slate`/`--slate-600` exactly). Fonts self-hosted via `next/font`.

### Component inventory & mockup deltas
Built: PostChip, ProgressRing, ChecklistItem, Sheet, Drawer, Scrim (heavy+soft), Toast,
SegmentedControl, MonthWheelPicker, ProposalCard, NoteRow, ExtractionSummary, plus a shared
`PostEditor` (used by the desktop drawer AND mobile sheet) and ChannelIcon/FormatIcon.
- **No post title field exists** → PostChip/timeline title = the caption's first sentence, else
  `pillar` (recorded; the mockups' rich titles were fake data).
- **Tags fully omitted** (D2): no editor chips, card pills, or swipe "Add tag". Mobile swipe-right
  is **Move only** (date-picker sheet), matching D2/D6 (no publish/approve-lock this stage).
- **Review dot** on a chip = `status==='new'` → NEW badge, else a coral dot when the post is
  at-risk OR `reviewState==='preserved_edit_orphan'`.
- **ExtractionSummary renders the REAL agent turn** — each proposal as an "Action → Approvals"
  row plus Sprigly's `message` (which covers answered questions / captured notes). The mockups'
  keyword classifier is not ported.

### Async "Shape this post" (deviation 3) — how pending is shown
`shape()` adds the post id to a `shapingIds` set, POSTs `/api/posts/:id/shape`, and on a
`{mode:'pending', jobId}` response polls `/api/jobs/:jobId`. While pending, the editor's shape
input + chips are disabled and the note reads "Sprigly is rewriting this in your voice — it'll
appear here when it's ready." The **caption textarea is never mutated on submit**; the rewritten
caption swaps in when the job completes (or on the next `/api/plan` refresh), then the textarea
syncs to it.

### Endpoint reconciliation vs AUDIT.md (no mismatches — clarifications)
Mirrored `PlanApp`'s proven client contracts exactly: agent POST body is
`{instruction, selectedPostId, conversationId}` (not `{message}`), response `{conversationId,
message, proposals}`; structural writes return `ShapeResult{mode:'applied',posts,summary}`;
`/api/posts/:id/shape` → `{mode,jobId}` (async); steps endpoints return `{steps}`;
`checklist/generate` → 200 `{steps}` / 409 `checklist_exists` / 422 `no_template` (email hides
the generate button). Month chevrons switch to the adjacent **cycle**, Today → home cycle, the
wheel picker jumps to a cycle by month (cycles are the month unit). No new fetches for rings or
Tasks — `PlanPost.steps` arrives batched.

### For the next stage
Every interactive element carries a stable `data-testid` (e.g. `post-chip`, `nav-tasks`,
`agent-send`, `swipe-card`, `step-toggle`, `proposal-approve`) so the Playwright harness has
anchors. Verified visually via a temporary seeded preview route (removed before commit) with
Playwright screenshots of both breakpoints.
