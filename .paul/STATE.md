# Project State

## Project Reference

See: .paul/PROJECT.md (created 2026-05-11)

**Core value:** Generic AI workflow engine — email in, finished work out. Clients trigger via email/Slack/SMS, receive completed work back.
**Current focus:** Phase 1 — Foundations (monorepo scaffold, DB, model client, audit, OAuth tokens)

## Current Position

Milestone: v0.1 Engine MVP
Phase: 3 of 4 (Admin UI) — Not started
Plan: 03-04 (PLAN written, awaiting APPLY)
Status: Phase 3 in progress — final plan
Last activity: 2026-05-13 — 03-04 PLAN written; ready to APPLY

Progress:
- Milestone: [███████░░░] 68%
- Phase 1: [██████████] 100% ✓ COMPLETE
- Phase 2: [██████████] 100% ✓ COMPLETE
- Phase 3: [███████░░░] 75% (3/4 plans complete)

## Loop Position

03-04 loop open:
```
PLAN ✓  APPLY —  UNIFY —
```

## Accumulated Context

### Decisions
- Auth: Clerk (admin only at L2; L3-ready for client users)
- apps/web is admin-only; marketing site lives at sprigly/site/ (separate)
- No migration of existing Aigura blog posts — fresh start
- Kill aigura.co.uk
- AWS KMS/Bedrock not yet configured — Plan 01-04 has a guided checkpoint
- Local-dev encryption fallback: static env key if no AWS creds, clearly logged
- Package naming: @sprigly/* throughout
- Schema enums: text() + TypeScript unions (not pgEnum)
- text[].default([]): use sql`'{}'` for empty array defaults
- Admin user email: john@sprigly.co.uk
- baseColumns spread pattern: id/createdAt/updatedAt on every table
- ModelClient + AuditLogger types defined locally (structural compat with engine/types.ts)
- Bedrock ToolInputSchema: cast `as ToolInputSchema`
- Spread conditionals for optional params: `...(x !== undefined && { key: x })`
- oauth_connections has no composite unique on (clientId, provider) — use select-then-upsert pattern
- Seed script: run via `pnpm --filter @sprigly/db seed` from engine root (not `../../node_modules/.bin/tsx` — that path doesn't exist)
- Worker `dev` script: uses shell wrapper (`sh -c 'set -a && . ../../.env.local && ...'`) — `tsx --env-file ... watch ...` ordering treats `watch` as the entry file
- OAuth setup: port 3456 (3000 taken by Next.js); scopes are `gmail.readonly + gmail.send` (not `gmail.modify`)
- storeTokens always INSERTs — re-running setup-gmail creates duplicate oauth_connections rows; delete old rows first

### Deferred Issues
- Price map rates are placeholder (TODO) — update before production billing

### Blockers/Concerns
- None active

## Session Continuity

Last session: 2026-05-13
Stopped at: 03-03 complete
Next action: Run /paul:plan 03-04 to build events list, approvals queue, audit log pages
Resume file: .paul/phases/03-admin-ui/03-03-SUMMARY.md

---
*STATE.md — Updated after every significant action*
