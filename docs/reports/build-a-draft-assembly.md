# Build A — Draft assembly engine

**Date:** 2026-07-20 · **Branch:** `dev` · **Session 1 baseline:** `613030e`
**Status:** Complete. Six commits on `dev`, not pushed.

---

## Blocker: the referenced plan document does not exist

The brief opens *"Context: `docs/plans/draft-plan-intake-arc.md` and the Phase 0 report."*

```
$ ls docs/
architecture  backlog  BACKLOG-engine.md  brief  content-cycles  diagrams
infrastructure  integrations  operations  README.md  reference  reports  workflows

$ find . -name "*draft-plan*" -o -name "*intake-arc*" | grep -v node_modules
./docs/reports/phase0-draft-plan-intake-findings.md
```

There is no `docs/plans/` directory and no file of that name anywhere in the repo. The Phase 0
report exists and I have it. **D1, D2 and D4 are restated inline in the brief, so Parts 0–5 are
buildable without the plan doc** — but anything the plan doc says beyond those three decisions
(D3's fallback, the draft view's shape, beat approval semantics, how drafts are superseded when
the real plan lands) is unavailable to me. §4 below flags one place where that gap has a concrete
consequence.

---

## Part 0 — Consumer audit

Every non-test reader of `content_cycle_posts`, found by exhaustive grep across `app/`, `admin/`,
`engine/`, `packages/` (229 hits across 27 files; tests and `/dist/` excluded).

**Stop condition: NOT triggered.** `status` is a column on the table and is available at every
layer that reads it. Every leak below is fenceable with a simple status filter.

### A. Client-facing and agent readers — real leaks

| # | Reader | file:line | Status filter today | Draft leaks? |
|---|---|---|---|---|
| 1 | `loadPlanPosts` | `app/src/lib/plan.ts:119` | none — `cycleId` + `clientId` + `isNull(deletedAt)` only | **YES** |
| 2 | `loadCrossMonthPosts` | `app/src/lib/plan.ts:144` | none — client/channel/date-range + `deletedAt` | **YES** |
| 3 | `toPlanPost` status coercion | `app/src/lib/plan.ts:105` | n/a — see below | **YES, and worse** |
| 4 | `loadCycleList` | `app/src/lib/plan.ts:189` | none — `leftJoin` counts live posts per cycle | **YES** |

Reader 1 is the important one: it is the single load behind **three** surfaces —
`app/src/app/page.tsx:46` (first paint), `app/src/app/api/plan/route.ts:36` (month view), and
`app/src/lib/agent/turn.ts:106` (**the agent's plan answers — the Bug 4 adjacency**). Fencing
`loadPlanPosts` closes all three at once.

**Reader 3 is the most serious finding of this audit.** `plan.ts:105` coerces any unrecognised
status to `'planned'`:

```ts
const STATUSES = new Set<PostStatus>(['planned', 'edited', 'new', 'generating', 'generation_failed']);
...
status: (STATUSES.has(r.status as PostStatus) ? r.status : 'planned') as PostStatus,
```

A `draft` row reaching this mapper would not merely leak — it would be **relabelled `'planned'`
and become indistinguishable from a committed plan post** in the client UI and in the agent's
context. A silent misrepresentation, not a visible anomaly. Filtering at the query is therefore
necessary but not sufficient: `'draft'` must also be added to `STATUSES`/`PostStatus` (Part 1) so
that any row which ever does reach the mapper is labelled honestly rather than disguised.

Reader 4 leaks a *cycle*, not a post: a cycle whose only rows are drafts would report
`liveCount > 0` and qualify for the client's month menu, surfacing a month that has no plan.

### B. Admin reader — leak

| # | Reader | file:line | Status filter today | Draft leaks? |
|---|---|---|---|---|
| 5 | Magic-link empty-cycle guard | `admin/src/app/admin/clients/[id]/actions.ts:59` | none — `count(*)` where `cycleId` + `deletedAt` | **YES** |

A draft-only cycle would count as non-empty, suppressing the "client would land on an empty plan"
confirmation and letting an operator mint a link to a cycle with no plan.

### C. Engine — plan regeneration and the weekly session

| # | Reader | file:line | Status filter today | Draft leaks? |
|---|---|---|---|---|
| 6 | Regen merge classification | `engine/src/content-cycles/planning.ts:1008` | none — all rows for the cycle | **YES — see §4** |
| 7 | Weekly-session week window | `engine/src/content-cycles/weekly-session.ts:135` | none — cycle/client/`deletedAt` + date range | **YES** |
| 8 | `merge-apply-cli` (ops) | `engine/src/content-cycles/merge-apply-cli.ts:103` | none | YES (ops tool) |
| 9 | `plan-merge-dryrun` (ops) | `engine/src/content-cycles/plan-merge-dryrun.ts:37` | none | YES (ops tool) |

Reader 7 would let the weekly audit critique, rewrite, and raise proposals against draft beats as
though they were plan posts.

### D. Single-post-by-id readers — low risk, fenced defensively

All take an explicit `postId` and additionally scope by `clientId` (+ `cycleId`). A draft's id is
not discoverable once the list readers above are fenced, so these are defence-in-depth rather than
open leaks. Fencing them means a draft id leaked by any future path still cannot be edited or
generated against.

| Reader | file:line |
|---|---|
| `ownedPost` (all client mutations) | `app/src/lib/mutations.ts:39` |
| `gatePostEdit` context | `app/src/lib/edit-scope.ts:49` |
| `ownedPostFormat` (checklist steps) | `app/src/lib/steps.ts:45` |
| Agent hook-target resolution | `app/src/lib/agent/proposals.ts:140` |
| Agent refine-target resolution | `app/src/lib/agent/proposals.ts:165` |
| Hook generation | `engine/src/content-cycles/hook.ts:70` |
| Script generation | `engine/src/content-cycles/script.ts:38` |
| Field refine | `engine/src/content-cycles/refine.ts:43` |
| Shape (caption rewrite) | `engine/src/content-cycles/shape.ts:65` |

### E. Confirmed NOT readers — no fence needed

| Path | Evidence |
|---|---|
| **Delivery / `plan_ready` email** | `engine/src/content-cycles/planning.ts:662` merges only `{clientName, monthLabel, appLink}`. It does not enumerate posts. |
| **CSV / xlsx workbook** | Built from the in-memory `planRows` inside the planning run, never re-read from the table. `content_cycle_posts` is an additive dual-write (`schema.ts:936-942`). |
| `app/src/lib/queue.ts:55,170` | `UPDATE … WHERE id` by explicit post id — writes, not reads. |
| `engine/src/content-cycles/post-mapping.ts` | Pure helpers (`mapFormat`, `isoDateInMonth`) — no query. |
| `engine/src/content-cycles/backfill-posts-cli.ts` | Writes only. |

So **delivery is already safe by construction** — it never reads the table. That is a stronger
guarantee than a filter, and worth recording so nobody later "adds a filter for consistency" and
implies the surface was ever at risk.

### F. Status domain — where `'draft'` must be added (Part 1)

| Enforcement point | Current state |
|---|---|
| **DB CHECK constraint** | **None exists.** `pg_constraint` on `content_cycle_posts` shows only NOT NULLs, PK and two FKs. `status` is bare `text NOT NULL DEFAULT 'planned'`. No DB change needed for the domain. |
| TS union | `app/src/lib/types.ts:13` — `PostStatus = 'planned' \| 'edited' \| 'new' \| 'generating' \| 'generation_failed'` |
| Runtime coercion set | `app/src/lib/plan.ts:74` — `STATUSES` |
| Zod schemas | None found for post status — grep surfaced no zod validator over this field. Recorded as verified-absent, not assumed. |

---

## 4. One decision the missing plan doc would have settled

Reader 6 (`planning.ts:1008`) feeds `plan-merge.ts`'s classifier. A `draft` row entering it is
neither `'new'` nor `'edited'`, so `shouldPreserve` (`plan-merge.ts:52-62`) returns false and the
row lands in `dec.replace` — meaning **a plan regeneration would silently delete every draft beat**
as an incidental consequence of a classifier that has never heard of drafts.

Deleting drafts when the real plan lands may well be the intended lifecycle. But right now it
would happen *by accident*, through a code path whose comments show no awareness of the case.

I do not have the plan doc that would tell me the intended disposition, and inventing one is
outside this session's scope. **My proposal for Part 0:** exclude `'draft'` from the classifier's
input entirely — an explicit fence, so drafts are neither preserved nor deleted incidentally — and
leave their supersession to the later build in this arc that owns the draft lifecycle. Drafts would
survive a regen but remain invisible everywhere (readers 1–5, 7 fenced), so there is no
user-visible consequence either way; this simply avoids encoding a lifecycle decision by accident.

Flagging rather than deciding, because it is a lifecycle question, not a fencing question.

---

## 5. Proposed fix approach

Rather than 15 scattered `ne(status, 'draft')` clauses that will drift, export the predicate once
from `@sprigly/db` (already imported by `app/`, `admin/` and `engine/`) and use it at each reader:

```ts
export const POST_STATUS_DRAFT = 'draft';
/** Drizzle condition: exclude unapproved draft beats from a plan read. */
export const excludeDraftPosts = () => ne(contentCyclePosts.status, POST_STATUS_DRAFT);
```

Explicit at every call site as the brief requires, but with one definition of what "draft" is.

---



## 6. Part 0 — fixes applied

All confirmed. `excludeDraftPosts()` is defined once in `packages/db/src/schema.ts` and applied
explicitly at each reader. The fence landed **first** (commit `cd29f8f`, before the status could
exist), so there was never a window in which a draft row was visible.

| Reader | file:line | Fix applied |
|---|---|---|
| `loadPlanPosts` | `app/src/lib/plan.ts:131` | `excludeDraftPosts()` in `WHERE` — closes the client plan, `GET /api/plan`, and the agent's plan context together |
| `loadCrossMonthPosts` | `app/src/lib/plan.ts:~160` | `excludeDraftPosts()` in `WHERE` |
| `loadCycleList` | `app/src/lib/plan.ts:~210` | `excludeDraftPosts()` in the **JOIN** |
| `isCycleReadableByClient` | `app/src/lib/plan.ts:~262` | `excludeDraftPosts()` in the **JOIN** |
| Magic-link empty guard | `admin/src/app/admin/clients/[id]/actions.ts:59` | `excludeDraftPosts()` in `WHERE` |
| Weekly-session window | `engine/src/content-cycles/weekly-session.ts:135` | `excludeDraftPosts()` in `WHERE` |
| Regen classifier | `engine/src/content-cycles/planning.ts:~1008` | `excludeDraftPosts()` in `WHERE`, lifecycle-inert |
| `PostStatus` / `STATUSES` | `app/src/lib/types.ts:13`, `app/src/lib/plan.ts:74` | `'draft'` added so the coercion cannot relabel it |

The two cycle-qualification joins filter in the **JOIN** rather than the `WHERE` deliberately: a
draft-only cycle must still return its row with `liveCount 0` rather than vanishing from the
aggregate entirely.

### One reader the audit missed

`isCycleReadableByClient` (`app/src/lib/plan.ts`) was **not** in the Part 0 table. I found it while
applying the fence — it is structurally identical to `loadCycleList` (same `leftJoin` + live-count
shape) and is the guard the read path uses before serving a non-home cycle. It was a genuine leak:
a draft-only cycle would have been readable. Recorded because the audit was presented as
exhaustive and was not.

### Known interim state — draft supersession

Per the confirmed decision, the regen classifier fence encodes **no** supersession behaviour. The
consequence, stated plainly: **a whole-plan generation on a cycle that holds drafts will produce
generated plan posts alongside surviving draft rows.** The drafts stay invisible to every fenced
reader, so there is no user-visible effect, but they are not cleaned up. Draft lifecycle —
including when a draft is superseded, approved, or expired — belongs to Build D.

---

## 7. Migrations

Written as the next-numbered files and applied to the **dev** database by hand. The journal stays
frozen at 0026; `drizzle-kit generate` and `drizzle-kit migrate` were not run.

### 0084 — `content_cycle_posts.beat_meta`

```
$ psql "$DATABASE_URL" -f packages/db/migrations/0084_draft_beat_meta.sql
ALTER TABLE

$ psql "$DATABASE_URL" -c "\d content_cycle_posts" | grep -E "beat_meta|status"
 status                | text                        |           | not null | 'planned'::text
 beat_meta             | jsonb                       |           |          |
```

`BeatMeta` / `BeatRationaleEvidence` are defined in `packages/db/src/schema.ts` as the contract.
`cadenceBasis` was made **required** during implementation: every beat has a slot-count basis on
the observed and template paths alike, and a beat that cannot say why it exists at all should not
exist.

**No DB CHECK on `content_cycle_posts.status`** — verified against `pg_constraint` (only NOT NULLs,
the PK and two FKs). The status domain lives in TypeScript.

### 0085 — `ask_drafted` email template

```
$ psql "$DATABASE_URL" -f packages/db/migrations/0085_ask_drafted_template.sql
ALTER TABLE
ALTER TABLE
INSERT 0 1

$ psql "$DATABASE_URL" -c "select key, version, is_published from email_templates order by key, version;"
     key     | version | is_published
-------------+---------+--------------
 ask         |       1 | f
 ask         |       2 | t
 ask_drafted |       1 | t
 last_call   |       1 | t
 nudge       |       1 | t
 plan_ready  |       1 | t
```

**Unexpected, and worth knowing:** `email_templates.key` *does* carry a CHECK constraint
enumerating valid keys — unlike `content_cycle_posts.status`, which has none. The first apply was
rejected by it. The migration now replaces the constraint rather than dropping it: an
unconstrained key column would let a typo'd key insert silently and then resolve to no template at
send time. My Part 0 audit checked constraints on `content_cycle_posts` only, so this was a gap in
the audit's scope rather than in the database.

---

## 8. Part 2 — pillar `sharePct` persistence

`derivePillars` always asked the model for a per-pillar share; `toConfigPillars` discarded it. That
is why no pillar weight existed anywhere in the database for any client (Phase 0, I-1 §1a).

**Chosen: derive on read, not backfill.** `sharePct` is optional on `Pillar`, so every config
written before this commit remains valid, and `resolvePillarWeights()` falls back to equal shares.

Justification for the smaller change: a backfill means re-running `derivePillars` per client — a
billable, non-deterministic model call that would write weights nobody ever measured as though they
had been. Equal-share-on-read is both less code and more honest. Callers get the basis back
(`'derived' | 'equal'`), so a beat planned on equal shares says so in its evidence instead of
implying it observed something. Confirmed against live data: all three clients' stored configs
parse unchanged, and earl-of-east's draft correctly reports the `equal` basis (see §10).

One stale test asserted the old discard behaviour (`onboard.test.ts`, named *"share dropped from
config"*). It is fixed in `9e43e39` — noting honestly that `d99253b` left the worker suite red
between those two commits.

---

## 9. Parts 3–4 — assembler, allocator, phrasing

New modules in `@sprigly/engine`, all pure (the db reads live in `engine/src/content-cycles/draft-plan.ts`):

| Module | Role |
|---|---|
| `draft-history.ts` | Observations from stored `ig_posts` — cadence, weekday pattern, format mix, per-format engagement |
| `pillar-weights.ts` | `resolvePillarWeights` + `spreadPillars` (largest-remainder, interleaved) |
| `draft-skeleton.ts` | Slot count, dates, formats, pillars → the deterministic skeleton |
| `draft-allocator.ts` | The temperature dial (D4) |
| `draft-assembly.ts` | Wires the above, builds evidence + assumptions |
| `draft-phrasing.ts` | The one model call, with a validated contract |

**Determinism** is a property of the functions, not of a mock: every ordering has an explicit
tiebreak, and tests assert the skeleton is unchanged when the input arrays are reversed. A tie
resolved by array position is a tie resolved by database row order.

**Honest evidence.** Below `DRAFT_MIN_POSTS` (15, mirroring onboarding's `THIN_CAPTION_FLOOR`) the
assembler switches to a neutral template skeleton and declares it — template beats carry **no**
`formatEngagement` and **no** `pillarShare` at all, which is asserted directly. A format the client
has never posted is **absent** from the observations rather than present with zero: "no reels
observed" and "reels scored zero" are different claims.

**The engagement tilt is clamped to [0.5, 2].** Unclamped, one strong month of carousels erases
reels from the plan entirely — a recommendation the data cannot support from n=8.

**Temperature resolves to nothing today**, exactly as expected: `loadDurableInputs` filters
`plan_inputs` to `type IN ('idea','next_cycle')` and every live row is `type='note'`, so the
candidate list is empty for every client. Tested as the day-one path — an empty backlog must give a
full proven month, never an empty one. Unfilled experimental slots always revert to proven. No
per-client temperature dial exists yet (D4 — the interface lands here, the dial does not), so
`draft-plan.ts` passes `null`.

**The phrasing pass** is the only place a draft can gain words nobody verified, so its contract is
enforced twice — in the prompt *and* in `validatePhrasing()`. It rejects invented launches,
restocks, prices, dates, months, metrics and performance claims, and rejects the **whole batch** on
one bad title: a model that invented a launch for beat 7 was not reasoning within its evidence for
beats 1–6 either. On failure it retries once, then falls back to deterministic titles. Assembly
never hard-fails on phrasing.

Two real detection holes were found *by the tests* and fixed: `\b` before `£` never matches (not a
word character), and "back in stock" is a restock by another name.

---

## 10. Sample draft — Earl of East, run against dev data

`assembleDraft` run against the live dev database (read-only; no writes, no model call). Client
slug is **`earl-of-east`** — the brief's `earlofeastlondon` does not exist.

```
client=Earl of East  cycleMonth=2026-08  planningMonth=2026-09
history=31 posts     basis=observed      beats=10

date        format    pillar                    slot     title
2026-09-02  carousel  Brand Story & Culture     proven   Brand Story & Culture — Carousel
2026-09-03  single    Everyday Ritual           proven   Everyday Ritual — Single
2026-09-04  carousel  Home & Space              proven   Home & Space — Carousel
2026-09-09  single    Product & Fragrance       proven   Product & Fragrance — Single
2026-09-11  carousel  Workshops & Experiences   proven   Workshops & Experiences — Carousel
2026-09-16  single    Brand Story & Culture     proven   Brand Story & Culture — Single
2026-09-17  carousel  Everyday Ritual           proven   Everyday Ritual — Carousel
2026-09-23  single    Home & Space              proven   Home & Space — Single
2026-09-24  single    Product & Fragrance       proven   Product & Fragrance — Single
2026-09-25  single    Workshops & Experiences   proven   Workshops & Experiences — Single

formats: {carousel: 4, single: 6}
pillars: 2 each across all five pillars
```

`rationaleEvidence` (beat 1, representative):

```json
{
  "basis": "observed",
  "formatEngagement": { "format": "carousel", "avgEngagement": 69.9, "posts": 8 },
  "pillarShare": 0.2,
  "cadenceBasis": { "postsPerWeek": 2.24, "source": "observed", "months": 4 }
}
```

`assumptions`:

```
1. No launches or restocks are on record for this month — the draft assumes a business-as-usual month.
2. No pillar weights are on record, so the month splits evenly across pillars.
```

Three things worth reading off this:

- **The engagement figures match the Phase 0 SQL exactly** — carousel 69.9 over n=8, single 38.2
  over n=23 (report I-1 §2). The TypeScript observation and the hand-written SQL agree, which is a
  real cross-validation rather than a self-consistent mock.
- **The tilt behaves as designed.** Carousels are 25.8% of observed posts but take 40% of the
  slots, pulled up by ~1.8× engagement — and singles are not eliminated, which the clamp exists to
  guarantee.
- **The assumptions are true.** Earl of East genuinely has no briefed launch for the month and a
  pillar config predating `sharePct`, so the draft reports the `equal` basis rather than implying
  it measured a distribution. **No reels appear** — correctly, since Earl of East has posted none;
  the assembler never invented a format it had no evidence for.

---

## 11. Tests

| Suite | Result |
|---|---|
| `@sprigly/engine` | **139 passed** (8 files) — 43 assembler/allocator/skeleton, 21 phrasing |
| `@sprigly/app` | **194 passed**, 1 skipped (26 files) — includes 5 draft-invisibility |
| `@sprigly/worker` | **326 passed**, 1 skipped (22 files) — includes 5 Ask-touch draft tests |
| `@sprigly/db` | **6 passed** |

Type-check clean across `packages/db`, `packages/engine`, `app`, `admin`, `engine`.

Coverage against the brief: assembler determinism (incl. input-order independence); allocator edge
cases (temp 0, temp null, temp 1, empty candidates, candidate surplus, candidate shortage,
rounding, spacing); draft invisibility for each fenced reader; phrasing-pass fallback (malformed,
invented content, model throw, retry-then-recover); Ask-touch failure isolation; thin-data fallback
above, at and below the floor.

**Two verifications that the tests bite**, since a passing test that cannot fail proves nothing:

- Removing `excludeDraftPosts()` from `loadPlanPosts` → the invisibility suite fails.
- (Session 1) Bypassing the structural merge → 6 of its tests fail.

The worker and app suites need `DATABASE_URL` at collect time (`packages/db/src/client.ts:6`); run
as the package scripts do (`set -a && . ../.env.local`). Without it, 9 worker files fail to
*collect*. Pre-existing, unrelated to this work.

---

## 12. Commits

| Hash | Part | Behaviour |
|---|---|---|
| `cd29f8f` | 0 | Fence draft beats out of every plan reader before they can exist |
| `981d0b2` | 1 | `beat_meta` column and `'draft'` post status |
| `d99253b` | 2 | Persist pillar `sharePct` instead of discarding it |
| `33672fe` | 3–4 | Deterministic assembler, allocator and phrasing pass |
| `9e43e39` | 2 (fix) | Update the onboarding assertion that required `sharePct` to be discarded |
| `36c55a3` | 5 | Assemble a draft at the Ask touch and send it to the client |

Not pushed, not merged, not promoted. Build B not begun. The intake route was not touched.

---

## 13. Unexpected, and left unfixed

1. **The plan document does not exist** (§ top). Built against the inline D1/D2/D4 restatements.
   Anything else it specifies has not been honoured because it could not be read.
2. **`email_templates.key` has a CHECK constraint**; `content_cycle_posts.status` does not. Found
   by a rejected insert, not by the audit. Migration 0085 widens it.
3. **`isCycleReadableByClient` was missing from the Part 0 audit** and was a real leak (§6).
4. **Draft supersession is unowned** (§6). A regen leaves invisible draft rows behind. Interim by
   agreement; Build D.
5. **`d99253b` left the worker suite red** until `9e43e39`. Recorded rather than hidden by an
   amend.
6. **Staleness is inferred from `ig_posts.updated_at`**, because no trawl-run table exists. It is
   the closest available proxy for "when did a trawl last succeed", not a direct measure — a trawl
   that ran and found nothing new may not bump it.
7. **`content_cycle_posts.overlay` remains dead** (no writer, zero non-null rows) — carried over
   from Phase 0, untouched here.
8. **No per-client temperature dial.** `draft-plan.ts` hardcodes `null`. The allocator interface is
   built and tested; wiring a stored dial is deliberately out of scope for this arc (D4).
