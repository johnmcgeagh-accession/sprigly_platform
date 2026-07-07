# Sprigly Plan Surface Redesign — Implementation Plan

**Audience:** Claude Code, working in the Sprigly platform monorepo.
**Goal:** Ship the redesigned client-facing plan experience — mobile and desktop — fully wired to existing platform functionality, behind a feature flag, UAT-verified, and ready for production.
**Design references (source of truth for look, interaction, and copy):**
- `design/reference/sprigly-mockup.html` — mobile experience
- `design/reference/sprigly-desktop.html` — desktop experience

Commit both reference files to the repo first. Every visual and interaction decision in this plan is embodied in those files; when this document and the mockups disagree on a visual detail, the mockups win. When either disagrees with an existing backend contract, the backend contract wins and you flag the mismatch in `design/DECISIONS.md`.

---

## 0. Working rules

1. Work on branch `redesign/plan-surface`. Conventional commits, one logical change per commit.
2. **Never invent a backend.** Every feature below maps to existing platform functionality. Phase 1 exists to find the real names, routes, and schemas. If something genuinely has no backend (the task/checklist model is the known case), it gets a migration + API in Phase 2 — nothing else does.
3. All new UI lives behind a feature flag `plan_redesign` (per-tenant). The existing plan page keeps working untouched until cutover.
4. The client plan page is accessed by share link (tokenized, no password) as well as by authenticated operators via Clerk. Preserve both access paths and their permission differences throughout.
5. Respect the platform's agent guardrails in the UI: proposals are stored, never auto-run; the per-session mutation cap applies to anything the agent queues; approval is an explicit human action.
6. Verify every phase with Playwright before moving on. Add tests to the existing test setup; if none exists for the web app, create `e2e/plan-redesign/` with a Playwright config scoped to the flag-enabled state.
7. Keep a running `design/DECISIONS.md` — every assumption you had to make, every mismatch between mockup and backend, every deferred item.

---

## 1. Phase 1 — Discovery & mapping (no code changes)

Produce `design/AUDIT.md` answering all of the following, with file paths and route names from the actual repo. Do not start Phase 2 until this exists.

### 1.1 App structure
- Where does the current client plan page live (Next.js route, components)? How is the share-link token validated and what does it authorize?
- What is the component/styling convention (CSS modules, Tailwind, styled-components)? The redesign follows whatever exists; do not introduce a new styling system.
- Where are brand tokens currently defined, if anywhere?

### 1.2 Data model (Postgres)
Map each of these to real tables/columns:
- **Posts / planned content** — the entity behind calendar chips. Likely owned by the content_cycles domain. Record: identifier, scheduled date, title/angle, caption, content type (single image / carousel / reel), channel, status enumeration (map to the mockups' idea → draft → scheduled → published), edited/original caption fields if versioning exists.
- **Proposals** (store-don't-run) — the table the planning agent writes to and the operator CLI approves from. Record: schema, status values, the apply mechanism, and where the per-session mutation cap is enforced.
- **Notes / captured context** — the voice-learning Derived Rules store and/or capture log. Determine which is the right source for the client-visible "Notes" list (likely a filtered view of derived rules with a client-safe rendering).
- **Clients/tenants** — how IVY-t is modelled; how per-tenant flags are stored.

### 1.3 Services & APIs
- Planning agent entry point: how is a natural-language ask submitted today, and what does the extraction output look like (actions vs notes vs questions)? The desktop mockup's "From your ask, Sprigly took" block renders exactly this output — confirm its shape.
- `sprigly-voice`: current interface (WebSocket? HTTP?) for Deepgram Nova-3 streaming + Haiku cleanup. What does a client need to open a session, and can a post ID be attached as context?
- Caption rewriting ("Shape this post"): which Bedrock model/prompt path does caption generation use today (the voice pipeline uses Haiku cleanup; the Excel pipeline used Sonnet). Reuse, don't duplicate.
- Publishing: what does "Publish now" actually call (Instagram API integration status), and is it safe to expose to clients or operator-only?
- Question answering: the pgvector Question Answerer workflow — endpoint and response shape, for inline answers to "question"-classified asks.

### 1.4 Known gaps (expected result of audit)
- **Production checklist / tasks** — the work-back model (steps with lead times per content type, done flags, at-risk derivation) does not exist in the platform. It is the one net-new data model in this project.
- **Approval surface** — exists as operator CLI; the client/operator web UI for it is new, the underlying proposal store is not.

---

## 2. Phase 2 — Foundations

### 2.1 Design tokens
Create a single token source (following the repo's styling convention) from the mockups' `:root` block:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F5F4F2` | app background |
| `--surface` | `#FFFFFF` | cards, rail, sheets |
| `--coral` / `--coral-strong` / `--coral-tint` | `#E87766` / `#FF6F62` / `#FCE9E5` | brand accent, active states |
| `--slate` / `--slate-600` / `--muted` | `#334155` / `#475569` / `#8A94A3` | text hierarchy |
| `--ink` | `#1B2430` | dark surfaces (agent FAB) |
| `--amber` / `--amber-tint` | `#F59E0B` / `#FDF0D8` | at-risk / attention |
| `--red` | `#B23A2E` | destructive |
| `--line` / `--line-soft` | `#ECEAE6` / `#F1EFEC` | borders, dividers |

Type: Plus Jakarta Sans (UI) + DM Serif Display (display, dates, headings) — self-host via `next/font`, do not load from Google at runtime. `color-scheme: only light` on all plan pages (existing brand rule).

Note the known brand discrepancy: marketing uses `#E87766`, HTML theme-color uses `#FF6F62`. The mockups use both deliberately (base + strong). Record in DECISIONS.md; do not resolve unilaterally.

### 2.2 Shared component library
Build once, use on both breakpoints. From the mockups:
`PostChip` (channel icon + two-line title + type label + NEW/review markers), `ProgressRing` (done/total, risk state), `ChecklistItem` (with due chip states: Late / Today / by-date / Done), `TagPill` (status set: Draft, Scheduled, Needs approval, Published), `Sheet` (bottom sheet, mobile pattern), `Drawer` (right drawer, desktop editor), `Scrim` (heavy + soft variants), `Toast`, `SegmentedControl`, `MonthWheelPicker` (mobile), `ExtractionSummary` (the "From your ask, Sprigly took" rows), `ProposalCard` (Approve/Discard), `NoteRow`, `ChannelIcon` (instagram now; email/x/linkedin defined for later).

### 2.3 Data layer — the one new model
Migration for production checklists:

```
post_steps: id, post_id (FK), label, lead_days int, done bool,
            done_at timestamptz null, sort int, created_by (agent|user)
step_templates: content_type, steps jsonb  -- Reel: script(4), shoot(3), edit(2), caption(1)
                                           -- Carousel: source(3), frames(2), caption(1)
                                           -- Single image: source(2), caption(1)
```

Derivations are computed, never stored: `due_date = post.scheduled_date - lead_days`; a step is *at risk* if not done and due_date < today; a post's ring is done/total of its steps. API: CRUD on steps + a `POST /posts/:id/checklist:generate` that instantiates from template (this is also the endpoint the agent's "build checklist" proposal applies through — so even agent-generated checklists flow through the proposal → approve path when initiated by the agent, and directly when clicked by the user in the editor).

### 2.4 Feature flag & routing
- `plan_redesign` flag, per-tenant, default off. IVY-t on in UAT first.
- One responsive app, not two: the plan route renders `<PlanDesktop>` ≥1080px and `<PlanMobile>` below, sharing all state hooks and the component library. The mockups differ structurally (rail+drawer vs strip+sheets), so this is a layout split, not CSS-only responsiveness.

**Acceptance:** tokens render on a bare page; migration up/down clean; flag toggles between old and new page with zero change for flag-off tenants.

---

## 3. Phase 3 — Desktop experience (`sprigly-desktop.html` as spec)

Build in this order; each item lists its backend wiring.

### 3.1 Shell
Top bar (brand left, "Plan workspace" right). Right rail: client card ("Ivy T · {viewed month}", share-link context), nav (Calendar / Timeline / Tasks / Approvals / Notes) with counts (month post count; overdue "N late" amber; approvals count; notes count), collapse toggle → 72px icon rail with coral attention dots (Tasks-late, Approvals, Notes only — not Calendar). "+ Add a post". Agent FAB bottom-right, offset from rail width, amber badge = pending proposals.

### 3.2 Calendar view
Month grid from real posts (`GET` plan for month). Leading empty cells become the month summary card ("{n} posts planned" / "{k} behind schedule — see Tasks" from the at-risk derivation). Chips per §2.2; drag-to-reschedule calls the existing post-update endpoint (direct user action — not a proposal). Empty days show dashed ＋ → creates an idea-status post on that date. Month chevrons + Today. **Wiring:** posts list, post date update, post create.

### 3.3 Timeline view
Chronological cards, coral Today divider, filled/hollow dots past/future, NEW / quiet EDITED badges (EDITED = caption differs from original, per the versioning fields found in audit). **Wiring:** same posts list.

### 3.4 Tasks view
Summary card + Overdue / Next 7 days / Later groups from `post_steps` derivations. Checking a circle completes the step; row click opens the post editor. **Wiring:** steps API (§2.3).

### 3.5 Editor drawer
Right drawer, soft scrim, plan visible behind. Contents: format/status/date header, EDITED/NEW badge, Revert (restores original caption), caption textarea + Save, Remove post, media placeholder (drop-zone stub — actual media upload is out of scope, mark in DECISIONS.md), checklist section (tick, add step, "✨ Build checklist" when empty), "Shape this post" (input + softer/shorter/warmer chips → the caption-rewrite service from audit §1.3; result replaces textarea content unsaved, so the user reviews before Save — this mirrors "rewrites it in your voice and checks it before it lands. Revert always returns to the original"). **Wiring:** post get/update/delete, steps API, rewrite service.

### 3.6 Agent sheet ("Talk to your plan")
Bottom sheet: title, explainer, single input with mic + "✨ Ask Sprigly". Submit → planning agent entry point. Render the agent's extraction output in the persistent `ExtractionSummary` block (Action → Approvals; Note → Notes; Question → answer inline beneath the row via the Question Answerer). Sheet stays open; rail Approvals/Notes flash + counts update. **The mockup's keyword classifier is a stand-in — delete it; the real extraction comes from the agent response.** Mic button opens a `sprigly-voice` session and streams the transcript into the same input (one path for typed and spoken asks). Enforce and surface the session mutation cap: if the agent declines to queue more actions this session, say so in the extraction block.

### 3.7 Approvals view
Proposal cards from the real proposals table, Approve/Discard calling the same apply/reject mechanism the operator CLI uses (extract that logic into a service function if it currently lives only in the CLI — the CLI then calls the same function). **Permissions decision, record in DECISIONS.md and confirm with John before building:** default — share-link clients can approve proposals scoped to their own plan content; anything infrastructure-level remains operator-only and is filtered from the client view.

### 3.8 Notes view
Client-safe rendering of captured context per audit §1.2. Read-only list for now.

**Acceptance (Playwright, flag on, seeded tenant):** month renders with correct counts; drag reschedules and persists; editor round-trips caption save/revert; checklist generate/tick persists and updates ring + Tasks view; agent ask produces extraction block and a real proposal; approving the proposal mutates the plan; rail flash and counts correct; collapse behaves; no console errors.

---

## 4. Phase 4 — Mobile experience (`sprigly-mockup.html` as spec)

Same hooks and components, mobile layout:

1. **Locked chrome:** brand row, month switcher (chevrons + label → bottom-sheet wheel picker), rolling 7-day week strip (dots = has posts), Plan|Tasks segmented control. Only the feed scrolls.
2. **Agenda feed:** day sections for the selected week; scroll-spy updates strip selection (rAF-throttled, spy-locked during programmatic scrolls — port the mockup's logic, it handles the webview edge cases); tapping a strip day scrolls the feed container explicitly (not `scrollIntoView`).
3. **Swipe cards:** axis-intent locking (`pan-y` + the lock thresholds from the mockup) and rubber-band overshoot. Left: Edit / Delete. Right: Publish now / Add tag. Publish gates on the audit §1.3 answer — if Instagram publishing isn't client-safe, the action queues a proposal instead and the button copy says "Request publish".
4. **Tasks tab:** week-scoped work-back board (Overdue / Due today / This week).
5. **Editor sheet:** ~85% bottom sheet — caption, when, tags, checklist, "Speak to this post".
6. **Voice overlay:** full-screen, fully opaque canvas, pulsing mic, streaming transcript from `sprigly-voice`, context chip when opened from a post ("On: {title}" — pass post ID into the voice session so "this post" resolves). Action pills come from the agent's proposed intents, confirmed by tap = approval of that single proposal.

**Acceptance:** all Phase 3-equivalent flows pass on a 390×844 viewport; swipe gestures don't fight vertical scroll (axis-lock test with synthetic diagonal pointer events); voice overlay opens with and without post context.

---

## 5. Phase 5 — Hardening

1. **Accessibility:** keyboard paths for everything pointer-driven (drag-reschedule gets a fallback: editor date field; swipe actions get an overflow menu equivalent), focus trapping in sheets/drawer, `prefers-reduced-motion` disables pulse/flash animations, ARIA on the segmented control, week strip, and proposal actions. Visible focus rings throughout.
2. **Performance:** month payload in one query; steps batched with posts; no layout thrash from the scroll-spy (already rAF'd); fonts self-hosted with `display: swap`; Lighthouse ≥ 90 performance / ≥ 95 accessibility on both layouts.
3. **Error & empty states:** every list has the empty copy from the mockups; agent/voice failures degrade to typed input with an inline error; share-link expiry shows a branded message.
4. **Security review:** share-link token cannot reach operator-scoped proposals, other tenants' data, or the rewrite service beyond its own posts; rate-limit agent asks per token; voice sessions authenticated per tenant.
5. **Telemetry:** events for view switches, proposal approve/discard, agent asks (with extraction mix), voice session start/complete, checklist completion — whatever analytics layer exists; if none, add minimal server-side event logging.

---

## 6. Phase 6 — UAT & production

1. Deploy flag-on for IVY-t in the UAT environment (Clerk dev instance, "Sprigly UAT" OAuth, KMS `sprigly-uat-oauth-tokens`). Seed with a realistic July plan.
2. Run the full Playwright suite against UAT, both layouts.
3. Manual UAT script for John + Sally: plan a week on mobile including one voice ask; on desktop, ask for a multi-part change (action + note + question), verify extraction, approve from Approvals, confirm calendar updates; complete a checklist through Tasks; drag-reschedule; revert a shaped caption.
4. Fix list → re-run suite → tag release.
5. Production: deploy flag-off, enable for IVY-t, monitor telemetry + error rates for one week, then default-on for new tenants. Keep the legacy page routable for one release as rollback.

---

## 7. Feature ↔ platform map (summary)

| UI feature | Backend | Status |
|---|---|---|
| Calendar/timeline posts | content plan entities (audit §1.2) | exists |
| Drag reschedule, caption save, delete | post update endpoints | exists |
| Shape this post | caption-rewrite Bedrock path | exists — reuse |
| Checklist / Tasks / rings / at-risk | `post_steps` + templates | **new (§2.3)** |
| Talk to your plan + extraction block | planning agent, store-don't-run | exists — new surface |
| Approvals view | proposals table + CLI apply logic | exists — extract to service, new surface |
| Notes view | derived rules / capture log | exists — client-safe view |
| Mic / voice overlay | sprigly-voice (Deepgram + Haiku) | exists — attach post context |
| Inline question answers | Question Answerer (pgvector) | exists |
| Publish now | Instagram integration | audit-dependent — may become a proposal |
| Mutation cap surfaced in UI | existing session cap | exists — expose in responses |

---

## 8. Open questions for John (answer before the relevant phase)

1. Approval permissions: can share-link clients approve plan-scoped proposals, or does everything remain operator-approved with clients seeing a read-only "waiting on Sprigly" state? (Blocks §3.7.)
2. Is Instagram publishing live enough to expose "Publish now" to clients, or proposal-gated? (Blocks §4.3.)
3. Should the Notes view show raw captured quotes, the derived rules, or both? (Blocks §3.8.)
4. Multi-channel: posts get a `channel` field now (defaulted `instagram`) so the icon system is real — confirm.
5. Legacy plan page: hard cutover after one release, or keep selectable per tenant?
