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
