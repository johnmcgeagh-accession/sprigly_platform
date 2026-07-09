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

---

## 9. Stage 3 — Playwright e2e harness (2026-07-08)

### One command
`pnpm e2e` → `scripts/e2e.sh full`: `test-db.sh up` (pg17 container + dev schema dump +
migrations) → seed → Playwright (its `webServer` starts `next dev`) → teardown. Partial modes for
local iteration: `bash scripts/e2e.sh no-teardown | seed | test` (reuse a running container/app).

### The fake-agent gating (hard gate)
All e2e fakes live in `app/src/lib/e2e-fake.ts` behind `e2eFakeEnabled()` =
`SPRIGLY_E2E_FAKE === '1' && NODE_ENV !== 'production'`. **Both** conditions must hold, so a leaked
env var can never activate them in a real deploy. The fakes sit at SERVICE boundaries, never the
HTTP routes — the agent route, task parser, proposal persistence, and approve path stay real:
- `getModelClient()` returns a canned `ModelClient` (no Bedrock) that emits a tasks JSON derived
  from the instruction (it reads a post id straight out of the week digest already in the prompt).
- `enqueueShape()`/`readShapeJob()` skip Redis/BullMQ: enqueue writes a canned caption to the post,
  read reports `done` — so "shape pending → caption swaps" is deterministic.
- `resolveTodayIso()` and the agent route's `today` honour a non-prod `PLAN_TODAY` so derivations
  are stable in CI (frozen 2026-07-08).
- `GET /api/e2e/activity` is a test-only ledger read, 404 unless the gate is on.

### Deviation from "next start"
The spec said run the app under test with `next start`, but `next start` forces
`NODE_ENV=production`, which the hard gate deliberately excludes. So the e2e app runs via
**`next dev`** (development) — the only way the gate can be satisfied without weakening it. This is
the intended safety trade recorded here.

### Determinism
`packages/db/src/seed-e2e.ts` (run like `migrate.ts`, from the db package, to avoid root-tsconfig
path quirks) seeds one tenant (`plan_redesign` on), a July-2026 cycle, 12 fixed-id posts across
formats/statuses (incl. one email + three empty-checklist posts), steps in mixed done/at-risk
states, one pending proposal, and three voice `plan_inputs`. Reset is `TRUNCATE clients CASCADE`
(one statement — handles FK order AND bypasses plan_activity's append-only *row* trigger, which
blocks DELETE; `step_templates` has no FK to clients so the migration seed survives). Tests
`reseed()` in `beforeEach` because the desktop and mobile projects share one container.

### Session
Magic-link only (no Clerk): the seed mints a fixed token into `app_magic_link_tokens` and writes it
to `app/e2e/.auth/token.txt`; a Playwright `setup` project visits `/p/<token>` once and saves the
storageState every test reuses.

### Coverage & runtime
Two projects (desktop 1440×900, mobile 390×844), 20 tests + the auth setup, ~26s warm. Covers
month render/rings/summary/counts, drag-reschedule (native DnD via dispatched events) + ledger,
caption save→EDITED→revert + ledger, checklist generate/409/email-hidden/tick→ring→Tasks + ledger,
agent ask (stubbed) → extraction → Approvals → approve (origin=agent + ref_proposal_id) / discard,
shape pending→swap, mobile axis-lock / swipe reveal / Move round-trip / scroll-spy (tap + manual).

### Gaps (couldn't be tested as specified)
- **"Month with no posts" and the Notes empty-state** aren't covered: the seeded session is scoped
  to one cycle that has posts + notes, and empty cycles are filtered out of the switcher, so those
  states aren't reachable without a second empty tenant + its own token/session. Approvals empty
  state IS covered (by clearing the queue). A future add: a second seeded empty tenant.
- Visual-regression snapshots deferred to Stage 5 (noted as a possible add), per scope.

---

## 10. Stage 5 — hardening (2026-07-08)

### Accessibility
- **Keyboard paths for every pointer-only action:** drag-reschedule → a labelled editor date input
  (`editor-date`); mobile swipe → a per-card overflow ⋯ menu (Edit/Move/Delete, `card-menu`);
  calendar chips are role=button + Enter/Space; empty-day ＋ get aria-labels.
- **Focus management:** Sheet/Drawer trap focus (`useFocusTrap`), Escape closes the top layer
  (stopPropagation), focus returns to the opener on close. Closed dialogs use the `inert` property
  (removed from the a11y tree + tab order — fixes aria-hidden-focus and off-screen tabbing).
- **ARIA:** SegmentedControl = tablist/tab + aria-selected; week-strip days = buttons with
  aria-pressed + a label carrying the date + post count; ProgressRing = role=img
  aria-label "N of M steps done"; ProposalCard actions labelled with the proposal text; icon-only
  buttons (shape, mic, chevrons) labelled; toast = aria-live=polite; each dialog has an accessible
  name (label / labelledBy).
- **prefers-reduced-motion:** a scoped reset drops all redesign transitions/animations (sheet/drawer
  slides → instant, ring animation, rail flash, mic pulse, segmented-pill slide).
- **Visible focus:** a global coral `:focus-visible` outline on `.plan-redesign`.
- **Colour-contrast deviation from the mockups (a11y-mandated):** the mockup palette failed WCAG AA
  as small text — `muted #8A94A3 → #5C6470`; coral **text** uses a new `coral-deep #B04830`
  (backgrounds/borders/icons keep brand coral `#E87766`); amber-dark `#B77400 → amber-deep #7A5200`;
  overdue text → `danger`. Recorded as an intentional look-vs-a11y trade (Stage 2 said "resemble",
  Stage 5 requires AA).
- **axe** (`@axe-core/playwright`, `a11y.spec.ts`): **0 serious/critical** on desktop
  calendar+editor+agent and mobile feed+editor.

### Performance (Lighthouse, prod-mode app, session cookie)
- **Desktop: performance 100, accessibility 100. Mobile: performance 97, accessibility 100.** Both
  clear ≥90 / ≥95. **CLS 0**, TBT 0 ms, LCP ~2.4 s (mobile). Rings/chips reserve dimensions (no CLS
  on the batched step load). Fonts self-hosted with `display: swap`. Month payload is 2 queries
  (posts + batched steps), no waterfall.
- **Bundle:** `/` route 28.4 kB (Stage 2) → **30.3 kB (+1.9 kB)** for focus-trap, error states,
  telemetry + rate-limit clients, and the overflow menu.

### Error & empty states
- Every client fetch failure → toast; Approvals/Notes get an inline **Retry** pane (never a blank
  pane). Agent failure → inline error in the sheet, **input preserved** (429 has its own copy).
  Shape-job failure → a per-post error note with **Retry** (not a stuck spinner) — driven by the
  job API's `error`/`timeout` status. Share-link invalid/expired → the branded `/expired` page
  (no redirect loop; `/` renders a message, not a redirect).
- A **second seeded tenant** (empty cycle, no notes) closes the Stage 3 gaps as e2e tests:
  month-with-no-posts (summary + dashed adds) and Notes empty state.

### Security
- **Cross-tenant isolation** (`security.spec.ts`, tenant B): B cannot read tenant A's cycle (403),
  cannot mutate A's posts/steps/revert/generate (404), cannot approve A's proposal (no mutation),
  and sees only its own empty notes/activity.
- **/api/e2e/\* + fakes inert in prod:** gated on `NODE_ENV !== 'production'`; the prod-smoke test
  asserts `/api/e2e/activity` → **404** under `next start`.
- **Rate limit (interim):** no mechanism existed; added an in-process token-bucket on the agent
  route keyed by `${clientId}:${cycleId}` (8 burst, 1 token / 3 s → ~20/min), 429 surfaced inline.
  Per-instance, not distributed — a durable Redis limiter is a later item. See `lib/rate-limit.ts`.
- **Token space:** seeded e2e tokens (`e2e0…`, `e2e1…`) live only in the disposable e2e container,
  never in the prod DB; even in one DB, real tokens are 32 random bytes (base64url), so a collision
  with the fixed seed values is ~2⁻²⁵⁶. No collision risk.

### Prod-mode smoke
`pnpm e2e:prod` → `next build && next start` on :3300, fakes off. 6 tests (boot, magic-link session,
month render + rings, caption save, checklist tick, /api/e2e 404). ~6 s warm.

### Telemetry
No analytics existed → added a minimal server-side **`ui_events`** table (migration 0069),
**separate from plan_activity** (plan_activity = plan-mutation ledger/source-of-truth; ui_events =
analytics). Client fires `POST /api/plan/events` (allow-listed, best-effort) for: view_switched,
proposal_approved/discarded, agent_ask_submitted, checklist_step_completed, shape_requested.

### Skipped (optional)
`toHaveScreenshot` visual snapshots — skipped per the "only if cheap / skip if flaky" allowance;
pixel snapshots across two form factors + fonts are flake-prone and axe + Lighthouse already gate
the visual/a11y surface. A future stage can add them with an animation-disabled config.

---

## 11. Local-dev workflow + token-rejection fix (2026-07-08)

### Root cause of "seeded magic-link token rejected as expired" (P1)
**Not** a validation/clock/single-use bug. The app's `dev` npm script is
`sh -c 'set -a && . ../.env.local && set +a && next dev'` — the `set -a && . ../.env.local`
**re-exports `DATABASE_URL` (the Railway dev DB), clobbering the container URL** passed on the
command line. So `DATABASE_URL="$(test-db.sh url)" … pnpm --filter @sprigly/app dev` runs the app
against **Railway**, where the seeded token doesn't exist → `verifyLink`'s `if (!row) return null`
(auth.ts) fires → `/p/[token]` redirects to `/expired`. Manual SQL updates hit the container, not
Railway, so they had no effect. The Playwright suite passes because its webServer runs `next dev`
**directly** with `env.DATABASE_URL = CONTAINER_DB` (no `.env.local` sourcing). Fix is at the
**workflow** layer (`pnpm dev:local`), not the route — token validation was correct all along.

### `pnpm dev:local`
`scripts/dev-local.sh`: ensures the test container is up (creates it if absent), reseeds, and starts
`next dev` **directly** (bypassing the `.env.local`-sourcing `dev` script) with
`DATABASE_URL=<container>`, `SPRIGLY_E2E_FAKE=1`, `PLAN_TODAY=2026-07-08`. Prints clickable
magic-link URLs for tenant A and B. `pnpm dev:local --reseed` resets data while the app keeps
running and reprints URLs.
- **Bind host = LAN IP** (`-H $(ipconfig getifaddr en0)`), falling back to localhost with no network.
  Reason: Next dev pins the `/p/[token]` redirect to the **bound** host (not the `Host` header), so
  `-H 0.0.0.0` would redirect to `0.0.0.0` and break the session cookie; binding the LAN IP yields
  one URL that works from **both** the Mac's browser and a phone. (The `/p` route is unchanged.)
- Seeded local tokens are long-lived (**2035** expiry) and exist only in the disposable container —
  gated like the other fakes (the seed is never a production path).

### Regression test
`e2e/session.spec.ts`: visits `/p/<token>` twice with a gap, both landing on the plan (not
`/expired`) and the resulting session authorizing an API read — guards the validation-side symptom
class (single-use / rotation / clock rejection). (The env-level root cause isn't reproducible in
e2e, which never uses the `dev` script.)

### Housekeeping
- **Seed NOTICE silenced:** `SET client_min_messages TO warning` at the top of the seed session
  removes the "truncate cascades to …" wall.
- **Next lockfile warning — verdict: benign, now explained.** `next dev` emits
  "Found lockfile missing swc dependencies, patching… / Failed to patch lockfile /
  Cannot read properties of undefined (reading 'os')". Cause: a **stray
  `/Users/johnmcgeagh/package-lock.json`** in the home dir — Next's `findUp('package-lock.json')`
  walks up from the app dir and finds it (this repo uses pnpm-lock.yaml), decides the lockfile is
  "missing swc deps" (the pinned `@next/swc-*@14.2.33` vs `next@14.2.35` skew), and tries to patch
  it by fetching npm metadata, which fails (offline/registry) → the caught `os` crash. **SWC is
  installed and working** (`@next/swc-darwin-arm64@14.2.33`); dev/build/e2e all succeed. It affects
  nothing. To remove the noise: delete the stray `~/package-lock.json` (not part of any project).
  A cosmetic realignment (`pnpm install` to bump `@next/swc-*` to 14.2.35) would also stop it but
  needs network and wasn't done here to avoid pre-UAT lockfile churn.

---

## 12. Design-alignment pass — Tailwind scoped-reset specificity bug (2026-07-08)

A systematic screenshot comparison against the reference mockups (desktop 1440×900,
mobile 390×844) found the redesign had drifted from Stage 2 — but the cause was a single
CSS bug, not many separate ones.

**Root cause.** `globals.css` scoped the redesign's base reset as unlayered
`.plan-redesign button { background: none; border: none; color: inherit; font: inherit }`.
That selector's specificity (0,1,1) **outranks every single-class Tailwind utility (0,1,0)**,
so on every button in the redesign the utilities for background / border / color / font
were silently overridden. And because preflight is disabled globally, there was no
`border-style: solid` default, so `border-*` utilities set a width but rendered nothing.
Measured symptoms: rail active-nav pill, "Add a post", the agent FAB, "Ask Sprigly",
"Save caption", the shape button and the editor/agent close circles all had **transparent**
backgrounds; done checklist boxes weren't coral; the "+ Add step" dashed pill, the empty-day
add-`+` dashed pills, calendar-cell and chip borders, and the Tasks overdue left-accent bars
had no border.

**Fix.** Move the scoped resets into `@layer base` and scope them with `:where(.plan-redesign)`,
which contributes **zero** specificity — so the reset sits at type-selector level (≤ 0,1,0)
and Tailwind utilities always win (this is exactly how Tailwind's own preflight stays
overridable). Re-added preflight's border reset (`border-width:0; border-style:solid;
border-color:#ECEAE6`) under the same scope so `border-*` utilities render. One ~15-line
change in `globals.css`; no component edits were needed — every affected surface (calendar,
editor, agent, tasks, mobile feed) realigned at once. e2e 31/31, axe 0 serious on both
layouts, type-check + build clean.

**Excluded as recorded decisions (not "fixed"):** editor Scheduled-date field (Stage 5
keyboard reschedule), mobile card ⋯ menu (Stage 5 swipe alternative), disabled voice/mic
entry points, caption-first-sentence titles, darkened muted/coral-deep/amber-deep text
(Stage 5 WCAG trade), "Media — coming soon" (upload out of scope).

**Ambiguous (left as-is, flagged not changed):** the reference mobile cards show a status
pill (Scheduled / Draft) rendered via the same `.tag` mechanism that D2 removed; the app
omits it. Could be intentional (part of the tags removal) or drift — not changed pending a
call. Trivial: the empty-day add affordance uses a full-width "＋" (U+FF0B) vs the ref "+".

---

## 13. Brand-alignment & palette refinement (2026-07-08)

Swapped the mockup-era palette + placeholder mark for the real Sprigly brand, and
eliminated the burnt-orange `coral-deep` text colour.

### Palette (token config)
- **Background `bg`: `#F5F4F2` → `#FFFFFF`.** The cream/warm-gray wash is not in the
  brand. Cards keep separation via their existing `--line` (#ECEAE6) borders (calendar
  cells, chips, rail `border-l`, topbar `border-b`, mobile cards, "Add a post"). One
  surface separates by fill not border: **completed checklist rows** (`bg-[#F7F6F4]`,
  transparent border) — left as-is because done rows are meant to recede (line-through,
  muted); the ~#F7F6F4-on-white delta is intentionally faint.
- **Dark surfaces: ink `#1B2430` → slate `#334155`** (the FAB, the scrim, sheet/FAB
  shadow tints). `ink` removed from the palette; dark surfaces use `slate-700`.
- **Dual-coral is deliberate (do not "fix"):** `coral` **#E87766** is the primary / mark
  colour; `coral-strong` **#FF6F62** is the strong interactive variant and the HTML
  `theme-color` (brand rule; set via `viewport.themeColor` in `layout.tsx`).
- Amber accent (#F59E0B) and fonts (Plus Jakarta Sans + DM Serif Display) unchanged.
  `color-scheme: only light` retained (`:where(.plan-redesign)` in globals.css).

### Coral text rule (supersedes the Stage 5 `coral-deep` trade)
Burnt-orange `coral-deep` (#B04830) as small text read as rust / off-brand. New rule:
**coral is never used for small text.** `coral-deep` was removed and replaced by two
constraint-named tokens so it can't be reached for small text again:
- **`coral-heading` #DE6E5C** — large display/serif coral text ONLY (≥24px, or ≥18.66px
  bold). Verified **3.24:1 on white** (WCAG large-text ≥3:1). Applied to: the italic
  "plan" in "Talk to your plan" / "Speak to your plan" (27/26px serif) and the desktop
  "Sprigly" wordmark (22px extrabold).
- **`coral-on-tint` #B04830** — coral text ONLY on `coral-tint`. Verified **4.70:1 on
  #FCE9E5** (small-text AA). Sole use: the active rail-nav label. (Checked separately per
  the pairing, as required.)
- **All other coral text → `slate-700` bold** (emphasis via weight, not colour): agent
  copy ("nothing happens until you approve it"), "Approvals" references, section eyebrows
  (Caption / Scheduled date / Checklist / Shape this post), NEW badges, format labels,
  "Today"/"N late" labels, due chips, ring completion numbers, "→ Approvals", Retry.
- **Non-text coral unchanged** (brand `coral` #E87766): icons (chip/proposal/notes/format,
  active-nav icon), the "+" and "▾" glyphs, ring strokes, risk dots, dashed-pill borders,
  focus rings, coral-tint active-nav background, filled coral buttons.

### Contrast re-verification (against pure white)
Stage 5's darkened text tokens were tuned on #F5F4F2; recomputed on white — all still
clear AA, no re-darkening needed: **muted #5C6470 = 5.98**, **amber-deep #7A5200 = 6.92**
(6.14 on amber-tint), **danger #B23A2E = 5.94**, **slate #334155 = 10.35**. White-on-coral
primaries remain the known close call: **white on #E87766 = 2.89**, **on #FF6F62 = 2.73**
(both below AA) — buttons are unchanged brand primaries and axe (the gate) stays green
(0 serious/critical) because the tested enabled coral button qualifies under axe's
large-text path / the other coral button is disabled-exempt.

### Logo
Replaced the placeholder sprig SVG (`SprigMark`, `icons.tsx`) with the real mark — two
curved leaves meeting at a pointed top, stem below (from `studio/svg_logos/
sprigly-mark-coral.svg`), brand coral #E87766. Used in the topbar/brand row on both
layouts. Favicon (`app/src/app/icon.svg`) already shipped the real mark geometry; aligned
its fill to the mark colour #E87766.

---

## 14. Calendar polish + month-nav (2026-07-08)

### Session / cycle model (drove the month-nav answer)
The magic-link token is cycle-scoped (`app_magic_link_tokens.cycle_id`), but the session is
**not strictly one-cycle**. The existing read path (`GET /api/plan?cycleId=`, guarded by
`isCycleReadableByClient`) already serves **any same-client cycle READ-ONLY**, while WRITE
scope stays the session's home cycle. `loadCycleList` builds the switcher from the client's
qualifying cycles (same channel, ≥1 live post, not out_of_sync). So month-nav is legitimate —
the chevrons were "silent" only because the seed had a single cycle.
- **Kept the chevrons** (the sibling-cycles-in-session branch): seeded an adjacent **August**
  cycle for tenant A (3 posts, read-only) so nav is exercisable; chevrons are **`disabled`
  (native → visual + aria) at the boundary**, never a silent no-op; e2e covers the
  July→August→July round-trip incl. boundary-disabled + read-only assertions.
- Navigating to a sibling opens it **read-only** (no add controls); the home cycle stays
  editable. `Today` returns to the home cycle.

### Footer capability copy
The old "Share link · view-only / Unlimited edits" contradicted itself. Replaced with one true
line reflecting the **viewed** cycle's actual capability:
- editable home cycle → **"Shared plan · unlimited edits until {cycle-month end}"** (e.g. "…until 31 Jul");
- read-only sibling → **"Shared plan · read-only preview"**.

### Other polish
- Calendar **month-summary** is now a solid card (white, `--line` border, `shadow-card`) so it
  no longer shares the dashed empty-cell language; **"see Tasks"** is a real button that
  switches to the Tasks view.
- Header **drops the "N posts" count** for the calendar (already in the rail badge + summary card).
- Chip **fallback title** for captionless drafts is now **"Untitled — tap to draft"** (muted
  italic) instead of the pillar; `postTitle()` returns 'Untitled' for tooltips/secondary uses.
- **FAB clearance**: plan scroll area padding `pb-10 → pb-28` so the fixed FAB never overlaps the
  last calendar row at 900px-height viewports.
- **Tasks-view summary card removed** (desktop + mobile) per John — redundant with the section
  counts and the rail badge.

---

## 15. Stage 6 — foundation + John's visual pass (2026-07-08)

### Visual (token + component)
- **Page background `bg`: white → soft cool grey `#F3F4F6`** (John, from a reference image) so
  white `surface` cards read as cards again. Cards unchanged.
- **"Add a post" is now a filled brand-coral CTA** (`bg-coral` #E87766 + white text/glyph), per John's
  explicit directive + reference image — a prominent CTA, not a bordered white card.
  - **Brand-vs-AA exception (flagged for John):** white on brand coral #E87766 is **2.89:1** — below
    AA, and no coral bright enough to read as the mark can clear it (the brightest AA-safe coral is
    ~#C94E39, a deep brick that no longer reads as the brand). Honoured John's brand directive
    verbatim and **scoped a documented axe exclusion for that single CTA node** (`a11y.spec.ts`); every
    other surface still holds AA. One-line switch to a deeper AA-safe coral if John prefers strict AA.
- **Dropped the calendar summary risk line** ("N behind schedule — see Tasks") entirely (John) — the
  summary card now shows only "N posts planned"; `see Tasks`, `onNavigate`, and `riskN` removed.
- **Chip fallback copy** shortened "Untitled — tap to draft" → **"Untitled draft"** (muted italic) so it
  doesn't clamp illegibly on narrow chips; the full affordance stays in the editor.

### Migration 0070 (hooks/scripts foundation)
`content_cycle_posts` + `hook`, `script` (pre-existing, `IF NOT EXISTS`), `script_length_seconds`;
new **`hook_patterns`** table (id, name, category, pattern-with-{slots}, example, formats[], active,
created_at) seeded with the **42 patterns from `design/reference/hook-patterns-seed.md`** — verified:
42 rows, 10 categories, slots + apostrophes intact, seed idempotent (only-when-empty), up→down→up
clean on the container. Selection reads `active=true` only (retire = UPDATE, not deploy). Mapped in
the Drizzle schema; added to `scripts/test-db.sh`.

### Discovery (informs the generation build)
- **Voice-context loader = `assembleShapeContext(cycle, deps)`** in `engine/src/content-cycles/planning.ts`
  (returns `voiceMd`, vocab, pillars, register, historic posts). It lives in the **engine worker**, not
  the app — so hook/script generation must run through the engine (a new job type) or a shared
  extraction, NOT be duplicated in the app. **This means "sync hooks in the app" is the wrong shape** —
  reusing the loader without duplication implies the async shape-job pattern for hooks too.
- **`prompt_templates` IS the live convention** — `packages/prompts` `DbPromptResolver` resolves
  generation prompts from the `prompt_templates` table. New hook/script generation prompts belong there.

### Stage-6 generation features — status
Hook generation, script generation, format-editing, and deviation-3 closure are **not built in this
pass**. They are a large app+engine build (new engine job types + Bedrock + fake-gate extensions +
async UI + e2e) that can't be completed and verified to the 3× gate in one sitting. The 0070 schema +
seed + the discovery above are the foundation so that build is app/engine code only (no further UAT
migration). See `design/UAT-PROMOTION.md` for the deployable scope.

### §15 correction (John's Stage-6b review) — no axe exclusion
The brand-coral-CTA axe exclusion is **removed**. New standing rule, recorded alongside the
coral-text rule (§13): **white-on-coral text is banned at every size below AA-large** (white on
#E87766 = 2.89, on #FF6F62 = 2.73 — both fail; nothing bright enough to read as the brand clears it).
- **"Add a post" ships AA-safe** as the active-nav palette: `coral-tint` fill + `coral` border +
  slate-700 label + `coral-on-tint` glyph (all ≥4.5:1), zero axe exclusions.
- Alternative offered to John (screenshotted): deep AA-safe coral `#C24C34` + white text (4.80:1) —
  a stronger, more distinct CTA if the tint reads too quiet. One-token swap.
- The dark-slate FAB (`slate-700` + white) is unaffected — white on #334155 = 10.35.
- **Background** shipped WARM `#F5F4F2` (original mockup value) instead of the cool `#F3F4F6` — the
  cool grey clashed in the warm/coral palette. One-token swap if John prefers cool.

---

## 16. Stage 6b — generation features (2026-07-08)

Built as verified vertical slices (hooks → scripts → format editing); weather (Slice 4) is separate.

- **CTA = John's pick B**: "Add a post" is deep AA-safe coral `bg-coral-cta` (#C24C34) + white
  (4.80:1). `coral-cta` is the only coral permitted under white text, button fills only (§15).
- **Slice 1 — Hooks** (reels + carousels): engine `hook` job reuses `assembleShapeContext`
  **as-is** (client/cycle-scoped voice context — no post-scope adaptation; post fields passed
  alongside), selects active `hook_patterns` by format (random, with a marked analytics-weighting
  seam), prompt from `prompt_templates` (imitate structure, never example); 3 candidates → pick →
  Save → `hook_saved`. Fake-gated at the queue boundary.
- **Slice 2 — Scripts** (reels): engine `script` job (voice + hook + caption + pillar + length with
  ~2.2 words/s guidance) writes a structured script; app gates on hook+caption, length picker
  15/30/60/90 → `script_length_seconds`, editable on arrival, Save → `script_saved`.
  **Deviation-3 closed**: shared engine ledger helper; `shape.ts` emits `caption_saved`/agent/
  `ref_proposal_id`, script worker emits `script_saved`/agent from day one — verified by
  `engine/.../ledger.integration.test.ts` against the container (append-only holds).
- **Slice 3 — Format editing**: header format selector → PATCH → `format_changed`; checklist
  reconcile (silent regen when no progress, keep/replace dialog when progress, email = cleared);
  hook/script hidden for non-applicable formats but **retained** (reel→single→reel keeps the script),
  with a note when hidden.
- **e2e flakiness**: the shared-tenant / single-dev-server harness has intermittent reseed-timing
  flakes (a test reliable in isolation occasionally fails under full-suite load). Hardened the format
  specs (one change per test, distinct posts) and set Playwright **`retries: 1`** — a real defect
  still fails both attempts. Full suite green (42) with retries.

---

## 17. test-db baseline decoupled from the remote (2026-07-09)

`scripts/test-db.sh up` (and therefore `pnpm dev:local`) used to `pg_dump --schema-only`
the remote DB (`.env.local` DATABASE_URL → the **UAT** Railway instance) on **every** `up` —
so a "local" command phoned UAT each run, and broke entirely when UAT was unreachable (DNS
failure; a failed dump also left a 0-byte cache with no fallback). Read-only + schema-only,
so no row data was ever read/committed, but the dependency was wrong for a local command.

Fix: **`up` is now local-only** — it loads a cached baseline (`.test-db/schema.sql`,
gitignored) and never connects to the remote. The single remote step is a new explicit
`./scripts/test-db.sh refresh` (opt-in; atomic — a failed pull never clobbers a good
baseline). `destroy` keeps the baseline (container only); `destroy:all` purges it. So after
one `refresh` while UAT is reachable, `dev:local` is fully offline forever. (Supersedes the
Stage-1 "refreshed on each up" behaviour.)

---

## 18. Stage-6b close-out — button unify, hook autosave, weather (Slice 4) (2026-07-09)

Two of John's review refinements plus Slice 4, then the stage close-out. No new migration —
this is app + engine-package code only (0070/0071 remain the deployable schema).

### Refinement 1 — one secondary-action button style
The dashed-coral pill (John's "dashed rust pill") is retired as a **button** treatment. A
single shared style — `SECONDARY_BTN` in `PostEditor.tsx`: solid slate `bg-slate-700`
(#334155) fill, white text/glyph, no dashed border, `rounded-full` (the existing pill radius)
— now backs all four editor generate/add buttons: **Generate/Regenerate hooks**,
**Generate/Regenerate script**, **+ Add step**, and **Build checklist**. White-on-slate is
10.35:1 (comfortably AA; the FAB precedent, not the banned white-on-coral — §13/§15). The
`SparkIcon` glyph is kept on the generate buttons (it *is* the ✨ glyph; the redundant literal
"✨" character was dropped from the labels so there aren't two sparkles).
- **Dashed survives only as "empty slot":** the calendar empty-day add-`＋` (desktop cell +
  mobile "＋ Plan a post for this day"). Info panes that happen to use a dashed border
  (script-needs-hook, media-placeholder, the Tasks/Approvals/Notes empty states) are not
  buttons and were left unchanged.

### Refinement 2 — hooks autosave on candidate pick
Picking a candidate hook now **PATCHes `{hook}` immediately** via `saveHook` (→ `patchPost`,
`hook_saved` ledger row, origin user) and shows a brief "Hook saved." toast — the separate
"Save hook" step is gone for picks. The generate button stays visible after a pick (label →
**Regenerate hooks**) so John can re-roll and re-select; each pick autosaves the same way.
- **Typed edits keep the explicit-save path.** The "Save hook" button is gated on `hookDirty`,
  which is only true after manual typing (a pick autosaves, so `post.hook` == field → not
  dirty). So typing never PATCHes per keystroke; it saves on the button, consistent with how
  the caption saves (both use an explicit Save, not blur). The script field is unchanged
  (still explicit-save — scripts aren't a pick-a-candidate flow).
- e2e updated: generate → pick → auto-ledgered without a save click → persists on reload →
  regenerate → pick a different candidate → ledger shows **both** `hook_saved` rows.

### Slice 4 — weather overlay
- **Forecast landed in a SEPARATE endpoint, `GET /api/plan/weather`** (not folded into the
  plan payload). Reason: the resilience rule ("the weather call never blocks or delays plan
  render") is satisfied structurally by keeping it off the payload — the plan renders from its
  own query and the client fetches weather in a parallel post-mount effect, ignoring failures.
  Returns `{ forecast: [{date, weather_code, temp_max_c}] }`, today + 14 days (15), °C only.
- **Reuses the weekly-session Open-Meteo client** (`@sprigly/weather` `fetchForecast`) — no
  second weather path; added `@sprigly/weather` as an app workspace dep. Client lat/lon come
  from `clients.lat`/`lon` (the columns the weekly audit already uses).
- **Cache = the package's own per-process in-memory cache** (6h TTL, keyed on
  `(lat,lon,London-day,days)`). Because the key is the client's coordinates, it is effectively
  "cached per client for a few hours" as specified — no second cache layer was added. (A
  serverless/multi-instance deploy caches per warm instance; acceptable for free/unmetered
  decoration, matching the package's documented stance.)
- **Icon bucketing** (`app/src/lib/weather.ts`, unit-tested) — Open-Meteo's ~28 WMO codes →
  8 glyphs: `0`→sun · `1,2`→partly-cloudy · `3`→overcast · `45,48`→fog · `51–63,66,80,81`→rain ·
  `65,67,82`→heavy-rain · `71–77,85,86`→snow · `95,96,99`→thunder · anything unmapped→overcast
  (the most neutral glyph). Tooltip / label = `"<rounded temp>° · <condition>"`.
- **Desktop:** muted 14px icon top-right of each in-window day cell (day number owns top-left);
  icon `aria-hidden`, info in a native `title` tooltip; out-of-window days render nothing (the
  forecast map simply has no entry). **Mobile:** icon + temp right-aligned in each agenda
  day-section header (not the week strip), wrapped in one `role="img"` + `aria-label`
  ("Weather: 18° · rain") — one accessible label per header (a plain `aria-label` on a generic
  `<span>` trips axe's `aria-prohibited-attr`; `role="img"` is the fix and the ProgressRing
  precedent).
- **Resilience is pure decoration:** no lat/lon, a 401, a fetch error, or an empty forecast all
  leave the calendar identical and surface nothing. e2e stubs a deterministic 15-day forecast
  in the fake layer (`e2eWeatherForecast`, anchored to `PLAN_TODAY`) and a second test forces
  the endpoint to 500 (Playwright route intercept) to prove the calendar is unaffected. Axe on
  the calendar/feed (desktop + mobile) stays 0 serious with icons present.

### Flake debt (recorded, NOT fixed now) — named post-UAT harness task
The Playwright suite runs with **`retries: 1`** (Stage-6b, §16) to absorb an intermittent
**shared-tenant reseed-timing flake**: the desktop/mobile/tenant projects run against one
dev-server + one seeded tenant, so a rapid `reseed()` in `beforeEach` can race an in-flight
request from the prior test. A real defect still fails **both** attempts (verified: the two
failures in the first close-out run — the mobile axe regression and the over-broad weather
assertion — failed both attempts and were genuine, not retry-masked).
- **The proper fix is per-worker seeded tenants** (each Playwright worker gets its own tenant +
  token + isolated data, so reseeds never cross-talk and the suite can go `fullyParallel` with
  `retries: 0`). This is a **named post-UAT harness task**, deferred deliberately — it is test
  infrastructure, not product, and doesn't gate the UAT promotion.
- **Standing rule:** `retries: 1` is the *only* sanctioned flake absorber, and only for this
  known reseed-timing class. **Any new flake pattern must be investigated and root-caused, not
  absorbed by the retry.** If a second distinct flake appears, that is the trigger to do the
  per-worker-tenant work rather than widen `retries`.

---

## 19. Editor polish pass — autosave, button alignment, header, delete (2026-07-09)

From John's review of the reel editor. App-only (PostEditor.tsx + e2e); no schema/env change.

### Autosave everywhere (Save buttons removed)
Caption, typed hook, and script now persist via a shared `useAutosave(value, persisted,
save, enabled, delay=1500)` hook: a save fires **1.5s after the last change OR immediately
on blur/unmount** — one PATCH (→ one ledger row) per *settled* edit, never per keystroke.
- The `Save caption` / `Save hook` / `Save script` buttons are gone. Removing the typed-hook
  Save button also kills the flicker John saw when picking a candidate (the Save button
  flashing in/out during the pick-autosave).
- `persisted` (the server value) is the baseline: when it changes from outside — a candidate
  pick, a shape job, a reload, switching post — it becomes the new baseline and is never
  echoed back. Candidate picks still save immediately and call `markSaved(value)` so the
  debounce can't double-save the same text.
- The existing per-field toasts ("Saved your caption." / "Hook saved." / "Script saved.")
  are the quiet settle confirmation. Revert is unaffected — it still restores the original
  from an autosaved state (e2e proves it).
- **e2e restructure:** caption/hook/script specs now blur to save (not click a button) and
  assert **one** ledger row per settled edit; a new test types character-by-character under
  the debounce window and asserts a single `caption_saved` row (not one-per-keystroke).

### Consistent section-header buttons
`Regenerate script` moved from its own line below the length picker onto the **Script header
row** (right-aligned), matching `Regenerate hooks`; `+ Add step` / `Build checklist` moved
onto the **Checklist header row**. One convention: each generate/add button sits right-aligned
on its section's header, same slate style, same size/spacing. (`SECONDARY_BTN` dropped its
`self-start` and gained `flex-none` so it sits cleanly in the header flex row.)

### Header overlap (Revert vs ✕)
The drawer/sheet ✕ is absolute (top-right, owned by the Drawer/Sheet wrapper, shared by all
dialogs). The editor header now carries `pr-12`, reserving the ✕ its own slot so Revert can't
slide under it at any width; the format/date/status badges wrap (flex-wrap) before Revert
clips. Localised to the editor header — the shared ✕ was left as-is.

### Delete post — bottom-pinned, coral, confirmed
Removed the mid-panel "Remove post". New: a **full-width, bottom-pinned "Delete post"**
(`bg-coral-cta` #C24C34 + white + trash glyph; 4.80:1, the AA-safe coral, §16) at the end of
the scroll, with a **two-step inline confirm** ("Delete this post? This can't be undone." /
Delete / Cancel) — no single-tap destruction. e2e covers cancel-keeps / confirm-removes +
`post_deleted` ledger.
- **Pending John's pick:** shipped the coral treatment; an alternative conventional-destructive
  treatment (white fill, red #B23A2E border + text) was screenshotted for comparison. One-class
  swap if he prefers it. (Both clear AA: coral-cta white 4.80:1; #B23A2E on white 5.94:1.)

---

## 20. Final polish pass — pickers, email-out, delete B, worker tests (2026-07-09)

John's last edits before UAT promotion. App is `PostEditor.tsx` + a new `pickers.tsx`
(shared components); the worker changes are test-only.

### Styled controls replace the OS-native ones (`pickers.tsx`)
- **Format dropdown** replaces the native `<select>`: the chip gains a ▾ chevron at rest
  (so it reads as changeable) and opens a custom `role="listbox"` popover (white, `--line`
  border, `shadow-card`, format icon + label per option, coral check on the current one).
  Keyboard: arrows/Home/End move option focus, Enter/Space select, Escape closes and returns
  focus to the trigger; outside-click closes. Same component desktop + mobile.
- **Date picker** replaces the native `<input type=date>`: a branded `CalendarPicker` in the
  plan calendar's language (serif month heading, chevron month-nav, Mon–Su grid, muted
  out-of-month days, coral circle on the selected day, ring on today). Keyboard: arrows move
  the focused day (shifting month at edges), Home/End week ends, PageUp/Down month, Enter/Space
  select, Escape closes. `role="grid"`/`row`/`gridcell` with per-day `aria-label` + `aria-current`.
  **One date-picking experience** — the desktop "Scheduled date" popover and the mobile
  swipe-right "Move" sheet both render the same `CalendarPicker`; selecting PATCHes immediately
  (ledgered `rescheduled`), no separate text input (the popover's ARIA + arrow-keys is the
  keyboard path).

### Email excluded from the plan-surface flow
The email workflow isn't built, so **Email is removed from the format selector** — no post can
be switched TO email. Existing email posts (the seed has one) still render and show their Email
chip, and the selector on them offers only the three real formats (**switch away allowed, back
not**). The server-side 422/`no_template` handling for email posts is untouched. Revisit when the
email workflow stage lands.

### Delete = treatment B (John's pick) — coral is never destructive
The bottom-pinned "Delete post" switched from the coral fill to the **conventional destructive
treatment: white fill, `danger` #B23A2E border + text + trash glyph** (5.94:1). The confirm-step
"Delete post" is a filled `bg-danger` + white (5.94:1). Placement, full width, and the two-step
confirm are unchanged. **New standing rule (alongside §13/§15's coral-text rules): coral is
never used for destructive actions — destructive = `danger` #B23A2E.** (Supersedes §19's coral-cta
delete.)

### Other editor tidy-ups
- **Duplicate "Edited" removed:** the header's status *word* span (New idea / Edited / Draft) is
  gone; only the NEW / EDITED pill remains (a 'planned' post shows no badge, matching D2's
  no-tags stance).
- **Media section removed** from the editor (desktop + mobile) — the "coming soon" placeholder
  returns only if/when publishing lands. Removed outright (no dormant render).
- **Shape suggestion pills removed** (Make it softer / shorter / Warmer tone) — the free-text
  Shape input + go button stands alone; empty input no longer submits a 'warmer tone' default.

### Worker test-drift fixed (test-only; production untouched)
Two deterministic pre-existing worker-test failures (both: a test asserting old behaviour after
the production code was refactored to a typed, non-throwing contract) — fixed the **tests**, not
production:
- **`consumer.test.ts` (6 tests):** `consumer.ts` calls `queue.getJob(emailJobId)` to clear a
  stale completed/failed email entry before the deterministic re-enqueue (real BullMQ dedup),
  but `MOCK_QUEUE` only stubbed `add`. Added a controllable `getJob` stub: **default → `undefined`
  (fresh enqueue)**; the two dedup-intent tests (deterministic-jobId re-enqueue, and the full
  chain re-run "already requested") override it with a **completed job** and now also assert the
  stale entry's `remove()` is called — so the dedup-remove path is actually covered. No existing
  assertion changed (the consumer always calls `add` after the guard); the completed-job cases are
  additive.
- **`ig-producer.test.ts` (1 test):** the account-guard returns a typed
  `IgTrawlOutcome { status: 'account_mismatch', detail }` (a recorded, non-retried condition), but
  the test still asserted a *throw*. Updated it to assert the resolved outcome (`status`, `detail`
  cites the expected handle + foreign owners, no file written) — the real production behaviour.
  This surfaced only when the suite runs with `DATABASE_URL` set (the file imports a DB-validated
  module); offline it never loaded. **Worker suite now fully green (204/204 with the container DB).**

### e2e
Format specs drive the custom dropdown (open trigger → click option) and add coverage that the
menu excludes Email and an existing email post still renders/only-switches-away. The mobile Move
and a new desktop date-picker test select via the `CalendarPicker`. New assertions that the media
section and shape pills are gone. **Toast-vs-axe flake fixed properly:** the format-confirm axe
scan now waits for the status toast to reach full opacity before analyzing — axe was catching the
toast mid-fade (a blended `#ebebec`-on-`#89909a` = 2.7 transient; the toast is white-on-slate
10.35:1 at rest). Investigated, not absorbed (§18's rule).

---

## 21. UAT round 1 — focus bug + agent/checklist fixes (2026-07-09)

Six issues from John's first real-Bedrock session. All app-side (+ the extraction prompt,
which lives in **code**, not `prompt_templates` — so NO migration; 0066→0071 is unchanged).

### 1. Focus-stealing on keystroke (critical) — root cause
Every keystroke in the agent input (and the caption, on autosave) moved focus to the ✕.
Nothing was remounting: **`useFocusTrap` listed `onClose` in its effect dependency array,
and every `Sheet`/`Drawer` call site passes a fresh inline-arrow `onClose` on each render.**
So any re-render of the layer's parent re-ran the trap effect, whose 30ms `setTimeout`
focuses the first focusable — the ✕. The two triggers: the agent input's value is state in
`PlanDesktop` (keystroke → `setAgentText` → PlanDesktop re-render → new `onClose`), and the
caption's 1.5s autosave updates `posts` (→ drawer re-render). **Fix:** hold `onClose` in a
ref inside `useFocusTrap` and depend the effect only on `[active, ref]` (both stable) — the
trap now initialises once per open, never on incidental re-renders. A `keyboard.type()`
regression e2e (agent input + caption-through-autosave) guards it; `fill()`-based tests are
blind to this class, which is why 50 green specs missed it.

### 2. Editable checklist step labels
`useAutosave` extracted to its own module (`useAutosave.ts`) and reused: `ChecklistItem`'s
label is now an inline `<input>` that autosaves on blur/idle → new `renameStep` (steps.ts) →
`PATCH …/steps/:id { label }` → `step_renamed` ledger (added to `ActivityAction`). Enter
commits, Escape reverts, read-only cycles keep static text. axe-clean (per-step aria-label).

### 3. Ask Sprigly working indicator
On submit: input + send disabled, send → a spinner + "Sprigly is thinking…", and the
extraction area shows a skeleton (`agent-thinking`, `aria-live`). Never strands — `ask` now
aborts to an inline error after a 60s ceiling. Motion (`animate-spin`/`animate-pulse`) is
dropped by the existing `prefers-reduced-motion` scoped reset; the text state remains.

### 4. Extraction rendering + inline approve
The agent message no longer duplicates proposal summaries as "• …" bullets — the route pushes
ONLY conversational parts (answers, notes, clarifications) into the message, and
`ExtractionSummary` renders it as clean prose (`cleanProse` strips any stray markers).
Proposal rows gained an **inline Approve + Discard** calling the existing approve/reject
endpoints via `data.decide`; on approve the row swaps to "Applied ✓" and the plan + rail
counts refresh. Ledger + mutation-cap behaviour is identical to the Approvals view (same
`approveProposal`), which is unchanged as the full queue.

### 5. Compound-ask decomposition — extraction prompt (code, not DB)
The prompt is `TASK_PARSER_SYSTEM_PROMPT` in `app/src/lib/agent/task-parser.ts` (a code
const resolved by the parser; NOT `prompt_templates`/`DbPromptResolver` — that resolver is
for generation prompts). Changed: an explicit **DECOMPOSE COMPOUND REQUESTS** rule (split on
and/commas/sequenced verbs; two edits to the same post = two tasks) and a **don't-drop** rule
(an unmappable clause becomes a `clarify`, never vanishes), plus a worked compound example.
John's failing case ("… and make it a carousel") was dropped because there was **no format
action** — added `change_format` end-to-end: a task action + a `format` proposal kind that
applies via `patchPost { format }` (`format_changed`, origin agent) + summaries. Grammar fix:
`addSummary` now reads "Add **an Instagram** post" (article + capitalised channel), not "a
instagram". The e2e fake returns a two-proposal compound (move + change_format on the seeded
reel) so the flow is deterministic. **Real-Bedrock extraction quality iteration continues on
UAT — this prompt change is round one, not a guarantee.**

### 6. Timeline z-order
The connector `<span>` is absolutely positioned, so it painted **above** the static dots and
cards (positioned elements paint after non-positioned siblings). Fix: `isolate` the timeline
(own stacking context), put the connector at `-z-10`, and lift each row/divider to `z-10`.
Dots (opaque coral fill / white-centred hollow) now sit above the line; verified the line no
longer cuts through either dot state or the Today divider.

---

## 22. UAT round 2 — weather overlay refinement + mobile week nav (2026-07-09)

From John's UAT during a real heatwave. Two threads: the weather overlay couldn't
communicate heat (icon-only cells + a haze-misread), and mobile calendar navigation was
broken. App-side + one `@sprigly/weather` addition (rebuilt); **no migration**.

### 1. Desktop cells now show the temperature — reverses the §18 icon-only decision
The §18 "muted 14px icon top-right, temp only in the tooltip" call **does not survive a
heatwave**: an icon alone can't say "32°", and a hazy-hot day read as "cloudy" — the calendar
told the wrong story in exactly the conditions where weather matters most for shoot planning.
So each in-window desktop cell now renders **icon + a compact temp label** ("32°") top-right
(`WeatherCellIcon`, `pieces.tsx`): `text-[11px] font-semibold tabular-nums`, muted by default,
small enough not to compete with the chips. The full detail stays in the native `title`
tooltip ("32° · clear"); glyph still `aria-hidden`. **This is a deliberate reversal of §18 —
the heatwave case is the reason.**
- **Mobile was already icon + temp** (§18) — confirmed the formatting now matches desktop:
  both `Math.round(tempMaxC)°`, `tabular-nums`, same tone treatment (below). Mobile stays
  slightly larger (12.5px vs 11px) for the bigger touch surface; the shared logic lives in one
  `weatherTreatment()` helper so the two surfaces can't drift.

### 2. Hot-/cold-day emphasis — a quiet accent, never an alert
A `tempTone()` band (in `lib/weather.ts`) drives the label colour (thresholds °C):
- **≥27° "hot"** → the muted label swaps to **AA-safe amber-deep #7A5200 (6.9:1 on white)**.
- **≥32° "scorcher"** → amber label AND, when the day is otherwise sunny, the sun glyph swaps
  to a bolder **"hot-sun" variant** (filled core + heavier rays, tinted amber to match) so a
  scorcher reads at a glance. The swap is temperature-driven and **render-only** — the WMO
  bucket stays `sun` (`data-weather="sun"`), only the glyph changes (`data-glyph="hot-sun"`).
- **≤2° "cold"** → the label goes a calm **slate-blue (sky-800 #075985, 7.4:1)**. Included
  because it was trivially cheap (same code path as the amber band), as scoped.
The icon itself stays muted except the hot-sun (which carries the amber so the scorcher is one
coherent accent). Kept quiet by design: an accent for scannability, not an alert colour.

### 3. Icon bucketing fixed — code 1 ("mainly clear") is a SUN, not a cloud
The haze misread was real: `bucketWeatherIcon` mapped WMO **1 → partly-cloudy**, so a
hazy-hot "mainly clear" day drew a cloud. Fixed so **only 2 and 3 earn cloud glyphs**. Final
code→icon table (`lib/weather.ts`, unit-tested):

| WMO code(s) | Icon | | WMO code(s) | Icon |
|---|---|---|---|---|
| 0, **1** | **sun** | | 65, 67, 82 | heavy-rain |
| 2 | partly-cloudy | | 71–77, 85, 86 | snow |
| 3 | overcast | | 95, 96, 99 | thunder |
| 45, 48 | fog | | anything unmapped | overcast (neutral) |
| 51–64, 66, 80, 81 | rain | | | |

(Order matters: the heavy-rain codes 65/67/82 are checked before the 51–67/80–81 rain range.)

### 4. Cache sanity — TTL + key were already correct; added a fetch timestamp
Audited the package cache (`packages/weather`): **TTL is 6h** (`TTL_MS`), matching the "few
hours" spec, and the **key is `(lat.toFixed(3), lon.toFixed(3), London-day, days)`** — i.e.
client-location + date-window, exactly as required (coordinates are the per-client dimension;
two clients at one location correctly share a forecast, per §18). **No change to TTL or key.**
The one gap was **no exposed fetch timestamp**, so staleness (the overlay can be up to 6h old)
wasn't diagnosable. Added `fetchForecastWithMeta()` returning `{ data, fetchedAt, fromCache }`
where `fetchedAt` is the cache entry's timestamp — **on a hit it's the ORIGINAL Open-Meteo
fetch time**, which is what "is this stale?" needs. `fetchForecast()` is now a thin wrapper
(weekly session unaffected). The route exposes `fetchedAt` (ISO) + `cached` in the JSON and an
`x-weather-fetched-at` header; the client `console.debug`s it. Tooltip/aria conventions and
the pure-decoration resilience (no lat/lon, 401, error, empty → identical calendar) unchanged.

### 5. Mobile calendar navigation — couldn't move between weeks; landed on the 1st
Two defects in `PlanMobile.tsx`, both fixed:
- **"Can't move between weeks."** The feed renders one week (`selectedDay`'s Mon–Sun) and the
  only prev/next buttons switched **cycles (months)**, not weeks — there was no week stepper,
  so a user was locked to the initial week. Added **prev-/next-week** chevrons flanking the
  week strip (step ±7 days, **clamped to the viewed month**, disabled at the month's edges).
- **"Today isn't shown — I land on the 1st of June."** `selectedDay` fell back to the earliest
  post (→ the 1st) whenever `today` wasn't in the viewed cycle's month, with no recovery. Now:
  (a) a single `defaultDayFor()` picks **today when today is in the viewed month**, else the
  month's earliest post, else the 1st; (b) a **cycle-switch effect re-anchors** the week view
  when you change month (it previously stranded the strip on the old month); (c) a **mobile
  "Today" pill** (desktop parity) jumps to today, switching to the cycle that *contains* today
  when today is in a different month. The first render already lands on today's week (via the
  `useState` initializer) with today highlighted in the strip; the cycle-switch re-anchor is
  keyed on an **actual `viewedCycleId` change** (not a mount flag) so React StrictMode's double-
  invoked mount effect can't fire the re-anchor's scroll on load — its 700ms spy-lock would
  otherwise swallow the user's first feed scroll (a regression the e2e caught).

### e2e + verification
- Weather e2e (`weather.spec.ts`): asserts 15 temp labels render alongside icons; a new
  hot-day spec with the stubbed **33°** day proves `data-tone="scorcher"` + `data-glyph="hot-sun"`
  while the bucket stays `sun`, the 29° day is `hot` with a normal sun glyph, the 1° day is
  `cold`, and **WMO code 1 → `data-weather="sun"`**. The e2e fake (`e2e-fake.ts`) gained a 33°
  clear day, a code-1 day, and a 1° day. Mobile e2e gained a week-step-and-Today-jump test and
  a scorcher-tone badge assertion. Unit tests cover the new `bucketWeatherIcon(1)==='sun'` and
  `tempTone` bands. Full suite + axe green; type-check/build clean.

---

## 23. Client-customisable generation prompts — IVY-t hook + script overrides (2026-07-09)

John asked to "make the hook + script prompts client-customisable and create an Ivy-trained
version of both." **The per-client mechanism already exists end-to-end — nothing in the code
needed to change to support it.** The deliverable was therefore purely the Ivy prompt content,
shipped as a client-scoped seed migration in the established pattern.

### What was already there (verified, not built)
- **Data layer:** `prompt_templates.client_id` is nullable; the unique key is
  `(client_id, workflow_id, step_name, version)`. Provenance columns `copied_from_template_id` /
  `copied_from_version` exist specifically to track a client override forked from a shared default.
- **Resolver:** `DbPromptResolver.resolve(clientId, workflowId, stepName)` (`packages/prompts`)
  returns the **client-scoped** row when present (highest version), else falls back to the
  **global** `client_id IS NULL` row. So a client override always wins; absence is a clean fallback.
- **Runtime wiring:** hook generation (`engine/.../hook.ts`, `plan_hooks/generate`) and reel-script
  generation (`engine/.../script.ts`, `plan_scripts/generate`) both already call
  `prompts.resolve(job.clientId, …)` — the real per-client id flows all the way through. The
  client's `voice.md` is separately injected into the *user* message via `assembleShapeContext`.
- **Admin:** `admin/.../clients/[id]/actions.ts` already has a "create client override" action that
  inserts `version 1` + `copied_from_*` provenance. The migration mirrors it exactly.

### What was added — `0072_ivy_t_generation_prompts.sql` (+ `.down.sql`)
Two **ivy-t client-scoped** rows (`plan_hooks/generate`, `plan_scripts/generate`), authored from
`clients/ivy-t/memory/voice.md`. Each keeps the **same task + output contract** as the global
default — hooks still return `{"hooks":[…]}` (parsing unchanged) and still imitate the injected
`hook_patterns` STRUCTUREs; scripts still emit the `HOOK / BEAT / CTA` plain-text shape — and adds
an **"IVY HOUSE RULES"** block distilled from voice.md (no em dashes, no hard sell / superlatives /
AI tells, embedded-not-announced sustainability, "organic cotton" always in full, garment
personification, register-by-post-type I-vs-we for scripts, Ivy's real CTA mechanics like
comment-to-waitlist). The rules are baked into the *system* prompt so the model applies them
reliably rather than hoping to infer them from the injected voice.md.
- **Self-contained by necessity:** the resolver returns one whole string with no composition, so
  an override is a full replacement system prompt, not a diff over the global.
- **Idempotent AND safe where ivy-t is absent:** each INSERT selects the ivy-t client id and
  inserts only when that client exists and the row isn't already present — a clean no-op on the
  e2e test DB (which has no ivy-t), re-runnable without duplication. Provenance points at the
  global v1 row. `0072` added to `scripts/test-db.sh`'s migration list.
- **Not applied to prod by me** (APPLY-BEFORE-DEPLOY, manual `psql -f`, per the repo convention).

### Verification
Against the disposable test DB: `0072` applied cleanly as a no-op with no ivy-t client; after
inserting a temp ivy-t client it inserted exactly the two rows (`version 1`, `copied_from_version 1`,
`copied_from_template_id` = the global v1 row), and re-applying was idempotent. The **real
`DbPromptResolver`** then confirmed ivy-t resolves the IVY-trained prompt for both workflows while
another client id falls back to the global default, with the two global rows untouched.

### Note for future customisation
Any further client (or a v2 of Ivy's) is the same one-row insert — or John can use the existing
admin prompt editor's "create client override" action; no schema or engine work. The prompt
wording is a first draft from voice.md and is meant to be iterated (admin `saveNewVersion` bumps
the version in place).

---

## 24. UAT round 2 — plan-agent hook/script vocabulary, format inference, generate_hook, focus (2026-07-09)

Four UAT items on the plan agent. All app-side; **no migration, no engine/worker change**. Note:
the instruction parser John called `agent-instructions.ts` is actually
`app/src/lib/agent/task-parser.ts` (`TASK_PARSER_SYSTEM_PROMPT`); there is no `agent-instructions.ts`.

### Part 1 — the parser now knows the product's own vocabulary
The prompt predated Stage 6, so a hook/script clause drew a generic "what kind of hooks — email
subject lines?" question. Added a **PRODUCT CONCEPTS** block to `TASK_PARSER_SYSTEM_PROMPT`
defining hooks (reel/carousel opening lines from a pattern library, generated in the editor,
stored on the post), scripts (timed reel scripts from hook+caption+length), checklists/steps, and
formats (reel/carousel/single; email excluded), with the rule: a concept clause with no matching
action → **product-aware guidance** in a `clarify` ("approve the post, then open it and use
Generate hooks"), never a generic question. Scripts have no task yet → guidance to the editor's
Generate script.

### Part 2 — add_post infers the format from the ask
`add_post` gained a `format` field (`reel|carousel|single`). Inference (an explicit word always
wins): reel/video → reel; carousel/slides/swipe → carousel; post/photo/image/picture → single;
**no signal → default single, made VISIBLE and correctable** — the proposal summary reads "Add a
single image on … (say 'reel' or 'carousel' if you'd prefer)" so the default is fixable before
approve, not discovered after. Email is never inferable — an "add an email" ask returns the
product-aware "email posts aren't available here yet" (a clarify), not a proposal. The `add`
proposal payload carries `format`; `addDraft` / `addGeneratingPost` gained a `format` param (was
hardcoded `'single'`); the `post_created` ledger payload now records the format. The proposal row
+ summary always state the format explicitly.
- **Checklist parity (verified, nothing to fix):** neither the editor create path (`POST
  /api/posts` → `addDraft`) nor the agent create path auto-creates a checklist — checklists are
  **on-demand and format-aware** (the editor's Build/Generate checklist reads the post's current
  format's template). So setting the format correctly on create is exactly what makes the later
  on-demand checklist the right one; the two create paths are already consistent.

### Part 3 — generate_hook proposal, and the ordering-dependency mechanism (the decision)
New `generate_hook` action + `{ kind:'generate_hook', cycleId, postId?|refProposalId? }` payload.
"Create a reel about X with a good hook" decomposes into **two** independently-approvable proposals
(add_post reel, then generate_hook). On approve, generate_hook enqueues the **existing** hook engine
job (`enqueueHookJob`) for the target post; candidates surface in that post's hook UI exactly as a
manual Generate hooks does (the client polls the hook job into `hookCandidates`).

**Ordering mechanism — chosen: payload reference resolved at apply time, via the ledger (no new
column).** The second proposal is created up front (so both rows show immediately) with
`refProposalId` = the add proposal's id and `postId` null. At approve time the target is resolved
by reading the `post_created` `plan_activity` row tagged with that `refProposalId` (the add already
records `refProposalId` via the agent actor). The alternative — "create the second proposal only
after the first applies" — was rejected because it can't show both rows at once, which the UX
requires. **Out-of-order approval is handled gracefully, NOT made impossible:** approving the hook
step before its create step resolves to "not ready", so the proposal is **un-claimed (left
pending/approvable)** and the client shows "Approve the 'Add …' step first" — it never consumes or
fails the proposal, so the user simply approves the create step then the hook step. (Implemented as
claim-then-revert rather than a pre-claim read, so the non-generate_hook approve path is byte-
identical and the mocked `proposals.test` is unaffected.)
- **Single-image guard:** hooks are reels/carousels only. An ask for hooks on a single-image post
  (existing, or a no-format create) yields a **question** ("Hooks apply to reels and carousels —
  want me to make it a reel first?"), never a silent drop and never an invalid proposal.
- **Mutation cap:** generate_hook is a first-class proposal (same create/approve/changeSet flow),
  and on approve it is gated by the same monthly AI-change check as a rewrite (`isRewriteBlocked`) —
  it counts against the cap like any AI proposal. The hook job's own emission is unchanged.

### Part 4 — agent input double focus indicator + Ask Sprigly button
The agent sheet input showed **two nested coral rectangles** on keyboard focus: the container's
`focus-within:border-coral` PLUS a second ring from the global `input:focus-visible { outline … }`
in `globals.css`. Root cause: that global rule is **unlayered**, so it beats the input's
`.outline-none` utility (which lives in Tailwind's `utilities` layer) — unlayered normal always wins
over a layered one, regardless of specificity. Fix: `focus-visible:!outline-none` on the inner input
(the `!important` is required to beat the unlayered rule), leaving the container's `focus-within`
border as the single indicator. A11y holds (focus stays clearly visible at the container level on
both pointer and keyboard focus; axe green). Sweep: the only `focus-within` composite input in the
redesign is this one — the shape/hook/caption/script inputs use a different direct `focus:border-coral`
pattern (a single border, not the nested-container bug), so they were correctly left alone.
- **Ask Sprigly button drift:** its idle-enabled fill was `bg-coral` (#E87766) with white text =
  **2.89:1, failing AA** (the banned white-on-brand-coral, §15). Restored to `bg-coral-cta`
  (#C24C34, white 4.80:1, AA) — the deep coral John expected. The pale look in his screenshot was
  the `disabled:opacity-50` state over the already-too-light coral.

### Verification
Full Playwright e2e + axe green ×3; worker suite (203) + app/agent mocked suites green; type-check
+ build clean across app, engine, worker. New `agent.spec.ts` (desktop project) covers: Part 1
guidance (hook-on-single + script), Part 2 format inference ×4 incl. the visible default note and
the downstream created-post format, Part 3 compound two-row approve-in-order → reel + candidates,
out-of-order graceful block, and the single-image question. The e2e fake gained deterministic
format-worded / hook / script branches. New `proposals.test` cases cover generate_hook enqueue +
the single-image block.

---

## 25. Disabled-state convention for primary/filled buttons (2026-07-09)

Follow-on from §24 Part 4. `disabled:opacity-50` on a filled button reads as a **washed-out**
version of the live colour (a pale coral "Ask Sprigly"), which looks broken rather than inactive.

**Convention:** filled / primary buttons use a **neutral inactive** disabled treatment —
`bg-line-soft` (#F1EFEC) fill + `text-muted` (#5C6470) text + no shadow, **no opacity**. Codified
as one shared constant `DISABLED_PRIMARY = 'disabled:bg-line-soft disabled:text-muted
disabled:shadow-none'` in `primitives.tsx`, applied everywhere so the states can't drift.
- **Swept and applied** to every filled button that used `disabled:opacity-50`: Ask Sprigly
  (coral-cta), the ProposalCard + ExtractionSummary **Approve** buttons (coral), the editor's shared
  `SECONDARY_BTN` generate/add buttons (slate), and the **shape** submit (coral-tint).
- **Secondary / outline buttons are out of scope** and keep their own subtle disabled state — the
  **Discard** buttons (`border` + `bg-surface`) still use `disabled:opacity-50`; a faint outline
  button doesn't read as "washed-out colour", and the convention is deliberately for filled CTAs.
- **One exception, Ask Sprigly while BUSY:** the neutral classes apply only when disabled-because-
  empty. During the "Sprigly is thinking…" state the button is also `disabled` but stays coral-cta,
  because its spinner is a white ring that a `line-soft` fill would swallow — "working" must stay
  visually distinct from "inactive". Disabled inputs (`disabled:opacity-60`) are unchanged — this is
  a button convention. Axe + e2e green.

---

## 26. Target-aware Shape — refine hooks + scripts (Part 1, 2026-07-09)

Shape only rewrote captions ("make the script punchier" silently rewrote the caption). Made it
target-aware: the editor's Shape input gains a **Caption | Hook | Script** segmented control (only
the fields that exist and apply to the format; caption is the default), and the instruction refines
the chosen field.

### Job design — GENERALISED the shape job (not a sibling), with a lighter refine path
The shape worker is deeply caption-specific: it reuses the planning generate+validate machinery
(`regeneratePost` → `applyCodeGate` → `applyCritic` → catalogue grounding), which is right for a
caption but wrong for a one-line hook or a timed script (the caption critic would reject them). So:
- **The caption path is unchanged** — same `runShapeForCycle`, same gates, same behaviour.
- **A `target` field was added to the shape job** (`ShapeJob.target?: 'caption'|'hook'|'script'`,
  default caption). The consumer dispatches `target: hook|script` to a new lighter handler
  `runFieldRefine` (`engine/.../refine.ts`); caption keeps `runShapeForCycle`. This **reuses ALL the
  shape plumbing** — the same `shape` job type + deterministic `shape_<cycle>_<post>` jobId, the same
  `GET /api/jobs` poll → `loadPlanPosts` reload → the editor's `pending → arrives → autosave`
  resync (`useAutosave` `persisted` baseline). One job, one route, one poll path.
- **`runFieldRefine`** takes the current field text + instruction + `assembleShapeContext` voice
  (voiceMd); for **script** it also passes the hook, length and 2.2 words/second budget so a refined
  script stays timed; for **hook** the prompt keeps it to ONE line so it can't drift into a caption.
  The prompt instructs a **minimal-necessary edit, preserving what wasn't asked to change** — not a
  rewrite-from-scratch. It writes the field (`status='edited'`), records a `post_edits` row (so a
  refine counts against the AI cap like a caption shape), and ledgers `hook_saved` / `script_saved`,
  origin agent — the established generation naming, no new action name needed.

### Prompts — dedicated DB prompts (client-customisable, like generation)
Caption "shape" has no dedicated prompt (it injects the instruction as repair feedback into the
planning prompt). Hook/script GENERATION each have a dedicated DB prompt (`plan_hooks/generate`,
`plan_scripts/generate`, §23). Following that convention, REFINE gets dedicated DB prompts
`plan_hooks/refine` + `plan_scripts/refine` (migration **0073**, global rows, resolved via
`DbPromptResolver` → client-customisable the same way, falls back to global). Not a code const.

### Route + client
`POST /api/posts/:id/shape` gained a `target` param; for hook/script it loads the post and guards
field-exists + format (returns `mode:'empty'` defensively — the editor only offers a target whose
field exists). `usePlanData.shape(id, instruction, target)` threads it through and stores it for
retry. e2e (faked): the fake shape writes the target field (E2E_REFINED_HOOK / _SCRIPT) and mirrors
the worker's `hook_saved`/`script_saved` ledger row so the editor e2e can assert pending → refined
text lands → autosaved → ledger; hook refine stays one line; a caption-only post shows no control.

---

## 27. Agent refine actions (Part 2, 2026-07-09)

The plan agent could generate hooks but refine nothing. Added a **`refine`** proposal type that
reuses the §26 target-aware shape job.

### Proposal-type shape chosen — ONE parameterised `refine` (target: hook | script)
Not `refine_caption`/`refine_hook`/`refine_script`. Caption refinement already has a path
(`rewrite_post` → shape target=caption), so a `refine_caption` would duplicate it; caption refinement
stays `rewrite_post`. The new action is a single `refine` with `target ∈ {hook, script}` and an
`instruction`; payload `{ kind:'refine', cycleId, postId?|refProposalId?, target, instruction }`. On
approve it enqueues the shape job with that target + the proposal id (ledger ref) — the field lands
via the same pending → reload flow, and the worker records `hook_saved`/`script_saved`.

### Parser vocabulary
Refinement verbs (make it X, tighten, shorten, punchier, rework the CTA, warmer…) aimed at a hook or
script map to `refine{target}`. WRITE-from-scratch of a script still returns editor guidance (there's
no agent generate-script). "make the script on the 14th punchier" → `refine{target:script}` → a
proposal "Refine the script for '…'".

### Empty field → offer generation, not a proposal
Refining a field that doesn't exist is a **question, not a proposal**: an existing post whose hook or
script is empty gets "There's no script on that post yet. Open it and use Generate script first"
(hooks: "Want me to generate some hooks first?"). Checked at the route (existing post) AND at apply
time (`resolveRefineTarget`) — an empty field at apply un-claims the proposal and returns the same
graceful message, so it never applies a no-op.

### Deferred-child + cap
The §24 ordering mechanism applies: a ref-less refine (a field on a post created earlier in the same
ask) carries `refProposalId`, resolved at apply from the `post_created` ledger; if the field isn't
there yet it blocks gracefully (stays approvable). A refine counts against the AI-change cap like any
AI proposal (`isRewriteBlocked` on approve; the worker's `post_edits` row increments it). e2e (faked):
"make the script punchier" → refine proposal → approve → job enqueued → `script_saved` ledger;
refine-on-empty-script → question, no proposal. Unit tests cover the enqueue + the empty-field block.
