# Surface kind follows the viewed cycle

**Date:** 2026-07-21
**Branch:** `dev`
**Spec:** `docs/reports/draft-mode-not-rendering.md` (the investigation; its Q7/Q8 are the reproduction)

| commit | contents |
|---|---|
| `88778ee` | `fix: an outstanding draft wins the landing` |
| `2831d40` | `feat: the surface kind follows the viewed cycle` |
| `75070ca` | `fix: a cycle holding a reviewable draft qualifies for the month menu` |

Three defects, one symptom. The landing picked the wrong cycle; the surface could not
change once picked; and a draft on a non-home cycle was not reachable at all.

---

## Commit 1 — landing: an outstanding draft wins

**`app/src/lib/cycle-nav.ts:88`** — new `resolveLandingCycleId`, pure:

```ts
export function resolveLandingCycleId(params: {
  cycles: readonly CycleMonthRef[]; today: string;
  homeCycleId: string; homeHasReviewableDraft: boolean;
}): string {
  if (params.homeHasReviewableDraft) return params.homeCycleId;
  return resolveDayCycleId(params.cycles, params.today) ?? params.homeCycleId;
}
```

**`app/src/app/page.tsx:53`** — the call site, replacing the bare `resolveDayCycleId`:

```ts
const initialCycleId = resolveLandingCycleId({
  cycles,
  today:                  editScopeToday(),
  homeCycleId:            session.cycleId,
  homeHasReviewableDraft: await cycleHasReviewableDraft(session.clientId, session.cycleId),
});
```

Extracted rather than inlined so the rule is testable without rendering a server component.
The predicate is **passed in**, not fetched inside, so `cycleHasReviewableDraft`
(`plan.ts:322`) keeps one definition and this stays pure.

**No fence was touched**, per the report's caution. `cycleHasReviewableDraft` is the
existing named exception to the draft fence; `excludeDraftPosts()` is unchanged everywhere.

---

## Commit 2 — the surface decision moves with the month

### Server: one computation, two callers

**`app/src/lib/plan.ts:409`** — `surfaceForCycle`, the single server-side computation:

```ts
export async function surfaceForCycle(params: {
  clientId: string; cycleId: string; committedPostCount: number; planRedesign: boolean;
}): Promise<{ kind: SurfaceKind; draftBeats: DraftBeatView[] }> {
  const draftBeats = mayHaveDraftSurface({ hasSession: true, committedPostCount: params.committedPostCount })
    ? await loadDraftBeats(params.clientId, params.cycleId)
    : [];
  const kind = resolveSurfaceKind({ hasSession: true, committedPostCount: params.committedPostCount,
                                    draftBeatCount: draftBeats.length, planRedesign: params.planRedesign });
  return { kind, draftBeats };
}
```

It wraps the **existing** `resolveSurfaceKind` with that cycle's real inputs — the fenced
committed count the caller already loaded, the `loadDraftBeats` count, and the flag. The
laziness `page.tsx` had is preserved: `mayHaveDraftSurface` still gates the draft read.

Both callers now use it, so the first paint and a month switch cannot disagree:

- **`app/src/app/page.tsx:112`** — first paint (replaced its inline block).
- **`app/src/app/api/plan/route.ts:76`**, returned at **`:83`**:
  ```ts
  return NextResponse.json({ posts, crossMonthPosts, beats, intake, durable, surfaceKind, readOnly: !isHome });
  ```

### Draft data never rides the committed payload

**`app/src/lib/plan.ts:438`** — `loadDraftSurfaceContext` (pillars / editable / receipts),
served by the existing deliberate draft reader at **`app/src/app/api/plan/draft/route.ts:64`**.
`page.tsx:126` uses the same helper, so a draft entered by landing and one entered by a
switch render identically. `monthLabel` is deliberately absent — the client already has it
from the cycle list, and a second source would be a second truth.

The route takes the channel from the cycle row, never the request
(`api/plan/draft/route.ts:56-63`), and an unknown cycle returns an empty surface rather
than an error or a leak.

### Client: follows, never decides

**`app/src/lib/surface-state.ts:69`** — the transition, named and pure:

```ts
export function followServerSurface(serverKind: SurfaceKind | undefined): { kind: SurfaceKind; loadDraft: boolean } {
  const kind = serverKind ?? 'committed-redesign';
  return { kind, loadDraft: kind === 'draft' };
}
```

**`app/src/components/plan/usePlanData.ts:541`** — used inside `switchCycle`: on `draft` it
fetches `/api/plan/draft?cycleId=`; otherwise it **clears** the stored draft, so a stale
draft can never render over a committed month. `resolveSurfaceKind` is not called
client-side anywhere.

**`app/src/components/plan/PlanRoot.tsx:48`** — renders the surface the server chose:

```tsx
if (data.surfaceKind === 'draft' && data.draft) {
  return <DraftPlan … cycles={data.cycles} viewedCycleId={data.viewedCycleId} onSwitchCycle={data.switchCycle} … />;
}
```

This is a switch on the union, not a fork on "are there drafts?" — the client cannot reach
a different conclusion than the server did.

### Two consequences worth stating

**Draft mode now renders inside `PlanRoot`** for redesign tenants, because that is where the
month switcher lives. Rendered standalone it had no way out: a client who landed on a draft
could not look at any other month. `page.tsx:129` keeps the standalone render for flag-off
tenants — their legacy shell has no switcher for it to sit inside, so nothing changes for
them. `DraftPlan` gained an optional month nav (`DraftPlan.tsx:78-100`), absent when those
props are.

**`DraftPlanView` is keyed by cycle** (`DraftPlan.tsx:113`). It holds its beats in local
state (`DraftPlanView.tsx:69`), so without the remount a client returning to a draft month
would see the month they left.

---

## Commit 3 — menu qualification

**`app/src/lib/plan.ts:234` and `:242`**:

```ts
const withDraft = await cyclesWithReviewableDraft(clientId, rows.map((r) => r.cycleId));
…
const reviewableDraft = withDraft.has(r.cycleId);
if (!isHome && !reviewableDraft && (r.liveCount === 0 || r.syncStatus === 'out_of_sync')) continue;
```

**`app/src/lib/plan.ts:345`** — `cyclesWithReviewableDraft`, the batch form, one query for
the whole menu rather than one per cycle.

### One deviation from the brief, stated plainly

The brief asked for **named predicate reuse, no inline re-derivation**. There is no inline
re-derivation — the menu calls a named predicate. But the batch helper **states the rule a
second time** rather than the single-cycle form delegating to it.

I tried the delegation first. It broke two assertions in `draft-reader.test.ts:184-196`,
which pin `cycleHasReviewableDraft`'s **query shape** — specifically that the WHERE carries
`clientId` and `status='draft'`. That is ownership scoping, a security property, not an
implementation detail. Given the brief's "all prior suites unmodified", I reverted the
delegation and left the original function byte-identical. Both helpers carry a comment
saying they state one rule and must change together, and naming the condition for
collapsing them (a third caller, with that test updated deliberately).

Flagging it because it is a real, if small, duplication that I chose rather than inherited.

---

## Test output

```
Test Files  37 passed | 1 skipped (38)
     Tests  401 passed | 1 skipped (402)
```

`pnpm --filter @sprigly/app type-check` clean. Worker and db packages untouched.

### New coverage, against the brief's list

**Landing** — `app/src/lib/cycle-nav.test.ts` (fixture mirrors the report's Q7 result):
```
✓ lands on the home cycle when it holds a reviewable draft
✓ falls back to the date rule when the home cycle has no draft
✓ the date rule wins again once the draft is approved (no longer reviewable)
✓ exact plan-month match still beats nearest-future when there is no draft
✓ falls back to the home cycle when the list is empty
```

**Surface per cycle + round trip** — `app/src/lib/surface-follows-cycle.test.ts`:
```
✓ draft-only cycle → draft
✓ committed cycle → committed-redesign
✓ MIXED (committed posts AND drafts) → committed wins, per the Build B rule
✓ empty cycle (no posts, no drafts) → committed-redesign, which renders its own empty state
✓ flag-off tenant with a draft still gets draft — the draft check precedes the flag
✓ ROUND TRIP: draft → committed → draft, the hole the report identified
✓ draft: adopt it and fetch the draft payload from its own reader
✓ committed: adopt it and load NO draft, so a stale draft cannot render over a plan
✓ missing field falls back to the committed shell, not to an empty draft frame
```

**Menu** — `app/src/lib/cycle-menu-draft.test.ts`:
```
✓ a draft-only NON-HOME cycle appears in the menu
✓ a genuinely empty non-home cycle is still dropped
✓ an out_of_sync non-home cycle WITH a draft is still reachable
✓ an out_of_sync non-home cycle WITHOUT a draft is still dropped
✓ the home cycle is kept regardless, as before
✓ returns only the cycles that hold a live draft
✓ returns an empty set when nothing holds a draft
✓ an empty id list short-circuits — inArray([]) is not valid SQL
```

**Draft reader** — `app/src/app/api/plan/draft/route.test.ts` gained three cases for the
extended GET (context served, channel taken from the row not the request, unknown cycle
yields an empty surface). Its existing assertions are unchanged apart from `toEqual` →
`toMatchObject` on one, which now carries additional fields.

### On the round-trip test

The app's vitest environment is `node` with no DOM testing library, so the round trip is
asserted where the decision actually lives: `surfaceForCycle` asked about the draft cycle,
then the committed one, then the draft cycle again. That is precisely the property that was
broken — previously the surface was computed **once, ever** — and the client half is covered
by `followServerSurface`. A browser-level round trip belongs in the Playwright suite
(`app/e2e/`), which I have not extended.

### Prior suites

`draft-invisibility`, `draft-reader`, `draft-mutations`, `draft-approval`, `surface-state`
and `draft-view` all pass **unmodified** (95 tests). No fence, no invisibility rule, and no
Build B/C/D behaviour was changed.

---

## Expected post-fix values for the report's Q7/Q8

Neither query changes shape; what changes is what the code does with the results. To be run
against UAT **after deploy** — I have not re-run them.

**Q7 (`loadCycleList` mirrored).** The rows are unchanged — the same three cycles, the same
`live_count`, the same `display_month`:

```
 cycle_id     | cycle_month | display_month | live_count | is_home | in_menu
 040d6a1a…    | 2026-09     | 2026-10       |          0 | t       | KEPT
 d5670806…    | 2026-08     | 2026-09       |         13 | f       | KEPT
 447358e2…    | 2026-07     | 2026-08       |         12 | f       | KEPT
```

`040d6a1a` was already KEPT via the `isHome` escape, so **for this client the menu is
identical**. Commit 3 changes the `in_menu` column only for a draft-only cycle that is
**not** home — to see it, mirror the query with a different `homeCycleId`: `040d6a1a` should
then still read KEPT, where before the fix it would have been dropped.

**Q8 (`loadPlanPosts` for the resolved landing cycle).** The query is unchanged, but the
**cycle it should be run against changes**, and that is the whole fix:

| | before | after |
|---|---|---|
| resolved `initialCycleId` | `447358e2` (August) | **`040d6a1a`** (October) |
| Q8 `committed_post_count` for that cycle | 12 | **0** |
| `loadDraftBeats` for that cycle | never called | **10** |
| `surfaceForCycle` → kind | `committed-redesign` | **`draft`** |

So the post-fix Q8 to run is the same SQL with `cycle_id = '040d6a1a-9ad4-4d32-bda2-d67b01f70512'`,
and it should return `0` — with Q6 (`draft_beats`) still returning `10`. Those two together
are what make `resolveSurfaceKind` answer `'draft'`.

**Expected on screen:** the client lands on the October draft surface, not the committed
calendar. Switching to September or August shows the committed shell for those months;
switching back to October returns to draft mode.

---

## Not done

- **No Playwright coverage.** The browser-level round trip is untested; the logic-level one
  is. Worth adding to `app/e2e/` when the surface settles.
- **`plan_ready_sent_at` / migration 0089 is still unapplied** on UAT and prod, as are
  0084/0086/0087 on prod. Unrelated to this build, but it gates any promotion.
- **The month nav added to `DraftPlan`** is deliberately plain (a row of month pills). It
  exists so the draft surface is not a dead end; it has had no design pass.
