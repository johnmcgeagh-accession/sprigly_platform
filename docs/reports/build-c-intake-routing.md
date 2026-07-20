# Build C — Intake routing, live reshaping, and the diff

**Date:** 2026-07-20 · **Branch:** `dev` (not pushed) · **Build B baseline:** `7122072`
**Status:** Complete. Eight commits.

---

## 1. The north-star moment, running

`assembleDraft` → one client sentence → `applyIntent` → computed diff. Run against **live
dev data** for `earl-of-east`. The classifier reply is stubbed to the shape the model is
contracted to return (so the run is deterministic and costs no Bedrock call); **everything
after classification is the real code path**.

### The input

```
"The Wilderness candle relaunches on the 24th, can we build up to it?"
```

### The extracted intent

```json
{
  "kind": "launch",
  "subject": "the Wilderness relaunch",
  "sourceText": "The Wilderness candle relaunches on the 24th, can we build up to it?",
  "dateRange": { "start": "2026-09-24", "end": "2026-09-24" }
}
```

### Before — 10 beats

```
2026-09-02  carousel  Brand Story & Culture    Brand Story & Culture — Carousel     [observed n=8]
2026-09-03  single    Everyday Ritual          Everyday Ritual — Single             [observed n=23]
2026-09-04  carousel  Home & Space             Home & Space — Carousel              [observed n=8]
2026-09-09  single    Product & Fragrance      Product & Fragrance — Single         [observed n=23]
2026-09-11  carousel  Workshops & Experiences  Workshops & Experiences — Carousel   [observed n=8]
2026-09-16  single    Brand Story & Culture    Brand Story & Culture — Single       [observed n=23]
2026-09-17  carousel  Everyday Ritual          Everyday Ritual — Carousel           [observed n=8]
2026-09-23  single    Home & Space             Home & Space — Single                [observed n=23]
2026-09-24  single    Product & Fragrance      Product & Fragrance — Single         [observed n=23]
2026-09-25  single    Workshops & Experiences  Workshops & Experiences — Single     [observed n=23]
```

### After — still 10 beats

```
2026-09-03  single    Everyday Ritual          Everyday Ritual — Single             [observed n=23]
2026-09-09  single    Product & Fragrance      Product & Fragrance — Single         [observed n=23]
2026-09-16  single    Brand Story & Culture    Brand Story & Culture — Single       [observed n=23]
2026-09-17  carousel  Everyday Ritual          Everyday Ritual — Carousel           [observed n=8]
2026-09-19  single    Brand Story & Culture    the Wilderness relaunch — Tease      [client_input]
2026-09-23  single    Home & Space             Home & Space — Single                [observed n=23]
2026-09-24  single    Product & Fragrance      Product & Fragrance — Single         [observed n=23]
2026-09-24  reel      Home & Space             the Wilderness relaunch — Launch     [client_input]
2026-09-25  single    Workshops & Experiences  Workshops & Experiences — Single     [observed n=23]
2026-09-27  carousel  Workshops & Experiences  the Wilderness relaunch — Follow-up  [client_input]
```

### The rendered diff

```
• Added: the Wilderness relaunch — Tease, Sat 19 Sep
• Added: the Wilderness relaunch — Launch, Thu 24 Sep
• Added: the Wilderness relaunch — Follow-up, Sun 27 Sep
• Replaced: Brand Story & Culture — Carousel, Wed 2 Sep
• Replaced: Home & Space — Carousel, Fri 4 Sep
• Replaced: Workshops & Experiences — Carousel, Fri 11 Sep

changedIds: ["beat-new-10","beat-new-11","beat-new-12"]
```

### What this demonstrates

- **Slot count held at exactly 10.** Three in, three out.
- **The replacement rule fired correctly.** The three evicted beats are all `n=8`
  carousels; every `n=23` beat survived. Weakest evidence went first, as specified.
- **The arc landed around the date** — tease 5 days before, launch on the 24th, follow-up
  3 days after — and stayed inside September.
- **New beats carry `client_input` evidence** quoting the client verbatim. No engagement
  figure, no pillar share, nothing pretended.
- **Two beats now share 24 Sep**, which is legitimate and exactly why Build B implemented
  `reorderWithinDay` rather than skipping it.

---

## 2. Part 0 — Build B debt

### Route tests (`b77edad`)

28 tests over `/api/plan/draft`, covering what the 28 library tests could not: op parsing,
required-field validation, guard→HTTP mapping (404 gone / 409 moved-on-or-closed / 422
invalid), message pass-through, and that identity comes from the **session** — a caller
passing someone else's `cycleId` on `add` is ignored. Includes an explicit check that
`op: 'approve'` is rejected, since approval is Build D and must not be reachable by
accident.

### Render-state consolidation (`37c48ae`)

**Enumeration method.** Before touching anything, one sweep for every render site:

```
grep -rn "PlanApp\|PlanRedesign\|DraftPlan\b" --include="*.tsx" --include="*.ts" app/src \
  | grep -v node_modules | grep -v "\.test\." | grep -E "import|from '@/components"
```

Four hits, all in `app/src/app/page.tsx` — it is the sole render site for all four
surfaces, so the consolidation had exactly one consumer.

The decision is now `resolveSurfaceKind()` — a discriminated union derived once and
switch-rendered. **Behaviour-preserving:** every existing view and invisibility test passes
unmodified (empty `git diff` on both files).

The mixed-state rule finally has a direct home. It was previously only assertable through a
predicate hand-restated inside the view test; it is now the resolver's second case with its
reasoning attached — test `committedPostCount === 0` rather than "are any rows drafts?",
because the count comes from the already-fenced list and so the two cannot drift.

---

## 3. Part 1 — migration 0086

**Constraint check first**, per the Build A `email_templates` lesson:

```
$ psql -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='plan_inputs'::regclass;"
→ NOT NULLs, PK, and four FKs. NO CHECK constraints.
```

So no domain widening was needed — unlike `email_templates`, which had one and rejected the
0085 insert.

```
$ psql -f packages/db/migrations/0086_plan_inputs_backlog.sql
ALTER TABLE
ALTER TABLE
ALTER TABLE
CREATE INDEX

$ psql -c "select type, status, source, origin, lifecycle, used_in_cycle_id from plan_inputs;"
 type |   status   | source | origin | lifecycle | used_in_cycle_id
------+------------+--------+--------+-----------+------------------
 note | integrated | web    | client | candidate |
 note | dismissed  | web    | client | candidate |
 note | dismissed  | web    | client | candidate |
```

**Backfill: the column defaults, and nothing more.** Both text columns are `NOT NULL
DEFAULT`, so the three existing rows took `client` / `candidate` as the columns were added.
That is correct rather than convenient: all three were captured from the client via web,
and none has been used in a cycle, so `used_in_cycle_id` stays NULL. No row is claimed to
be more mature than it is.

**Three new columns, not three reuses**, and the reasons matter:

| Column | Why not reuse |
|---|---|
| `origin` | `source` exists but means TRANSPORT (`web`/`voice`), not provenance. Overloading collides with the live values and with `NoteView.source`, which the client UI reads. |
| `lifecycle` | `status` is an AVAILABILITY axis (`active`/`expired`/`dismissed`/`integrated`). The backlog needs MATURITY (`candidate`→`used`→`measured`→`proven`). Orthogonal — a proven idea is still active — so merging destroys information. It also keeps the **nine** readers hardcoding `status='active'` working; repurposing would have broken them **silently**, since `DURABLE_INPUT_TYPES` is typed `string[]`. |
| `used_in_cycle_id` | `cycle_id` is the CAPTURE cycle (deliberately NULL for durables); `consumed_by_proposal_id` points at a proposal. Neither answers "which cycle consumed this". |

---

## 4. Part 2 — the classifier's second axis

### Why a separate LLM call (the brief asked for justification)

`extractStructuredBrief` cannot carry both axes:

1. It runs over the **accumulated** intake (merged answers + freeNotes), so it cannot
   attribute a change to the sentence that caused it — and the receipt must.
2. Its output is a month **brief** (products / schedule / content_asks), not a routing
   decision about one input.
3. It runs **after** intake is persisted, whereas routing must be decided before we know
   whether to touch the month at all.

They also fail differently — a failed extraction loses beat display; a failed
classification must silently become backlog routing — and merging them would couple those.

It remains **one** model call in the intake→reshape path. Everything downstream is
deterministic.

### Fixture results

All 20 classifier tests pass. The routing table:

| Input shape | Routes to | Reason |
|---|---|---|
| Well-formed launch with a date | `month_scoped` | — |
| Explicit evergreen verdict | `evergreen` | `classified_evergreen` |
| Malformed envelope | `evergreen` | `validation_failed` |
| Unknown scope | `evergreen` | `validation_failed` |
| `month_scoped` with no/null intent | `evergreen` | `validation_failed` |
| Unknown intent kind (`"vibes"`) | `evergreen` | `validation_failed` |
| Intent missing `subject` | `evergreen` | `validation_failed` |
| Malformed date (`"28th Sept"`) | `evergreen` | `validation_failed` |
| **Launch with NO date** | `evergreen` | `ambiguous` — an arc needs an anchor |
| **beat_edit missing `edit` or `beatRef`** | `evergreen` | `ambiguous` — cannot apply deterministically |
| Unparseable model output | `evergreen` | `validation_failed` |
| Model throws | `evergreen` | `model_error` |
| Empty input | `evergreen` | no model call at all |

Parse failure reports `validation_failed`, not `model_error` — **the code was changed to
make this true**, because the model answering with junk is not the same event as the model
being unreachable, and a misroute is only diagnosable if the receipt records which one
happened.

`sourceText` is overwritten with the text we actually received rather than trusted from the
model: a receipt must never be able to quote words the client did not send. Trust the model
for meaning, never for provenance.

---

## 5. Part 3 — the replacement rule, evidenced

32 transform tests. The rule, and what proves it:

| Rule | Evidence |
|---|---|
| Template-basis beats go first | ranking test puts `tmpl` ahead of `n=3` and `n=30` |
| Then smallest sample | `['n3','n12','n30']` |
| **Client-touched beats never replaced** | `isReplaceable` false for `clientTouched` |
| **Client-sourced experiments never replaced** | false for `candidateRank.origin='client'` |
| **Client-added / client_input beats never replaced** | false for both bases |
| Slot count never exceeds | adds === removes, asserted per transform |
| Total ordering | reversing the input array changes nothing |
| Arc stays inside the month | anchored on the 30th, every part still September |
| Partial arc is reported | `"Added 1 of 3"` when only one slot is free |
| Nothing replaceable → nothing done, loudly | note returned, ops empty |

**Emphasis** never touches a past-dated beat or a client-edited one, and converts at most a
third of eligible beats — "more product" does not mean "only product", and reading it that
way would be a worse answer than doing nothing.

**beat_edit refuses ambiguity**: "Friday" matching two beats resolves to neither and routes
to the backlog with a receipt. Changing the wrong post is worse than changing no post.

---

## 6. Part 4 — the diff

Computed from before/after snapshots, never narrated. A beat can yield **multiple** deltas
(moved *and* reformatted) rather than collapsing to "changed", which would hide half of
what happened to it. Removals are not marked as changed beats — the marker is for things
still on the page.

A test asserts **no rendered line contains a because / in-order-to / balance clause**. The
rationale for a beat lives on the beat; the receipt's job is to state what moved so the
client can check it against what they asked for.

**Persistence: `content_cycles.intake_json`, not a new table.** No migration, and a receipt
*is* part of the intake record — it is what happened to the month because of an intake
input. A table would buy queryability nothing needs yet, at the cost of a migration and a
join. Capped at 10 so the column cannot grow unbounded. Receipts survive reload; the
changed-marker is in-memory only, which is the one-boolean treatment the brief asked for.

---

## 7. Part 5 — evergreen and receipts

Evergreen inputs become `plan_inputs` rows with `origin='client'`, `lifecycle='candidate'`.
The receipt panel reads as filing rather than changing, and its `aria-label` matches — a
screen reader should not hear "What changed" about something that did not.

`add_to_month` re-routes a backlog idea through the **same** transform path as a typed
input, then marks the row `lifecycle='used'` and sets `used_in_cycle_id`. That column now
has its first writer.

Assumption prompts become answerable: with a say box wired, the copy switches from "Reply
to our email" to "Answer any of these below", and an answer is just an intake input.

---

## 8. Fence proof

```
$ git diff 37c48ae -- app/src/lib/draft-invisibility.test.ts
(empty)
```

Build A's invisibility suite is byte-unmodified across Builds B **and** C, and passes. All
seven `excludeDraftPosts()` applications are unchanged. Build B's view tests were extended
with new cases but no existing assertion was altered.

Every write in `draft-apply.ts` is scoped to `status='draft'` in the WHERE, so an intake
input cannot touch a committed post whatever a transform decides.

---

## 9. Tests

| Suite | Result |
|---|---|
| `@sprigly/app` | **337 passed**, 1 skipped (33 files) |
| `@sprigly/engine` | **203 passed** (11 files) |
| `@sprigly/worker` | 326 passed, 1 skipped |
| `@sprigly/db` | 6 passed |

Type-check clean across all five packages. New in Build C: 28 draft-route, 8 surface-state,
20 classifier, 32 transform, 12 diff, 19 apply-route, 12 view.

---

## 10. Commits

| Hash | Part | Behaviour |
|---|---|---|
| `b77edad` | 0.1 | Route-level coverage for `/api/plan/draft` |
| `37c48ae` | 0.2 | One surface decision instead of four stacked forks |
| `f217ebf` | 1 | `plan_inputs` gains origin, lifecycle and a consumption record |
| `02e014d` | 2 | Classify intake on a second axis |
| `59734b1` | 3 | Deterministic transforms |
| `723a4f1` | 4 | Compute the change receipt from row deltas |
| `c4c2894` | 5 | One sentence reshapes the month, with a receipt that proves it |

Not pushed, not merged, not promoted. Build D not begun.

---

## 11. Unexpected, and left unfixed

1. **The end-to-end demo uses a stubbed classifier reply.** Everything downstream is the
   real path against real data, but the model call itself was not made — I did not want to
   spend a Bedrock call inside an autonomous session, and a stubbed reply makes the run
   deterministic and re-runnable. **The live classifier is therefore unproven against real
   client phrasing.** Its 20 fixtures cover the contract and every failure path, but not
   whether Sonnet actually classifies "can we build up to it?" as a launch. That is worth a
   manual check before this reaches a client.

2. **`applyEmphasis` converts a beat's pillar without touching its evidence.** The beat then
   claims an `observed` basis citing a pillar share for a pillar it no longer has. The
   rationale is stale rather than false, but it is misleading and I did not fix it because
   the right fix — recomputing evidence via the assembler primitives — is more than a patch.
   Recorded as the most likely place a client would catch us being sloppy.

3. **zod was added to `@sprigly/engine`.** The package had no zod dependency; the contract
   needed one. `pnpm install` emitted a build-scripts approval warning, which I did not
   action.

4. **The engine-local `ModelCompleteParams` has no `temperature`.** The classifier would
   ideally run at temperature 0, since a routing decision should not vary between identical
   inputs. It cannot, without widening a shared contract. Mitigated by every failure mode
   landing on evergreen, so variance costs a tap rather than a wrong mutation — but it is a
   real gap and is commented at the call site.

5. **`page.tsx` now loads receipts on every draft render**, adding a query. Small, and the
   consolidation's stated cost, but it compounds the four extra reads noted in Build B.

6. **No test drives the full `applyIntakeToDraft` against a database.** Its pieces are
   covered (classifier 20, transforms 32, diff 12, route 19) and the demo exercises the real
   composition, but the DB-writing function itself has no integration test. The app's test
   setup mocks Drizzle rather than running Postgres, so this would need a different harness.

7. **`beat_edit` with `edit: 'move'` reads `editValue` as a date** but the classifier prompt
   does not explicitly instruct the model to put an ISO date there. Guarded (a non-ISO value
   is refused with a note), so it fails safe, but the prompt and the consumer are not as
   tightly coupled as they should be.
