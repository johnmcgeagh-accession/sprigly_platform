# Worker Brief Inheritance

**Date:** 2026-08-13 · branch `dev`
**Status:** investigation brief. Established by READING only — nothing here was measured, and
nothing was acted on.
**Read first:** `docs/reports/` — the extraction thread; and the commits
`f57efaa` (the CURRENT PLAN section), `9e4ae96` / `71fb469` / `0233d49` (cap, shortfall
detection, failure recording), `a722af9` (the reshape reads the submission's brief).

---

## The finding in one paragraph

The app and the worker run the same extractor for two different jobs, and the app's answer
silently becomes the worker's. The app extracts **with** a CURRENT PLAN section — the
edit-resolution framing — and persists the result. The worker never re-extracts when a brief is
already persisted, so the month generator's description of the client's brief is the output of a
call that was framed, and budgeted, for a different question. When that call abridges, the
generator is told a smaller brief than the client wrote, and nothing says so.

---

## What was established, by reading

### 1. The two callers pass different inputs

| | app — `app/src/app/api/plan/intake/route.ts` | worker — `engine/src/content-cycles/planning.ts` |
|---|---|---|
| call site | `:218-229` | `:774-778` |
| `currentPlan` | **passed** (`:220`) | **not passed** |
| `durableContext` | passed | passed |
| budget | `EXTRACT_TIMEOUT_MS = 25_000` (`route.ts:44`) | model-client default, 180s |
| runs | on every pre-cutoff save | once, at cutoff, only if nothing is persisted |

### 2. The worker takes the app's answer verbatim

`ensureStructuredBrief` (`planning.ts:757-763`):

```
const existing = cycle.structuredBrief;
if (existing != null) return existing as StructuredBrief;   // extract-once: re-read on regen
```

The docblock at `:743-756` states the intent plainly — *"If the cycle already has a persisted
structured_brief, re-read it — no extraction (regen is cheap and stable)"* — and names the only
re-extraction trigger: an intake change clearing the column
(`packages/db/src/structured-brief-invalidate.ts:44-70`). That clear is a no-op at or after
`planning` (`:56`, `PRE_PLANNING_STATUSES` at `:28-30`), so whatever the last pre-cutoff save
persisted is what the cutoff run inherits.

### 3. The inherited brief is the describe-consumers' only input

Everything below reads `structured_brief` and none of it re-derives:

| Consumer | Location | What it does with it |
|---|---|---|
| `renderStructuredBriefSection` | `planning.ts:204-236`, called `:285` | Renders `BRIEFED LAUNCHES / RESTOCKS (the ONLY launches and restocks this month …)`, `FIXED DATED BEATS`, `UNDATED CONTENT PIECES`, `PLAN WINDOW` into the generation prompt |
| `hasBriefContent` | `planning.ts:240-242` | Gates whether that section appears at all |
| `surfaceConflicts` | `planning.ts:252-265`, called `:1006` | Appends `⚠️ Brief conflict` to post notes for the reviewer |
| `briefedProductNames` | `plan-merge.ts:112-121`, called `planning.ts:1091` | The "briefed universe" the orphan check tests existing posts against |
| `indexCatalogue` | `engine/src/catalogue/validate-catalogue.ts:68`, `:102-117`, called `shape.ts:162` | Admits a briefed launch colourway into that product's valid set so a caption naming it is not flagged as a fabrication |
| `hasBriefedLaunch` | `draft-plan.ts:286-287`, used `:339` | `products.length > 0` |

### 4. Why that matters given the abridgement

The prompt's `BRIEFED LAUNCHES / RESTOCKS` line asserts exclusivity — *"the ONLY launches and
restocks this month — feature these; do NOT frame any other product as launching, new, or
returning"* (`planning.ts:228`). A dropped product therefore does not merely go unmentioned: the
generator is instructed that it is **not** launching. The same dropped name is absent from
`briefedProductNames`, so an existing post naming it can read as orphaned; and absent from
`indexCatalogue`'s briefed pairs, so a caption naming its new colourway can be flagged as
invented.

### 5. The worker's own extraction would probably be better

Measured previously and recorded here only as context, not as part of this finding: with no
CURRENT PLAN section the same brief extracted to 2,881–3,557 output tokens in 38–45s, versus
1,488–1,960 tokens with it. The worker has 180s, so the slower, fuller call is affordable there
and is not affordable on the app's 25s path. The path that can afford the good answer is the one
that never runs.

### 6. `a722af9` deliberately did not change this

That commit gave the *reshape* a submission-scoped brief and left persistence alone. The column
is still written by the accumulation extraction, on the app path, with CURRENT PLAN. So the
inheritance described here is unchanged and remains live.

---

## What was NOT measured

Everything downstream of the brief. Specifically:

- **No generated month was compared** against an abridged versus a faithful brief. The harm is
  argued from the prompt text and the consumer list, not observed.
- **No orphan-check or catalogue-validation outcome** was measured with a name missing. That a
  dropped name is absent from `briefedProductNames` is a code fact; that it changes a
  preserve/drop/replace decision or produces a spurious caption violation is inference.
- **Frequency is unknown.** How often a cutoff actually inherits an abridged brief depends on
  whether the last pre-cutoff save abridged, which is sampled and unstable — the same input has
  produced 5/5, 4/5, 3/5 and 2/5 drops across sessions.
- **No production instance was found.** The shortfall detector (`brief-shortfall.ts`, added
  `71fb469`) has recorded no `outcome: shortfall` row in production; the only recorded outcomes
  are 12 `failed/timeout` rows from a UAT harness. It has not been running long enough to say
  anything about real traffic.
- **Whether the worker's own extraction is actually better on this brief** is untested at the
  worker's call shape: the 2,881–3,557 figure came from a scratchpad harness, not from
  `ensureStructuredBrief` running with a cleared column.

---

## What it would take to measure it

Roughly in increasing cost.

1. **Establish frequency, cheaply and passively.** The detector already writes
   `content-cycle:brief-extract-outcome` rows with `outcome: shortfall` and the missing names
   (`route.ts`, `71fb469`). Leave it and query after real traffic. This answers "does this happen
   to clients" without a single model call. Limitation stated in `brief-shortfall.ts:29-42`: it
   sees only catalogue products, so it is a floor.

2. **Prove the inheritance directly.** For a cycle whose persisted brief has a recorded
   shortfall, read `structured_brief` at cutoff and confirm the generation prompt carried the
   abridged product list. `brief-prompt-preview.ts` already renders the planning user message for
   a cycle without generating, so this is a read plus a diff — no spend, no writes.

3. **Measure the generation delta.** Take one cycle, generate a month twice — once with the
   inherited brief, once with the column cleared so `ensureStructuredBrief` re-extracts — and
   diff the resulting posts for the dropped product. This is the first step that costs real
   generation spend, needs a cycle that can be written to and reset, and is sampled: generation
   varies run to run, so a single pair proves nothing and the comparison needs several.

4. **Measure the second-order consumers.** Orphan classification (`mergePlan`) and catalogue
   validation (`applyCatalogueValidation`) are both pure given their inputs, so each can be
   driven directly with a briefed-universe that does and does not contain the dropped name — no
   model calls, no writes. `merge-apply-cli.ts` and `brief-grounding-probe.ts` are existing
   entry points for exactly this.

---

## What this brief does not recommend

Nothing. The obvious shapes — have the worker re-extract regardless, mark provenance on the
persisted brief so the worker can tell which framing produced it, or stop the app persisting at
all and let the worker own the describe pass — each trade differently against the month view,
which reads the persisted column on page load (`app/src/app/page.tsx:120-130`,
`app/src/app/api/plan/route.ts:44-63`) and would show nothing between the save and the cutoff if
the column stopped being written. That trade-off is the decision this brief exists to inform,
and it is not made here.
