# Content-Calendar Pipeline — Architecture Audit

**Date:** 2026-06-23  
**Branch:** fix/mc-alignment  
**Scope:** Read-only. No code was modified. All assertions cite confirmed file paths or are flagged as assumptions.

---

## Table of Contents

1. [Part 1 — Skills Chain Trace](#part-1--skills-chain-trace)
2. [Part 2 — Existing Platform](#part-2--existing-platform)
3. [Part 3 — Gap Analysis and Proposal](#part-3--gap-analysis-and-proposal)
4. [Verdict](#verdict)

---

## Part 1 — Skills Chain Trace

### Skills inventory

Skills live at `~/.claude/skills/`. The four skills relevant to this pipeline are:

| Skill | File | LLM? | Bedrock model |
|---|---|---|---|
| `content-analyser` | `~/.claude/skills/content-analyser/SKILL.md` | Yes — Claude (Claude Code context, not a BullMQ Bedrock job) | N/A — runs interactively |
| `voice-profiler` | `~/.claude/skills/voice-profiler/SKILL.md` | Yes — Claude (interactive) | N/A |
| `sprigly-content-plan` | `~/.claude/skills/sprigly-content-plan/SKILL.md` | Yes — "LLM-driven skill. Every step requires reasoning" (interactive) | N/A |
| `sprigly-content-calendar` | `~/.claude/skills/sprigly-content-calendar/SKILL.md` | **No** — both scripts are "pure Python — no LLM, deterministic, cheap to run" | N/A |

**Important distinction:** These are Claude Code skills — they run in an interactive session with Claude as the reasoning engine. They are not wired into the BullMQ/Railway engine. The engine handles email-triggered automated workflows (blog posts, prospect research, inbox triage). These are separate systems.

---

### Step-by-step chain

**Step 1 → `/content-analyser`**

| Aspect | Detail |
|---|---|
| Inputs | `clients/{slug}/memory/content-strategy.md` (pillars, competitors); Apify API key from `$SPRIGLY_ROOT/.env` |
| Reads voice.md | No |
| Apify actors | `apify/instagram-scraper`, `apify/linkedin-post-search-scraper` (see `~/.claude/skills/content-analyser/references/apify-actors.md`) |
| Cache | `clients/{slug}/knowledge/fetched/instagram-{handle}-YYYY-MM-DD.json`; competitor data in `competitors/` subfolder; stale > 30 days |
| LLM calls | Yes — Claude analyses scored posts, maps to pillars, writes strategic overlay |
| Outputs | `clients/{slug}/knowledge/analysis/competitor-analysis-{channel}-YYYY-MM-DD.md` + `-summary.md`; updates `memory/content-strategy.md` with `## Last analysis` pointer |
| Confirmed live for ivy-t | `clients/ivy-t/knowledge/analysis/competitor-analysis-instagram-2026-06-23.md` and `-summary.md` exist |

**Artifact out of Step 1:** `knowledge/analysis/competitor-analysis-{channel}-YYYY-MM-DD-summary.md`

---

**Step 2 → `/voice-profiler`**

| Aspect | Detail |
|---|---|
| Inputs | Social content fetched via Apify (same cache as content-analyser) or manually pasted |
| Reads voice.md | Yes — reads existing `clients/{slug}/memory/voice.md` before CREATE/UPDATE/REPLACE |
| LLM calls | Yes — Claude extracts tone, vocabulary, structural patterns; writes profile block |
| Outputs | `clients/{slug}/memory/voice.md` (one file, multiple `## {Channel} — Voice Profile` blocks) |
| Confirmed live for ivy-t | `clients/ivy-t/memory/voice.md` exists |

**Artifact out of Step 2:** `clients/{slug}/memory/voice.md`

---

**Step 3 → `/sprigly-content-plan`**

| Aspect | Detail |
|---|---|
| Reads voice | Yes — `clients/{slug}/memory/voice.md` is the first file loaded; if thin or missing, skill tells user to run `/voice-profiler` first |
| Also reads | `clients/{slug}/memory/ivy-t-content-strategy.md` (pillars, competitors, last analysis pointer); `clients/{slug}/memory/context.md`; `clients/{slug}/memory/preferences.md`; most-recent analysis summary; previous plan CSV; planning CSVs and meeting notes in `documents/` |
| LLM calls | Yes — Claude generates post briefs, draft captions (applying all voice.md rules), competitor insights, pillar balance, format allocation |
| Outputs | `clients/{slug}/outputs/instagram/YYYY-MM_{slug}-instagram-plan.csv` (13-column, `csv.QUOTE_ALL`, UTF-8); updates `memory/content-strategy.md` with `## Last plan` pointer |
| Confirmed for ivy-t | Column spec matches exactly: blank `{Contact}'s Amended Caption` and `{Contact}'s Notes / Questions` in output |

**CSV column spec (exact, in order):**

`Date`, `Day`, `Post Title / Theme`, `Category`, `Pillar`, `Format`, `Posting Time`, `Who Posts`, `Competitor Insight (why this was recommended)`, `Sprigly Draft Caption`, `Sprigly Notes (context for {Contact})`, `{Contact}'s Amended Caption`, `{Contact}'s Notes / Questions`

**Artifact out of Step 3:** `clients/{slug}/outputs/instagram/YYYY-MM_{slug}-instagram-plan.csv`

---

**Step 4a → `generate_calendar.py`**

Source: `~/.claude/skills/sprigly-content-calendar/scripts/generate_calendar.py`

```
python3 generate_calendar.py <csv_path> [--config clients/{slug}/calendar-config.json] [--out dir/]
```

| Aspect | Detail |
|---|---|
| Inputs | CSV (must start `YYYY-MM_`); optional `calendar-config.json` with `client`, `contact`, `categories` map; `palette.json` (sibling of the script) |
| LLM | No — pure Python (openpyxl only) |
| `--config` shape | `{ "client": "Ivy", "contact": "Sally", "categories": { "Product launch": "FFD7D1", ... } }` |
| `--out` | Directory or full `.xlsx` path; defaults to same dir as CSV |
| Outputs | `{Client} — Content calendar - {Month} {Year}.xlsx` — 3-tab workbook: **Calendar** (month grid, colour-coded by category), **Post details** (full plan, amber editable columns), **How to use** (client-facing instructions) |
| Editable column detection | Columns located by **suffix** ("Amended Caption" / "Notes / Questions") — contact-name agnostic |
| Confirmed live for ivy-t | `clients/ivy-t/calendar-config.json` exists with `client`, `contact`, `categories` |

**Artifact out of Step 4a:** `{Client} — Content calendar - {Month} {Year}.xlsx`

---

**Step 4b: Client review (manual / out-of-band)**

Client fills two amber columns in the **Post details** tab:
- `✏️ {Contact}'s Amended Caption` — rewrite if they'd say it differently
- `✏️ {Contact}'s Notes / Questions` — anything to flag

**Blank = happy with draft.** This is the convention `extract_edits.py` relies on. Returns the xlsx.

---

**Step 4c → `extract_edits.py`**

Source: `~/.claude/skills/sprigly-content-calendar/scripts/extract_edits.py`

```
python3 extract_edits.py <edited_xlsx> [--config clients/{slug}/calendar-config.json] [--out path.json]
```

| Aspect | Detail |
|---|---|
| Inputs | Returned xlsx; same `calendar-config.json` as generation step |
| LLM | No — pure Python (openpyxl `data_only=True`) |
| Column detection | Suffix-based: `col_index_by_suffix(headers, "Amended Caption")`, `col_index_by_suffix(headers, "Notes / Questions")`, `col_index_by_suffix(headers, "Sprigly Draft Caption")` |
| Edit criterion | Only rows where `amended` or `notes` cell is **non-blank** are included; fully blank rows are skipped |
| `--out` | Full JSON path; defaults to `{xlsx_stem}-edits.json` in same directory |
| Output path convention | `clients/{slug}/outputs/instagram/YYYY-MM-edits.json` |

**Edit diff JSON contract:**

```json
{
  "client": "Ivy",
  "contact": "Sally",
  "month": "2026-07",
  "edits": [
    {
      "date": "16 Jul",
      "post_title": "Connie: Ours vs theirs",
      "category": "POV",
      "pillar": "Born From Real Need",
      "sprigly_draft": "I've been making this comparison for years...",
      "amended": "Sally's rewrite...",
      "notes": "Can we soften the opening line?",
      "changed": true
    }
  ],
  "summary": {
    "total_posts": 18,
    "edited": 6,
    "edit_rate": 0.33
  }
}
```

All rows with a non-blank `amended` OR `notes` cell are included. `changed` is always `true` for included rows (there is no partial-match case).

**Artifact out of Step 4c:** `YYYY-MM-edits.json`

---

**Step 5 → `/voice-profiler` (update mode)**

Invoked with the edit JSON as context:
> "Here are Sally's edits to the July content calendar — `2026-07-edits.json`. Update her Instagram voice profile based on where she changed the drafts."

| Aspect | Detail |
|---|---|
| Inputs | Edit diff JSON + existing `memory/voice.md` |
| LLM | Yes — Claude synthesises which patterns are consistently changed (word choice, structure, tone) and merges into the relevant channel block |
| Outputs | Updated `clients/{slug}/memory/voice.md` |
| Current treatment | **Source-of-truth** — the file is read, merged, and overwritten in-place. No DB backing, no version history, no rollback. |

**Artifact out of Step 5:** Updated `clients/{slug}/memory/voice.md`

---

### Full artifact chain

```
[content-analyser]
  Apify JSON cache (knowledge/fetched/)
         ↓
  knowledge/analysis/competitor-analysis-instagram-YYYY-MM-DD-summary.md  [LLM]

[voice-profiler]
  Instagram / website content
         ↓
  clients/{slug}/memory/voice.md  [LLM]

[sprigly-content-plan]
  voice.md + analysis summary + client memory files
         ↓
  YYYY-MM_{slug}-instagram-plan.csv  [LLM — draft captions, competitor insights, pillars]

[sprigly-content-calendar → generate_calendar.py]
  YYYY-MM_{slug}-instagram-plan.csv + calendar-config.json
         ↓
  {Client} — Content calendar - {Month} {Year}.xlsx  [Pure Python — no LLM]

[Out-of-band: deliver xlsx to client, await return]

[sprigly-content-calendar → extract_edits.py]
  {Client} — Content calendar - {Month} {Year}.xlsx (edited)
         ↓
  YYYY-MM-edits.json  [Pure Python — no LLM]

[voice-profiler update]
  YYYY-MM-edits.json + existing voice.md
         ↓
  clients/{slug}/memory/voice.md (updated)  [LLM — synthesis step]
```

---

## Part 2 — Existing Platform

### a) Google Drive folder-watching

**Drive watching does not exist in the current platform.**

A grep of the entire engine codebase for `drive`, `Drive`, `google.*drive`, `gdrive` returned only three files: `docs/workflows/question-answerer.md`, `docs/operations/costs.md`, and `docs/infrastructure/routing.md` — none implement Drive integration. The `SourceType` enum in `packages/engine/src/types.ts` lists `email`, `sms`, `slack`, `form`, `voice`, `webhook`, `schedule`. There is no `drive` source type.

The engine has one implemented source: **Gmail** (`packages/sources/src/gmail/`).

**OAuth scope:** `oauth_connections` stores encrypted tokens per `(client_id, provider)`. Only `gmail` is implemented (`schema.ts`). There is no `drive` provider.

**Implication for the pipeline:** The assumption that a Drive watch already exists is incorrect. If xlsx return is needed via Drive, it is entirely NET-NEW. The simpler path — client replies by email with the xlsx attached — reuses Gmail polling but requires extending `GmailApiClient` to parse binary attachments (the current `getMessage()` fetches only text body). See Part 3.

---

### b) BullMQ setup

**File references:** `apps/worker/src/index.ts` (worker entrypoint and workflow registration), `apps/worker/src/consumer.ts` (job dispatch), `apps/worker/src/poller.ts` (poll scheduling).

**Queue name:** `'incoming-events'` (confirmed in `apps/web/src/app/review/[token]/actions.ts:177`).

**Job shape:**
```typescript
{
  eventId: string;          // UUID of incoming_events row
  clientId: string;         // UUID of clients row
  directWorkflowId?: string; // bypass routing — used by triage invoke_workflow
}
```

**Concurrency:** 10 (ADR 16: `concurrency: 10`).

**Retry policy:** BullMQ default (no automatic job-level retry configured). Bedrock `ThrottlingException` retries are handled inside `BedrockClient` with 3-attempt exponential backoff (ADR 16, `packages/model-client/src/bedrock-client.ts`). Non-throttling errors propagate to BullMQ as job failures.

**OAuth token path:** Two IAM users (ADR 9):
- `sprigly-bedrock-worker` (`BEDROCK_AWS_*` env vars) — Bedrock inference only
- `sprigly-kms-worker` (`KMS_AWS_*` env vars) — KMS-envelope-encrypt/decrypt OAuth tokens only

OAuth tokens stored in `oauth_connections.encrypted_tokens` (AES-256-GCM, data key encrypted by KMS). Decrypted at runtime by `getTokens()` in `packages/oauth-tokens/src/`.

**Client identification:** `clients.id` (UUID), `clients.slug` (URL-safe text, unique). BullMQ jobs carry `clientId` explicitly; the engine never infers it from context.

**Adding a new queue handler — the exact steps:**

1. `pnpm new-workflow <name>` — generates scaffold in `packages/workflows/src/<name>/`
2. Edit `types.ts`, `parse-input.ts`, `<name>.ts` (steps, model choice)
3. Write real prompt, replace `__PROMPT_NOT_CUSTOMISED__` sentinel
4. Run `pnpm db:migrate` (migration auto-created at `packages/db/migrations/NNNN_<name>_prompts.sql`)
5. Import workflow object in `apps/worker/src/index.ts`, add to `workflows[]`
6. Create routing rule via admin UI or migration

The `pnpm new-workflow` path is a viable convention to follow for `calendar:generate`, `calendar:detect-edits`, and `voice:ingest`.

---

### c) Inbox-triage delivery path and magic-link review

**Files:**
- `apps/worker/src/digest-sender.ts` — builds and sends digest email with magic-link URL
- `apps/web/src/app/review/[token]/page.tsx` — token-gated review page (no Clerk auth)
- `apps/web/src/app/review/[token]/actions.ts` — `approveItem`, `rejectItem`, `modifyAndApprove` server actions
- `packages/db/migrations/0019_triage_digest.sql` — `triage_digest_tokens` table + `digest_cadence` / `last_digest_sent_at` columns

**Token mechanism:**
- Table: `triage_digest_tokens` (`id`, `client_id`, `token` (32-byte hex, unique), `expires_at` (72h TTL), `created_at`)
- Upsert: `upsertDigestToken()` reuses an unexpired token (sliding expiry), mints new token only when none exists → exactly one active token per client at all times
- Auth: **token in URL path only** — no Clerk session required. Page calls `resolveTokenToClient(token)` → `notFound()` on expired/invalid
- Token re-validated on **every server action** (not just page load) — expired token cannot submit

**Digest email flow:**
1. `sendDigestsForAllClients()` runs on a 15-minute tick (cadence logic: `end_of_day` / `twice_daily` / `end_of_week`)
2. Collects pending `triage_capture_log` rows (where `decision IS NULL`) for the client
3. Mints/reuses digest token → `reviewUrl = ${appBaseUrl}/review/${token}`
4. Sends email via Gmail API (client's own Gmail OAuth connection)
5. Inserts sent message ID into `processed_external_ids` so the Gmail poller never routes the digest into triage
6. Updates `triage_configs.last_digest_sent_at`

**Domain-gated send safety:**
The `gmail-reply-with-attachment` destination (`packages/destinations/src/generic/gmail-reply-with-attachment.ts`) supports a `mode: 'verified-domain-gate'` option (referenced in `actions.ts:148`). When set, delivery compares the recipient against `clients.verified_domain`. This gate is the mechanism that prevents auto-sending to arbitrary addresses.

**Reusable surface for calendar pipeline:**
The token generation, expiry, URL pattern, and review page architecture are reusable patterns. However, the review page is currently hardwired to `triage_capture_log` rows. To reuse it for calendar review (e.g. deliver xlsx link, collect approval to send), a parallel `calendar-review/[token]` page would be needed — or the review page would need to be extended with a new item type.

**Collecting the returned xlsx:**
The review page has no file upload capability. There is no `/review/upload` endpoint. If the client edits the xlsx locally, the return mechanism must be:
- (Option A) Email reply with attachment → Gmail poller receives it → new `calendar:detect-edits` workflow triggered. **But**: `GmailApiClient.getMessage()` currently returns only text body. Attachment parsing is NET-NEW (see gap table).
- (Option B) Google Drive upload → Drive watch. NET-NEW.
- (Option C) Interim manual path: client emails John, John runs `extract_edits.py` locally. No platform change required for MVP.

---

### d) voice-profiler and voice.md

**Location:** `clients/{slug}/memory/voice.md` — confirmed live at `clients/ivy-t/memory/voice.md`.

**How it's written today:**
- `/voice-profiler` Claude Code skill runs interactively (Steps 4–6 in `SKILL.md`)
- Step 5: writes a structured markdown channel block
- Step 6: reads existing `voice.md`, then CREATE (new block) / UPDATE (merge signals, preserve signature phrases) / REPLACE (full overwrite)
- No DB record, no version history

**Treated as:** **Source-of-truth.** The file is what Claude reads when generating captions. There is no DB-backed representation. `/sprigly-content-plan` reads `memory/voice.md` directly as one of its first loaded files.

**Current update on edit ingestion:** Invoked manually with edit JSON as context. Claude reads the file, synthesises which patterns are consistently changed, and merges/overwrites. The previous version is gone.

**Implication for the proposed design:** voice.md must become a **derived** artifact — regeneratable from a DB ledger of raw edit sets. The DB is the source-of-truth; `voice.md` is a projection of it at any given point.

---

### e) Postgres — migration tooling and client tables

**Migration convention:**
- Files: `packages/db/migrations/NNNN_{random_or_descriptive_name}.sql` (4-digit prefix, auto-incremented by Drizzle)
- Run: `pnpm db:migrate` (Drizzle ORM)
- Idempotent seeds: guarded with `WHERE NOT EXISTS` (see `0004_seed_prospect_prompts.sql` pattern)
- Latest migration: `0019_triage_digest.sql`
- Next migration should be `0020_{name}.sql`

**Client / tenant tables (from `docs/reference/database-schema.md`):**

`clients`:  `id` (UUID PK), `slug` (text, unique), `name` (text), `status`, `settings` (JSONB, `{}` default)

`client_id` resolution throughout the system: passed as a UUID string in every BullMQ job payload and in `WorkflowContext.clientId`. The `slug` is the display handle (`ivy-t`); the UUID is the FK key.

**All tables share:** `id` (UUID, gen_random_uuid()), `created_at` (timestamp, default now()), `updated_at` (timestamp, default now()).

**Relevant existing tables for new schema design:**

| Table | Reuse |
|---|---|
| `clients` | FK anchor for all new voice diff tables |
| `workflow_outputs` | Generic output store (ADR 2) — new jobs can write edit digests here |
| `audit_log` | Logs every model call; `voice:ingest` should log here |
| `prompt_templates` | `voice:ingest` prompt should be seeded here (per ADR 6) |

---

## Part 3 — Gap Analysis and Proposal

### 1. Current-state flow diagram

```
[MANUAL — Claude Code skill]
/content-analyser
  Apify scrape → LLM analysis
  Out: knowledge/analysis/-summary.md
         |
         ▼ [REUSE existing — reads file]
/sprigly-content-plan
  voice.md + analysis → LLM drafting
  Out: YYYY-MM_{slug}.csv
         |
         ▼ [REUSE existing — pure Python]
generate_calendar.py
  CSV → xlsx workbook
  Out: {Client} — Content calendar - {Month} {Year}.xlsx
         |
         ▼ [NET-NEW — delivery mechanism]
  Email xlsx to client
  (today: manual)
         |
         ▼ [NET-NEW — client edits locally]
  Client fills amber columns, returns xlsx
  (today: email / no structured channel)
         |
         ▼ [REUSE existing — pure Python]
extract_edits.py
  Edited xlsx → diff JSON
  Out: YYYY-MM-edits.json
         |
         ▼ [EXTEND — add persistence; today: no DB record]
/voice-profiler update
  diff JSON + voice.md → LLM synthesis
  Out: voice.md overwritten
  (today: no rollback, no version history)
```

**Tags:** Steps 3–4a are REUSE (skills exist and work). Delivery, return, and persistence are NET-NEW or EXTEND.

---

### 2. Three proposed jobs

#### `calendar:generate`

**Purpose:** Take a finalised plan CSV and deliver a branded xlsx to the client.

**Trigger options:**
- (A) Email to the client's Sprigly-connected Gmail (`Calendar Generate: {slug}` subject) → routing rule → BullMQ
- (B) Scheduled trigger (monthly, `schedule` source type, not yet wired in the worker)
- Recommendation: Option A for now (reuses existing Gmail polling with zero new plumbing)

**Steps:**
1. `parseInput` — extract slug and month from subject
2. Resolve latest CSV path from `clients/{slug}/outputs/instagram/` (file convention: latest `YYYY-MM_*.csv`)
3. Spawn Python subprocess: `python3 generate_calendar.py <csv> --config clients/{slug}/calendar-config.json --out <tmpdir>`
4. Read resulting xlsx into a `Buffer`
5. Deliver via `gmail-reply-with-attachment` to client's contact email (set in `client_configs` or `calendar-config.json`)

**What's reused:**
- BullMQ job dispatch (REUSE)
- `gmail-reply-with-attachment` destination (EXTEND — MIME type must be `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` rather than `application/pdf`; `attachmentMimeType` is already a configurable field in the destination's settings schema)
- `db-save-output` for the job record (REUSE)

**What's new:**
- Python subprocess invocation in Node.js worker (small — `child_process.execFileSync` or similar)
- `calendar-config.json` must be readable by the worker (presently a local file; worker would need filesystem access to the clients directory, or config values must move to `client_configs.settings` in Postgres)

**LLM:** NO — `generate_calendar.py` is pure Python.

---

#### `calendar:detect-edits`

**Purpose:** Receive the client's edited xlsx, extract diffs, persist them immutably to the DB.

**Trigger:**
- Client emails the Sprigly Gmail address with the edited xlsx attached
- Subject routing rule: `field: 'subject'`, `op: 'contains'`, `value: 'Content calendar'`
- Or: a dedicated reply-matching rule on `threadId`

**Steps:**
1. `parseInput` — detect attachment (xlsx) in email body/attachments
2. Download attachment bytes from Gmail API (NET-NEW — `getMessage()` currently returns only text body; need `GmailApiClient.getAttachment(messageId, attachmentId)`)
3. Write xlsx bytes to a temp file
4. Spawn Python subprocess: `python3 extract_edits.py <tmpfile> --config ... --out <tmpjson>`
5. Read diff JSON
6. Persist to `voice_edits` table (see schema below) — one row per edited post
7. Update `voice_ingestion_runs` with edit count

**What's reused:**
- Gmail polling / routing rules (REUSE)
- BullMQ dispatch (REUSE)
- `db-save-output` for job record (REUSE)
- `audit_log` if a model call is added (REUSE — none needed here)

**What's extended/new:**
- `GmailApiClient.getAttachment()` — attachment download is not implemented; `getMessage()` parses only text body (`packages/sources/src/gmail/gmail-client.ts`)
- Python subprocess invocation in worker
- `voice_edits` and `voice_ingestion_runs` schema (NET-NEW migration)

**LLM:** NO — `extract_edits.py` is pure Python.

---

#### `voice:ingest`

**Purpose:** Synthesise the month's edit set into a voice.md update using Bedrock Haiku; persist a snapshot; regenerate `voice.md` from the snapshot.

**Trigger:** Chained after `calendar:detect-edits` completes (enqueue `voice:ingest` job at end of detect-edits step, passing `ingestion_run_id`).

**Steps:**
1. Load `voice_edits` rows for this `(client_id, channel, month)` from DB
2. Load current `voice.md` content from disk (or latest `voice_snapshots.snapshot_md` from DB if present)
3. Resolve prompt: `ctx.prompts.resolve(clientId, 'calendar-voice-ingest', 'synthesise')`
4. Call `ctx.model.complete({ model: 'haiku', ... })` with diff set + current voice as context
5. `ctx.audit.logModelCall(...)` — records token cost
6. Parse LLM output → updated channel block text
7. Insert new `voice_snapshots` row (immutable — `snapshot_md` is the full voice.md content post-update, `source_month` = YYYY-MM)
8. Write updated `voice.md` to `clients/{slug}/memory/voice.md` (DERIVED — can be regenerated from DB)
9. Update `voice_ingestion_runs` row: `status = 'completed'`, `snapshot_id`

**What's reused:**
- `BedrockClient.complete()` — Haiku model (REUSE)
- `ctx.audit.logModelCall()` (REUSE)
- `ctx.prompts.resolve()` + `prompt_templates` DB storage (REUSE)
- `db-save-output` for job record (REUSE)

**What's new:**
- `voice_snapshots` and `voice_ingestion_runs` schema
- The `synthesise` prompt (seeded via migration `0020_*`)
- File write to `clients/{slug}/memory/voice.md` — the worker would need filesystem access to the clients directory, or voice.md must live in Postgres and be written to disk only on demand

**LLM:** YES — Haiku-tier. Single step, no web search.

---

### 3. Proposed Postgres schema for versioned voice diffs with rollback

**Design principle:** The DB is the source-of-truth. `voice.md` is a derived artifact. A bad ingestion can be rolled back by:
1. Identifying the `voice_snapshots` row from before the bad run
2. Restoring `voice.md` from `snapshot_md`
3. Logging the rollback as a new snapshot row (reason: `'rollback'`)

No data is deleted. History is append-only.

```sql
-- Migration: 0020_voice_diff_tables.sql

-- ── voice_edits ──────────────────────────────────────────────────────────────
-- Immutable ledger: one row per edited post per ingestion run.
-- Each month's edit set is retained forever.
CREATE TABLE IF NOT EXISTS "voice_edits" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"       timestamp NOT NULL DEFAULT now(),
  "updated_at"       timestamp NOT NULL DEFAULT now(),
  "client_id"        uuid NOT NULL REFERENCES "clients"("id"),
  "channel"          text NOT NULL,     -- e.g. 'instagram'
  "month"            text NOT NULL,     -- YYYY-MM (derived from xlsx filename)
  "post_index"       integer NOT NULL,  -- 1-based row position in xlsx
  "date"             text,
  "post_title"       text,
  "category"         text,
  "pillar"           text,
  "sprigly_draft"    text,
  "contact_amended"  text,             -- null when blank (approved-as-is)
  "notes"            text,
  "ingestion_run_id" uuid NOT NULL     -- FK set after run row exists
);

-- Index for "load all edits for a client/channel/month" query.
CREATE INDEX IF NOT EXISTS voice_edits_client_channel_month
  ON "voice_edits" ("client_id", "channel", "month");

-- ── voice_ingestion_runs ──────────────────────────────────────────────────────
-- One row per calendar:detect-edits + voice:ingest pair.
CREATE TABLE IF NOT EXISTS "voice_ingestion_runs" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now(),
  "client_id"    uuid NOT NULL REFERENCES "clients"("id"),
  "channel"      text NOT NULL,
  "month"        text NOT NULL,
  "status"       text NOT NULL DEFAULT 'running', -- running | completed | failed
  "edit_count"   integer,
  "edit_rate"    numeric(5,2),
  "snapshot_id"  uuid,   -- FK to voice_snapshots.id, set on completion
  "error"        text,
  "started_at"   timestamp NOT NULL DEFAULT now(),
  "ended_at"     timestamp
);

-- Prevent double-ingesting the same month.
CREATE UNIQUE INDEX IF NOT EXISTS voice_ingestion_runs_unique_month
  ON "voice_ingestion_runs" ("client_id", "channel", "month")
  WHERE "status" = 'completed';

-- ── voice_snapshots ───────────────────────────────────────────────────────────
-- Immutable snapshots of voice.md at each ingestion point.
-- voice.md is regenerated from the most recent snapshot on demand.
CREATE TABLE IF NOT EXISTS "voice_snapshots" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now(),
  "client_id"    uuid NOT NULL REFERENCES "clients"("id"),
  "channel"      text NOT NULL,
  "snapshot_md"  text NOT NULL,   -- full content of the channel block in voice.md
  "reason"       text NOT NULL,   -- 'monthly-ingest' | 'manual-override' | 'rollback' | 'initial'
  "source_month" text,            -- YYYY-MM that produced this snapshot; null for initial/manual
  "run_id"       uuid            -- FK to voice_ingestion_runs.id if applicable
);

-- FK back-fill on voice_edits after runs table exists.
ALTER TABLE "voice_edits"
  ADD CONSTRAINT "voice_edits_run_fk"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "voice_ingestion_runs"("id");

ALTER TABLE "voice_ingestion_runs"
  ADD CONSTRAINT "voice_ingestion_runs_snapshot_fk"
  FOREIGN KEY ("snapshot_id") REFERENCES "voice_snapshots"("id");
```

**Rollback procedure:**

```sql
-- 1. Find the snapshot before the bad run (e.g. for client_id X, channel 'instagram', bad month '2026-09'):
SELECT id, source_month, created_at
FROM voice_snapshots
WHERE client_id = '<uuid>'
  AND channel = 'instagram'
  AND created_at < (SELECT started_at FROM voice_ingestion_runs WHERE month = '2026-09' AND client_id = '<uuid>' LIMIT 1)
ORDER BY created_at DESC
LIMIT 1;

-- 2. Restore voice.md from snapshot_md (done by worker or admin script):
--    Read snapshot_md from the row; write to clients/{slug}/memory/voice.md

-- 3. Record the rollback as a new snapshot (preserving history):
INSERT INTO voice_snapshots (client_id, channel, snapshot_md, reason, source_month)
VALUES ('<uuid>', 'instagram', '<restored_snapshot_md>', 'rollback', '2026-09');

-- 4. (Optional) Mark the bad run as failed for clarity:
UPDATE voice_ingestion_runs SET status = 'failed', error = 'rolled back'
WHERE client_id = '<uuid>' AND month = '2026-09';
```

**Regeneration from any point:** To reconstruct voice.md as of month M:
1. Find the `voice_snapshots` row with `source_month = M` (or the latest before M)
2. Read `snapshot_md`
3. Write to disk

No re-running of LLM is required to regenerate — the snapshot stores the full derived output.

---

### 4. Gap table

| What's missing | Where it slots in | Effort |
|---|---|---|
| Google Drive watch (new source) | `packages/sources/src/drive/` | **L** — OAuth scope, push notifications, channel renewal, dedup |
| Gmail attachment parsing in `GmailApiClient` | `packages/sources/src/gmail/gmail-client.ts` — add `getAttachment()` | **S** |
| `calendar:detect-edits` workflow (Python subprocess + attachment route) | `packages/workflows/src/calendar-detect-edits/` | **M** — new workflow, attachment handling |
| `calendar:generate` workflow (Python subprocess + xlsx delivery) | `packages/workflows/src/calendar-generate/` | **M** — new workflow, Python invocation |
| `voice:ingest` workflow (Haiku step + snapshot write) | `packages/workflows/src/voice-ingest/` | **S** — standard 1-step workflow |
| Prompt for `voice:ingest` `synthesise` step | Migration `0020_*` + admin UI | **S** |
| `voice_edits`, `voice_ingestion_runs`, `voice_snapshots` tables | Migration `0020_voice_diff_tables.sql` | **S** |
| Worker filesystem access to `clients/{slug}/` directory | Env var or Postgres migration of `calendar-config.json` data | **M** — worker runs on Railway; clients/ is local |
| `client_configs.settings` extension for contact email + calendar-config | Migration or convention decision | **S** |
| `calendar-review/[token]` page (if xlsx return via upload needed) | `apps/web/src/app/calendar-review/[token]/` | **M** |
| voice.md MIME-type extension in `gmail-reply-with-attachment` | `packages/destinations/src/generic/gmail-reply-with-attachment.ts` — `attachmentMimeType` already configurable | **XS** — settings field exists |

---

### 5. Open questions and assumptions

**ASSUMPTIONS (unverified — confirm before building):**

1. **ASSUMPTION**: The Railway worker container has read/write access to the `clients/{slug}/` directory on disk. This is required for `generate_calendar.py` to read the CSV and `voice:ingest` to write `voice.md`. If the worker is a Docker container on Railway with no persistent volume mounted at `clients/`, the calendar scripts cannot run there. The skills work today because they run locally in Claude Code where the filesystem is John's Mac. **This is the biggest architectural question for the engine integration.** If false, `clients/` data must either be synced to Postgres before jobs run or the calendar jobs must remain Claude Code skills.

2. **ASSUMPTION**: `calendar-config.json` (currently at `clients/ivy-t/calendar-config.json`) can be moved to `client_configs.settings` in Postgres so the worker can read it without filesystem access. The JSONB `settings` column on `client_configs` already supports arbitrary keys.

3. **ASSUMPTION**: Python 3 with `openpyxl` is available in the Railway worker container. The current Dockerfile (`dev/engine/Dockerfile`) was not read — confirm before adding subprocess calls.

4. **ASSUMPTION**: The `voice:ingest` Haiku prompt can be written without seeing the existing voice.md format in detail. (voice.md exists at `clients/ivy-t/memory/voice.md` but was not read to avoid including client data in this document.)

5. **ASSUMPTION**: `eu.anthropic.claude-haiku-4-5-20251001-v1:0` (the Haiku cross-region inference profile) is available on `eu-west-2` Bedrock. ADR 1 notes that Opus is not yet available on Bedrock `eu-west-2`; Haiku and Sonnet are confirmed available.

**OPEN QUESTIONS:**

1. **Worker ↔ clients/ filesystem**: Does the Railway worker have access to `clients/{slug}/`? If not, does the calendar pipeline stay as Claude Code skills indefinitely, or does the config/output data move to Postgres?

2. **xlsx return channel**: Which is the target for Phase 1 — (A) client replies by email with attachment, (B) client uploads to Drive, (C) interim manual path (John receives xlsx, runs extract_edits locally)? Option C requires zero platform change. Options A and B are both medium effort.

3. **voice.md as file vs DB column**: Should `voice.md` remain a file on disk (derived, regenerated by worker) or should it live purely in `voice_snapshots.snapshot_md` and be written to disk only when a skill needs to read it? The latter is cleaner but requires the worker to write to the local filesystem.

4. **`calendar:generate` trigger**: Monthly schedule (requires `schedule` source type, not yet wired in the worker — `SourceType` enum lists it but no scheduler is registered) vs. manual email (`Calendar Generate: {slug}`)?

5. **Delivery domain gate**: Should xlsx delivery to the client go through the `verified-domain-gate` mode of `gmail-reply-with-attachment`, or is the client email address configured explicitly in `calendar-config.json`? The gate requires `clients.verified_domain` to be populated.

---

### 6. Phased plan

#### Phase 1 — Working round-trip with persistence (no platform change needed)

All steps remain as Claude Code skills. Only the voice diff persistence is new.

| Step | What | Notes |
|---|---|---|
| 1 | Run `/sprigly-content-plan` (exists) | Produces CSV |
| 2 | Run `generate_calendar.py` locally (exists) | Produces xlsx |
| 3 | Email xlsx to client manually | No platform change |
| 4 | Receive edited xlsx from client | No platform change |
| 5 | Run `extract_edits.py` locally (exists) | Produces diff JSON |
| 6 | **NEW**: Persist diff JSON to `voice_edits` table | Write a small CLI script or extend extract_edits.py with `--persist` flag |
| 7 | **NEW**: Run `voice:ingest` as a BullMQ job OR as a Claude Code skill that writes snapshot | Haiku call; writes `voice_snapshots` row; regenerates voice.md |

**Deliverable:** voice.md is now derived from a versioned DB ledger. Rollback is possible. The rest of the pipeline is unchanged.

**Migration needed:** `0020_voice_diff_tables.sql` only.

---

#### Phase 2 — Automated xlsx delivery

Automate Step 2 and 3 via a BullMQ `calendar:generate` job:

| Step | What | Requires |
|---|---|---|
| `calendar:generate` workflow | Email-triggered; runs Python subprocess; sends xlsx via gmail-reply-with-attachment | Worker filesystem access OR config migration to Postgres |
| `calendar-config.json` → `client_configs.settings` | Move per-client config to DB | Migration + admin UI |

---

#### Phase 3 — Automated edit detection

Automate Step 4 and 5:

| Step | What | Requires |
|---|---|---|
| `GmailApiClient.getAttachment()` | Parse xlsx from email attachment | Extend `packages/sources/src/gmail/gmail-client.ts` |
| `calendar:detect-edits` workflow | Routing rule on attachment email; run extract_edits; persist to DB | New workflow; chained enqueue of `voice:ingest` |

This phase eliminates the manual xlsx-return step entirely.

---

#### Phase 4 — Google Drive integration (optional / deferred)

If email-return is insufficient (e.g. client prefers shared Drive folder):

- New `drive` source type in `packages/engine/src/types.ts`
- `packages/sources/src/drive/drive-poller.ts` — Drive push notification channel, registration, renewal, dedup via `processed_external_ids`
- OAuth scope: `https://www.googleapis.com/auth/drive.readonly` added to `oauth_connections` for new connections

This is the largest single item and should only be built if Phase 3 (email return) proves insufficient in practice.

---

## Verdict

Your "mostly reuse, minor voice update" hypothesis is **partially correct but rests on a false premise about Drive**. The skills chain itself (content-analyser → content-plan → generate_calendar → extract_edits → voice-profiler) already exists and works end-to-end; the Python scripts are complete, correct, and deterministic. The BullMQ, Bedrock, audit, and prompt-template infrastructure genuinely does reuse without modification for the `voice:ingest` job. However, the hypothesis overstates what's already in the platform in two important ways: (1) **Google Drive watching does not exist** — there is zero Drive code in the engine and the simplest substitute is extending the Gmail attachment path, which is a non-trivial `GmailApiClient` addition; (2) **the voice-feedback persistence is not "minor"** — voice.md is currently source-of-truth with no DB backing, no rollback, and no version history, so making it derived requires three new tables, a new migration, a new Bedrock job, and a file-write convention change. The real scope is: Python scripts (done), `voice_edits`/`voice_snapshots`/`voice_ingestion_runs` schema (S), `voice:ingest` BullMQ job (S), Gmail attachment parsing (S), `calendar:generate` and `calendar:detect-edits` jobs (M each), and resolution of the worker ↔ clients-directory filesystem question (which is the load-bearing unknown for whether any of the automation lands on Railway or stays as Claude Code skills).
