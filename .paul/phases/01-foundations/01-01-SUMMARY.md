# Plan 01-01 Summary — Workspace Init + Monorepo Skeleton

**Phase:** 01-foundations
**Plan:** 01
**Status:** Complete
**Executed:** 2026-05-11

## What Was Built

### Workspace structure
- `/Workspaces/sprigly/site/` — Sprigly marketing site copied from aigura workspace (node_modules stripped; original untouched)
- `/Workspaces/sprigly/engine/` — monorepo root

### Monorepo root config
- `package.json` — pnpm@10.32.1 workspace root, turbo scripts
- `pnpm-workspace.yaml` — includes `apps/*` and `packages/*`
- `turbo.json` — build/dev/lint/test/type-check pipeline with all env vars declared
- `tsconfig.json` — strict base (ES2022, NodeNext, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
- `.env.example` — all env vars documented with comments
- `.gitignore`

### Package stubs (10 packages)
All have `package.json` (correct `@sprigly/*` name, workspace deps), `tsconfig.json` (extends root), `src/index.ts` (stub with phase comment):
- `packages/db` — deps: drizzle-orm, postgres, drizzle-kit
- `packages/model-client` — deps: @anthropic-ai/sdk, @aws-sdk/client-bedrock-runtime
- `packages/engine` — deps: @sprigly/db, audit, prompts; includes full `src/types.ts` with all core interfaces
- `packages/sources` — deps: @sprigly/db, engine, oauth-tokens
- `packages/workflows` — deps: @sprigly/engine, model-client, audit
- `packages/destinations` — deps: @sprigly/db, engine, oauth-tokens
- `packages/oauth-tokens` — deps: @sprigly/db, @aws-sdk/client-kms
- `packages/audit` — deps: @sprigly/db
- `packages/prompts` — deps: @sprigly/db
- `packages/ui` — peer deps: react, react-dom

### App stubs (2 apps)
- `apps/worker` — Node.js TypeScript, pino logger stub
- `apps/web` — Next.js ^14.2.25, Clerk, Tailwind; minimal layout + placeholder page

## Verification Results
- `pnpm install` — exit 0, 393 packages, all @sprigly/* workspace links resolved
- All 10 packages `tsc --noEmit` — ✓ clean
- `apps/worker tsc --noEmit` — ✓ clean
- `apps/web tsc --noEmit` — ✓ clean

## Decisions Made
- pnpm version: 10.32.1 (matched installed version, not 9.0.0 from plan)
- Next.js bumped to `^14.2.25` (14.2.0 in plan was too old for @clerk/nextjs 6.x peer dep)
- apps/web runs on port 3100 (avoids conflict with Sprigly marketing site at 3000)

## Deferred / Out of Scope
- No business logic implemented — all packages are stubs
- esbuild build scripts flagged by pnpm approve-builds (cosmetic warning; esbuild works via pre-built binaries)
- apps/web Tailwind config not yet set up — Phase 3

## Next Plan
01-02: `packages/db` — full Drizzle schema for all tables, migration, connection client, seed script
