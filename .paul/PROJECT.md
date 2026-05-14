# Sprigly Engine

## What This Is

The Sprigly platform — a generic AI workflow engine for founder-led businesses. Clients trigger work by email (later SMS, Slack, webhook) and receive finished work back. Internally: Sources produce events, Workflows process them via Claude, Destinations deliver results.

Sprigly is the first client of its own engine — using it for the blog pipeline and prospect research. Paying clients come after the engine is solid.

## Core Value

"Brief in, finished work out." AI agents trained on how each client's business works. Adding a client = config rows + OAuth, not code changes.

## Workspace Structure

```
/Users/johnmcgeagh/Documents/Workspaces/sprigly/
├── engine/    # This monorepo
└── site/      # Sprigly marketing site (migrated from aigura workspace)
```

## Current State

| Attribute | Value |
|-----------|-------|
| Version | 0.1.0 |
| Status | Not started |
| Last Updated | 2026-05-11 |

## Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Monorepo | pnpm workspaces + Turborepo | |
| Web/Admin | Next.js 14, TypeScript, Tailwind, shadcn/ui | `/admin/*` behind Clerk — admin only |
| Worker | Node.js TypeScript | Separate Railway service |
| DB | Postgres via Drizzle ORM | Railway |
| Auth | Clerk | Admin only at L2; L3-ready for client users |
| Queue | BullMQ on Redis | Railway add-on |
| Hosting | Railway | web, worker, Postgres, Redis |
| Inference | AWS Bedrock eu-west-2 (prod) / Anthropic API (dev) | Same code, env-switched |
| Encryption | AWS KMS + envelope encryption | OAuth tokens only |
| Email | Gmail API | Microsoft Graph for Outlook later |

## Architecture Constraints

- Every table has `client_id` — no globally-scoped data
- Audit log is non-negotiable — every model call, event, delivery captured
- No email content at rest (metadata yes, bodies no — except blog post output which IS the product)
- TypeScript strict mode everywhere; no `any`
- No `console.log` in production — use `pino`
- Env vars validated at startup via Zod; process exits on missing required vars
- Tests with Vitest for engine, model-client, workflow logic

## Key Decisions

| Decision | Rationale | Date | Status |
|----------|-----------|------|--------|
| Clerk for auth | Managed auth, minimal setup, L3-ready | 2026-05-11 | Active |
| `apps/web` is admin-only | Marketing site stays separate at `sprigly/site/` | 2026-05-11 | Active |
| Fresh `blog_posts` table | No migration of existing Aigura blog posts | 2026-05-11 | Active |
| Kill aigura.co.uk | Sprigly replaces it | 2026-05-11 | Active |
| AWS setup via guided checkpoint | KMS/Bedrock not yet configured — walk user through it | 2026-05-11 | Active |
| Local-dev encryption fallback | Static env key if no AWS creds; clearly logged | 2026-05-11 | Active |

## Success Criteria (v1 complete)

- Log into `/admin`, see Sprigly as a client
- Send `Blog: [topic]` email → event in `/admin/events` within 5 min → blog post in DB → notification email with preview/publish links
- Send `Prospect: [brand]` email → prospect sheet returned as email reply
- Curl webhook endpoint → event appears (multi-source proof)
- Edit prompt template in `/admin` → retrigger → new prompt takes effect
