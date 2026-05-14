---
phase: 01-foundations
plan: 02
subsystem: database
tags: [drizzle-orm, postgres, drizzle-kit, zod, migrations]

requires:
  - phase: 01-01
    provides: monorepo scaffold, packages/db stub, tsconfig base

provides:
  - Full Drizzle schema for all 13 tables
  - Typed DB client (drizzle + postgres-js, Zod-validated env)
  - Migration runner + idempotent seed script
  - Generated migration SQL (0000_nice_spirit.sql)

affects: engine, audit, oauth-tokens, sources, workflows, destinations, worker, web

tech-stack:
  added: [zod@^3.22]
  patterns:
    - text() columns for string enums (not pgEnum) — avoids migration pain
    - sql`'{}'` for empty array defaults (drizzle-kit 0.20 bug workaround)
    - baseColumns spread for id/createdAt/updatedAt consistency
    - NodeNext .js extensions in all relative imports

key-files:
  created:
    - engine/packages/db/src/schema.ts
    - engine/packages/db/src/client.ts
    - engine/packages/db/src/migrate.ts
    - engine/packages/db/src/seed.ts
    - engine/packages/db/drizzle.config.ts
    - engine/packages/db/migrations/0000_nice_spirit.sql
  modified:
    - engine/packages/db/src/index.ts
    - engine/packages/db/package.json

key-decisions:
  - "text() + TypeScript union types instead of pgEnum — avoids ALTER TYPE migrations"
  - "sql`'{}'` for text array defaults — drizzle-kit 0.20 emits empty DEFAULT for .default([])"
  - "Admin email: john@sprigly.co.uk"

patterns-established:
  - "baseColumns spread: id (uuid pk), createdAt, updatedAt on every table"
  - ".$type<T>() on all jsonb columns for typed inference"
  - "NodeNext module resolution: .js extensions in all relative imports"
  - "Idempotent seed via onConflictDoNothing()"

duration: ~45min
started: 2026-05-12T21:00:00Z
completed: 2026-05-12T22:00:00Z
---

# Phase 1 Plan 02: packages/db — Schema, Client, Migrations Summary

**Drizzle schema for 13 tables with FK constraints and unique indexes, typed connection client with Zod env validation, migration runner, and idempotent seed.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~45 min |
| Tasks | 2 completed + checkpoint approved |
| Files created | 6 |
| Files modified | 2 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Schema compiles clean | Pass | tsc --noEmit exits 0 |
| AC-2: Migration generated | Pass | migrations/0000_nice_spirit.sql — 13 CREATE TABLE statements |
| AC-3: Seed succeeds against live DB | Pass | Sprigly client + john@sprigly.co.uk admin row verified |
| AC-4: Package exports correct | Pass | db, sql, all tables and types re-exported from index.ts |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `packages/db/src/schema.ts` | Created | 13 Drizzle tables, FK refs, unique indexes, inferred types |
| `packages/db/src/client.ts` | Created | Zod-validated DATABASE_URL, postgres + drizzle instance |
| `packages/db/src/migrate.ts` | Created | Runs pending migrations via drizzle migrator |
| `packages/db/src/seed.ts` | Created | Idempotent: Sprigly client + admin user |
| `packages/db/drizzle.config.ts` | Created | drizzle-kit config (schema path, migrations out, dialect) |
| `packages/db/migrations/0000_nice_spirit.sql` | Created | Generated — 13 CREATE TABLE + FK + unique index statements |
| `packages/db/src/index.ts` | Modified | Replaced stub — re-exports all schema + db client |
| `packages/db/package.json` | Modified | Added zod dependency; fixed generate script to generate:pg |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| `text()` for enum columns, not `pgEnum` | Avoids ALTER TYPE migrations when values change | All enum-like columns are plain text with TypeScript union types |
| `sql\`'{}'\`` for empty text array default | drizzle-kit 0.20 emits `DEFAULT  NOT NULL` (broken SQL) for `.default([])` | Required for `oauth_connections.scopes` column |
| Admin email: `john@sprigly.co.uk` | Corrected from john.mcgeagh@gmail.com during checkpoint | Seed script updated; DB row updated manually |
| `zod` added to @sprigly/db dependencies | Env validation at module load — process fails fast if DATABASE_URL missing | All packages using the client will inherit validated startup |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 3 | Essential corrections, no scope creep |

### Auto-fixed Issues

**1. drizzle-kit generate command**
- **Found during:** Task 2
- **Issue:** `drizzle-kit generate` not recognised in v0.20; correct command is `generate:pg`
- **Fix:** Updated `package.json` scripts: `"generate": "drizzle-kit generate:pg"`
- **Verification:** Command ran, produced migration file

**2. text array empty default generates invalid SQL**
- **Found during:** Checkpoint (migration failed with syntax error at position 359)**
- **Issue:** `text('scopes').array().default([])` → `DEFAULT  NOT NULL` (empty, invalid SQL)
- **Fix:** Changed to `default(sql\`'{}'\`)` using drizzle-orm's `sql` tag
- **Files:** `src/schema.ts`, migrations regenerated cleanly

**3. Seed admin email**
- **Found during:** Checkpoint review
- **Issue:** Seed used `john.mcgeagh@gmail.com` — should be `john@sprigly.co.uk`
- **Fix:** Updated `seed.ts`; user updated DB row directly

## Next Phase Readiness

**Ready:**
- `import { db, clients, users, ... } from '@sprigly/db'` works from any package
- All 13 tables exist in local DB with correct constraints
- Inferred types (`Client`, `User`, `BlogPost`, etc.) available for use in engine, audit, oauth-tokens
- Migration SQL committed — Railway deploy will run it automatically

**Concerns:**
- None

**Blockers:**
- None

---
*Phase: 01-foundations, Plan: 02*
*Completed: 2026-05-12*
