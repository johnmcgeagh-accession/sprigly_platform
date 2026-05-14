---
phase: 03-admin-ui
plan: 01
type: summary
completed: 2026-05-13
duration: ~1 session
---

# Summary: 03-01 — apps/web scaffold + Clerk auth + dashboard + clients

## What Was Built

`@sprigly/web` — Next.js 14 App Router admin UI with Clerk v6 auth, Tailwind CSS, and four live data pages querying Drizzle directly from Server Components.

**Files created/modified:**
- `engine/apps/web/package.json` — dev script shell wrapper; added `drizzle-orm ^0.30.0` as direct dep
- `engine/apps/web/src/app/globals.css` — Tailwind base/components/utilities directives
- `engine/apps/web/src/middleware.ts` — Clerk v6 `clerkMiddleware` protecting `/admin/*` and `/`
- `engine/apps/web/src/app/layout.tsx` — ClerkProvider + globals.css import
- `engine/apps/web/src/app/page.tsx` — redirects to `/admin`
- `engine/apps/web/src/app/sign-in/[[...sign-in]]/page.tsx` — Clerk `<SignIn />` catch-all
- `engine/apps/web/src/app/admin/layout.tsx` — sidebar nav (Dashboard, Clients, + stub links for future phases)
- `engine/apps/web/src/app/admin/page.tsx` — stat cards (active clients, events 24h, pending approvals) + recent runs table
- `engine/apps/web/src/app/admin/clients/page.tsx` — all clients table
- `engine/apps/web/src/app/admin/clients/[id]/page.tsx` — client detail: config, OAuth connections, recent events

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-2: / redirects to /admin | ✓ PASS | `redirect('/admin')` in root page |
| AC-3: unauthenticated → /sign-in | ✓ PASS | Clerk middleware + `auth.protect()` |
| AC-4: sign-in page renders | ✓ PASS | Clerk `<SignIn />` component |
| AC-5: dashboard stat cards + runs | ✓ PASS | User verified in browser |
| AC-6: /admin/clients shows clients | ✓ PASS | User verified in browser |
| AC-7: /admin/clients/[id] detail | ✓ PASS | User verified in browser |

## Decisions Made

- **`next.config.mjs` already had `transpilePackages`**: No change needed — scaffold was more complete than expected.
- **`postcss.config.js` and `tailwind.config.ts` already existed**: Both in place from initial scaffold.
- **`drizzle-orm` as direct dep in web**: Same pattern as all other packages — `eq`/`gt`/`desc`/`sql` fail type-check without it as a direct dep.
- **`sql<number>\`cast(count(*) as int)\``**: drizzle 0.30 has no `count()` helper; raw SQL cast used for all three stat queries.
- **Dev script shell wrapper**: Next.js doesn't auto-load `../../.env.local` from the monorepo root. Shell wrapper pattern `sh -c 'set -a && . ../../.env.local && set +a && next dev --port 3100'` used (same as worker).
- **Clerk env vars in `apps/web/.env.local`**: Next.js auto-loads from the package root; four vars required: publishable key, secret key, sign-in URL, after-sign-in URL.

## Deferred Issues

- Sidebar nav links for Routing Rules, Prompts, Events, Approvals, Audit Log — stubs only; pages to be built in Plans 03-02 through 03-04.
- No active nav highlighting — Link component has no `usePathname()` active state check (client component pattern needed for that).
- No sign-out button in the admin shell — acceptable for v0.1; Clerk `<UserButton />` can be added later.

## Next Plan

03-02: Routing rule builder UI (source, conditions, workflow, destinations)
