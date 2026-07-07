# Plan Surface Redesign — Reconciliation Audit

**Base:** branch `redesign/plan-surface`, cut from `dev` (`2ca13e4`, == `uat`). This branch
carries the full current plan surface, so every "exists" claim below is verified against the
actual base, not a stale one.

This is a **reconciliation**, not full Phase-1 discovery: the current client plan surface is a
working, shipped component (`app/src/components/PlanApp.tsx`) with real endpoints. Most of the
plan's "unknowns" are already answered. Read `DECISIONS.md` alongside this.

---

## 1. Genuinely new work (the list that matters)

Everything else is a reskin of existing, wired behaviour. The net-new build is narrow:

1. **Production checklist / Tasks model** — `post_steps` + `step_templates` (grep-confirmed
   absent). Per-post steps with `lead_days`; templates per content type
   (Reel: script 4 / shoot 3 / edit 2 / caption 1; Carousel: source 3 / frames 2 / caption 1;
   Single: source 2 / caption 1). **Derivations are computed, never stored:**
   `due_date = scheduled_date − lead_days`; a step is *at risk* if `!done && due_date < today`;
   a post's ring is `done/total`. CRUD + `POST /posts/:id/checklist:generate` (also the endpoint
   an agent "build checklist" proposal applies through). Rings, at-risk chips, and the whole
   Tasks view derive from this — nothing renders until it exists.

2. **Tailwind responsive rebuild** — re-express `PlanApp.tsx` (currently inline-style objects)
   as `<PlanDesktop>` (≥1080px: rail + drawer) and `<PlanMobile>` (strip + sheets) sharing one
   set of state hooks + a component library, matching the two reference mockups. Tailwind only
   (D5); look/feel must resemble the HTML.

3. **`plan_activity` ledger table** — small net-new table required by the D1 addendum
   (unified history). See §3 for the decision and shape.

4. **Playwright e2e harness** — the web app uses Vitest (endpoint tests exist:
   `proposals-endpoints.test.ts`, `agent-route.test.ts`, `revert.test.ts`); there is **no e2e
   harness**. `e2e/plan-redesign/` scoped to the flag-on state is net-new infra.

5. **`sprigly-voice` cross-repo wiring** — mic / voice overlay depends on the separate
   `sprigly-voice` repo (Deepgram Nova-3 + Haiku). The seam already exists in data
   (`agent_messages.source = 'voice'`, `agent_messages.metadata` carries a voice `sessionId`),
   but the **session contract** (how the client opens a session and attaches a post ID so
   "this post" resolves) is **not yet determined**. **Open question — resolve by reading the
   `sprigly-voice` repo at the voice stage; do not guess it now.**

---

## 2. Confirmation table — UI feature → existing backing (all on this base)

| Mockup feature | Backing (endpoint / component / table) | Status |
|---|---|---|
| Calendar grid + Timeline | `PlanApp.tsx` (CalendarView/timeline); `GET /api/plan` → `loadPlanPosts` (`content_cycle_posts`) | exists |
| Drag-to-reschedule | `PATCH /api/posts/:id { date }` (`PlanApp.reschedule`, line 256) | exists |
| Add a post / empty-day ＋ | `POST /api/posts` | exists |
| Caption save | `PATCH /api/posts/:id { caption }` | exists |
| Format change | `PATCH /api/posts/:id { format }` | exists |
| Remove post | `DELETE /api/posts/:id` (soft-delete `deletedAt`) | exists |
| Revert to original | `POST /api/posts/:id/revert` (`source_meta.original`, `lib/revert.ts`) — **D3** | exists |
| "Shape this post" (softer/shorter/warmer) | `POST /api/posts/:id/shape` | exists (some instructed-regen variants still stubbed per `PlanApp.tsx` header — confirm at Stage 3.5) |
| "Talk to your plan" + extraction block | `POST /api/plan/agent` → returns proposals (`agent_proposals`, `conversations`, `agent_messages`) | exists |
| Approvals view (Approve / Discard) | `GET /api/plan/proposals`, `POST …/[id]/approve`, `…/reject`; `lib/agent/proposals.ts`; `agent_proposals` — **D1** | exists (web surface already built) |
| Notes view | `GET /api/plan/notes` + `…/[id]/dismiss`; `plan_inputs` where `source='voice'`; `listActiveNotes` — **D7** | exists — render **read-only** |
| Weekly session | `POST /api/plan/weekly-session`; `weekly_sessions` table | exists |
| Month switcher / other-cycle view | `loadCycleList`; `GET /api/plan?cycleId=` (other same-client cycles served **read-only**, `isCycleReadableByClient`) | exists |
| Tags (chips / pills / swipe "Add tag") | — | **dropped (D2)** — do not port; see D2 delta in DECISIONS |
| Publish now / "Mark approved" lock | — | **new / deferred (D6)** |
| Checklist / Tasks / rings / at-risk | `post_steps` + `step_templates` | **new (§1.1)** |

**Access paths & permissions (both preserved):**
- **Client (share link):** password-less **magic-link** token (`app_magic_link_tokens`), opaque
  token in httpOnly cookie `sprigly_app_session`, **re-verified against the DB every request**
  (revocable). Scoped to one `clientId` + `cycleId`. **Home cycle = editable** (write scope);
  other cycles of the **same client = read-only**; anything cross-client or operator-level is
  unreachable via the token. This is the surface the redesign rebuilds.
- **Operator:** **Clerk** — but on the separate **`admin` app** (`admin/src/middleware.ts`), not
  the client plan surface. (Correction to plan §1.1, which implies Clerk on the plan page.)

---

## 3. Ledger decision (D1 addendum) — `plan_activity`, not `agent_proposals`

**Requirement:** manual edits (drag-reschedule, caption save, delete, checklist ticks) stay
immediate but must land in the same history stream as approved agent changes, tagged
`origin: user`, so plan history is one stream.

**Decision: add a thin `plan_activity` table. Do NOT overload `agent_proposals`.**

Why not reuse `agent_proposals`:
- Its `conversationId` and `messageId` are **NOT NULL FKs** to `conversations` / `agent_messages`.
  A manual drag has neither. Reuse would force synthetic conversations+messages per manual action
  (polluting agent history) or making those columns nullable (breaking the invariant that every
  proposal traces to a message).
- Its `status` lifecycle is `pending→approved→rejected→applied|failed` — a *request awaiting
  review*. A manual edit is *an accomplished fact*, not a pending request; jamming it in as
  `status='applied', origin='user'` muddies every query that assumes proposals are reviewable.
- Semantics differ: a proposal is an **intent**; the ledger wants a **record of what happened**.
  Conflating them couples the review queue to the history feed.

Proposed shape (built in Stage 2, not now):
```
plan_activity: id, client_id, cycle_id, post_id (nullable), origin ('user'|'agent'),
               action ('reschedule'|'caption'|'delete'|'checklist_tick'|...),
               summary text, ref_proposal_id (nullable → agent_proposals.id when the
               activity was an approved proposal being applied), created_at
```
Manual `/api/posts/*` writes emit an `origin='user'` row directly; the proposal-apply path emits
an `origin='agent'` row with `ref_proposal_id` set. One append-only stream, both actors.

---

## 4. Deferred (decide at the relevant stage)

- **D6 — "Mark approved / read-only" lock:** needs a schema add (`approved_at` / `locked` on
  `content_cycle_posts`, or a reused `review_state` value). Build the surface without it first;
  mobile swipe-right ships with **Move alone** until it lands (D2 delta).
- **Voice session contract:** the `sprigly-voice` open-session + attach-post-ID API — resolve by
  reading that repo at the voice stage. Do not guess.

---

## 5. Reconciliation notes (nothing here contradicts a DECISION)

- The plan's §7 "Approvals — exists as operator CLI, web UI is new" is **superseded**: a
  client-scoped web approve/reject surface already ships (`/api/plan/proposals/[id]/*`).
- The plan's §1.1 "operators via Clerk on the plan page" is **imprecise**: Clerk is on `admin`;
  the client plan surface is magic-link only. No decision depends on this.
- `content_cycle_posts.status` is `planned|edited|new` (not the mockups' idea/draft/scheduled/
  published) — already handled by dropping tags (D2). No publishing state is modelled (D6).
