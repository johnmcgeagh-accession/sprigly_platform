# Draft-Plan & Intake Arc — Build Plan

**Goal:** Invert the intake flow. Client receives a beat-level draft plan
grounded in their own `ig_posts` history before the first Ask email; intake
becomes reaction to a concrete draft (one surface, agent-routed); approval
triggers full generation (captions + hooks + reel scripts); a temperature
dial governs how many slots go to experiments from the ideas backlog
(client + competitor sourced).

**North star UX moment:** client types one sentence → plan visibly reshapes
with traceable causality. Every beat rationale is computed evidence, never
model narration.

## Locked decisions

- **D1:** Draft beats are `content_cycle_posts` rows, `status='draft'`,
  with `beat_meta` JSONB ({slotType, rationaleEvidence, sourceRef?,
  assumptions?}). No new table. Drafts are invisible to every reader
  except deliberate draft-view readers, enforced via `excludeDraftPosts()`
  applied per call site. 'draft' is a first-class member of PostStatus so
  stray rows are labelled honestly, never coerced to 'planned'.
- **D2:** Draft assembles at the Ask touch; the Ask email carries it
  ("we've drafted {{month}}"). Stale trawl (proxied via ig_posts.updated_at,
  14-day threshold) is a logged warning, never a blocker. Assembly failure
  never blocks the Ask touch — the plain Ask email sends.
- **D3:** If the client never approves before cutoff: auto-approve the
  draft (marked auto_approved), phase 2 fires, plan-ready copy notes "we
  went ahead with the draft." Precedent: the cutoff baseline run already
  proceeds on empty intake.
- **D4:** Temperature is allocation-only this arc: experiments =
  round(temp × slots), candidates from plan_inputs ideas ranked
  client-first then engagement; empty backlog or null temperature resolves
  to all-proven. The graduation loop (experiment → measured → proven) is
  DEFERRED until the measurement substrate exists: a planned↔published
  join (ig_posts has no post ID today) and persisted pillar weights
  (sharePct — persisted as of Build A).

## Build sequence

- **Pre-A (done):** structural-merge fix — regeneratePost merges input
  structural fields (date+day, format, pillar conditionally per sentinel
  rules) over model output at its return; repair can no longer silently
  mutate structure. Sentinel producers: 'New idea' (mutations.ts),
  'Weather' (weekly-session.ts).
- **A (done):** draft assembly engine — deterministic skeleton (pillar
  sharePct × cadence × format mix, engagement-weighted), allocator
  interface (temp-aware, resolves to all-proven today), rationaleEvidence
  structured-only, assumption flags, thin-data template fallback with
  honest evidence, single restate-only LLM phrasing pass with
  deterministic fallback, Ask-touch trigger with failure isolation.
- **B:** draft beat surface — deliberate loadDraftBeats reader, explicit
  readability predicate for draft-only cycles, client draft view (mobile-
  first, rationale rendered deterministically from evidence, experiment
  badges, assumption prompts display-only), deterministic structural
  mutations (move, swapFormat, drop, add, reorder-if-meaningful) guarded
  to draft rows in pre-cutoff windows.
- **C:** intake routing + diff — second classifier axis on the intake
  route: month-scoped inputs regenerate affected beats only and produce a
  visible diff; evergreen inputs land in plan_inputs backlog
  (source, lifecycle status: candidate/used/measured/proven/declined/
  stale) with a visible routing receipt and one-tap "add to this month"
  override. Ambiguity defaults to backlog (asymmetric misroute cost).
- **D:** approval + phase 2 — explicit "looks good" → drafts become the
  committed plan; generation consumes beats as fixed structure via the
  shipped shape.ts pattern fanned out (addGeneratingPost +
  startPostGeneration per slot); captions + carousel/reel hooks + reel
  scripts; per-post on-demand regeneration; invalidation = structure
  change post-approval regenerates affected posts only; draft
  supersession lifecycle owned here (including the Build A known interim
  state); plan-merge hook/script blindness fixed here.
- **E:** temperature live + backlog resurfacing — allocator fed by real
  plan_inputs candidates incl. source='competitor'; experiment beats
  carry evidence rationales citing their source; auto-temperature warm
  start deferred until candidates exist.
- **F (parallel):** reels transcription (Apify payload → transcript column,
  per I-4 findings) + spoken-register voice facet; admin config flags
  voice_intake_enabled / reels_script_enabled / temperature per client.

## Standing constraints

- Migrations hand-applied via psql, journal frozen at 0026, schema.ts is
  source of truth, never drizzle-kit generate/migrate.
- No push/promote within sessions. Sandbox clients only (earlofeastlondon,
  sprigly dogfood); IVY-t flags stay off; delivery pin stays until the
  three go-live gates clear.
- Rationales are computed evidence phrased at most — never model
  narration. Absence reported as absence, never as fact.
- Every build: investigation-before-build, separate reviewable commits,
  report file with running-code evidence, stop conditions honoured.

## Known interim states & follow-ups

- Whole-plan regen on a cycle holding drafts produces generated posts
  alongside surviving invisible drafts until Build D owns supersession.
- Staleness proxy: no trawl_runs table; ig_posts.updated_at inference can
  false-positive stale. Backlog: trawl_runs table (also graduation
  substrate).
- weekly-session add_post writes unrepaired sentinel pillar ('Weather')
  into content_cycle_posts unconditionally — backlog, interacts with
  sentinel handling.
- Repair prompt still asks the model to hold title/postingTime/whoPosts
  (content, unenforced) — add a comment distinguishing merge-enforced vs
  prompt-requested fields.
- plan.ts coerce-unknown-status-to-'planned' behaviour is a smell —
  backlog, do not change casually.
