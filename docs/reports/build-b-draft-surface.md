# Build B — Draft beat surface + structural edits

**Date:** 2026-07-20 · **Branch:** `dev` (not pushed) · **Build A baseline:** `af27286`
**Status:** Complete. Five commits.

---

## 1. Part 0 — plan doc

`docs/plans/draft-plan-intake-arc.md` created verbatim from the prompt and committed
docs-only (`72690ae`). The markers were present and the content substantive, so the stop
condition did not fire.

Worth noting: the doc's standing constraints name the sandbox client as
`earlofeastlondon`. The actual slug is **`earl-of-east`** — the same discrepancy recorded
in the Phase 0 and Build A reports. Committed verbatim as instructed rather than silently
corrected.

---

## 2. Call-site enumeration — method stated

Exhaustiveness is only checkable if the method is. Three independent sweeps, each run
across `app/`, `admin/`, `engine/`, `packages/`, excluding `node_modules` and `/dist/`:

**Method 1 — the fence itself.** Every site that applies or references the Build A guard:

```
grep -rn "excludeDraftPosts" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "/dist/"
```

18 hits: 1 definition (`packages/db/src/schema.ts:1045`), 7 applications, 4 in the Build A
test's mock, 6 in prose comments. **All 7 applications are byte-identical to Build A.**

**Method 2 — the predicate's importers.** Before changing the readability rule, every
caller of the function being changed:

```
grep -rn "isCycleReadableByClient" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "/dist/"
```

One production caller: `app/src/app/api/plan/route.ts:32`. One test caller (Build A's
invisibility suite). No other import path exists, so the OR could be added at the
definition with a single known consumer.

**Method 3 — the new reader's blast radius.** After adding `loadDraftBeats`, who can now
see drafts:

```
grep -rn "loadDraftBeats\|cycleHasReviewableDraft\|POST_STATUS_DRAFT" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "/dist/"
```

`loadDraftBeats` has exactly three callers: `page.tsx` (the draft-mode fork), the draft
API route, and `draft-mutations.ts` (which returns the refreshed list after each write).
No other module can read a draft row.

### Readers touched

| Reader | file | Change | Build A fence |
|---|---|---|---|
| `loadPlanPosts` | `app/src/lib/plan.ts` | none | intact |
| `loadCrossMonthPosts` | `app/src/lib/plan.ts` | none | intact |
| `loadCycleList` | `app/src/lib/plan.ts` | none | intact |
| `isCycleReadableByClient` | `app/src/lib/plan.ts` | **OR'd with `cycleHasReviewableDraft`** | **intact** — the committed-post join keeps `excludeDraftPosts()` |
| magic-link empty guard | `admin/.../actions.ts` | none | intact |
| weekly-session window | `engine/.../weekly-session.ts` | none | intact |
| regen classifier | `engine/.../planning.ts` | none | intact |
| **`loadDraftBeats`** | `app/src/lib/plan.ts` | **new** — the one deliberate draft reader | inverts the filter explicitly |

The readability change is an **OR of two named conditions**, not a relaxed filter. Drafts
still do not make a cycle readable *as a plan*; they make it readable *as a draft*, via a
predicate someone wrote down. That distinction is what keeps the Build A test passing
unmodified: it asserts the fence appears in the **join**, and it still does.

`cycleHasReviewableDraft` is deliberately **not** gated on the pre-cutoff window. Viewing
a draft and editing one are different rights — a client who opens their link the day after
cutoff should still see what was drafted for them. The mutations are what refuse.

---

## 3. Build A fences — confirmed untouched

```
$ git diff af27286..HEAD --stat -- app/src/lib/draft-invisibility.test.ts
(no output — the file is byte-identical)

$ npx vitest run src/lib/draft-invisibility.test.ts
Tests  5 passed (5)
```

The Build A invisibility suite was **not modified in any way** during Build B and passes
as written. Its five assertions (loadPlanPosts, loadCrossMonthPosts, loadCycleList,
isCycleReadableByClient, and the PostStatus membership check) all still hold.

---

## 4. The draft view at mobile viewport

Rendered via `react-dom/server` (the app's vitest env is node) with three beats modelled on
Build A's real Earl of East sample. Visible text as the client receives it:

```
Draft   Not sent yet
We’ve drafted September 2026 for Earl of East
It’s built from what’s been working on your feed. Change anything that’s wrong —
move a date, swap a format, drop what you don’t want.

What we assumed
  • We’ve assumed nothing’s launching this month — anything coming up?
  • We’ve split the month evenly across your pillars — want to weight it differently?
  Reply to our email and we’ll work it in.

  • Wed  2 Sep    [Carousel] Brand Story & Culture
    Where it all started
    Carousels average 70 likes and comments across your last 8 posts;
    Brand Story & Culture is about 20% of what you post.
    [ date picker ] [ Single post / Carousel / Reel ] [ Remove ]

  • Thu  3 Sep    [Single post] Everyday Ritual
    The slow morning edit
    Single posts average 38 likes and comments across your last 23 posts;
    Everyday Ritual is about 20% of what you post.
    [ date picker ] [ Single post / Carousel / Reel ] [ Remove ]

  • Fri  4 Sep    [Reel] Home & Space  «Something new»
    A room that breathes
    This came from an idea you sent us.
    [ date picker ] [ Single post / Carousel / Reel ] [ Remove ]

  + Add something
```

**Layout.** A 640px-max single column of dated cards — a vertical list, not a squeezed
calendar grid. Each card is a date block (weekday + day) beside format/pillar chips, the
title, the rationale, and a row of controls. Cards use a **dashed** border and a coral
"Draft" chip so the surface reads as working state rather than a finished plan. Every
interactive control has `min-height: 40px+` and every one carries an explicit `aria-label`
naming its beat.

**Numbers are the real ones.** 70 likes over 8 posts and 38 over 23 are Earl of East's
actual carousel and single-post figures, matching the Phase 0 SQL and Build A's assembler
output.

**Experiment badge.** The third beat carries «Something new» and a rationale naming its
source. Proven beats carry no badge — the default needs no label.

**Assumptions render once**, at the top, phrased as questions, with an explicit note that
they cannot be answered here. Asserted by test: with three beats sharing the same
assumption list, the prompt appears exactly once.

**Past cutoff**, every edit control disappears and the draft stays fully readable.

---

## 5. Mutations

All in `app/src/lib/draft-mutations.ts`, exposed via `POST /api/plan/draft`.

| Mutation | Behaviour |
|---|---|
| `moveBeat` | new `scheduled_date`; rejects past and malformed dates |
| `swapFormat` | vocab-checked against reel / carousel / single |
| `dropBeat` | **hard** delete |
| `addBeat` | pillar checked against the client's configured vocabulary; evidence `{basis:'client_added'}` |
| `reorderWithinDay` | **implemented** — see below |

**Guards, on every mutation.** `status='draft'` sits in the `WHERE` of the write itself,
not only in a preceding `SELECT`, so a committed post is unreachable from this module even
by id. Pre-cutoff is checked via `PRE_PLANNING_STATUSES` — the same classifier the intake
route uses, so "pre-cutoff" cannot come to mean two things in two places. `not_found` and
`not_a_draft` stay distinct: they are different facts and the client deserves the true one.

**Nothing here writes `status`.** Approval is Build D. There is a test asserting no
mutation's payload ever contains a `status` key, so an edit cannot accidentally commit a
plan nobody approved.

**`reorderWithinDay` was implemented, not skipped.** Position *is* meaningful:
`loadDraftBeats` orders by `(scheduled_date, position)`, so position is the tiebreak
whenever a date holds more than one beat. The assembler never produces same-date beats
(`spreadDates` samples distinct days), but `addBeat` can — so the concept is real rather
than invented. It reuses the block of positions the day already occupies, so reordering
one day cannot disturb another.

**`dropBeat` hard-deletes** deliberately. Soft-delete exists so a committed post can be
restored and so `post_edits` FKs survive; a draft beat has neither concern. Tombstoned
drafts would mean every draft reader had to learn to skip them. Undo is the inverse call
(`addBeat` with the same fields), not resurrection — the new row gets a fresh id, which is
honest, because it *is* a new beat the client added.

**`addBeat` refuses when the client has no configured pillars** rather than accepting free
text: an unvalidated pillar would poison the pillar weights the assembler reads back.

---

## 6. Tests

| Suite | Result |
|---|---|
| `@sprigly/app` | **271 passed**, 1 skipped (30 files) |
| `@sprigly/engine` | 139 passed |
| `@sprigly/worker` | 326 passed, 1 skipped |
| `@sprigly/db` | 6 passed |

Type-check clean across `app`, `admin`, `engine`, `packages/db`, `packages/engine`.

New in Build B: 12 reader/readability, 28 mutation, 19 rationale, 18 view/mixed-state.

Coverage against the brief:

- **Build A invisibility suite passes unmodified** — §3.
- **`loadDraftBeats` returns drafts and only drafts** — asserts `eq(status,'draft')` is in
  the WHERE *and* that the fence is absent (it is the one reader that inverts it).
- **Readability** — draft-only readable; empty still unreadable; committed unchanged;
  `out_of_sync` still wins; another client's cycle unreadable.
- **Mixed state** — draft mode does not render when committed posts exist.
- **Each mutation** — happy path, non-draft rejected, post-cutoff rejected, vocab
  violations rejected for both `swapFormat` and `addBeat` pillar.
- **Rationale rendering** — all three bases present in Build A's sample: engagement-based
  (`observed`), `template` fallback, and `client_added`.

The rationale tests are deliberately weighted toward **negative** assertions — that a
missing field shortens the sentence rather than filling it in, that a zero pillar share is
not claimed, that a format measured over zero posts is not cited, and that empty evidence
produces an empty string. Those are the failure modes that would cost the client's trust
in every other rationale on the page.

---

## 7. Commits

| Hash | Part | Behaviour |
|---|---|---|
| `72690ae` | 0 | The draft-plan & intake arc build plan |
| `c72c02a` | 1 | A deliberate draft reader, and readability as an explicit decision |
| `6d4d764` | 3 | Deterministic structural mutations on draft beats |
| `b7d46f3` | 2+4 | The client draft view — a month to react to, with its reasons attached |

Not pushed, not merged, not promoted. Build C not begun. The intake route and every
generation path were untouched.

---

## 8. Unexpected, and left unfixed

1. **A Build A modelling error, corrected here.** I had made `BeatRationaleEvidence.cadenceBasis`
   **required**, arguing every beat has a slot-count basis. That was true of every beat that
   existed then, and false the moment `addBeat` landed: a client-added beat has no
   slot-count basis at all. Writing `{postsPerWeek: 0}` to satisfy the type would have been
   exactly the fabrication the evidence contract exists to prevent, so `cadenceBasis` is
   optional again and `'client_added'` joins the basis union. One Build A test assertion
   was updated to `ev.cadenceBasis!` (still asserted present on every *assembled* beat).
   Flagging because it is a reversal of a decision I recorded confidently eight commits ago.

2. **`page.tsx` grew a fourth render fork.** It now branches on session → draft mode →
   `plan_redesign` flag → legacy `PlanApp`. Still readable, but it is accumulating, and
   Build D adds approval on top. Worth a deliberate look before it becomes five.

3. **The draft view is standalone, not inside `PlanRoot`.** It does not share
   `usePlanData`, the month switcher, or the intake sheet, because none of those apply to
   a cycle with no committed posts. That is correct today; if Build C wants the intake
   sheet available *from* the draft view, the two shells will need reconciling rather than
   duplicating.

4. **No route-level test for `/api/plan/draft`.** The mutations beneath it are covered at
   28 assertions and the route is a thin op-dispatch, but the dispatch itself (op parsing,
   status-code mapping, session derivation) is currently only exercised through the
   library. A route test would need the app's session mocking; noted rather than skipped
   silently.

5. **The plan doc's `earlofeastlondon`** does not match the real slug `earl-of-east`.
   Committed verbatim as instructed. Third report to record it.

6. **Undo is one slot, not a stack**, and it is not persisted — a page reload loses it.
   Deliberate for a working draft, but stated so nobody assumes an edit history exists.

7. **Build A's known interim state is now user-visible in one specific way**: a cycle
   holding both committed posts and leftover drafts renders the ordinary plan, so those
   drafts are unreachable through any surface until Build D owns supersession. Correct per
   the agreed fence, but it means drafts can accumulate invisibly.
