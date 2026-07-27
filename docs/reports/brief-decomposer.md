# Brief Decomposer

**Date:** 2026-07-27 · branch `dev`
**Spec:** the Brief-Decomposer prompt. Read first: `docs/reports/extraction-contract-2.md`,
`docs/reports/ivy-t-rehearsal-failures.md` (the real brief), `docs/reports/uat-findings-fixes.md`.

| commit | hash | what |
|---|---|---|
| 0 | `27aab11` | docs: consolidated product roadmap 2026-07-21 (operator-committed — see below) |
| 1 | `63cf2d5` | feat: split a brief into the instructions it contains |
| 2 | `dfedec2` | feat: apply a brief in order, report it as one receipt |
| 3 | `2d54799` | feat: a brief lands as one itemised receipt |
| 4 | `ce81186` | test: Sally's August brief, end to end + a decompose-check |

**Suites:** engine **346** (was 324: +15 decompose contract, +7 acceptance), all green.
Worker offline unit suites green; type-check clean across engine, worker, app. App **407 passed**
(+5 rollup-surface tests; +2 pre-existing `DATABASE_URL`-at-import suites still unloadable
offline — `edit-scope.test.ts`, `post-generation.test.ts`; unchanged by this work).
No migration; no DB writes from this session.

**Fences:** `git diff dfaae75 HEAD` on `draft-invisibility.test.ts`, `cycle-nav.test.ts` and
`packages/db/src/schema.ts` is empty; `excludeDraftPosts` unmodified. `draft-view.test.tsx` is
the working surface test (not a fence) and was extended.

---

## COMMIT 0 — roadmap doc

`docs/roadmap/sprigly-roadmap-2026-07-21.md` was **already placed AND committed** by the
operator (`27aab11`), and the working tree is clean for it. So this commit was a no-op this
session — nothing to create, nothing to re-commit.

---

## The problem

Real clients paste briefs, not sentences. Sally's actual August brief (~700 words, 13 distinct
intents) hit the single-intent extraction and fell to `couldnt_apply`. The contract can now
express everything the brief contains (series, beat_spec, cadence, correction, launch, event —
12/12 live-demonstrated via classify-check). This session adds the layer that splits a document
into those intents and routes each one. **The classifier prompt and schema are untouched.**

---

## COMMIT 1 — the decomposition step (`packages/engine/src/brief.ts`)

### The detector — `isDocumentShaped`

A honest heuristic tuned for a low false-POSITIVE rate on genuine single sentences. Document-shaped
if ANY of:
- **2+ line breaks** — people paste briefs with structure; the strongest signal;
- **240+ characters**;
- **4+ date signals** (ordinal days + month names) — several dates is a schedule.

A single instruction ("the Navy Edit launches on 28th August at 7pm" — one line, ~44 chars, 2
date signals) is **not** a document, so it bypasses the decomposer and the existing path is
byte-identical. A false negative (a short 2-intent paste slipping through as one) is the safer
failure: it lands exactly where it does today. `applyTextToDraft` in the app makes the call, so
the route never imports the engine index (which eagerly loads the db client).

### The segment contract — `decomposeInput` + `validateDecomposition`

ONE model call returns the input as an ordered list of PARTS, each a verbatim span, `keep:true`
for an instruction, `keep:false` for connective tissue. No paraphrase, no interpretation, no
intent labelling. `validateDecomposition` enforces:
- every part is a **verbatim substring** of the source;
- the parts **tile the source left-to-right, in order**, never overlapping;
- **every non-whitespace character is inside exactly one part** — gaps between parts must be
  whitespace only (the one thing the model may omit);
- at least one part is kept.

On any breach: **retry once, then null** — the caller falls back to the whole-input path, which
`couldnt_applies` exactly as today, never worse. Validated with zod; 15 tests pin the detector,
the coverage contract (verbatim / ordered / gap-only / nothing-kept) and the ordering.

### Route each segment — the existing classifier, unmodified

Each segment runs through `classifyIntake` as-is. The concurrent fan-out and audit wiring live in
the app orchestrator (Commit 2), so the engine layer stays pure.

### The application order — `orderIndices`

Deterministic, so the same brief always applies the same way:

> launch → series → event/beat_spec → correction/beat_edit → emphasis → **cadence last**, evergreen last of all

- launch and series first — they CREATE the anchor beats a correction may name;
- event and beat_spec share a tier (neither depends on the other);
- correction and beat_edit after all placement — their targets must exist first. **beat_edit is
  the one deviation from the spec's list**: it isn't named there, but it edits an existing beat, so
  it belongs with correction at tier 3;
- emphasis tilts the settled month;
- cadence LAST — its top-up counts the finished month, so it fills the real remaining gap.

A stable sort, document order the tiebreak.

---

## COMMIT 2 — ordered application + combined receipt (`app/src/lib/draft-apply.ts`)

`applyBriefToDraft` orchestrates: decompose (fallback to the whole-input path on a coverage
breach) → classify every segment through the **unmodified** contract (concurrent `Promise.all`,
each on the audit ledger via `createAuditLogger`) → apply the month-scoped intents in
`orderIndices` order. Each segment runs the existing per-intent path (`applyIntakeToDraft` with a
new `suppressReceipt` flag) so its beats, backlog rows, deferred instances and cadence floor are
all written exactly as a typed input's would be — only its individual top-level receipt is
withheld.

**One combined receipt.** The rollup is a `DraftApplication` with `items[]` — one `BriefItem`
per segment, carrying the span, the outcome (`applied` / `idea` / `couldnt_apply` / `noop`), the
diff `lines`, the `planInputId` for the rescue tap, and a `deferredCount`. The per-application
diff record is preserved individually inside the rollup rather than flattened; the client sees the
rollup. `changedIds` aggregate across items so the "Just changed" beat markers still light up.

**Partial failure is per-segment.** A segment whose transform produces no ops files itself to the
backlog as `couldnt_apply` with a rescue tap, and the rest proceed — never all-or-nothing.

---

## COMMIT 3 — the surface (`app/src/components/plan/DraftPlanView.tsx`)

The receipt panel gains a rollup mode, keyed on `receipt.items`. It extends the existing receipt
`<section>` — no new component. A pasted brief renders:

- a heading **"What we found"** and **"We found N things in what you sent."**;
- a per-kind summary of chips ("1 launch · 1 series · 1 idea · 1 couldn't apply");
- one line per segment: an outcome marker (✓ / ! / ·), the span, an **applied line expandable to
  its diff** (`<details>`), a deferral note ("1 saved for next month"), and the existing
  **add-to-this-month** tap on each idea / couldn't-apply line (using that item's `planInputId`).

A single-sentence receipt (no `items`) renders the plain panel **byte-identically**. The draft
surface is already mobile-first and bypasses the desktop/mobile fork, so the rollup is one
component for all viewports; the layout is a vertical list with wrapping chips and indented detail,
which holds at a narrow width. 5 new tests in `draft-view.test.tsx`.

---

## COMMIT 4 — the acceptance fixture + decompose-check

### The fixture run (`packages/engine/src/brief-acceptance.test.ts`, 7 tests)

Sally's reconstructed brief through the REAL decomposer and REAL transforms, classifier stubbed
to the known-correct intents, against an in-memory fixture draft (16 replaceable observed beats +
2 clientTouched). The brief text is reconstructed (the live `plan_inputs` row is not in the repo)
but each segment and intent is exactly what the failure report enumerates.

**The full decomposition — the receipt, itemised:**

| # | segment (abridged) | kind | outcome |
|---|---|---|---|
| 1 | The Navy Edit launches on 28th August at 7pm | launch | applied (arc: 3 beats) |
| 2 | Weekend Style Guide every Friday … 4th September | series (enumerated) | applied: 4 beats · **1 deferred (4 Sep)** |
| 3 | mini-series … one post every three weeks | series (recurrence) | applied: 2 beats (1 & 22 Aug) |
| 4 | On the 14th the stock leaves the factory | event | applied (1 beat) |
| 5 | On the 15th … Portugal … summer shutdown | event | applied (1 beat) |
| 6 | A throwback … given the heatwave | event | applied (1 beat) |
| 7 | colour-reveal … on the 25th | beat_spec | applied (+1 beat) |
| 8 | who can guess which of the girls … navy | beat_spec | applied (+1 beat) |
| 9 | breakdown of how our sweatshirts are made | evergreen | saved to ideas |
| 10 | life is busy and clothes should be simple | evergreen | saved to ideas |
| 11 | our organic cotton staples | evergreen | saved to ideas |
| 12 | the simple things that just work | evergreen | saved to ideas |
| 13 | we never use polyester | evergreen | saved to ideas |
| 14 | pull the DMs from last week | evergreen | saved to ideas · **does not mutate the plan** |

Asserted: **8 month-scoped applications, 6 evergreen filings** (5 content ideas + the DM-pull),
**exactly 1 next-cycle deferral** (the enumerated Style Guide's 4 Sept; the recurrence mini-series
stops at the month end without deferring), the **DM-pull produces zero ops**, **slot count never
exceeded** (launch/series/event applications each balance removes === adds; only a beat_spec adds,
and the final count is initial + 2), **clientTouched beats untouched**, and **one receipt line per
segment** (14 == 14).

### The decompose-check (operator)

`classify-check` gains a `briefs` array — the full brief — and prints, per brief, whether it is
document-shaped, the decomposed segments, and each segment's classified kind. The operator
live-verifies decomposition the same way they verify classification. **Not run this session** (no
Bedrock spend), by instruction.

```
pnpm --filter @sprigly/worker classify-check
```

---

## Cost accounting — calls per brief

| | model calls |
|---|---|
| detector | 0 (deterministic) |
| decompose | 1 |
| classify | 1 per segment (concurrent) |
| **Sally's brief** | **1 + 14 = 15** (vs 1 wasted `couldnt_apply` call before, which changed nothing) |

A retry on a decompose coverage breach adds 1 (then the whole-input fallback, 1 more). Every call
is on the audit ledger (`content-cycle:brief-decompose`, `content-cycle:intake-classify`).

---

## Found, and left unfixed

1. **Live decomposition is unverified end-to-end** — now automated by the decompose-check, but not
   run here (no Bedrock). Whether the model returns a clean verbatim, gap-only split for a real
   700-word paste is a prompt-behaviour question the coverage contract *catches* (falling back
   safely) but does not *prove*. Run `classify-check` post-merge and paste the segments.
2. **A rescue tap on a rollup item replaces the rollup with the single rescue receipt** (the
   existing `add_to_month` returns one application). The beats update correctly; the client just
   loses the rollup view after rescuing one item. Acceptable, but a "keep the rollup, mark that
   item promoted" refinement is a follow-up.
3. **The single-sentence intake path is still unaudited** (pre-existing — `applyIntakeToDraft`
   never passed an auditor). The brief path audits its decompose + classify calls; I did not widen
   the single path in this session to keep it byte-identical.
4. **The rollup receipt shares the 10-receipt cap** (`MAX_RECEIPTS`) with single receipts on
   `intake_json.draftApplications` — one rollup is one entry, so a brief costs one slot, which is
   correct; noted only because a very chatty session could still age a rollup out.
5. **Pre-existing, carried over:** `edit-scope.test.ts` and `post-generation.test.ts` parse
   `DATABASE_URL` at import and fail to load without it; `packages/db` still has no `test` script.
   Neither touched here.
