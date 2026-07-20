# add-post — canAddPost predicate, add affordance, placeholder prefix

**Date:** 2026-07-20 · **Branch:** `dev` (not pushed) · **Baseline:** `dbcd9bf`
**Spec:** `docs/reports/investigation-post-add-and-aug-plan.md`
**Status:** Complete. Three commits.

---

## 0 — Re-location of stale references

Every file:line in the brief was re-located before editing, per the preamble. **All
findings hold semantically; several line numbers had drifted:**

| Brief says | Actual now | Site |
|---|---|---|
| `usePlanData.ts:74` | 74 | `canEdit` — unchanged |
| `PlanDesktop.tsx:256` | **257** | the `add-on-day` button |
| `PlanMobile.tsx:212-214` | **214** | the ternary |
| `mutations.ts:112` | 112 | `addDraft` |
| `mutations.ts:19` | 19 | `DRAFT_PLACEHOLDER` |
| `agent/proposals.ts:233` | 233 | the `'add'` branch |
| `api/posts/route.ts:32` | 32 | unchanged |
| `plan-merge.ts:44` / `:54` | **50** / **61** | `PLACEHOLDER_PREFIX`, the `startsWith` |

No finding failed to hold, so no stop was triggered on that ground.

---

## 1 — `canAddPost` predicate (`c00f8b9`)

**Behaviour change:** none. A refactor giving one question one name.

The investigation found "can I add here?" derived in eleven places that disagreed — the UI
enforced one post per day while the server did not, the legacy shell forbade adding to a
non-home month while the redesign allowed it, and none of them said so anywhere.
`canAddPost(dateIso, today)` is now the single named answer, and the policy is written down
in `add-policy.ts`: date today-or-later, **no** status check, **no** capacity check.

The predicate takes `(dateIso, today)` and nothing else, so it **cannot express the
one-post-per-day cap even by accident**. There is a test asserting its arity for exactly
that reason.

### DEVIATION FROM THE BRIEF — flagged

The brief said to define it in `edit-scope.ts`. **The rule lives in a new `add-policy.ts`,
and `edit-scope.ts` re-exports it.**

`edit-scope.ts` imports `@sprigly/db`, which parses `DATABASE_URL` at module scope — fine on
the server, fatal in the browser. `usePlanData.ts` is a `'use client'` component and is one
of the four sites that must share the predicate. I verified it is the **only** client
importer of `edit-scope`, and that import was the one I had just added:

```
$ grep -rln "from '@/lib/edit-scope'" app/src | while read f; do
    printf "%-56s %s\n" "$f" "$(head -1 "$f" | grep -c 'use client')"; done
…
app/src/components/plan/usePlanData.ts                   1     ← only client importer
(every other importer: 0)
```

So the pure rule sits in a module with no imports at all, and `edit-scope` re-exports it.
Server callers still reach `canAddPost` through `edit-scope`, which remains the stated home
for edit policy; only the definition moved. One function, one name, reachable from both
sides. Not a listed stop condition (no parameter was added to the predicate), but a
deviation, so it is recorded here rather than buried.

### Sites converted

The four named (investigation sites 1, 5, 6, 7) **plus three siblings**:

```
usePlanData.ts:75            canEdit                         ← site 1
api/posts/route.ts:32        POST /api/posts                 ← site 5
mutations.ts:112             addDraft                        ← site 6
mutations.ts:152             addGeneratedPost                ← sibling
mutations.ts:187             addGeneratingPost               ← sibling
agent/proposals.ts:233       payload.kind === 'add'          ← site 7
agent/proposals.ts:299       payload.kind === 'add_generated' ← sibling
```

**Why the three extras.** All are unambiguously creation paths carrying the identical
`// DATE POLICY: create only for today-onward` comment. Leaving them would mean `addDraft`
used `canAddPost` while its immediate neighbours used `isEditableDate` for the same
decision, and a future reader would reasonably conclude they were different policies —
the exact failure this piece exists to prevent. A deliberate small expansion, called out
here for review.

**Edit paths deliberately keep `isEditableDate`:** `patchPost`, `softDeletePost`,
`revertPost`, `markPostGenerating`, and the agent's move/format branches. They are not adds
and must not silently inherit add policy.

### Untouched, and why

| Site | Reason |
|---|---|
| `PlanApp.tsx` `readOnly = !isHome` (site 4) | legacy shell — instructed out of scope |
| `draft-mutations.ts` (site 8), `page.tsx` (site 9) | **draft surface.** `cycleIsPreCutoff` is a deliberately different policy: an approved month's structure is fixed by contract. Load-bearing — not unified. |
| `DraftPlanView` pillar check (site 10) | draft surface |
| `lib/plan.ts` sync-status filter (site 11) | month-menu visibility, not an add gate |

### Proof

```
$ npx vitest run src/lib/edit-scope.test.ts
Tests  14 passed (14)      # 8 → 14; 6 new canAddPost cases

$ npx vitest run            # whole app suite
Tests  367 passed | 1 skipped (368)
```

One pre-existing test needed its `edit-scope` mock extended with `canAddPost`
(`proposals.test.ts`) — no assertion changed. Folded into the commit by amend.

---

## 2 — UI cap removal (`eec6845`)

**Behaviour change:** the add affordance now renders on **every future day, occupied or
not**, on both desktop and mobile.

The `dayPosts.length === 0` condition was a one-post-per-day cap that existed **only in
these two components**. Nothing else agreed: `POST /api/posts` creates a second post on an
occupied day happily, the planner writes two posts onto one date, the planning prompt
authorises it (*"Two beats may legitimately share a date"*), and there is no unique index on
`(cycle_id, scheduled_date)`.

The failure mode was silent — after a plan ran, **24 of 31 August days carried a post and
the button was simply not in the DOM**, with no message and no disabled state.

**Desktop:** condition dropped. The button already carried `mt-auto`, so on an occupied day
it pins below the cards with no layout change.

**Mobile:** the ternary made add the ELSE branch of "has posts" — the same cap expressed
differently. Cards and add are now two siblings: cards first, add underneath. **No styling
or scroll changes were required**, so the mobile stop condition did not trigger.

### Grep proof — zero occupancy gates remain

```
$ grep -rn "dayPosts.length === 0\|postsOn(iso).length$\|postsOn(.*).length === 0" \
       app/src/components/plan/*.tsx | grep -v "^\S*: *[0-9]*: *//"
app/src/components/plan/add-affordance.test.tsx:34: * Before: `canAddPost(iso) && dayPosts.length === 0`. After: `canAddPost(iso)`.
```

The single hit is a comment in the new test describing the old rule. **Zero functional
gates.**

### June spillover — confirmed, falls out for free

2026-08-03/05/06 render the 2026-06 cycle's posts in the August grid and used to suppress
add for a *different* cycle's month. The rule is date-only and does not know which cycle a
day's posts belong to, so this needed no special handling. Asserted by test rather than by
inspection alone. **Cross-cycle fetching and display are untouched.**

### e2e expectation updated

The old assertion baked the cap in as though it were policy — *"its **empty** days offer the
add affordance"*. It now asserts:

1. every future day offers add (`add-on-day` count === `calendar-cell` count);
2. **an occupied day shows its post AND offers add** — the case the old wording could not
   express.

Reused the existing `calendar-cell` testid rather than adding one.

### Proof

```
$ npx vitest run            # whole app suite
Tests  376 passed | 1 skipped (377)      # +9 from add-affordance.test.tsx
```

New coverage: empty day, occupied day, day holding **two** posts (the real 08-14 / 08-28
shape), past day still refused, today allowed, all three June-spillover dates, a
whole-future-month count (**7 of 31 under the old rule → 31 of 31**), and the add handler
receiving the day's own date whatever it already holds.

---

## 3 — Placeholder prefix (`f66930c`)

**Behaviour change:** an added-but-unfilled post is now correctly classified disposable by
the regen merge. It never was.

`plan-merge.ts:50` held `'Draft idea — tell Sprigly'` (em dash, lowercase "tell") while
`mutations.ts:19` wrote `'Draft idea. Tell Sprigly …'` (full stop, capital T). The
`startsWith` at `:61` could never match — dead code that read as working.

### Canonical form confirmed from the database, as instructed

```
$ psql -c "select left(caption,30) as prefix, count(*), min(created_at)::date as first,
                  max(created_at)::date as last, string_agg(distinct status,',') as statuses
           from content_cycle_posts where caption like 'Draft idea%' group by 1 order by 2 desc;"

             prefix             | count |   first    |    last    | statuses
--------------------------------+-------+------------+------------+----------
 Draft idea. Tell Sprigly what  |     4 | 2026-07-09 | 2026-07-17 | new
 Draft idea — tell Sprigly what |     1 | 2026-07-06 | 2026-07-06 | new
```

**The `mutations.ts` form is canonical** — as the brief expected. It is what the app writes
and has written since 07-09. The em-dash form is a single legacy row from 07-06, and a
repo-wide grep finds **no code that writes it**: its only occurrence was the plan-merge
constant itself.

**Stop condition not triggered.** It fires if rows match *neither* constant; these match
*both*. Recorded because "both" was not an anticipated outcome.

### Home: `@sprigly/db`

Both consumers — `app/` and the worker — already depend on it, so **no new cross-package
edge**. And it sits beside `POST_STATUS_DRAFT`, which is the same kind of thing: a magic
value about `content_cycle_posts` that several packages must agree on.

Exported as a pair — `DRAFT_PLACEHOLDER_CAPTION` (what the app writes) and
`DRAFT_PLACEHOLDER_PREFIX` (what the classifier matches) — with a test asserting the prefix
really is a prefix of the caption, so the two cannot drift into disagreeing about what a
placeholder looks like. That drift is the bug being fixed.

### Proof

```
$ npx vitest run src/content-cycles/plan-merge.test.ts
Tests  14 passed (14)      # 7 → 14

  ✓ THE FIX: the exact caption addDraft writes is classified disposable
  ✓ a placeholder post is DROPPED by the merge, not preserved
  ✓ the prefix is genuinely a prefix of the caption — they cannot drift apart
  ✓ the OLD em-dash form is no longer matched — recorded, not accidental
  ✓ a post with a REAL caption is never treated as a placeholder
  ✓ an empty caption is still disposable, as before
  ✓ a placeholder carrying a generated hook is NOT disposable
```

One pre-existing test needed the constant added to its `@sprigly/db` mock
(`mutations.test.ts`) — no assertion changed. I used the **real** string rather than a
stand-in, since the point of sharing the constant is that both sides use the same one and a
mocked value would hide exactly the drift being fixed.

---

## 4 — Verification

| Suite | Result |
|---|---|
| `@sprigly/app` | **376 passed**, 1 skipped |
| `@sprigly/worker` | **363 passed**, 1 skipped |
| `@sprigly/engine` | **213 passed** |
| `@sprigly/db` | **6 passed** |

Type-check clean across all five packages. No migrations. Nothing pushed.

### Commits

| Hash | Piece | Behaviour |
|---|---|---|
| `c00f8b9` | 1 | One named `canAddPost` predicate for the committed-plan surface |
| `eec6845` | 2 | The add affordance renders on every future day, occupied or not |
| `f66930c` | 3 | One placeholder-caption constant, so the merge can actually match it |

---

## 5 — Anomalies observed, out of scope, unfixed

1. **The em-dash legacy row loses disposability.** It was the only row the old constant
   matched. After the fix the classifier recognises what the app actually writes, so that
   one 2026-07-06 row stops being classified as a placeholder. The honest outcome, and
   there is a test recording it so nobody reads it as an accident — but it is a real, if
   tiny, behaviour change beyond "the fix works".

2. **`e2e/desktop.spec.ts` was not executed.** Playwright needs a running app and seeded
   database; this session changed the expectation and verified the underlying rule by
   component test instead. The e2e assertions are written but **unrun** — worth a pass
   before UAT.

3. **The mobile grid now renders add on every day of every visible week**, including days
   that already show several cards. On a phone that is one extra dashed button per day
   section. It is correct per the locked decision and required no layout change, but it is
   a visible density increase nobody has looked at on a real device.

4. **`postsPerMonthMax` remains unenforced** (out of scope by instruction). The investigation
   found 25 posts written against a configured max of 20, with both validators strictly
   per-post and neither ever evaluating `rows.length`.

5. **`recurringSeries.dayOfWeek` is still never read by scheduling code** (Build B scope).
   WSG is configured Saturday and landed Friday 4× in August and 3× in June.

6. **`dropCollidingInserts` still only guards preserved rows**, so two freshly generated
   posts can share a date. That is now *consistent* with the UI (both permit multi-post
   days) rather than in conflict with it — but it remains unreconciled with
   `postsPerMonthMax`, and the investigation flagged it as a defect rather than a decision.

7. **Working tree.** Per the preamble I treated untracked-only as clean and left the six
   accepted files alone — the brief's alternative instruction (commit or stash the
   pause/resume scripts first) would have contradicted the preamble's "known-accepted"
   list. None of them appear in any commit here.
