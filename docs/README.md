# Sprigly Engine Documentation

This directory is the canonical reference for the Sprigly engine. A new contributor -- or the author in six months -- should be able to understand the system, build a new workflow, and operate it in production using these docs alone.

Read them in this order if you are new. Jump directly to any section if you know what you need.

---

## Reference

Stable facts that do not change unless the code changes.

| Document | What it covers |
|---|---|
| [reference/glossary.md](reference/glossary.md) | All Sprigly-specific terms defined against the code |
| [reference/database-schema.md](reference/database-schema.md) | Every table, every column, JSONB shapes, FK diagram |
| [reference/env-vars.md](reference/env-vars.md) | Every environment variable, required vs optional, grouped by subsystem |
| [reference/api-tools.md](reference/api-tools.md) | The `web_search` tool definition, wiring, and limits |

---

## Architecture

Why the system is built the way it is.

| Document | What it covers |
|---|---|
| [architecture/decisions.md](architecture/decisions.md) | 12 ADRs: Bedrock, storage, PDF, Tavily, prompts-in-DB, Gmail polling, routing, IAM, BullMQ, error propagation, tool-use loop |

---

## Infrastructure

How each package works.

| Document | What it covers |
|---|---|
| [infrastructure/model-client.md](infrastructure/model-client.md) | BedrockClient, AnthropicClient, tool-use loop, force-summarise at MAX_TOOL_TURNS, throttle retry |
| [infrastructure/sources.md](infrastructure/sources.md) | GmailPoller, `is:unread` polling, idempotency, email parser |
| [infrastructure/routing.md](infrastructure/routing.md) | EventRouter, matchRules(), condition operators, fallback logic |
| [infrastructure/destinations.md](infrastructure/destinations.md) | DestinationDispatcher, all four registered destinations, settings shapes |
| [infrastructure/web-search.md](infrastructure/web-search.md) | TavilyProvider, WEB_SEARCH_TOOL_DEFINITION, operator guard, error propagation |
| [infrastructure/pdf-render.md](infrastructure/pdf-render.md) | render(), renderNoData(), fonts, adding a new document type |

---

## Workflows

How to understand, use, and build workflows.

| Document | What it covers |
|---|---|
| [workflows/anatomy.md](workflows/anatomy.md) | The Workflow interface, WorkflowContext, step pattern, shared/hardcoded/prompt-controlled three-column table for all three workflows |
| [workflows/prompts.md](workflows/prompts.md) | DbPromptResolver lookup order, variable substitution, versioning, client overrides |
| [workflows/existing.md](workflows/existing.md) | sprigly-blog-post, sprigly-prospect-research (production); sprigly-meeting-prep (scaffold skeleton, not registered) |
| [workflows/adding-a-workflow.md](workflows/adding-a-workflow.md) | `pnpm new-workflow` scaffold, six manual steps, working checklist |

---

## Operations

Running the system.

| Document | What it covers |
|---|---|
| [operations/deployment.md](operations/deployment.md) | Railway worker, Vercel admin app, migrations, onboarding a new client, Gmail OAuth setup |
| [operations/monitoring.md](operations/monitoring.md) | Admin UI pages tour, worker log patterns, useful DB queries |
| [operations/troubleshooting.md](operations/troubleshooting.md) | Known failures with verbatim error strings and resolution steps |
| [operations/costs.md](operations/costs.md) | Price map, empirical data from eval runs, per-workflow estimates |

---

## Diagrams

| File | What it shows |
|---|---|
| [diagrams/system-overview.mmd](diagrams/system-overview.mmd) | All services and their connections |
| [diagrams/email-flow.mmd](diagrams/email-flow.mmd) | Gmail poll cycle step by step |
| [diagrams/workflow-execution.mmd](diagrams/workflow-execution.mmd) | BullMQ job to destination dispatch |
| [diagrams/data-model.mmd](diagrams/data-model.mmd) | Entity-relationship diagram for all 13 tables |
| [diagrams/deployment.mmd](diagrams/deployment.mmd) | Railway, Vercel, AWS, and external services |

Diagrams are Mermaid source files (`.mmd`). Render them with [Mermaid Live Editor](https://mermaid.live/) or any Mermaid-capable viewer.

---

## Key facts for quick orientation

- **Two workflows in production:** `sprigly-blog-post` (email to blog post saved in DB) and `sprigly-prospect-research` (email to PDF reply). `sprigly-meeting-prep` exists as a skeleton only.
- **Model provider:** AWS Bedrock (`eu-west-2`) in production. Anthropic direct API for local dev (`MODEL_PROVIDER=anthropic`).
- **Email polling:** `is:unread` query, every 60 seconds. Marks messages read after processing. Not watermark-based -- see ADR 7 and BACKLOG.
- **Prompts live in the database.** Every workflow step resolves its prompt at runtime via `DbPromptResolver`. Edit prompts in the admin UI without a code deploy.
- **Costs:** Blog post ~£0.009-0.010 per run (Haiku/Bedrock). Prospect research varies with search depth: ~£0.03-0.30 per run (Sonnet/Bedrock + Tavily searches).
