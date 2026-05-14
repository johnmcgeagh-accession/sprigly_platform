---
phase: 03-admin-ui
plan: 02
type: summary
completed: 2026-05-13
duration: ~1 session
---

# Summary: 03-02 — Routing rule builder UI

## What Was Built

Routing rules CRUD in the Sprigly admin — list, detail, create, toggle enabled, delete — using Next.js 14 Server Components and Server Actions throughout (no client components needed).

**Files created:**
- `engine/apps/web/src/app/admin/routing-rules/page.tsx` — list with client, source, workflowId, condition count, priority, enabled badge; "New rule" button
- `engine/apps/web/src/app/admin/routing-rules/[id]/page.tsx` — detail: conditions table (field/op/value/case-sensitive), destinations list (destinationId + settings JSON), toggle + delete action forms
- `engine/apps/web/src/app/admin/routing-rules/actions.ts` — `'use server'` file with `createRoutingRule`, `toggleEnabled`, `deleteRoutingRule`
- `engine/apps/web/src/app/admin/routing-rules/new/page.tsx` — create form with clientId select, source select, workflowId text, matchConditions JSON textarea, destinations JSON textarea, priority, enabled checkbox

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: List page with data | ✓ PASS | Seeded rule visible |
| AC-2: Detail with conditions + destinations | ✓ PASS | Human-readable table/list display |
| AC-3: Create form produces DB row | ✓ PASS | Verified via test rule creation |
| AC-4: Toggle enabled | ✓ PASS | Flips enabled flag, page re-renders |
| AC-5: Delete removes row | ✓ PASS | Redirects to list after delete |
| AC-6: Type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |

## Decisions Made

- **Server Actions only — no client components**: Toggle and delete are plain HTML forms with `action={serverAction}`. No `useState`, no `'use client'` needed.
- **Type assertion for JSONB arrays**: `rule.matchConditions as Condition[]` and `rule.destinations as Destination[]` — local type aliases defined in the detail page for readable rendering.
- **JSON textarea for conditions/destinations**: Full dynamic form builder is out of scope for v0.1. JSON textareas are pragmatic for an internal admin tool and cover all cases.
- **`defaultValue` not `value` on textarea**: Server Components render HTML directly; `defaultValue` becomes the initial textarea content correctly without client-side state.
- **`enabled === 'on'` for checkbox**: HTML checkbox submits `'on'` when checked, absent when unchecked — `formData.get('enabled') === 'on'` is the correct pattern.
- **`enabled === 'true'` for toggle hidden input**: The toggle form passes `String(!rule.enabled)` as a hidden input value, so the action reads `enabled === 'true'`.

## Deferred Issues

- No routing rule edit page — create + toggle + delete covers v0.1 needs.
- No clientConfigId picker on create form — always null; can link a config to a rule via DB if needed.
- No form validation UI — invalid JSON throws a server error (not user-friendly); acceptable for an internal admin tool.
- No active nav highlighting on sidebar — Link has no `usePathname()` active state (requires client component pattern; deferred).

## Next Plan

03-03: Prompt template editor with version history
