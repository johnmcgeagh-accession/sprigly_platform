# Surface build — Session A

**Date:** 2026-07-28 · branch `dev` · **not pushed, not promoted**
**Base:** `779ae11` (*docs: the ink rule, propagated*) · **Last build commit:** `7e6bf9e`
**Scope:** Part 0 (docs), A1 (gap 7), A2 (actor attribution), A3 (the shell), A4 (the
committed surface). **Session B has not started.**

---

## 0. What to look at first

Three things are worth the operator's attention before the phone check, because each is a
decision this build made rather than executed:

1. **`postingTime` is not a clock value.** Reading the live rows found `6am`, `6pm`, `evening`,
   `Morning` — some times, some named slots. Every time in every mockup was the `PostingTimes`
   contract's documented *example*. §5 explains what the surface does about it.
2. **Two commits were merged and one part was deferred by design.** The shell and the day/month
   views ship as one commit (§10), and the draft surface is still `DraftPlan` on both form
   factors — restructured so Session B's move is a branch swap (§5.1).
3. **The mobile e2e suite is rewritten and could not be run** — the port its container needs is
   held by something that is not mine to stop (§7.3).

---

## 1. Commits

| Hash | Subject | Part |
|---|---|---|
| `bcf1d53` | docs: the round-5.1 carry-ins, as the build will read them | Part 0 |
| `dfbb58d` | feat: a stuck generation recovers itself, and the one that doesn't is ours | A1 |
| `c38aa40` | feat: every plan write says whose it was | A2 |
| `35c2645` | feat: one shell, and the committed month inside it | A3 + A4 (day, month) |
| `cdf0ba8` | feat: the detail sheet, the move picker, and one slot of undo | A4 (sheets) |
| `7e6bf9e` | fix: the audit's real findings, and the terminology grep made permanent | detector + audit |
| — | docs: surface build A — the report | this file, referenced by subject: a commit cannot contain its own hash, and amending to add one only changes it again |

`git diff 779ae11..HEAD --shortstat` → **79 files changed, 5163 insertions, 739 deletions.**

---

## 2. Part 0 — the docs revision

The riders carried round 5.1's rulings into the build. Three documents said three different
things about the shape-mode cancel, so the first commit made them say one.

| Ruling | Where it landed |
|---|---|
| **X1** the shape cancel is a quiet neutral, never red | spec §4, `DESIGN.md` → Components + Don'ts, `sprigly-mobile.css` `.shapefoot .cancel`, mockup 05 frame C |
| **X2** the wordless arrow primaries stand | spec §0, recorded not re-argued |
| **X3–X7** the transferred build checklist | new spec §0 table (touch-target floor, tappable-or-not-chips, the experiment marker's three definitions, silent-vs-speaking, the unverified breakpoint) |

The round-5.1 lesson was that a ruling applied to the *stylesheet* and not to the prose
describing it ships the old scheme — so X1 was applied to all four files in the same commit,
not to the code with a note to follow.

---

## 3. A1 — Gap 7: generation recovery

### 3.1 The sweep

`engine/src/content-cycles/generation-sweep.ts`, injected into `runContentCycleTick` exactly as
`sweepUnsentPlanReady` is, and wired in `consumer.ts` beside it.

- Selects `status = 'generation_failed'`, not soft-deleted, **dated today-onward**, with fewer
  than two sweep passes used.
- Re-enqueues through the same `shape` path the fan-out uses, with the same instruction —
  `captionInstruction`, now one definition in `@sprigly/engine/generation-recovery` because the
  app and the worker both enqueue it.
- **Enqueue first, stamp second.** The reverse leaves a post reading `generating` with nothing
  working on it. A failed enqueue does not consume a pass.
- Clears a stale completed/failed BullMQ slot first, or `queue.add()` returns without error and
  without enqueuing.

**The bound: two passes, in `source_meta.generationSweepAttempts`.** Each pass is up to three
paid Bedrock attempts, so the ceiling for one caption is nine. `source_meta` is the smallest
honest home: it is already the per-post generation scratchpad (`pendingInstruction`,
`generationError` are written by exactly the paths this re-runs), the counter is dead the moment
the caption lands, and a column would mean a migration plus a default on every row that will
never use it. The cost is a jsonb cast in the `WHERE` instead of an index, which at the volume
of *failed* posts is the cheaper side. The bound is asserted twice — in SQL so the pass cap
counts posts we might act on, and in code so it is a property of the function.

### 3.2 The operator surface

`admin/src/app/admin/failed-posts` + a nav entry. Before this, `generation_failed` appeared
**nowhere in `admin/src`**: terminal, client-visible, invisible to us.

Columns: client · month · post (title, date, format, pillar, id) · what went wrong · **what
happens next**. The last is `admin/src/lib/failed-post-verdict.ts`, whose clauses are ordered to
mirror the sweep's `WHERE` exactly, so the page cannot promise a retry the sweep will not make.

**Read-only, deliberately.** No retry button: the sweep owns re-enqueuing, and a second door
onto the same spend on the page that exists to show the first one ran out is how you lose track
of what has been paid for.

### 3.3 The client state

`app/src/lib/generation-state.ts`. `generating` and `generation_failed` collapse into **one**
client state — the difference between them is which of *our* processes runs next, and no client
has a use for that.

Removed from the legacy shell: `needs a retry`, `Couldn't write this one — open it to retry`,
the error text, and the **Try again** button. `/api/posts/:id/retry-generation` still exists as
a route; no client surface calls it.

### 3.4 Tests

| File | Cases | What it pins |
|---|---|---|
| `engine/.../generation-sweep.test.ts` | 11 | re-enqueues once, twice, **then stops**; in-flight job skipped; completed slot cleared; a failed enqueue consumes no pass; the stamp never precedes the enqueue; one post's failure does not end the pass |
| `packages/engine/src/generation-recovery.test.ts` | 7 | the instruction, the bound, and a reader that treats malformed jsonb as *never swept* rather than as exhausted |
| `admin/src/lib/failed-post-verdict.test.ts` | 8 | the list shows the exhausted post; a past-dated post is never labelled "will retry" |
| `app/src/lib/generation-state.test.ts` | 7 | both statuses collapse to one; no client string carries failure vocabulary |

---

## 4. A2 — Actor attribution

### 4.1 Migration 0090, hand-applied

```
$ psql "$DATABASE_URL" -f packages/db/migrations/0090_actor_attribution.sql
ALTER TABLE
NOTICE:  constraint "post_edits_actor_check" of relation "post_edits" does not exist, skipping
ALTER TABLE
ALTER TABLE
NOTICE:  constraint "plan_activity_actor_check" of relation "plan_activity" does not exist, skipping
ALTER TABLE
ALTER TABLE
CREATE INDEX
```

Verification:

```
      tbl      |          conname           |                    pg_get_constraintdef
---------------+----------------------------+-----------------------------------------------------------
 post_edits    | post_edits_actor_check     | CHECK ((actor IS NULL) OR (actor = ANY (ARRAY['client','operator','agent'])))
 plan_activity | plan_activity_actor_check  | CHECK ((actor IS NULL) OR (actor = ANY (ARRAY['client','operator','agent'])))
 plan_activity | plan_activity_origin_check | CHECK ((origin = ANY (ARRAY['user','agent'])))

  table_name   | column_name | is_nullable | data_type
---------------+-------------+-------------+-----------
 post_edits    | actor       | YES         | text
 plan_activity | actor       | YES         | text
```

**Adjacent constraints, checked before writing (the 0085 lesson).** `post_edits` had **none**.
`plan_activity` had exactly one — `plan_activity_origin_check` — and it is **untouched**: the new
CHECK is separate, so `origin`'s domain is unchanged and a future change to either is isolated.
The 0068 append-only trigger is `BEFORE UPDATE OR DELETE`, so `ADD COLUMN` does not fire it, and
a nullable column with no default means no table rewrite. `.down.sql` written, not applied.

No drizzle-kit. `schema.ts` updated by hand; the journal in `migrations/meta` has been dormant
since 0026 and stays that way.

### 4.2 Why a second column, and what it means

`origin` answers *who composed the write*; `actor` answers *whose intent it carries*. They agree
most of the time and come apart where it matters:

| Write | origin | actor | why |
|---|---|---|---|
| a direct edit in the app | `user` | `client` | every route in `app/` is behind a magic-link session |
| a client-instructed Shape | `agent` | `client` | the agent wrote the words; the client asked for them |
| an approved agent proposal | `agent` | `client` | this path only runs because a client pressed approve |
| the approval fan-out's captions | `agent` | `agent` | approving a draft is one act about a **month**, not a touch of ten posts |
| the nightly generation sweep | `agent` | `agent` | 05:00, nobody in the room |
| hook / script / weekly-session | `agent` | `agent` | autonomous generation |

**No backfill.** Nothing in a pre-0090 row records which it was, and inventing an answer would
poison the exact measurement the column exists to serve. NULL reads as *unattributed*, never as
*the client did it*.

**An unattributed shape job defaults to `agent`.** The direction is the load-bearing choice: it
under-counts client engagement. The other default would inflate the one number this column
exists to measure honestly, and would do it silently.

### 4.3 `'operator'` has no producer yet

Admin is **read-only** over both tables today — there is no admin write path to attribute. The
value is admitted by the CHECK and by `PlanActor`, and `OPERATOR_ACTOR` is exported, so the first
operator edit surface lands on a named constant instead of borrowing `USER_ACTOR` and quietly
counting our fix as a client touch. Flagged rather than built.

### 4.4 Tests

`app/src/lib/actor-attribution.test.ts` (6) — the ledger writer carries it, the two fields can
disagree, the constants say what they claim, **and a source fence over every `enqueueShape` call
site in `app/`**, because the failure to guard against is a write path added *later* without an
actor, which no behavioural test can see.

`engine/.../actor-attribution.test.ts` (5) — the worker agrees with itself across `post_edits`
and `plan_activity`, and an unattributed job resolves to `agent`.

---

## 5. A3 + A4 — the shell and the committed surface

### 5.1 The structural fix

`PlanRoot` returned `DraftPlan` **before** the desktop/mobile fork. The order is now inverted:

```
viewport  →  desktop | mobile
                 └── surface  →  draft | committed
```

Both surfaces are branches of a form factor rather than one pre-empting the other. Session B's
job is to swap the mobile draft branch for the same `PlanShell` the committed branch already
uses; nothing else moves.

`PlanShell` is deliberately **presentational** — frame and view switch, nothing about what a
month is. Both callers pass their own panel content, so `SURFACE → VIEW → content` is the
ordering, which is why Insights is a fourth segment later rather than a fourth screen.

### 5.2 Retired

`PlanMobile.tsx` (424 lines) and `MonthWheelPicker.tsx` are **deleted**. With them go
`updateActiveDay`, `onFeedScroll`, `scrollToDay`, `spyLock`, `rafTick`, the `anchoredCycle`
StrictMode guard, the swipe-to-Move card, the global "Add to your plan" button and the account
chip. Every one of the scroll-spy pieces existed to referee a fight between the strip's
selection and the feed's scroll position; §1.4's reversal means there is no fight. Net deletion,
as the spec's build order predicted.

### 5.3 Built

| Piece | File | Notes |
|---|---|---|
| the frame | `PlanShell.tsx` | wordmark → `‹ Month Year ›` + `headerRight` → badge + Today → strip → content → floating nav → overlays |
| the nav | `NavPill.tsx` | segmented pill + **separate** 56px mic on blurred material; segments `flex-1`; mic **absent** (not disabled) when `readOnly` |
| the strip | `WeekStrip.tsx` | selects; horizontal swipe for ±1 week, arrow keys as the keyboard equivalent so no navigation is gesture-only |
| the grid | `MonthGrid.tsx` | a peer and a **picker**; no legend — a filled dot is a post, a ring is one still being written |
| the day | `DayPanel.tsx` | the density rule, 0 / 1–2 / 3–4 / 5+ |
| tasks | `TasksPanel.tsx` | the existing checklist, moved to a view and re-tokenised |
| the sheet | `DetailSheet.tsx` | tabs + per-tab copy, insights toggle, three-button action row, shape-in-place |
| move | `MoveSheet.tsx` | full month grid, free **calendar**-month navigation, date + time in one write |
| undo | `Snackbar.tsx` | one slot, at the top |
| dates / text | `dates.ts`, `card-text.ts` | extracted from `PlanMobile`, plus the heading rule below |

### 5.4 Two things the mockups did not have to solve

**A card would have said the same thing twice.** `postTitle` derives a heading from the caption's
first sentence — fine on a surface showing a title *or* a caption, and a rendering fault on one
showing both. `card-text.ts`: a real slot title (`source_meta.title`) means the excerpt starts
from the top; without one, the heading is the first sentence and the excerpt picks up from the
second. A one-sentence caption gets a heading and **no** teaser.

**Posting time is a label, not a clock value.** The stored values are:

```
6am · 6pm · 7am · 7pm · 8pm · evening · Evening · Morning
```

Some are times, some are **named slots** — exactly what the `PostingTimes` contract describes,
and what every mockup assumed away by printing "6:00" everywhere. A strict `HH:MM` parser would
have shown no time at all on every real post while passing every test written from the design.
`normalisePostingTime` therefore: clock forms → 24-hour, named slots → one title-cased spelling
(so `evening` and `Evening` are not two slots), anything else → **no time**, never an invented
one. The move sheet offers the client's **own** labels, derived from their posts — not
`client_planning_config.posting_times` (no reader surfaces it) and not the contract's examples
dressed up as theirs.

### 5.5 Gaps closed as a side effect

| Gap | What landed |
|---|---|
| **1** (posting time) | read *and* write, on `source_meta.postingTime`, merged not replaced. Move sends date + time in one PATCH → one ledger row, one undoable act |
| **11** (where did it go?) | the snackbar names the destination, and names the **month** when the move crossed one — precisely when the post leaves the screen |
| **12** (Insights) | the pill's segments are `flex-1`; the fourth is deliberately **not drawn** |

Gap 4 (a `client_input` reason) is untouched — it belongs to the draft surface.
Gaps 2, 3, 5, 6, 8, 9, 10 are Session B or later, unchanged.

### 5.6 Token plumbing

`accent-500` and `accent-650` are plumbed through `theme.ts`'s `VAR`, Tailwind (`coral-500`,
`coral-650`), `ThemeTokens` / `THEME_TOKEN_KEYS`, and the admin swatch list. **This is the one
code change spec §12b said the ramp requires** — without it an operator can create Sprigly Mint
with an `accent650` and the surface silently falls back.

Both are **optional** on a theme, so Teal v1 and Sprigly Coral compute byte-identically; a theme
without them injects nothing and Tailwind's fallback applies. The coral fallbacks were chosen so
the ink rule still holds with no theme injected: white on `#D25B48` is **3.94:1** (mint's 650 is
3.40), and `chrome-deep` on `#F0968A` is **6.57:1** (mint's 500 is 6.99).

White-on-650 is now **reported** in admin's contrast table — round 5.1 recorded that it would
not be, and that it should be when the token landed. It is never gate-checked: the gate is one
pair (`accent-800` on `accent-100`) and this is not it. `themeActivatable(MINT).ok === true` is
asserted.

**Per R3, no theme was created or activated by this build.** Live stays Teal v1. Repo brand
assets remain coral and were not touched.

---

## 6. Detector

`npx impeccable detect` (v3.4.0) across the default, `type` and `layout` scopes, over every UI
file this session created or changed.

**Before remediation — 1 finding. After — 1 finding, waived.**

| # | Rule | File · line | Verdict |
|---|---|---|---|
| 1 | `side-tab` — thick coloured border on one side of a card | `app/src/components/PlanApp.tsx:474` | **WAIVED, with reason.** The legacy shell's month-grid chip, pre-existing and not touched by this session's edits to that file. The 3px edge carries *pillar identity* — information, not decoration — and `PlanApp` is the flag-off surface the redesign supersedes. Changing it is churn on a surface scheduled for retirement. |
| 2 | `side-tab` (**not detected**) | `TasksPanel.tsx`, the overdue row | **FIXED.** The detector only matches the inline-style form; the Tailwind form is the same pattern with the same problem. Removed — "Late" in `danger` is a stronger channel than a 3px edge and does not depend on colour vision. |

Finding 2 is recorded because a clean scan would otherwise have read as coverage the scan does
not have.

**Final run over the new surface alone** (`app/src/components/plan/surface`,
`PlanRoot.tsx`, `icons.tsx`, `tailwind.config.ts`): `[]`.

The standing `flat-type-hierarchy` findings from round 5.1 did **not** transfer: both were on
mockup HTML (`index.html`, `08-reshape-rollup.html`), and the built components do not reproduce
them: the built components use `DESIGN.md`'s ten named roles rather than the nineteen-size
ramp round 3 collapsed, and the detector is satisfied. **The waiver the riders anticipated (R5)
was therefore not needed** — there is no finding on a built component to resolve or waive. The
two round-5.1 findings stay where they are, on the review mockups, which this build does not
change.

The ignore registry is **unchanged**: 7 `ignoreValues`, `ignoreRules: ["single-font"]`. No new
ignores were registered.

---

## 7. `/impeccable audit`

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | a dialog-over-a-dialog had no focus trap; no `h1` — **both fixed** |
| 2 | Performance | 4 | no layout thrashing, no `will-change`, one bounded `backdrop-filter` on a ~290px pill |
| 3 | Responsive | 4 | nothing interactive under 40px; no fixed width over 280px; verified operable at 375 and 320 |
| 4 | Theming | 4 | zero hex literals, zero Tailwind-slate, every colour through `--t-*` — fenced by test |
| 5 | Implementation integrity | 4 | detector clean on new files; the one legacy finding triaged above |
| **Total** | | **19/20** | Excellent (minor polish) |

### 7.1 Fixed in this session

| Sev | Issue | Location | Fix |
|---|---|---|---|
| **P1** | The move sheet is `role="dialog" aria-modal` but had no focus trap. It opens *from* the detail sheet, which stays mounted, so Tab walked out of the modal into the sheet behind it. | `MoveSheet.tsx` | `useFocusTrap` (focus in, Tab held, Escape closes, focus restored); the two sheets are ordered in z rather than sharing a layer |
| **P2** | No `h1`; the heading ladder started at `h2`. | `PlanShell.tsx` | the month title is the `h1` — it is the page's subject. Ladder: h1 month → h2 day → h3 section → h4 card |
| **P2** | `side-tab` in `TasksPanel` (§6, finding 2). | `TasksPanel.tsx` | stripe removed |
| **P1** | Four client-facing strings the spec bans (§8). | 4 files | reworded |

### 7.2 Left standing, with reasons

| Sev | Issue | Why not now |
|---|---|---|
| **P3** | `role="tab"` on the nav pill without `role="tabpanel"` / `aria-controls`. | The pattern is complete enough for axe (tablist + tabs + `aria-selected`), and it is the mockups' recorded contract. Adding a panel wrapper means an extra flex container in the shell's column, which is a layout risk for an a11y nicety. Worth doing in Session B when the draft surface moves in and the shell's children change anyway. |
| **P3** | `PlanApp` and `DraftPlanView` still hold hard-coded hexes (`DraftPlanView` has a whole 12-entry colour object). | Both are surfaces the redesign supersedes — `DraftPlanView` is exactly what Session B replaces. Re-tokenising them now is work that gets deleted. |
| **P3** | `pieces.tsx`'s `ProgressRing` paints `#E8705F` / `#C4523F` / `#8F9296`. | Not used by the new surface — the ring left the card deliberately (§8.2). Still used by `PlanDesktop`, which is a later session. |

### 7.3 Verification that did **not** happen

- **The mobile e2e suite was not run.** `scripts/e2e.sh` provisions Postgres on port `55432`,
  and that port is held by an unrelated container (`restore_check`, up 11 days) which is not
  mine to stop. Playwright and its browsers are installed and Docker is running, so the only
  blocker is the port. `app/e2e/mobile.spec.ts` and the mobile half of `a11y.spec.ts` are
  **rewritten for the new surface and carry a header saying they are unrun.**
- **No rendered screenshot.** jsdom has no layout engine, so §7's responsive score is from the
  source fences and the interaction tests, not from pixels. **The operator's uat phone check is
  the real verification gate for anything geometric**, including the ≤480px breakpoint (X7),
  which no round has ever exercised.

---

## 8. The standing invariants

### 8.1 Fence — `git diff` on the invisibility suite

```
$ git diff 779ae11..HEAD -- app/src/lib/draft-invisibility.test.ts | wc -l
0
```

**Unchanged.** No reader was added or rewritten without the fence; `loadPlanPosts` and
`loadCrossMonthPosts` still carry `excludeDraftPosts()` and the new surface reads only through
them.

### 8.2 Tokens only

```
$ grep -rnE '#[0-9a-fA-F]{3,8}\b' app/src/components/plan/surface/ app/src/components/plan/PlanRoot.tsx
(comments only — no paint)
```

Made permanent as `surface/tokens.fence.test.ts` (7 cases), which scans the surface for hex
literals, for Tailwind's native `slate` scale (a literal grey **outside** the theme — the old
surface used it for every word, so a theme could repaint the accent and nothing else), and for
`var(--…)` references that are not `--t-*`.

The Sprigly mark itself stopped painting `#E8705F` and takes `currentColor`: it was the one
element that is unambiguously the brand and the one element the theme could not reach — which is
exactly the note the mockup sprite records against round 2.

### 8.3 Terminology

```
$ pnpm --filter @sprigly/app exec vitest run src/components/plan/terminology.fence.test.ts
✓ never says "beat" to a client
✓ never reports a failure or asks for a retry
```

The grep is now a test. It scans the strings a client can read — quoted literals, template text
with the `${…}` holes removed, JSX text — across every plan component, excluding identifiers and
test ids **by shape**, and it deliberately will not excuse a bare lower-case `beat` as camelCase.

It found four live violations that the previous rounds' manual greps had not:

| Where | Was | Now |
|---|---|---|
| `BeatMarker` `aria-label` | `Beat: warehouse sale` | `In your month: warehouse sale` |
| `BeatMarker` fallbacks | `'beat'` / `'Beat'` | `'Something planned'` |
| `DraftPlanView` undo bar | `Beat removed` | `Post removed` |
| `PlanDesktop` load errors, `PostEditor` hook/script errors | `Retry` | `Try again` |

An `aria-label` is exactly as client-facing as the label beside it, which is what the manual
greps kept missing.

`try again` survives deliberately, and is **not** covered by the ban: it is what a network
hiccup honestly says, and it is not a report that a generation broke.

### 8.4 Touch targets (X3)

```
$ grep -rnE 'min-h-\[(1[0-9]|2[0-9]|3[0-9])px\]' app/src/components/plan/surface/*.tsx
none under 40px
```

The mockups measured `.readypill` 34, `.todaybtn` 34, `.navbtn` 32, `.bulb` 30. Built: Today 40,
month arrows 40, tabs 40, time slots 40, task tick 40 (a 40px hit area around a 24px mark — the
expansion is visually inert), nav segments 44, copy / close / insights 44, `＋N more` 44, primary
50, shape footer 56, mic 56, action buttons 68, strip days 60.

### 8.5 Mobile-first, desktop functional

`PlanDesktop` is unchanged behind its own ≥1080px breakpoint and still builds and renders. The
only edit to it in this session is `text-coral-600` on the mark (so `currentColor` resolves) and
one copy change. Its own redesign is a later session; §5.1's note in `PlanRoot` records what the
left-rail adaptation will reuse — the same three views laid out vertically, the mic staying a
separate control, and the month control + arrows first, because *"October doesn't show"* was a
**desktop** report.

---

## 9. Interaction tests

**138 new tests.** Per-package, offline (`vitest run`):

| Package | Before | After | Δ |
|---|---|---|---|
| `@sprigly/app` | 407 | **510** | +103 |
| `@sprigly/worker` | 262 | **278** | +16 |
| `@sprigly/engine` | 349 | **360** | +11 |
| `@sprigly/web` (admin) | 31 | **39** | +8 |

App, per file: `generation-state` 7 · `actor-attribution` 6 · `posting-time` 14 ·
`card-text` 9 · `surface.interaction` 28 · `tokens.fence` 7 · `sheets.interaction` 28 ·
`terminology.fence` 4.

Pre-existing failures are unchanged and were confirmed identical on the pre-session tree: 2 app
files and 10 worker files that require `DATABASE_URL` / `TEST_*` env and skip cleanly with it.
**No test that passed before this session fails now.**

### 9.1 Interaction, not render

The standing invariant, and the round-1 lesson: render coverage cannot reach post-return bugs.
Two jsdom files, 56 cases, every assertion *after* a tap:

**`surface.interaction.test.tsx`** (28) — the panel follows the strip and the day you left is
**gone**, not scrolled past; the swipe threshold; the grid carries the date back to Day view and
the strip re-anchors to that week; the add slot uses the day you were looking at; the density
rule at 0 / 2 / 4 / 8 with `＋N more` expanding in place; a compact row states time and title and
nothing else; a failed generation reads "On its way" and the tree contains no failure
vocabulary; the mic is absent (not disabled) when read-only; month edges disable rather than
hide; the surface is operable at 375 and 320.

**`sheets.interaction.test.tsx`** (28) — copy sends the **open tab** and not the caption every
time; insights opens above the tabs and is absent when there is no reasoning; shape replaces the
whole footer in the same sheet and leaves nothing red in it; **a half-typed instruction never
follows you to another post**; a planned post has no tabs and no Shape; move navigates calendar
months without switching cycle, offers the client's own labels, and writes date + time together;
a within-month move names the day and a cross-month move names **November**; undo restores date
*and* time; delete gets a statement and no undo button; a read-only day shows the words and none
of the actions.

Plus source-level fences: tokens (7), terminology (4), the `enqueueShape` actor fence (1), and
pure-unit files for `card-text` (9), `posting-time` (14), `generation-recovery` (7) and
`failed-post-verdict` (8).

### 9.2 Builds

`@sprigly/app`, `@sprigly/web` and `@sprigly/worker` all build clean (`next build` / `tsc`).
`tsc --noEmit` is clean on all five packages.

---

## 10. Deviations from the prompt, and why

| Asked | Delivered | Reason |
|---|---|---|
| A3 commit = "shell + tab bar"; A4 = separate commits for day view / month overview / detail sheet | Two commits: **shell + day + month**, then **detail sheet + move + undo** | A shell renders nothing without content and content has nowhere to sit without a shell. Splitting them would have meant committing a surface that could not run. Month came with the shell because the day view's `Today` and the grid-as-picker are the same state. |
| the mic wired to the post-cutoff agent path | the FAB opens the day view and prompts | `POST /api/plan/agent` is reached through `data.ask`, and the **sheet that says which consequence the mic has** is Session B's (§8 of the spec, the voice sheet). Wiring the route without the sheet would mean a mic that sends an instruction with no place to type it. The gating is correct today: absent when `readOnly`, present otherwise. |
| — | the checklist **ProgressRing left the card** | The mockups' cards have no ring, and the spec makes Tasks a peer view. A card is "a thing you read". Recorded as a deliberate removal, not an oversight. |
| — | the **weather badge stayed** | Not mentioned anywhere in the redesign, but shipped and live. Dropping it silently would have been a regression; it moved to the one day header the panel now has. |

---

## 11. Open, and left for the operator

1. **X5 — the experiment marker has three definitions.** Spec §0 `DR2` says the banner pill
   carries the whole meaning; §7 says a bare lightbulb with a tap explanation; mockup 02 renders
   a 30px corner bulb with neither, in the slot where every other card states its time. **It did
   not block Session A** — the marker is a draft-surface element and nothing in the committed
   month renders it. Session B cannot start it without a ruling.
2. **X4 / X6** — the tappable-or-not chips and the silent-vs-speaking voice states are both
   Session B surfaces. Noted, not built.
3. **`swapFormat` still has no surface** (spec §4.1). The detail sheet has no format control, so
   the shipped `{op:'format'}` mutation is now reachable from nowhere on the committed month.
   The spec ranks the options and does not decide; this build did not decide either.
4. **`'operator'` has no producer** (§4.3).
5. **`/api/posts/:id/retry-generation`** is now called by no client surface. Left in place — it
   is a working route, and removing it is a separate decision.
6. **The mobile e2e suite is unrun** (§7.3). First execution should be part of the uat check.
7. **The ≤480px breakpoint remains geometrically unverified** (§7.3). The interaction tests prove
   the surface is *operable* at 375 and 320; only a device can prove it *looks* right.

---

## 12. What Session B inherits

- `PlanShell` takes `badge`, `headerRight`, `topSlot` and `overlays` — the Draft badge, the
  Generate pill, the summary chip's snackbar slot and the voice sheet already have their seats.
- The mobile draft branch in `PlanRoot` is a single `if`. Swapping `DraftPlan` for
  `<PlanShell surface="draft">` is the whole structural move.
- `DetailSheet`'s planned-post variant already renders the pre-approval case; the draft surface
  needs the same sheet with `{op:'drop'}` / `{op:'move'}` wired instead of the posts API.
- `MonthGrid` takes `marksFor` returning `'draft'` marks; the draft month's dot density is a
  different callback, not a different grid.
- `DraftPlanView`'s hard-coded colour object is the largest remaining tokens-only debt.
