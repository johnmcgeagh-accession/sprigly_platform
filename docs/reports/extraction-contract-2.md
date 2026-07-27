# Extraction Contract II + Generation Quality

**Date:** 2026-07-27 · branch `dev`
**Spec:** the Extraction-Contract-II prompt. Read first:
`docs/reports/rehearsal-fixes.md`, `docs/reports/ivy-t-rehearsal-failures.md`.

| commit | hash | what |
|---|---|---|
| 1 | `55859d7` | feat: a typed row is a beat, not a request (beat_spec) |
| 2 | `1df67b8` | feat: a stated cadence is a floor the telling can set |
| 3 | `507771f` | fix: a deliverable contains the deliverable, and nothing else |
| 4 | `73bf1f7` | feat: a reel's hook and script are one coherent pair |
| 5 | `c91ed57` | fix: a draft is assembled pre-planning or not at all |
| 6 | `a527383` | feat: classify-check — demonstrate the classifier, don't argue it |

**Suites:** engine **324** (was 296: +16 beat_spec, +12 cadence), all green.
Worker offline unit suites green (deliverable **8**, draft-plan-guard **3**, consumer **25**);
the Postgres/Redis integration suites (`fan-out-hooks`, `plan-ready`) are updated for the new
reel flow and skip cleanly offline — the operator runs them with `TEST_DATABASE_URL` /
`TEST_REDIS_URL`. App **402 passed** (+2 pre-existing `DATABASE_URL`-at-import suites still
unloadable offline — `edit-scope.test.ts`, `post-generation.test.ts`; unchanged by this work).
Type-check clean across engine, worker and app. No migration; no DB writes from this session.

---

## COMMIT 0 — roadmap doc

`docs/roadmap/sprigly-roadmap-2026-07-21.md` is **absent** from the tree. As instructed, this
commit was **skipped** and the doc was NOT created or reconstructed.

---

## COMMIT 1 — `55859d7` — beat_spec intent (typed rows apply literally)

**Two entry points, one application path.** A deterministic pre-parse (`parseBeatSpec`) runs
FIRST in `classifyIntake`, before the model: a date-leading `[date][format?][title]` line
short-circuits Bedrock entirely and is applied as `kind:'beat_spec'`. Near-misses phrased as a
request ("add a reel on the 22nd called X") fall through to the model, which returns the same
kind. Both dispatch through `applyBeatSpec`, which ADDS one beat (slot count grows, nothing
displaced): given date, given format (vocab-checked; absent → the month's commonest, else
`single`), title **VERBATIM** (the `deriveTitle` cap does not apply), `beat_meta` marked
`client_added` + `clientTouched` — the client's own hand, never auto-replaced.

**Fixtures** (`draft-beat-spec.test.ts`, 16 tests):

| input | result |
|---|---|
| `Sat 22 Aug Reel What I am most proud of… — part 2` | pre-parsed (no spend) → beat_spec, `2026-08-22`, reel, title verbatim incl. `— part 2` |
| `add a reel on the 22nd called What I am most proud of part 2` | pre-parse declines (not date-leading) → model owns it → beat_spec applies as one add on 22 Aug |
| `Fri 14 Aug Carousel Weekend Style Guide — Lily tee & Sophie short co-ord` | pre-parsed → `2026-08-14`, carousel, full hyphenated title kept |
| `we should do more reels` | pre-parse returns **null** (not date-leading) → falls through to the model |

Also pinned: a >60-char title is stored **whole** (the cap does not apply); a date-leading line
that opens with an intent verb ("20 Aug move the reel…") is declined by the pre-parse; the year
comes from the plan month, never the client; a beat_spec with no date is filed (`ambiguous`),
not dropped on a guessed day.

---

## COMMIT 2 — `1df67b8` — cadence intent (client instruction beats observed history)

`kind:'cadence' {postsPerWeek?, postsPerMonth?}` (at least one; the route files a numberless
"post more" as an emphasis/idea). **Storage:** the floor is written to
`content_cycles.intake_json.cadenceFloor` — the same cycle-scoped intake record that already
holds the receipts. Chosen over a new column because a cadence floor **is** an intake
instruction scoped to this cycle, the worker assembler reads it back on every re-assembly, and
a dedicated column would need a migration to buy queryability nothing yet uses. It is the
smallest honest home.

**Future assembly:** `buildSkeleton` gains `floorSlots` — the slot count is lifted to at least
the floor, never above the month, never below the observed count. `cadenceFloorSlots(month,
cadence)` converts weekly/monthly figures (larger wins) to a month slot count.

**Live top-up** (`applyCadence`, pure): when a draft exists, the gap to the floor is filled on
the **thinnest days** (fewest beats, widest gaps), format and pillar drawn from the mix the
month already shows (its observed weights via `spreadPillars`), the real observed
`formatEngagement` for each format copied from a live beat (never invented), every added beat
marked the client's `client_input`. Nothing is ever removed.

**Fixtures** (`draft-cadence.test.ts`, 12 tests):

| input (24-beat August, 31 days) | result |
|---|---|
| `we want 7 posts a week` | floor 31 → **+7 beats**, each on one of the 7 empty days, `Added 7 posts to reach 7 a week, as you asked.` |
| `post every day` (postsPerWeek=7) | +7 |
| `at least 28 this month` | +4, `Added 4 posts to reach 28 this month, as you asked.` |
| `no more than 4 a week` | floor 18 < 24 → **no ops**, `Recorded 4 a week as your floor. You have 24 posts this month — I only ever add to reach a floor, never remove, so drop the ones you don't want.` |
| interaction with `clientTouched` beats | ops are **pure additions** — `every(op==='add')` — so no touched (or any) beat is displaced |

Future-assembly floor: with a ~1/week history, a 7/week floor lifts `buildSkeleton` to 31 slots;
a floor below the observed count does not lower it. A cadence that arrives with **no draft yet**
records the floor and returns a receipt ("I'll hold your month to it when it's drafted") — it is
NOT filed as a backlog idea.

---

## COMMIT 3 — `507771f` — scratchpad leak (deliverables contain deliverables only)

`deliverable.ts` — one shared contract + gate:
- `extractDeliverable(raw, 'SCRIPT')` keeps only the text after a `===SCRIPT===` marker
  (reasoning before it discarded); falls back to the block after the last `---` (the shape the
  leak took on uat), then to the whole trimmed text (a clean answer passes unchanged).
- `hasDeliberativeMarkers(text)` — the gate. Precision-tuned so a real script passes ("let me
  know in the comments" is fine) while chain-of-thought fingerprints do not (word-count
  arithmetic, "Actually re-reading…", "let me reconsider", "per the rules", "as instructed",
  register/budget meta-references, "doesn't match the arc").

`script.ts` now extracts → gates → **repairs once** on a leak → **withholds rather than stores**
if still contaminated (a loud failure; the script field stays empty and regenerable). Hook
candidates carrying markers are dropped before the top one can be auto-selected. The contract is
enforced at the **call site**, not the mutable DB prompt, so it can't drift per client and needs
no migration.

### The uat leaked-script fixture — before → after

The live uat row is not in the repo, so the fixture (`deliverable.test.ts`) **reconstructs** its
described shape faithfully: register deliberation, `Target is 30s ≈ 66 words…`, `Actually,
re-reading the caption…`, `Per the rules… as instructed`, then `---`, then the clean
`HOOK/BEAT/CTA` script.

| | stored `script` field |
|---|---|
| **before** | the ENTIRE transcript — reasoning, word-count arithmetic, "Actually…", `---`, then the script |
| **after** | `extractDeliverable(…, 'SCRIPT')` → **only** the post-`---` `HOOK/BEAT/CTA` block; `hasDeliberativeMarkers` on the raw transcript is `true`, on the extracted block `false` |

A clean, contract-free response passes through byte-identical. A response with reasoning bled
*inside* a beat line (past every marker) is caught by the gate — extraction cannot save it, so
it is repaired/withheld. (8 tests.)

**Audit-caption path — finding, reported not fixed.** The per-post caption generator
(`plan-validation.ts` → `parseSinglePost`) and the weekly-audit caption rewrites that reuse it
already parse a JSON object, so preamble/CoT *outside* the JSON is discarded — a smaller leak
surface than the plain-text script had. The residual risk is reasoning bled *inside* the caption
field. The gate was applied to hook/script (the demonstrated leak) but deliberately **not** wired
into the well-tested `plan-validation` merge in this pass. Recommended follow-up: run
`hasDeliberativeMarkers` on the parsed caption field with the same repair-once/withhold policy.

---

## COMMIT 4 — `73bf1f7` — reels: hook + script generate TOGETHER

One `script` job now produces `{hook, script}` in **one** model call, built around each other
and written **atomically** (`===HOOK===` / `===SCRIPT===`, parsed by `deliverable.ts`, both
gated, repaired once, withheld if the pair can't be made clean). The reel's hook is grounded in
the same `hookPatternBlock` the standalone hook job uses (extracted from `hook.ts`).

- **Fan-out** (app `phase2.ts` + auto `draft-plan.ts`): a standalone hook job runs for
  **carousels only**. Reels get no separate hook job — the worker enqueues the combined job once
  the reel's caption lands (`enqueueScriptIfReady` now gates on the caption, not a pre-existing
  hook). `phase2.test.ts` updated: a reel is NOT in the hook-job target set; a carousel is.
- **Per-post regen:** "regenerate script" regenerates the coherent pair. The script route drops
  `hook_required` and requires only a caption (`caption_required`); the surface button reads
  "Generate / Regenerate hook & script" and no longer blocks on a pre-existing hook. Carousel
  hook regen and the interactive hook picker are untouched.

### Settlement verification

The combined job is a `'script'` job, so it is already in `GENERATION_JOB_KINDS =
['shape','hook','script']`; `isGenerationJobForCycle` matches `script_<cycle>_<post>_`, and
`hasPendingGenerationJobs` counts it. Sequence, per `consumer.ts` `settleFor`:

1. reel's **shape** (caption) job completes → `enqueueScriptIfReady` enqueues the combined
   `script` job → `settlePlanReady` runs AFTER, sees the just-queued script → **not_settled**.
2. combined **script** job completes → `settleFor` (type `script`) does not re-enqueue →
   `settlePlanReady` → no pending generation jobs → **settled**.

So the settled check cannot think a reel is done while its combined job waits — one job type
where there were two. The `plan-ready` integration predicate tests (`hook_/script_/shape_`
prefixes, "hook job pending → NOT settled") are unchanged and still valid; the `fan-out-hooks`
integration is updated: a reel with a caption enqueues the combined job (was: needed a hook);
post-fan-out, carousels have a hook and reels have a combined job queued (their hook arrives when
that job runs).

### Reel cost note — calls per reel

| | model calls per reel |
|---|---|
| **before** | hook job (1 call → 3 candidates) **+** script job (1 call) = **2** (and in the pre-autoSelect era the hook call was billed and discarded, so effectively ≥2 with a wasted one) |
| **after** | **1** combined call (+ at most 1 repair call, only when the first response leaks) |

Halved for the common case. Trade-off: a reel's hook and script now succeed or fail together —
a withheld pair leaves the reel with neither, regenerable from the surface.

---

## COMMIT 5 — `c91ed57` — assembly status guard

`assertCycleAssemblable(status)` refuses assembly outside `PRE_PLANNING_STATUSES` — the same set
the draft mutations and the intake route gate on. `assembleAndPersistDraft` calls it after
loading the cycle. The throw degrades the Ask touch to the plain email (its existing contract,
`consumer.ts`) and the `draft-assemble` CLI surfaces it as a clean operator message naming the
status and the `cycle-reset` command. **Both branches tested** (`draft-plan-guard.test.ts`, 3
tests): every pre-planning status permits; `workbook_built`, `planning`, `generating`,
`scheduled_and_approved`, `failed`, `complete` all refuse with the status + remedy named.

---

## COMMIT 6 — `a527383` — live-classifier verification harness

`classify-check` runs the REAL classifier over a fixture of sentences and prints intent kind +
extracted fields vs expected. Seeded (`classify-check-fixtures.json`) with: the series pair
(Style Guide enumerated, mini-series interval), the beat_spec sentences (typed row + phrased
near-miss), the cadence sentences (7/week, daily, "no more than 4"), the Meadow correction, a
plain launch, a plain event, a pure idea, the ambiguous founder story.

**Not run this session** (no Bedrock spend), by instruction. Date-leading beat_spec rows are
pre-parsed and cost nothing; the harness marks which cases spend. **Operator usage line:**

```
pnpm --filter @sprigly/worker classify-check
```

Run it once post-merge and paste the actual-vs-expected table. (It exits non-zero on any
mismatch, so it doubles as a check the operator can eyeball.)

---

## Found, and left unfixed

1. **The live-classifier check is still the one outstanding end-to-end verification** — now
   automated by `classify-check` (Commit 6) but not run here. Every transform is pinned by tests
   given a correct `kind`; that the model *returns* the right kind for beat_spec / cadence /
   series is argued in the prompt and demonstrable only by running the harness. This is the
   headline item to close post-merge.
2. **Audit-caption CoT gate — reported, not wired** (Commit 3 §finding). Apply
   `hasDeliberativeMarkers` to the parsed caption field with the same repair-once/withhold policy;
   left out of the well-tested `plan-validation` merge deliberately this pass.
3. **The script DB prompts (`0083`, `0071`) still say "plain text, no JSON".** The `===SCRIPT===`
   / `===HOOK===` contract is enforced at the call site (user message), which overrides and needs
   no migration, but aligning the DB prompt rows would remove the mixed signal. Follow-up.
4. **"No more than N a week" is stored as a FLOOR of N**, honored as "I won't add below this;
   drop the rest yourself" with an honest receipt — a ceiling can't be honored by removal
   (removal is the client's). Deliberate per spec; noted because a very thin future month could
   see that floor lift the count.
5. **A withheld reel pair leaves the reel with neither hook nor script** (Commit 4 trade-off).
   Regenerable from the surface; a hook failure no longer survives independently of the script.
6. **Pre-existing, carried over:** `app/src/lib/edit-scope.test.ts` and `post-generation.test.ts`
   parse `DATABASE_URL` at import and fail to load without it (2 suites); `packages/db` still has
   no `test` script. Neither touched here.
7. **Next session (boundaries):** the brief-decomposer consumes `beat_spec` + `cadence` + series;
   no application-undo, no per-post time override. Not started, by instruction.
