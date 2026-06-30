# Workflow: Question Answerer

Answers inbound customer questions from a client's own knowledge bank (FAQ + curated past replies), in the client's voice, as a Gmail draft for review. The purest expression of "trained on how your business works." Sprigly is configured as client #0 for dogfooding.

This doc was the implementation brief; it has been updated to reflect what was actually built across steps 1–6. Read `docs/workflows/existing.md` and `docs/operations/deployment.md` before making changes.

---

## How it fits the existing platform

- Gmail poller — unchanged; `checkSentDraftsForAllClients` runs after each poll cycle to detect when drafts are sent.
- Event router — Inbox Triage classifies inbound mail and triggers Question Answerer via `invoke_workflow:sprigly-question-answerer`; the consumer auto-chains this without a human gate.
- Workflow runner — registered as `sprigly-question-answerer` alongside Blog Post / Prospect Research / Triage.
- Destination — Gmail draft (no auto-send in v1).
- Per-client prompt templates — `reformulate` and `compose` steps; seeded as shared defaults in migration 0023.
- Per-workflow-step model selection — each Claude call uses its configured step model (default: `sonnet`).

New primitives added: `@sprigly/embedding-client`, `@sprigly/knowledge`, two DB tables, HNSW index, and a feedback loop driven by Gmail send-detection.

---

## Embedding provider

**AWS Bedrock Titan Text Embeddings v2, 1024 dimensions.** Keeps embeddings inside AWS in prod; no new vendor. The constant `EMBEDDING_DIMENSIONS = 1024` lives in `packages/embedding-client/src/types.ts` and is the single source of truth for the vector column size.

Env vars use dedicated keys (`BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`, `BEDROCK_AWS_REGION`) — never the generic `AWS_*` vars, which are reserved for KMS.

The `EmbeddingClient` interface (defined locally in `packages/engine/src/types.ts`) keeps `@sprigly/engine` free of the embedding-client dep; structural duck typing handles compatibility.

---

## Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Per-client topic taxonomy (configurable, curated)
CREATE TABLE knowledge_topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),   -- not timestamptz; all times are UTC
  updated_at  TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE TYPE knowledge_source AS ENUM
  ('faq_scrape','gmail_import','approved_draft','manual');
CREATE TYPE knowledge_status AS ENUM
  ('active','archived','pending_review');

CREATE TABLE knowledge_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topic_id     UUID REFERENCES knowledge_topics(id) ON DELETE SET NULL,
  content      TEXT NOT NULL,
  summary      TEXT,
  keywords     TEXT[] NOT NULL DEFAULT '{}',
  embedding    VECTOR(1024),                -- Titan v2; change EMBEDDING_DIMENSIONS if provider changes
  source_type  knowledge_source NOT NULL,
  source_ref   TEXT,
  status       knowledge_status NOT NULL DEFAULT 'active',
  content_hash TEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (client_id, content_hash)
);

CREATE INDEX idx_chunks_client_topic_status
  ON knowledge_chunks (client_id, topic_id, status);

-- HNSW index — cosine distance, matches vector_cosine_ops in retrieve query
CREATE INDEX idx_chunks_embedding
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

All `TIMESTAMP` columns (not `TIMESTAMPTZ`) — consistent with the rest of the schema; application layer treats all values as UTC.

`content_hash` makes re-scraping idempotent. `topic_id` nullable: a chunk the classifier can't place lands as `pending_review`.

---

## Ingestion — one pipeline, four adapters

`ingestSource(clientId, input, deps)` in `packages/knowledge/src/ingest.ts`.

```
rawChunks  = adapter(input)                     // per-source
hash each chunk via sha256(normalise(content))
novel      = bulk dedup via single inArray query (no per-chunk round-trips)
taxonomy   = loadTopics(clientId)
labelResults = withConcurrency(5, novel.map(c => labelChunk(c, taxonomy, model, labelModel)))
embeddings   = embeddingClient.embedBatch(novel.map(c => c.content))  // ONE call
INSERT ON CONFLICT (client_id, content_hash) DO NOTHING
```

**Key constraints:**
- Hash dedup is a single `inArray` query over all content hashes in the batch — no per-chunk DB round-trips.
- `embedBatch()` is called once for all surviving chunks — do not loop `embed()` per chunk.
- `withConcurrency(5, ...)` bounds the Claude label calls.
- `labelChunk` returns `{ topicId: uuid|null, keywords: string[], summary: string }`. `topicId: null` → status `pending_review`.

**Adapters** (in `packages/knowledge/src/adapters/`):
- `faq_scrape` — `fetch` the FAQ URL, extract Q&A blocks via `<dt>/<dd>`, heading+`?`, or `Q:/A:` patterns. `source_ref` = URL.
- `gmail_import` — pull sent replies via `listSentMessageIds`, strip signatures/quoted threads. `source_ref` = message id.
- `approved_draft` — fed by the feedback loop. `source_ref` = workflow run id.
- `manual` — admin paste/upload, split by paragraph+sentence boundary ≤1500 chars.

---

## Retrieval

`retrieveChunks(args, deps)` in `packages/knowledge/src/retrieve.ts`.

```typescript
// Wraps query in pgClient.begin() so SET LOCAL GUCs are scoped to this transaction.
const rows = await pgClient.begin(async (trx) => {
  await trx`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`;
  await trx`SET LOCAL hnsw.ef_search = 100`;
  return trx<RawRow[]>`
    SELECT id, content, summary, topic_id, source_type,
           1 - (embedding <=> ${vecStr}::vector) AS score
      FROM knowledge_chunks
     WHERE client_id = ${clientId}::uuid AND status = 'active'
       AND (${topicId}::uuid IS NULL OR topic_id = ${topicId}::uuid)
     ORDER BY embedding <=> ${vecStr}::vector
     LIMIT ${k}`;
});
```

`vecStr` is produced by `serializeVector(embedding)` from `@sprigly/db` — single source of truth for the `[x,y,...]` PostgreSQL vector literal format, shared with `pgVector.toDriver`.

**Multi-tenant HNSW recall fix:** pgvector's ANN candidate set is built before WHERE filters are applied. On a multi-tenant table, a small client can return fewer than `k` rows once the table grows. `hnsw.iterative_scan = 'relaxed_order'` (pgvector ≥ 0.8) keeps scanning until `k` rows survive the post-filter. `SET LOCAL` scopes the GUCs to this transaction only — no server config mutation.

---

## Workflow steps

Registered as `sprigly-question-answerer` in `packages/workflows/src/`.

### 1. Reformulate + classify

Claude call using the `reformulate` prompt template. Input: raw email subject + body + client topic list. Output JSON: `{ cleanQuestion, topicId }`.

**triageTopicId forwarding:** If Inbox Triage set `content.structured.triageTopicId` on the event, it is forwarded with `skipClassify: "true"` so the model only reformulates without re-classifying. **However,** the forwarded ID is validated against `ctx.knowledgeTopics` (a Set of UUIDs) before use. Triage's own action taxonomy uses string keys, not knowledge_topics UUIDs — an unvalidated forward would silently match zero rows in retrieval. If the forwarded ID is not in the client's knowledge_topics, it is discarded with a `console.warn` and fresh classification runs.

### 2. Retrieve

`retrieveChunks({ clientId, queryText: cleanQuestion, topicId, k: 6 }, { embeddingClient })`.

### 3. Zero-chunks branch

If `chunks.length === 0`: return a holding reply (`outcome: 'needs_human'`, `noChunksFound: true`). Do not compose a guessed answer.

### 4. Compose

Claude call using the `compose` prompt template. System prompt contains brand voice, signature, author name, and retrieved chunks. Rules: answer only from supplied material; ask one clarifying question if specifics are missing; no hallucination. User = `cleanQuestion`.

### 5. Dispatch

WorkflowRunner creates a Gmail draft and patches `workflow_runs.output.gmailDraftId`. The full output (including `draftText`, `threadId`, `cleanQuestion`) is stored in `workflow_runs.output` (JSONB).

Each Claude call uses its configured per-step model (`getStepModel` reads `clientConfig.settings.stepModels['sprigly-question-answerer'][stepName]`, defaults to `'sonnet'`).

---

## Feedback loop

Two complementary signals share the same `feedbackIngestedAt` flag in `workflow_runs.output`. Whichever fires first wins; the other is a no-op via the idempotency guard. `content_hash` in `knowledge_chunks` is a second dedup layer for near-identical text.

### Signal 1: Gmail send-detection (primary)

`checkSentDraftsForAllClients` runs in the worker after each `pollAllClients` cycle.

Per active Gmail client, per cycle:

```
rows = workflow_runs WHERE workflowId = 'sprigly-question-answerer'
         AND output->>'gmailDraftId' IS NOT NULL
         AND output->>'feedbackIngestedAt' IS NULL
         AND output->>'feedbackDiscardedAt' IS NULL

for each run:
  if getDraft(draftId) returns true  → still pending; no flag; re-check next cycle
  else (404):
    sentIds = listSentByThread(threadId, run.startedAt)
    // after: epoch is seconds: Math.floor(date.getTime() / 1000)
    if sentIds.length === 0:
      patch feedbackDiscardedAt  // deleted, not sent
    else:
      // Gmail returns newest-first; sentIds[sentIds.length-1] = earliest in window
      sentBody = getMessage(sentIds[last]) → extractMessageText
      ingestSource(clientId, 'approved_draft', sentBody, ref: runId)
      patch feedbackIngestedAt
      log { edited, originalLength, sentLength }
```

`getDraft` returns `false` only on HTTP 404; any other error is re-thrown and caught at the per-run level, not silently swallowed. `listSentByThread` queries `in:sent threadId:X after:Y` where Y is a seconds epoch.

### Signal 2: Admin in-panel approval (complementary)

`approveQaDraft` server action on the admin client detail page. Shown for runs that have a `gmailDraftId` and neither `feedbackIngestedAt` nor `feedbackDiscardedAt`. The textarea is pre-filled with the original `draftText`; the admin pastes/confirms the actual sent text.

Same `feedbackIngestedAt` guard prevents double-ingest if send-detection already fired.

This path handles the case where a draft is approved and text is confirmed in the panel directly, without going through Gmail.

---

## Auto-chaining from Triage

After Inbox Triage outputs `action: 'invoke_workflow:sprigly-question-answerer'`, the BullMQ consumer enqueues a new job:

```typescript
await queue.add('incoming-events', {
  eventId, clientId, directWorkflowId: 'sprigly-question-answerer',
});
```

The triage topic is forwarded via `content.structured.triageTopicId` and validated as described in step 1. No human gate in the chain.

---

## Admin UI

Per-client admin page (`/admin/clients/[id]`):

- **Prompt Templates** — shows coverage for `reformulate` and `compose`; customise per client.
- **Pending Q&A Drafts** — runs awaiting feedback (no `feedbackIngestedAt`/`feedbackDiscardedAt`). Editable textarea pre-filled from `draftText`. Approving calls `approveQaDraft`, triggering `ingestSource` server-side.

Knowledge bank management (list/add/edit topics; view/approve pending_review chunks; trigger ingestion sources; archive chunks) is a backlog item.

---

## Known limitations / backlog

### 1. Bank is append-only — no supersession on source change

When an FAQ answer changes (new pricing, new process), re-running `faq_scrape` adds a new chunk but does **not** retire the old one. Both stay `active`. The retrieval step will return whichever scores higher, which may be the stale one if embeddings are similar. This surfaces as the agent citing outdated facts for clients with churny FAQs (pricing tiers, SLA terms, scope boundaries).

The same applies to `gmail_import`: a reply that contradicts a later policy update stays in the bank indefinitely.

**Acceptable at current volume.** The first churny-FAQ client will surface this. No action now.

**Likely fix direction (do not build yet):** source_ref-based supersession. On re-scrape (or re-import), before inserting new chunks, `UPDATE knowledge_chunks SET status = 'archived' WHERE client_id = $1 AND source_ref = $2 AND status = 'active'`. This retires the prior generation for that source before the new chunks land. Requires passing `source_ref` (the URL for `faq_scrape`, the message id for `gmail_import`) into the dedup/insert loop — currently `source_ref` is stored but not used as a supersession key.

### 3. Admin UI for knowledge management is not built — currently script-only

Managing topics (create/edit/delete `knowledge_topics`) and triggering ingestion sources (manual paste, FAQ scrape, Gmail import) currently require a `tsx` script invocation per client. The `seed-knowledge.ts` script in `apps/worker/scripts/` handles the two primary seeding paths, but there is no admin UI for any of it.

**This does not scale past one client.** A per-client `tsx` invocation is acceptable for dogfooding Sprigly as client #0 but is not a viable onboarding path for paying clients.

**Deferred, not dropped.** Required before onboarding a second client. Admin surfaces needed: topic CRUD at `/admin/clients/[id]/knowledge/topics`, chunk browser with `pending_review` approval at `/admin/clients/[id]/knowledge/chunks`, and ingestion trigger forms (manual paste textarea, FAQ URL field, Gmail import button) at `/admin/clients/[id]/knowledge/ingest`.

---

### 2. No archival/expiry for `approved_draft` chunks

Approved reply chunks accumulate as the bank compounds. There is no aging-out mechanism: a reply that was correct six months ago but reflects a now-changed process stays `active` unless manually archived via direct SQL. At current low volume this is not a problem; it becomes one once the bank is large enough that retrieval routinely surfaces older, weaker matches over newer, better ones.

**Acceptable at current volume.** Revisit when a client's bank exceeds ~500 chunks.

---

## Acceptance criteria (as-built)

- Migrations 0022 + 0023 create tables, enums, indexes, and seed default prompts.
- All four ingestion adapters land chunks with embeddings; re-running does not duplicate.
- `pending_review` path works when `labelChunk` returns `topicId: null`.
- Retrieval is client-scoped, active-only, ranked by cosine similarity; HNSW iterative scan prevents multi-tenant recall degradation.
- `sprigly-question-answerer` registered and runnable end-to-end; produces a Gmail draft, never auto-sends.
- triageTopicId forwarding validated against `ctx.knowledgeTopics`; invalid IDs discarded with log.
- Feedback loop: send-detection (primary) + admin approve (complementary) both write `feedbackIngestedAt`; first-writer wins.
- Sprigly configured as client #0. Knowledge bank is empty — do not seed with invented content.
