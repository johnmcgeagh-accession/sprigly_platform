# Roadmap: Sprigly Engine

## Overview

Build the Sprigly platform from monorepo scaffold to a working end-to-end AI workflow engine — email in, finished work out — with an admin UI and Sprigly's own blog + prospect-research pipelines running on it.

## Current Milestone

**v0.1 Engine MVP**
Status: In progress
Phases: 2 of 4 complete

## Phases

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Foundations | 4 | Complete | 2026-05-12 |
| 2 | Engine + First Workflow | 5 | Complete | 2026-05-13 |
| 3 | Admin UI | 4 | Not started | — |
| 4 | Second Workflow + Multi-source | 3 | Not started | — |

---

## Phase Details

### Phase 1 — Foundations

**Goal:** Monorepo scaffold, DB schema, model client (Anthropic + Bedrock), audit logger, OAuth token storage with envelope encryption. Stop and verify before Phase 2.

**Depends on:** Nothing (first phase)

**Plans:**
- [x] 01-01: Workspace init + site migration + monorepo skeleton ✓ 2026-05-11
- [x] 01-02: `packages/db` — full Drizzle schema, migrations, seed ✓ 2026-05-12
- [x] 01-03: `packages/model-client` + `packages/audit` ✓ 2026-05-12
- [ ] 01-04: `packages/oauth-tokens` + AWS KMS setup (checkpoint)

---

### Phase 2 — Engine + First Workflow

**Goal:** Core engine orchestration, Gmail source, Sprigly's blog-post workflow (ported from old pipeline), destinations, worker service. End-to-end test: email in → blog post in DB → notification out.

**Depends on:** Phase 1

**Plans:**
- [x] 02-01: `packages/engine` — EventRouter, WorkflowRegistry, WorkflowRunner, DestinationDispatcher, PromptResolver ✓ 2026-05-12
- [x] 02-02: `packages/sources/email-gmail` — Gmail poller + body parser + idempotency ✓ 2026-05-12
- [x] 02-03: `packages/workflows/sprigly-blog-post` — three-model-call blog pipeline ✓ 2026-05-12
- [ ] 02-04: `packages/destinations` (db-save-blog-post + gmail-send-notification) + seed routing rules + prompt templates
- [ ] 02-05: `apps/worker` — cron poller, BullMQ queue, consumer, Gmail OAuth setup script

---

### Phase 3 — Admin UI

**Goal:** Next.js 14 admin at `/admin/*` behind Clerk. Dashboard, clients, routing rules, prompt editor, events, approvals, audit log.

**Depends on:** Phase 2

**Plans:**
- [x] 03-01: `apps/web` scaffold + Clerk auth + dashboard + clients list/detail ✓ 2026-05-13
- [x] 03-02: Routing rule builder UI (source, conditions, workflow, destinations) ✓ 2026-05-13
- [x] 03-03: Prompt template editor with version history ✓ 2026-05-13
- [ ] 03-04: Events list, approvals queue, audit log pages

---

### Phase 4 — Second Workflow + Multi-source Proof

**Goal:** Prospect sheet workflow, Gmail reply destination, webhook source scaffold.

**Depends on:** Phase 3

**Plans:**
- [ ] 04-01: `packages/workflows/sprigly-prospect-sheet` + `packages/destinations/gmail-reply`
- [ ] 04-02: `packages/sources/webhook` — HMAC-validated webhook source + `/api/webhook/[clientId]/[ruleId]` endpoint
- [ ] 04-03: Seed prospect-sheet routing rule + end-to-end test

---

*Roadmap created: 2026-05-11*
