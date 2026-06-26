# Content-Calendar Pipeline — Step Classification Audit

**Date:** 2026-06-23
**Builds on:** `docs/integrations/content-calendar-pipeline.md` (prior report)
**Scope:** Read-only. Only findings not covered by the prior report. File paths cited throughout; assumptions flagged explicitly.

---

## Part 1 — LLM Step Classification: Generation vs Decision

### Methodology

Each skill runs as an interactive Claude Code session — there are no discrete HTTP calls to separate. For this audit, a "step" is each distinct analytical task the model performs within a skill execution. Classification:

- **GENERATION** — fixed input, fixed output shape, no control-flow influence; could be a templated Bedrock call with a stable prompt seed.
- **DECISION** — model output determines what happens next, or requires genuine semantic judgment that rules cannot substitute.
- **MIXED** — both in the same step.

Non-LLM steps (Apify fetches, cache checks, CSV writing, file reads, Python scripts) are omitted. The two Python scripts (`generate_calendar.py`, `extract_edits.py`) are confirmed pure-Python with no model calls.

---

### content-analyser (`~/.claude/skills/content-analyser/SKILL.md`)

**CA-1 — Pillar Mapping** (Step 4, per-post)

| Field | Detail |
|---|---|
| Input | Per-post fields (caption, type, engagement metrics, word count, boolean flags) + pillar definitions and key messages from `memory/content-strategy.md` |
| Output | Per-post pillar label (one named pillar or `'unmapped'`) |
| Classification | **MIXED** |
| Reasoning | Keyword matching handles unambiguous posts (~60–70%) deterministically. Ambiguous posts — a post about "feeling confident in your own skin" mapping to "Understands Real Women" vs "Stable Foundations" — require semantic brand-strategy judgment. Not fully replaceable by code. |

**CA-2 — Client Performance Synthesis** (Step 5)

| Field | Detail |
|---|---|
| Input | All scored and pillar-tagged posts for the client |
| Output | Five structured sections: top performers list, performance-by-type table, performance-by-pillar table, caption patterns, content gaps |
| Classification | **GENERATION** |
| Reasoning | Sections, format, and input are fully specified. No branching. Model fills each section from provided data. |

**CA-3 — Competitor Synthesis** (Step 6)

| Field | Detail |
|---|---|
| Input | Scored posts for each competitor account |
| Output | Per-competitor profile block (top 5 posts, type breakdown, 3–5 dominant themes, tone notes, posting frequency, engagement benchmarks) + cross-client benchmark table |
| Classification | **GENERATION** |
| Reasoning | Fixed per-competitor template. No conditional logic. Structured data in → structured analysis out. |

**CA-4 — Strategic Overlay** (Step 7)

| Field | Detail |
|---|---|
| Input | Client analysis (CA-2) + competitor analysis (CA-3) + client's content pillars + brand values and tone rules |
| Output | Three sections: (a) competitor patterns that fit client's pillars and how to adapt; (b) what competitors do that the client should NOT do; (c) untapped content opportunities |
| Classification | **DECISION** |
| Reasoning | Evaluating whether a competitor pattern "fits" a client pillar is a semantic brand-strategy judgment. No rule maps "@elevenloves posts athlete lifestyle content" to "Ivy should or should not adopt this given the Stable Foundations pillar." Requires understanding of brand positioning, value alignment, and competitive differentiation. Cannot be replaced by deterministic code. |

**CA-5 — Recommendations** (Step 8)

| Field | Detail |
|---|---|
| Input | All prior analysis sections (CA-2 through CA-4) |
| Output | 5–8 concrete recommendations, each with: action statement, supporting data citation, pillar tie, example post idea |
| Classification | **MIXED** |
| Reasoning | SELECTION of which 5–8 findings to elevate is DECISION (requires judgment about actionability, priority, and brand fit). ARTICULATION of each recommendation in the structured format is GENERATION. |

---

### voice-profiler (`~/.claude/skills/voice-profiler/SKILL.md`)

**VP-1 — Content Analysis** (Step 4)

| Field | Detail |
|---|---|
| Input | 30 most recent posts (caption text, type, date) |
| Output | Analysis across five dimensions: tone & personality, sentence & structure, vocabulary, punctuation & formatting, CTA & engagement patterns |
| Classification | **GENERATION** |
| Reasoning | Fixed content set in, fixed output dimensions. Pattern extraction from provided text. No branching. |

**VP-2 — Profile Writing** (Step 5)

| Field | Detail |
|---|---|
| Input | VP-1 analysis results; 3–5 verbatim example phrases from source |
| Output | Structured markdown channel profile block filling the exact template defined in SKILL.md |
| Classification | **GENERATION** |
| Reasoning | Fill a fully specified template from analysis input. Template structure is invariant. |

**VP-3 — Merge Operation** (Step 6)

| Field | Detail |
|---|---|
| Input | Existing `clients/{slug}/memory/voice.md` + new VP-2 profile block |
| Output | Updated `voice.md` |
| Classification | **MIXED** |
| Reasoning | CREATE and REPLACE are mechanical once the user-specified operation is known. UPDATE/merge requires DECISION: which new signals override vs. complement existing observations, which existing signature phrases to preserve when the new analysis contradicts them. |

---

### sprigly-content-plan (`~/.claude/skills/sprigly-content-plan/SKILL.md`)

**SP-1 — Plan Architecture** (Step 6)

| Field | Detail |
|---|---|
| Input | Month calendar, product/event list from `memory/context.md`, previous plan CSV, competitor analysis, meeting notes |
| Output | Month structure: total post count, launch clusters, pillar distribution, recurring series placement |
| Classification | **MIXED** |
| Reasoning | The rules (cadence, pillar %, format %, cluster structure) are fixed constraints — applying them mechanically is GENERATION-like. But allocating the post budget across the specific events of THIS month requires DECISION that the stated rules don't resolve: when a launch cluster already occupies three slots in a week that also needs a Sunday Style, whether to defer a series to preserve space. |

**SP-2 — Competitor Insight Selection** (Step 7, per-post)

| Field | Detail |
|---|---|
| Input | Full competitor analysis data (CA-2, CA-3, CA-4) + current post being planned (format, pillar, category, intent) |
| Output | One specific, data-grounded competitor insight for this post |
| Classification | **DECISION** |
| Reasoning | For each post, the model must select from available competitor data the single most relevant data point. "Most directly relevant" for the specific post's narrative intent is not field-matchable. This decision runs 16–20 times per plan. Retrieval by format/pillar could mechanically find candidate stats, but "which specific stat is the right citation for a founder-POV Reel about origin story?" requires semantic judgment. |

**SP-3 — Draft Caption Writing** (Step 7, per-post)

| Field | Detail |
|---|---|
| Input | Post brief (date, category, pillar, format, time, who posts) + full `memory/voice.md` rule set |
| Output | Full caption text in client's voice |
| Classification | **GENERATION** |
| Reasoning | The WHAT is determined by the plan architecture; the HOW is fully specified by voice.md constraints. Control flow is fixed (every post gets a caption). Pure generation with specified constraints. |

**SP-4 — Sprigly Notes Writing** (Step 7, per-post)

| Field | Detail |
|---|---|
| Input | Post brief + production requirements |
| Output | Practical notes for client contact: what to shoot, what to check, what to adapt |
| Classification | **GENERATION** |
| Reasoning | Fill practical production notes from known post requirements. No judgment about what runs next. |

**SP-5 — Content-Strategy Update** (Step 9)

| Field | Detail |
|---|---|
| Input | Completed plan statistics (post count, month, file path, anchor events) |
| Output | `## Last plan` markdown section |
| Classification | **GENERATION** |
| Reasoning | Fill fixed template with known values. Zero judgment required. |

---

### Summary Table

| ID | Step | Skill | Classification |
|----|------|-------|----------------|
| CA-1 | Pillar mapping | content-analyser | MIXED |
| CA-2 | Client performance synthesis | content-analyser | GENERATION |
| CA-3 | Competitor synthesis | content-analyser | GENERATION |
| CA-4 | Strategic overlay | content-analyser | **DECISION** |
| CA-5 | Recommendations | content-analyser | MIXED |
| VP-1 | Content analysis | voice-profiler | GENERATION |
| VP-2 | Profile writing | voice-profiler | GENERATION |
| VP-3 | Merge operation | voice-profiler | MIXED |
| SP-1 | Plan architecture | content-plan | MIXED |
| SP-2 | Competitor insight selection | content-plan | **DECISION** |
| SP-3 | Draft caption writing | content-plan | GENERATION |
| SP-4 | Sprigly Notes writing | content-plan | GENERATION |
| SP-5 | Content-strategy update | content-plan | GENERATION |

**Counts: GENERATION: 7 | DECISION: 2 | MIXED: 4**

---

### Part 1 Verdict

**(a) The chain is predominantly GENERATION.** Seven of thirteen steps are pure generation with fixed inputs, fixed output templates, and no influence on control flow. The four MIXED steps have generation as the dominant workload — the decision component in CA-1, CA-5, VP-3, and SP-1 is bounded and infrequent relative to the generation work within the same step. The two pure DECISION steps (CA-4 and SP-2) produce bounded, structured outputs that feed cleanly into subsequent generation steps.

The chain does not require an agent loop. There is no step where the model decides to invoke additional tools mid-stream, loop back based on intermediate results, or follow a conditionally-chosen path through the pipeline. Control flow through the chain is fixed and deterministic at the architecture level. A staged Bedrock pipeline — each skill maps to one or two `ctx.model.complete()` calls in sequence, following the `anatomy.md` step pattern — is architecturally valid.

**(b) The single most decision-like step is CA-4 (Strategic overlay in content-analyser).** This is the only step where the model evaluates semantic fit between a competitor's content approach and the client's specific brand strategy, positioning risk, and pillar ownership. It cannot be reduced to rules or retrieval. It runs once per analysis cycle (not per-post), produces a bounded three-section structured output, and is the natural candidate for a dedicated Sonnet call while the remaining steps use Haiku.

**(c) SP-2 (competitor insight selection) is the most frequent decision step** (16–20× per plan). It is bounded — the decision space is a finite set of competitor stats. A viable optimisation: pre-compute a competitor-stats index by `(format, pillar)` from the analysis output and inject the top-3 candidates into the SP-2 prompt as structured context, reducing it to a short-list selection rather than open retrieval.

**(d) This chain supports a deterministic Bedrock pipeline for the scheduled trigger.** The two isolated interpretation calls (CA-4, SP-2) can each be configured with a dedicated Sonnet step in `clientConfig.settings.stepModels` — the same per-step model selection mechanism already used by `sprigly-question-answerer`.

---

### Email-Adjustment Path (EA-1) — NET-NEW Step

No existing skill handles parsing a free-text change request against an existing plan. `sprigly-content-plan` generates from scratch; it reads the prior plan only to avoid title repeats. There is no `diff-against-existing-plan` step anywhere in the chain.

**Proposed EA-1 — Change-Request Parsing:**

- **Input:** Raw email body text (free-text instructions) + existing plan CSV as structured context
- **Output:** Structured edit list (JSON):

```json
{
  "operations": [
    {
      "op": "insert",
      "after_date": "2026-07-10",
      "new_post": {
        "Post Title / Theme": "Raspberry: the colourway story",
        "Category": "Product launch",
        "Pillar": "Born From Real Need",
        "Format": "Reel",
        "Posting Time": "6am",
        "Who Posts": "Sprigly",
        "Sprigly Draft Caption": "..."
      },
      "reason": "user requested launch post for new raspberry colourway"
    },
    { "op": "move", "from_date": "2026-07-14", "to_date": "2026-07-15", "reason": "user asks to move WSG post" },
    { "op": "delete", "target_date": "2026-07-21", "reason": "user asks to remove testimonial post" }
  ],
  "unresolved": ["Could not identify which post on 2026-07-14 is the WSG post — assumed Saturday post is WSG"],
  "summary": "Added 2 raspberry posts, moved WSG by one day, removed testimonial"
}
```

- **Classification:** DECISION (parse free-text intent into typed operations) + GENERATION (generate new post content for `insert` operations with voice.md applied)
- **Bounded:** Fixed JSON schema gates the output — the model can only produce `insert|replace|move|delete` with date keys; no free-form actions
- **Feeds:** Exactly the same downstream pipeline as the scheduled trigger. Deterministic Python applies the operations to the existing CSV → same `generate_calendar.py` → same xlsx delivery. The only difference from the scheduled path is the entry point.

---

## Part 2 — Prompt-Storage Convention

### What exists (confirmed from code reading)

**The `prompt_templates` table is the established convention for all Bedrock workflow prompts** (ADR 6, `docs/architecture/decisions.md`; fully documented at `docs/workflows/prompts.md`).

Confirmed pattern in every deployed workflow (`sprigly-inbox-triage.ts:52–64`):
```typescript
const template = await ctx.prompts.resolve(ctx.clientId, 'sprigly-inbox-triage', 'classify');
const prompt = fillTemplate(template, { categories: ..., voiceSample: ..., ... });
const result = await ctx.model.complete({ model: getStepModel(ctx, 'classify'), messages: [...] });
```

Prompts are seeded by SQL migrations. Confirmed seeds:
- `0004_seed_prospect_prompts.sql` — `sprigly-prospect-research` (steps: `research`, `write`)
- `0006_sprigly_meeting_prep_prompts.sql` — `sprigly-meeting-prep` (scaffold with `__PROMPT_NOT_CUSTOMISED__` sentinel)
- `0018_inbox_triage_prompts.sql` — `sprigly-inbox-triage` (step: `classify`)
- `0023` — `sprigly-question-answerer` (steps: `reformulate`, `compose`)

**Two-tier prompt pattern, confirmed:**
- **Tier 1 (tunable text):** User-visible prompt body → `prompt_templates` (per-client overridable, live-editable via `/admin/prompts`, versioned)
- **Tier 2 (structural constants):** System prompt logic hardcoded in TS (e.g. `getStepModel()` for model selection, XML tag delimiters in the triage classify prompt, JSON schema specification)

**`prompt_templates` resolver — confirmed gotchas** (`docs/workflows/prompts.md`):
- Missing global default throws immediately on first run — migrations are not optional
- `fillTemplate` silently drops unknown `{{variable}}` names (renders as empty string; no warning)
- Rollback = insert a new row with old text (gets next version number); no one-click rollback
- No prompt preview before running — admin UI shows unsubstituted `{{variables}}`

### Claude Code skill prompts

Skills embed their prompts inline in `SKILL.md` files at `~/.claude/skills/{name}/SKILL.md`. These are instruction documents for interactive Claude Code sessions. They have **no connection** to `prompt_templates`. The engine's Postgres DB is not accessible to Claude Code skills — they execute on the local Mac; `prompt_templates` is on Railway's Postgres.

### Is a shared registry possible?

No existing mechanism bridges the two. Options:

| Option | Description | Feasibility |
|--------|-------------|-------------|
| **Dual maintenance (recommended near-term)** | SKILL.md is the authoring surface (fast iteration); `prompt_templates` is the production surface. When a SKILL.md prompt stabilises, extract the relevant section into a migration seed. Document the expected output contract (JSON schema, column names) as the coupling point — not the prompt text itself. | Viable immediately. Acknowledge drift risk. |
| Extract prompt files | Split SKILL.md into instruction prose + `prompts/{step}.txt` files; Bedrock job reads same file. Requires Railway worker to access skill files. | Blocked by worker filesystem access; resolvable via Drive, but adds complexity. |
| DB-backed SKILL.md | SKILL.md references a `prompt_templates` row by ID; Claude Code looks it up via MCP or API call. | Net-new tooling; not supported today. |

**Current state: SEPARATE, no bridge.** The Bedrock jobs for `voice:ingest`, `calendar:generate`, `calendar:detect-edits`, and `calendar:adjust` will each need their own prompt seeds in `prompt_templates` migrations. These will inevitably drift from SKILL.md over time unless the dual-maintenance convention is followed.

**The coupling point to maintain:** not prompt text verbatim, but the **output contract** — what JSON schema, what column names, what field semantics. If both SKILL.md and the `prompt_templates` seed specify "output must be a JSON array of `{op, target_date, new_post, reason}` objects," they can diverge in prose without breaking the pipeline. Document the contract in the workflow's `docs/workflows/existing.md` entry, not in comments inside the prompt text.

---

## Part 3 — Google Drive

### Confirmed: Drive does not exist

Prior report confirmed zero Drive code in the engine. This session confirms additionally:

**`setup-gmail-oauth.ts:11–15` — OAuth scopes, confirmed exact:**
```typescript
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];
```
No Drive scope (`drive.file`, `drive.readonly`) is requested or stored. This was listed as an assumption in the prior report — it is now **confirmed from source code**.

**`packages/oauth-tokens/src/types.ts:1` — `OAuthProvider` type:**
```typescript
export type OAuthProvider = 'gmail' | 'outlook' | 'slack';
```
No `'drive'` type variant. Extension requires modifying this type and the DB schema's `provider` column.

**Worker `index.ts` — no Drive client, no Drive watcher.** Five workflows registered: `blog-post`, `prospect-research`, `inbox-noop`, `inbox-triage`, `question-answerer`. No Drive source, no `drive` SourceType registration.

### What adding Drive would take

**Reused without change:**
- KMS envelope encryption: `storeTokens()` / `getTokens()` in `packages/oauth-tokens/` — same pattern for any Google OAuth token bundle
- `oauth_connections` table — extend `OAuthProvider` type to include `'drive'`, or add Drive scope to the existing Google OAuth connection (one row can hold multiple scopes; the `scopes: string[]` field already stores scope strings as an array)
- `processed_external_ids` — same dedup table, `source: 'drive'` for changed-file event dedup
- BullMQ job enqueue — same `queue.add('process', { eventId, clientId })` pattern
- `googleapis` package — already used in `digest-sender.ts` and `setup-gmail-oauth.ts`; `google.drive()` client follows the same auth pattern as `google.gmail()`

**Net-new (with effort):**

| Component | Effort | Notes |
|-----------|--------|-------|
| Drive OAuth setup script (`setup-drive-oauth.ts`) | XS | Copy `setup-gmail-oauth.ts`, replace SCOPES with `drive.file`, replace provider with `'drive'` |
| `OAuthProvider` type extension | XS | Add `'drive'` to `packages/oauth-tokens/src/types.ts` + DB schema |
| Google Drive API client (`packages/sources/src/drive/drive-client.ts`) | S | `drive.files.get`, `drive.files.list`, `drive.files.create`, `drive.files.update` |
| New `drive` SourceType + registration in worker | S | Add to enum; no `DriveWatcher` needed initially (polling rather than push is a simpler first pass) |
| Drive push notification channel + renewal | M | `drive.changes.watch()` registers a webhook channel; channels expire (max 7 days); renewal cron needed; requires an inbound HTTP endpoint |
| Webhook listener endpoint | M | Worker has no inbound HTTP server. Simplest path: add a Next.js API route to `apps/web` that validates the webhook and calls `queue.add()`. Reuses existing `apps/web` deployment. |
| Drive file read (config JSON, CSV, xlsx download) | S | `drive.files.get({ fileId, alt: 'media' })` once client is built |
| Drive file write (voice.md, edits JSON upload) | S | `drive.files.create` or `drive.files.update` with media upload |
| `client_channels.drive_folder_id` populated at onboarding | S | Admin UI form or migration seed |

**Total effort: M-L.** The push notification / webhook infrastructure is the hardest piece. File read/write is straightforward once the client and auth are in place.

### Railway outbound network access

Not a constraint. The worker has standard outbound HTTPS access. Calls to `googleapis.com` from the worker work today — confirmed by `digest-sender.ts` and `review/[token]/actions.ts` which both call `google.gmail()` from inside Railway containers.

### Drive as the shared filesystem

This resolves the blocking problem identified in the prior report. If `clients/{slug}/` moves to Google Drive:
- John's Mac (skill execution) reads/writes via Drive API or mounted Drive
- Railway worker (job execution) reads/writes via Drive API using stored OAuth tokens
- Both access the same files without sharing local disk

The `calendar-config.json`, plan CSVs, and xlsx workbooks can all live in a per-client Drive folder. `voice.md` lives there too (the Bedrock pipeline would write `voice_snapshots.snapshot_md` to Postgres as the rollback-safe version and Drive as the consumable file accessible to Claude Code skills).

---

## Part 4 — Channel / Folder Mapping

### How `clientId` is resolved today

`pollAllClients()` loads all active `oauth_connections` records and calls `poll(clientId)` for each. The `clientId` is known from the OAuth connection before examining any email content. `oauth_connections.email_address` identifies which Gmail address was authorised.

For the calendar pipeline's email-return route: the edited xlsx arrives at the monitored Gmail address; the poller knows the `clientId` from the connection; a routing rule on subject (`contains: 'Content calendar'`) routes to `calendar:detect-edits`. No content-based client resolution needed.

### What's missing for Drive

The worker needs to know: "for client X's Instagram channel, which Drive folder ID contains the calendar files?" This mapping does not exist in any table today.

- Derived from Drive: impossible (you need the folder ID to find Drive)
- Derived from `clients.settings` JSONB: technically possible but fragile — querying JSONB fields for a critical lookup is not consistent with the rest of the schema
- Correct home: a dedicated config table

### Proposed `client_channels` table

```sql
-- packages/db/migrations/0025_client_channels.sql
-- (Exact migration number TBD — check current highest migration before numbering)
CREATE TABLE IF NOT EXISTS "client_channels" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now(),
  "client_id"         uuid NOT NULL REFERENCES "clients"("id"),
  "channel"           text NOT NULL,          -- 'instagram', 'linkedin', etc.
  "inbound_address"   text,                   -- expected sender email for return-xlsx validation
  "drive_folder_id"   text,                   -- Google Drive folder ID for this channel
  "status"            text NOT NULL DEFAULT 'active',
  CONSTRAINT "client_channels_unique" UNIQUE ("client_id", "channel")
);
```

**Fit with existing schema conventions:**
- Same base columns (`id` UUID gen_random_uuid(), `created_at`, `updated_at` as `timestamp`) as every other table — confirmed from `docs/reference/database-schema.md`
- FK to `clients.id` — same pattern as all other tables in the schema
- `status` with `active|paused|archived` string values — same as `clients.status` and `oauth_connections.status`
- UNIQUE on `(client_id, channel)` — same pattern as `triage_configs`'s one-row-per-client constraint
- Explicit columns rather than JSONB — consistent with ADR 2 preference for explicit columns when querying is required

**Population:** At client onboarding, the admin sets `drive_folder_id` manually (admin UI form or migration seed). This is NOT derived from Drive — it IS the pointer to Drive. No circular dependency.

**The `inbound_address` column:** Optional sender validation. The worker can check that the return-xlsx email sender matches `inbound_address` before processing. Not required for routing (`clientId` is already known from the OAuth connection), but provides a safety check: an unexpected sender returning an xlsx file will not trigger a voice update for the wrong client.

---

## What This Means for the Build

**The GENERATION-dominant verdict (Part 1) has a direct architectural consequence:** neither trigger path requires an agent loop.

**Scheduled monthly trigger (`calendar:generate`):**
Use a staged Bedrock pipeline. Each step in the chain maps to one or two `ctx.model.complete()` calls following the `anatomy.md` step pattern. CA-4 (strategic overlay) is the one step that warrants Sonnet; all others can use Haiku. Control flow through the full chain is fixed — no conditional branching at the model layer. This is standard `pnpm new-workflow` territory.

**Email-adjustment trigger (`calendar:adjust`):**
EA-1 is a single bounded Sonnet step with a structured JSON output schema. Output gates the pipeline: apply operations to existing CSV deterministically → `generate_calendar.py` → xlsx delivery. One model call, one Python subprocess, one delivery.

**Net-new platform capabilities, ordered by dependency:**

1. `client_channels` table — migration (check current highest number before naming). Everything else depends on knowing the Drive folder ID.
2. `voice_edits`, `voice_snapshots`, `voice_ingestion_runs` tables — voice persistence before voice jobs.
3. Google Drive OAuth scope extension — `setup-drive-oauth.ts` requesting `drive.file`; extend `OAuthProvider` type; existing `storeTokens()` handles token storage.
4. Google Drive API client — `packages/sources/src/drive/drive-client.ts`. Prerequisite for all Drive file operations.
5. Drive push notification channel + webhook endpoint — `packages/sources/src/drive/drive-watcher.ts` + Next.js API route in `apps/web` calling `queue.add()`. Effort: M.
6. `voice:ingest` workflow — `pnpm new-workflow voice-ingest`. One Haiku step; writes to `voice_snapshots`; regenerates Drive copy of `voice.md`. Smallest of the three jobs; good first Bedrock integration to validate the Drive file-write path.
7. `calendar:detect-edits` workflow — `pnpm new-workflow calendar-detect-edits`. Drive file read for returned xlsx; Python subprocess for `extract_edits.py`; writes `voice_edits` rows; chains `voice:ingest`.
8. `calendar:generate` workflow — `pnpm new-workflow calendar-generate`. Runs the full CA→VP→SP chain as Bedrock steps; Python subprocess for `generate_calendar.py`; delivers xlsx via `gmail-reply-with-attachment` (xlsx MIME type — `attachmentMimeType` field already exists in destination settings).
9. `calendar:adjust` workflow — `pnpm new-workflow calendar-adjust`. EA-1 Sonnet step; applies structured ops to existing CSV; chains the xlsx delivery step.
10. Prompt seeds in `prompt_templates` for each new workflow step — one migration per workflow, seeded with placeholder text, then written to real prompts before deployment. Each seed must include a global default row (`client_id = NULL`) or every run throws on first execution.
