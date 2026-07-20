# Session 1 — Structural-merge fix

**Date:** 2026-07-20
**Branch:** `dev` (not pushed)
**Commit:** `613030e` — *fix: regeneration can no longer mutate a post's slot (date/day/format/pillar)*
**Status:** Complete. Two stop conditions fired mid-session and were resolved by the user before implementation.

---

## 1. The behaviour change

A repair or instructed rewrite exists to change a post's **content**. Until this commit it could
silently change its **structure** too.

`regeneratePost` returned `parseSinglePost(result.content)` — the model's whole post object — and
every caller assigned it wholesale (`plan-validation.ts:295`, `:581`; `shape.ts:116`;
`weekly-session.ts:93`). Structure survived only because the repair prompt *asked* the model to hold
it (`plan-validation.ts:214`: *"Keep date, day, title, format, postingTime and whoPosts unchanged…"*).
Nothing enforced that and nothing checked it: `codeGateCheck` (`:125-159`) validates captions and
vocab, never dates or formats. A drifted date or format would have been written to
`content_cycle_posts` unnoticed.

Structure is now merged from the input row over the model output at `regeneratePost`'s return.

## 2. Merge point, with call-graph evidence

**Chosen point: `regeneratePost`'s return boundary — `engine/src/content-cycles/plan-validation.ts:300`.**

```ts
// STRUCTURE IS NOT REGENERABLE. The fixMessage above ASKS the model to hold the
// slot fields; this merge ENFORCES it, at the one boundary every caller flows
// through (applyCodeGate, applyCritic, shape.ts, weekly-session.ts).
const after = mergeStructuralFields(post, parseSinglePost(result.content), ctx.vocab);
```

Every consumer of `regeneratePost` in the repo, verified by exhaustive grep
(`--include="*.ts" --include="*.tsx"`, excluding `node_modules` and `/dist/`):

| # | Consumer | Call site | Reaches the merge? |
|---|---|---|---|
| 1 | Planning code gate (`applyCodeGate`) | `plan-validation.ts:295` | Yes |
| 2 | Planning critic (`applyCritic`) | `plan-validation.ts:581` | Yes |
| 3 | Shape handler (instructed rewrite) | `shape.ts:116` | Yes |
| 4 | Weekly session (`generateCaption`) | `weekly-session.ts:93` | Yes (inert — see §3) |

There is no other path by which a regenerated post reaches a caller: `parseSinglePost` is module-private
(`plan-validation.ts:239`) and `regeneratePost` is the only exported wrapper around it. Confirmed that
nothing outside the worker package imports this module — the only non-`engine/` grep hit for
`plan-validation` is a prose comment in `packages/db/src/schema.ts:791`.

**No public type signature changed.** `regeneratePost`'s signature is untouched; the two new exports
(`STRUCTURAL_FIELDS`, `mergeStructuralFields`) are purely additive. `npx tsc --noEmit` is clean.

## 3. Stop conditions — both fired, both resolved

### 3a. A third consumer (fired)

The brief anticipated two consumers; there are **four call sites across three modules**. The
unanticipated one is `weekly-session.ts:93`, whose private `generateCaption` helper (`:73`) states in
its own header that it *"Mirrors shape.ts (assembleShapeContext → regeneratePost → code gate → critic
→ catalogue)"*.

Assessed as **benign**: `generateCaption` returns `Promise<string>` and extracts only the caption
(`:105`, `:110`), discarding every structural field before the value leaves the function. Its
proposals carry structure the weekly session chose itself, never structure echoed from the model —
`add_post` (`:188-190`) takes `date`/`format`/`pillar` from its own skeleton, and `move_post`
(`:196-198`), the one path that genuinely changes a date, never calls `regeneratePost` at all.

**Resolution (user, Decision 1):** merge point confirmed; the merge being inert at this call site is
accepted.

### 3b. Public type signatures (not fired)

No signature change was required. Documented above.

### 3c. Second blocker surfaced during analysis — pinning `pillar` (not on the stop list)

Pinning `pillar` unconditionally, as the brief's field set implied, would have **broken a working
production repair path**. `codeGateCheck` flags `invalid-pillar` (`:153-156`) and the repair prompt is
explicitly told to fix it (`:214`). With `pillar` pinned, that failure becomes unrepairable: the gate's
retry loop (`:289-301`) burns all three `MAX_PLAN_RETRIES` attempts — three billable model calls — then
accepts-with-warning (`:303-309`) leaving the invalid pillar in place. Silent degradation plus wasted
spend.

Two live paths deliberately supply an out-of-vocabulary **sentinel** pillar and depend on repair
replacing it:

| Path | Pillar | In any client's vocab? |
|---|---|---|
| `app/src/lib/mutations.ts:203` — `addGeneratingPost`, passed through by `shape.ts:83` | `'New idea'` | No |
| `engine/src/content-cycles/weekly-session.ts:180` — weather skeleton | `'Weather'` | No |

**Resolution (user, Decision 2):** conditional pinning, implemented exactly as specified —

- input pillar passes `ctx.vocab` → **input wins**, model output discarded
- input fails vocab, model output passes → **model output wins** (sentinel repair preserved)
- both fail → **model output kept**, gate flags it (existing behaviour unchanged)

A comment at the merge point names both sentinel producers so the conditional is not later
"simplified" into an unconditional pin (`plan-validation.ts:184-197`).

## 4. The structural field set

Defined in one place, `plan-validation.ts:175`:

```ts
export const STRUCTURAL_FIELDS = ['date', 'day', 'format', 'pillar'] as const;
export type StructuralField = (typeof STRUCTURAL_FIELDS)[number];
```

- **`day` is pinned alongside `date`** (Decision 3) as one logical field — both are derived from the
  same stored `scheduled_date` (`shape.ts:78`, `weekly-session.ts:110`), so pinning one without the
  other would let them drift ("Mon" against a Wednesday date).
- **Deliberately NOT structural:** `draftCaption`, `title`, `notes`, `competitorInsight`, `whoPosts`,
  `category`. These are what regeneration is *for*. `category` is vocab-checked like `pillar` but is
  not slot identity, so it is left fully mutable and needs no conditional.
- **`postingTime` was dropped** from my earlier proposal per the user's narrowed field set.
- **No `position`/slot field.** `position` is not on `PlanPostRow`; it is assigned by array index
  (`planning.ts:1041`) and preserved by both loops pushing exactly once per input index. Covered by
  test (f) instead.

**One semantic added during implementation.** `tsconfig` has `exactOptionalPropertyTypes: true`, which
surfaced an undecided case: what if the *input* has no `date`? The merge now **mirrors absence as
faithfully as presence** — an undefined input field deletes the output's. Otherwise "input had no
structure" would be the one gap through which regeneration could still write structure. Covered by a
test.

## 5. Test results

Runner: `vitest run` (`engine/package.json:44`). The worker suite needs `DATABASE_URL` at collect time
(`packages/db/src/client.ts:6`), so it is run the way the package scripts do — `set -a && . ../.env.local`.
Without it, 9 files fail to *collect*; this is pre-existing and unrelated to this change.

```
$ sh -c 'set -a && . ../.env.local && set +a && npx vitest run'

 Test Files  21 passed | 1 skipped (22)
      Tests  321 passed | 1 skipped (322)
   Duration  866ms
```

`plan-validation.test.ts` alone: **49 → 58 tests, all passing.** `npx tsc --noEmit`: clean.

New coverage:

| Test | Covers |
|---|---|
| `mergeStructuralFields` — pure merge semantics (5 tests) | Field-by-field pinning; content untouched; the declared set is exactly `[date, day, format, pillar]`; absence mirroring; empty-vocab client |
| **(a)** structural fields survive regeneration | Model mutates `date`/`day`/`format`/`pillar` → all restored, caption rewrite lands |
| (a) dash normalisation intact | Existing `normaliseDashes` behaviour unaffected by the merge |
| **(b)** shape.ts instructed-rewrite path | `PlanPostRow` reconstructed exactly as `shape.ts:75-90` builds it; caption change lands, every structural field byte-identical |
| **(d)** sentinel repair preserved | `'New idea'` → model's valid pillar wins, gate then clean; same for `'Weather'`; both-invalid → model's kept and gate still flags it |
| **(e)** valid-pillar mutation blocked | Input valid, model returns a different valid pillar → input wins |
| **(f)** slot count/order invariance | `applyCodeGate` and `applyCritic` each return exactly one row per input row, in order, dates intact — including when a post exhausts all retries and lands in `acceptedWithWarning` at its own index |

**The new tests were verified to bite.** Temporarily bypassing the merge (reverting line 300 to
`parseSinglePost(result.content)`) fails **6 of them**; restoring it returns the suite to green. They
are not vacuous.

Note on test (b): it exercises the shape path through the shared choke point using shape's exact
`PlanPostRow` reconstruction, rather than booting Drizzle — `shape.ts` reaches `regeneratePost` only
after `assembleShapeContext` hits the database, and the structural guarantee lives entirely at the
choke point, not in shape's own code.

## 6. Notes and anomalies

- **Working tree was not clean at session start.** Six untracked files pre-existed
  (`pause-state.txt`, `resume-state.txt`, `scripts/inspect-queue.ts`, `scripts/pause-queues.ts`,
  `scripts/remove-planning-job.ts`, plus the Phase 0 report). None were touched; only the two files in
  this commit are staged. Those files remain untracked.
- **The repair prompt's wording is now belt-and-braces**, and deliberately left alone. It still asks
  the model to hold `title`, `postingTime` and `whoPosts`, which the merge does *not* enforce. That is
  correct — they are content/operational, not slot identity — but the prompt and the merge now express
  slightly different sets. Worth a tidy at some point; out of scope here.
- **`weekly-session.ts`'s `add_post` proposal builds `format: 'single'` and `pillar: 'Weather'` into
  its payload independently of the generated row** (`:189`). The `'Weather'` pillar therefore reaches
  `content_cycle_posts` regardless of what the repair loop chose. Not touched — pre-existing, outside
  this scope, and flagged here only because it interacts with the sentinel handling.

## 7. Scope discipline

Two files changed, nothing else:

```
M  engine/src/content-cycles/plan-validation.ts
M  engine/src/content-cycles/plan-validation.test.ts
```

One commit: `613030e`. Not pushed, not merged, not promoted. Session 2 (Build A) not started.
