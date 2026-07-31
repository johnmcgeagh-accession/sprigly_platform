# Draft mode does not render for earl-of-east / October 2026

**Date:** 2026-07-21
**Branch:** `dev` (same code as deployed UAT)
**Mode:** read-only. All DB access via `psql` against **UAT only** (`10.160.160.193`), with
`PGOPTIONS='-c default_transaction_read_only=on'` (verified `default_transaction_read_only = on`).
SELECTs only. No code edited.

---

## Verdict

**The draft plumbing is intact and correct. It never runs, because the surface is decided
for the wrong cycle.**

`page.tsx:50` picks the landing cycle from *today's date*, not from the month the client is
looking at. Today is 2026-07-21, so the landing cycle is the **August** plan cycle
(`447358e2`, 12 committed posts). The surface decision is then made once, server-side,
against that cycle: 12 committed posts → not draft → `committed-redesign`.

Navigating to October afterwards refetches posts and relabels the header, but **cannot
re-decide the surface** — that already happened on the server. October's 10 rows are all
`status='draft'`, which every committed loader fences out, so the calendar renders empty:
"Earl of East · October", "0 posts".

Every input that *should* produce draft mode is correct: the flags are on, the token is
homed on the draft cycle, the cycle is unapproved and pre-cutoff, and it holds exactly 10
draft beats. The single wrong value is `initialCycleId`.

---

## 1. The render path — one surface, and it is the one Build B modified

**Confirmed: there is no second workspace shell.** The "Plan workspace" page with a Calendar
tab *is* `PlanDesktop`, reached from `page.tsx`. The strings in the screenshot are literals
in that file:

| screenshot text | source |
|---|---|
| "Plan workspace" | `app/src/components/plan/PlanDesktop.tsx:68` |
| "Earl of East · October" | `PlanDesktop.tsx:122` — `{data.clientName} · {MONTHS[month]}` |
| "0 posts" | `PlanDesktop.tsx:125` — `{posts.length} posts · opened from your link…` |
| Calendar tab | `PlanDesktop.tsx:126` — `railBtn('calendar', 'Calendar', …)` |

The "tabs" are the right-rail nav: `type View = 'calendar' | 'timeline' | 'tasks' | 'approvals' | 'notes'` (`PlanDesktop.tsx:16`).

**Route trace.** Magic link → `app/src/app/p/[token]/route.ts:12-23` verifies the token,
sets the session cookie, and redirects to `/`. There is no `middleware.ts`, no route group,
no `(workspace)` directory; the app's entire route tree under `app/src/app` is `/`,
`/p/[token]` and `/expired`. `app/src/components/` holds only `DraftPlan.tsx`,
`PlanApp.tsx`, `PlanRedesign.tsx` and `plan/`.

So the answer to "is the workspace a different surface that never got the draft-mode work?"
is **no**. `page.tsx` renders one of four branches and this is the `committed-redesign` one.
`PlanDesktop` contains no reference to draft beats — correctly, because it is the committed
branch. The decision happens upstream.

---

## 2. Month → cycle resolution

**The rule.** A cycle's display month is the month it *plans* — `cycle_month + 1` — never
derived from post dates. `app/src/lib/plan.ts:231`:

```ts
const displayMonth = nextMonth(r.cycleMonth);
```

with `nextMonth` at `app/src/lib/cycle-nav.ts:17-24`, and the intent stated at
`plan.ts:221-226`: *"A cycle's month is ALWAYS the month it PLANS … it is NEVER derived
from post dates."*

**So "October 2026" is the cycle with `cycle_month = '2026-09'` — which is `040d6a1a`.**
That part of the system is right.

**But the landing cycle is not chosen by viewed month.** `app/src/app/page.tsx:50`:

```ts
const initialCycleId = resolveDayCycleId(cycles, editScopeToday()) ?? session.cycleId;
```

`resolveDayCycleId` (`app/src/lib/cycle-nav.ts:56-72`):

```ts
const month = today.slice(0, 7);
const exact = cycles.find((c) => c.displayMonth === month);
if (exact) return exact.cycleId;
const future = cycles
  .filter((c) => c.displayMonth > month)
  .sort((a, b) => a.displayMonth.localeCompare(b.displayMonth))[0];   // nearest ahead
if (future) return future.cycleId;
```

### Reproducing the resolution against live data

`loadCycleList` (`plan.ts:196-244`) mirrored — `liveCount` counts live, **draft-fenced**
posts (the `excludeDraftPosts()` sits inside the LEFT JOIN at `plan.ts:213`), and the
qualification filter is `plan.ts:230`:
`if (!isHome && (r.liveCount === 0 || r.syncStatus === 'out_of_sync')) continue;`

```sql
-- Q7
WITH rows AS (
  SELECT cy.id AS cycle_id, cy.cycle_month, cy.status, cy.posts_sync_status AS sync_status,
         count(p.id)::int AS live_count
  FROM content_cycles cy
  LEFT JOIN content_cycle_posts p
    ON p.cycle_id = cy.id AND p.deleted_at IS NULL AND p.status <> 'draft'
  WHERE cy.client_id = (SELECT id FROM clients WHERE slug='earl-of-east')
    AND cy.channel = 'instagram'
  GROUP BY cy.id, cy.cycle_month, cy.status, cy.posts_sync_status
)
SELECT cycle_id, cycle_month,
       to_char((cycle_month||'-01')::date + interval '1 month','YYYY-MM') AS display_month,
       live_count,
       (cycle_id = '040d6a1a-…') AS is_home,
       CASE WHEN cycle_id = '040d6a1a-…' OR (live_count <> 0 AND coalesce(sync_status,'') <> 'out_of_sync')
            THEN 'KEPT' ELSE 'dropped' END AS in_menu
FROM rows ORDER BY display_month DESC;
```

```
               cycle_id               | cycle_month | display_month | live_count | is_home | in_menu
--------------------------------------+-------------+---------------+------------+---------+---------
 040d6a1a-9ad4-4d32-bda2-d67b01f70512 | 2026-09     | 2026-10       |          0 | t       | KEPT
 d5670806-568e-4a66-8cab-f6a808815275 | 2026-08     | 2026-09       |         13 | f       | KEPT
 447358e2-94b0-4ed5-826f-815de0ce5c51 | 2026-07     | 2026-08       |         12 | f       | KEPT
```

**Note the draft cycle survives the menu filter** — it has `liveCount = 0`, but it is the
token's home cycle, so the `isHome` escape at `plan.ts:230` keeps it. (This is worth
stating plainly because it is a tempting wrong answer: the cycle is *not* missing from the
list.)

Now apply `resolveDayCycleId(cycles, '2026-07-21')`:

| step | result |
|---|---|
| `month = '2026-07'` | — |
| exact match `displayMonth === '2026-07'` | **none** — no cycle plans July (that would be `cycle_month = '2026-06'`, which does not exist) |
| nearest future, ascending | `'2026-08'`, `'2026-09'`, `'2026-10'` → first is **`'2026-08'`** |

> **`initialCycleId` = `447358e2-94b0-4ed5-826f-815de0ce5c51` — the August plan cycle.**
> **It is NOT `040d6a1a`.**

That value is passed straight through as the landing month: `page.tsx:146`
`initialCycleId={initialCycleId}` → `usePlanData.ts:68`
`useState(init.initialViewedCycleId ?? init.homeCycleId)`.

---

## 3. The surface-state derivation, with real values

`page.tsx:98-107`:

```ts
const draftBeats = mayHaveDraftSurface({ hasSession: true, committedPostCount: posts.length })
  ? await loadDraftBeats(session.clientId, initialCycleId)
  : [];

const surface: SurfaceKind = resolveSurfaceKind({
  hasSession:         true,
  committedPostCount: posts.length,             // already draft-fenced by loadPlanPosts
  draftBeatCount:     draftBeats.length,
  planRedesign:       readPlanRedesignFlag(cfg?.settings),
});
```

`posts` comes from `loadPlanPosts(session.clientId, initialCycleId)` (`page.tsx:51`), which
is scoped to **one cycle** and draft-fenced (`plan.ts:125-141`).

### The actual inputs

```sql
-- Q8: loadPlanPosts mirrored for the RESOLVED landing cycle
SELECT count(*) AS committed_post_count
FROM content_cycle_posts
WHERE client_id=(SELECT id FROM clients WHERE slug='earl-of-east')
  AND cycle_id='447358e2-94b0-4ed5-826f-815de0ce5c51'
  AND deleted_at IS NULL AND status <> 'draft';
```
```
 committed_post_count
----------------------
                   12
```

```sql
-- Q5: per-cycle vs client-wide committed counts
 cycle 040d6a1a only      | 0
 client-wide (all cycles) | 25
```
```sql
-- Q6: draft beats on 040d6a1a (what loadDraftBeats WOULD see)
 draft_beats
-------------
          10
```
```sql
-- Q4: flags
 earl-of-east | {"plan_redesign": true, "draft_flow_enabled": true}
```

| fact | value | source |
|---|---|---|
| `hasSession` | `true` | valid cookie |
| `initialCycleId` | `447358e2` (August) | Q7 + `cycle-nav.ts:56-72` |
| `committedPostCount` | **12** | Q8 |
| `mayHaveDraftSurface` | **false** (`12 !== 0`) | `surface-state.ts:54-56` |
| `draftBeatCount` | **0** — `loadDraftBeats` never called | `page.tsx:98-100` |
| `planRedesign` | `true` | Q4 |

`resolveSurfaceKind` (`app/src/lib/surface-state.ts:47-51`):

```ts
if (!facts.hasSession) return 'gated';                                          // false
if (facts.committedPostCount === 0 && facts.draftBeatCount > 0) return 'draft'; // 12 !== 0 → false
return facts.planRedesign ? 'committed-redesign' : 'committed-legacy';          // → 'committed-redesign'
```

**Branch: `committed-redesign`.** It is not `draft` because `committedPostCount` is 12 —
the August cycle's posts — and the draft check is short-circuited before `loadDraftBeats`
ever runs. Had `initialCycleId` been `040d6a1a`, the same expression would have been
`0 === 0 && 10 > 0` → `'draft'`.

### Why the header then says "October / 0 posts"

Switching month is client-side and refetches: `usePlanData.ts:153-157` calls
`/api/plan?cycleId=…`, and `usePlanData.ts:510` does
`setPosts(d.posts); setCrossMonthPosts(…); setBeats(d.beats ?? []); setViewedCycleId(cycleId);`.

So on switching to October, `posts` becomes October's committed posts — **0**, because all
10 rows are `status='draft'` and `/api/plan` fences them (`loadPlanPosts`, `plan.ts:132`;
`loadCrossMonthPosts`, `plan.ts:163`). `PlanDesktop.tsx:125` renders `{posts.length} posts`
→ "0 posts", and `PlanDesktop.tsx:31` derives the header month from
`viewedCycle?.displayMonth` → "October".

**Crucially, none of that re-runs `resolveSurfaceKind`.** The surface is a server-side
decision taken once in `page.tsx`; the month switcher only swaps data inside the shell that
decision already chose. There is no client path from `committed-redesign` to `draft`.

Two things ruled out while here:

- **`beats` in the `/api/plan` payload are not draft beats.** `app/src/app/api/plan/route.ts:52`
  — `const beats = cyc ? beatsInMonth(cyc.structuredBrief, viewedMonth) : [];` — these are
  structured-brief markers (`PlanDesktop.tsx:251`, "Brief beats — read-only markers"). Draft
  beats have exactly one reader, `loadDraftBeats` (`plan.ts:256-269`), and it is called only
  from `page.tsx:99`.
- **No flag suppresses draft mode.** `app/src/lib/flags.ts:11` defines only
  `PLAN_REDESIGN_FLAG`, and it is consulted *after* the draft check, so it cannot mask it.
  `draft_flow_enabled` is a worker-side gate (`packages/engine/src/client-flags.ts:23`)
  read by the Ask touch, not by this page. Both are `true` for this client anyway (Q4).

---

## 4. Magic-link scoping — correct, and not the cause

```sql
-- Q3 (most recent first)
                  id                  |               cycle_id               | cycle_month |         created_at         |      last_used_at
--------------------------------------+--------------------------------------+-------------+----------------------------+-------------------------
 db382532-fd6f-4c79-9950-6e178a5ea2e1 | 040d6a1a-9ad4-4d32-bda2-d67b01f70512 | 2026-09     | 2026-07-21 06:37:39.656167 | 2026-07-21 06:38:39.549
 76f6e8ad-95ac-4198-8d73-a62fc1999354 | 040d6a1a-9ad4-4d32-bda2-d67b01f70512 | 2026-09     | 2026-07-21 06:37:29.908329 |
 e2b80f83-0dcb-4f6c-994d-d08fe215fd23 | 040d6a1a-9ad4-4d32-bda2-d67b01f70512 | 2026-09     | 2026-07-20 22:03:46.80531  | 2026-07-20 22:03:52.516
 …
```

**The token in use IS homed on the draft cycle.** `session.cycleId = 040d6a1a`, the
most-recently-used token (`db382532`, used 06:38 today) points at it, and it is unrevoked
and unexpired.

The scope does not restrict resolution — it is only a *fallback*: `page.tsx:50` uses
`session.cycleId` only when `resolveDayCycleId` returns `null`, which it does not here
(three cycles qualify). So the correct cycle is present in the session and is discarded in
favour of the date-derived one.

This is the sharpest form of the bug: **the one piece of state that knows which cycle the
client was invited to review is the piece the landing logic ignores.**

---

## 5. Minimal fix (finding only — not implemented)

The defect is one expression: `page.tsx:50` resolves the landing cycle by date, and the
surface is then derived from whatever that returns.

**Minimal change: prefer a reviewable draft cycle over the date-derived one when choosing
`initialCycleId`.** Concretely — before the `resolveDayCycleId` call, if the session's home
cycle holds draft beats and no committed posts, land on it:

```ts
// sketch, not implemented
const initialCycleId =
  (await cycleHasReviewableDraft(session.cycleId))
    ? session.cycleId
    : resolveDayCycleId(cycles, editScopeToday()) ?? session.cycleId;
```

`cycleHasReviewableDraft` already exists (`plan.ts:299-313`) and is currently used only by
`isCycleReadableByClient`. That keeps the date-based landing for every ordinary month and
makes an outstanding draft — which is a *request for the client's attention*, and the
reason the link was sent — win the landing.

Two properties worth preserving in whatever is chosen:

- **The surface decision must be able to follow the viewed month, or the landing must be
  right first time.** Today it is neither: decided once, for a cycle the client may
  immediately navigate away from. Even with the fix above, a client who lands on their
  draft and then browses to September and back would return to a committed shell, because
  `refreshPlan` (`usePlanData.ts:510`) has no way to re-enter draft mode. Making
  `/api/plan` return a surface kind and having the client honour it would close that hole;
  the landing fix alone does not.
- **Do not "fix" this by loosening the fence.** `committedPostCount` being 0 for the draft
  cycle is correct, and `excludeDraftPosts()` is doing its job everywhere. The bug is
  upstream of the fence, and widening it would leak unapproved beats into committed views.

---

## Anomalies noted in passing (out of scope)

1. **No cycle plans the current month.** earl-of-east's cycles plan Aug/Sep/Oct; nothing
   plans July, so `resolveDayCycleId`'s exact-match arm can never hit today and it always
   falls through to "nearest future". Whether a client should land on a *future* month by
   default is a product question this bug happens to expose.
2. **`liveCount` and the draft fence interact in the month menu.** A draft-only cycle scores
   `liveCount = 0` and survives only via the `isHome` escape (`plan.ts:230`). A client with
   a draft on a cycle that is *not* their token's home would find that month absent from the
   menu entirely — unreachable rather than merely mis-rendered. Not the case here, but the
   same root assumption.
3. **Cycle `040d6a1a` was reset and re-assembled** between sessions: `created_at`
   2026-07-20 19:49, `approved_at` now NULL (it was stamped 19:51 yesterday), and its 10
   rows are all `draft` dated 2026-10-01…2026-10-29. Consistent with "freshly assembled";
   noted so the state is not mistaken for drift.
