# Hardening — pre-UAT

**Date:** 2026-07-20 · **Branch:** `dev` (not pushed) · **Build D baseline:** `2017ec0`
**Status:** Complete. Four commits. Item 4 stopped at the enumeration, as the brief directed.

---

## 1 — Hashtag gate (`0ed455a`)

### What changed

`codeGateCheck` gains a `corrupted-hashtag` issue. The repair prompt gains a matching
instruction: write the correction exactly or drop the tag, never invent a third spelling.

### Where known hashtags come from

**The client's own `ig_posts` captions, and nothing else** — because nothing else exists:

```
$ psql -c "select table_name, column_name from information_schema.columns
           where table_schema='public' and column_name ~* 'hashtag';"
(0 rows)

$ psql -c "select count(*) from client_planning_config
           where pillars::text like '%#%' or categories::text like '%#%';"
0
```

No hashtag column anywhere in the schema, and no hashtags hiding in the planning config
JSON. So the vocabulary is **derived, not curated**, which also means it cannot go stale
relative to what the client actually posts. Loaded in `planning.ts` (`loadKnownHashtags`)
over **every** stored month rather than the critic's two — a bigger known set means more
exact matches pass untouched, and a thin set is the dangerous direction.

Empty set → the check disables itself. A client with no scraped feed is never second-guessed
about tags we have no basis to judge.

### The near-miss rule, and why it is shaped that way

Flag only when the unknown tag is **1–2 edits** from a known one **AND** those edits are
**≤ 0.2 of the tag's length**.

**Levenshtein** rather than a phonetic or prefix measure: the failure mode is a *typo* — a
substituted, dropped or transposed character — which is exactly what edit distance measures
and what soundalike measures do not.

**The ratio is what makes it safe.** A bare distance threshold would flag `#solo` against a
known `#soho` — two perfectly ordinary distinct words one edit apart — and force the model
to abandon a legitimate tag. Requiring ≤20% divergence means distance 1 needs ≥5 characters
and distance 2 needs ≥10, so only long tags (which is what brand hashtags are) can trip it.

| Case | Distance | Ratio | Verdict |
|---|---|---|---|
| `#ritualovertoutine` vs `#ritualoverroutine` | 1 | 1/17 = 0.059 | **flagged** |
| `#homefragrence` vs `#homefragrance` | 2 | 2/13 = 0.15 | **flagged** |
| `#solo` vs `#soho` | 1 | 1/4 = 0.25 | passes |
| `#autumnlight` (novel) | — | — | passes |

**The model is still allowed to invent hashtags.** A novel tag is a legitimate creative
choice and blocking new tags would make captions worse. What it may not do is mangle a tag
the client demonstrably uses.

### Evidence — red→green on the real string

The exact caption fragment from the Build D dogfood run is now a test:

```
it('THE BUG: catches #ritualovertoutine as a mistyped #ritualoverroutine', () => {
  expect(checkHashtags('a caption // #earlofeast #ritualovertoutine', known))
    .toEqual([['ritualovertoutine', 'ritualoverroutine']]);
});
```

`plan-validation.test.ts`: **49 → 65 tests**, all passing. Coverage includes the real case,
a novel tag passing, a known tag passing, a two-edit corruption of a config-length tag, the
short-word false-positive guard, and the gate disabling itself with no vocabulary.

---

## 2 — Bounded retry (`125ebd7`)

### What changed

`GENERATION_JOB_OPTIONS` — **3 attempts, exponential backoff from 5s** — now shared by
caption, hook and script jobs, which previously carried three separate inline `attempts: 1`.

**Pattern cited:** `IG_TRAWL_JOB_OPTIONS` (`engine/src/content-cycles/job-options.ts:3-6`)
— the platform's existing answer to a network-flaky external call. Smaller attempt count
because each attempt here is a paid Bedrock call, not a scrape.

The original `attempts: 1` reasoning was *"a failed generation is usually a bad response
rather than a flaky connection"*. Reasonable, and the Build D run disproved it: the observed
failure was a **180s timeout**, exactly the transient case retrying fixes.

### The failed state is made truthful, not weakened

`generation_failed` is stamped **only on the final attempt**. The consumer computes that
from `job.attemptsMade` against `job.opts.attempts`; the parameter defaults to `true` so
every existing caller is unchanged.

### A second bug the retry surfaced

Retrying would have been **actively harmful** without this: `shape.ts` read `isGenerating`
as `status === 'generating'` only. A post already stamped `generation_failed` that then
recovered would resolve to `'edited'` — mislabelled as a client edit it never received.
`'generation_failed'` now counts as generating too, since a retry is still finishing the
*original* generation.

### Test output

```
✓ src/content-cycles/shape-retry.test.ts  (7 tests)

  a recoverable failure does not surface to the client
    ✓ a NON-final attempt failing does NOT stamp generation_failed
    ✓ rethrows so BullMQ actually retries it
    ✓ a retry that SUCCEEDS resolves the post to new, not edited
  an unrecoverable failure still surfaces — the backstop is not weakened
    ✓ the FINAL attempt failing stamps generation_failed with the reason
    ✓ defaults to final-attempt behaviour, so every existing caller is unchanged
  the happy path is untouched
    ✓ writes the caption and resolves a generating post to new
    ✓ a direct rewrite of a committed post still resolves to edited
```

### Cost guard counts retried calls

**No change needed, and here is why:** the guard reads `audit_log`, and the audit write sits
inside `regeneratePost` on the call path — so attempt 2 writes its own row exactly as
attempt 1 did. A retried post therefore shows up as *more calls for the same post*, which is
precisely the signal `callsPerPost` exists to surface. Proven by construction rather than by
a test that would have to mock the ledger to say anything.

---

## 3 — Approval dedup (`e933e55`)

### Home: `@sprigly/engine`

**Justified by the existing dependency direction.** `packages/engine/package.json` lists
`@sprigly/db`; the reverse does not exist. So engine can import the tables while db stays a
leaf. And `intake-signals.ts` already sets the precedent for a shared DB-querying domain
helper living there.

Putting business rules in `@sprigly/db` would make the schema package own decisions about
when a month may be approved, which inverts what that package is for.

### Caller enumeration — method stated

```
grep -rn "approveDraft\|autoApproveAndGenerate" --include="*.ts" --include="*.tsx" . \
  | grep -v node_modules | grep -v "/dist/"
```

Four consumers, all accounted for:

| Caller | Was | Now |
|---|---|---|
| `app/.../draft/approve/route.ts:33` | app impl | thin wrapper → core |
| `engine/.../consumer.ts:230` | worker impl | worker fan-out → core |
| `app/src/lib/draft-approval.test.ts` | app impl | same assertions, core beneath |
| (worker had no test of its own) | — | covered by the app suite against the core |

### Deletion proof — deleted, not shadowed

```
$ grep -n "approvedBy: 'auto'\|already approved\|PRE_PLANNING_STATUSES\|mixed_state" \
       engine/src/content-cycles/draft-plan.ts
(none — all rules now live in the shared core)

$ grep -n "approveDraftCore" engine/.../draft-plan.ts app/src/lib/draft-approval.ts
app/src/lib/draft-approval.ts:18:  return approveDraftCore(db, params);
engine/.../draft-plan.ts:295:  const approval = await approveDraftCore(db, { clientId, cycleId, auto: true });
```

Both call sites now delegate. Each keeps only its transport difference: the app returns an
HTTP-shaped result, the worker enqueues on the BullMQ handle it already holds.

### Assertions unmodified

```
$ git diff --stat app/src/lib/draft-approval.test.ts
(no output)

✓ src/lib/draft-approval.test.ts  (13 tests) — all passing
```

Only the implementation moved.

**Bonus drift closed:** the worker also picks up `GENERATION_JOB_OPTIONS`, so a cutoff
auto-approval now retries exactly as a client-approved one does. Those were about to diverge
for the same reason the rules had.

---

## 4 — Bedrock wrapper: **STOPPED at the enumeration** (`3bd4dc8`)

The brief said to stop if the invocation sites turned out many and heterogeneous. They did.

### Enumeration — method stated

```
# Every invocation
grep -rn "\.complete(\|\.completeStreaming(" --include="*.ts" --include="*.tsx" . \
  | grep -v node_modules | grep -v "/dist/" | grep -v "\.test\." | grep -v "packages/model-client"

# Every direct client construction
grep -rn "createModelClientFromEnv\|new BedrockRuntimeClient" --include="*.ts" --include="*.tsx" . \
  | grep -v node_modules | grep -v "/dist/"
```

**31 invocation sites across 6 packages**, plus **14 direct `createModelClientFromEnv()`
constructions.**

| Package | Sites | `clientId` in scope? |
|---|---|---|
| `engine/` (worker) | 12 — planning ×1, plan-validation ×2, hook, script, refine, weekly-audit, onboard ×2, lean-line, voice-batch-merge, eval | mostly yes; onboarding/probes no |
| `packages/engine` | 5 — brief-extract ×2, intake-classify, draft-phrasing, brief-preview | **optional** — several take `clientId?` |
| `packages/workflows` | 8 — blog-post ×3, inbox-triage, question-answerer ×2, meeting-prep, prospect-research ×2 | **no** — keyed on a workflow run |
| `app/` | 2 — task-parser, agent query | yes |
| `packages/knowledge` | 1 — label-chunk | **no** |
| `scripts/`, `engine/scripts/` | 3 — new-workflow, eval-bedrock, eval-harness | **no** — CLIs |

### Why this is not a hardening tweak

More than half the sites have **no `clientId` at all**. A wrapper that audits
unconditionally cannot simply be dropped in: `audit_log.client_id` is `NOT NULL`, so every
clientless category — CLIs, probes, the eval harness, workflow steps keyed on a run rather
than a client — needs a *decision* about what such a call even means on the ledger. That is
a design question with a schema implication, and the brief explicitly rules schema changes
out of this session.

Doing it here would be exactly the sprawling refactor the brief warned against.

### What landed instead

A pointing comment at `hook.ts` and `script.ts` — the two sites silently unaudited until
Build D — recording why they carry a hand-written audit call, that any **new** model call
needs one too, and where the backlog item lives. The comment sits where someone copying this
code will actually look.

### Backlog item

> **Bedrock call wrapper.** Make "every model call is on the audit path" true by
> construction. Blocked on a decision for clientless call sites (`audit_log.client_id` is
> NOT NULL): either a nullable client with a `source` discriminator, or a synthetic internal
> client id, or excluding CLIs/eval from the ledger by design. Site list: §4 table above.
> Until resolved, every new model call needs its own audit write.

---

## 5 — Verification

| Suite | Result |
|---|---|
| `@sprigly/app` | **361 passed**, 1 skipped |
| `@sprigly/worker` | **356 passed**, 1 skipped |
| `@sprigly/engine` | **213 passed** |
| `@sprigly/db` | **6 passed** |

Type-check clean across all five packages.

```
$ git diff 2017ec0..HEAD --stat -- app/src/lib/draft-invisibility.test.ts
(empty)
```

Build A's invisibility suite is byte-unmodified across Builds B, C, D **and** this session.

No schema changes were needed. The post-cutoff agent path was not touched.

---

## 6 — Commits

| Hash | Item | Behaviour |
|---|---|---|
| `0ed455a` | 1 | The code gate catches mangled brand hashtags |
| `125ebd7` | 2 | Bounded retry on generation jobs, without weakening the failed state |
| `e933e55` | 3 | One approval core, shared by the client and cutoff paths |
| `3bd4dc8` | 4 | Point the formerly-unaudited call sites at the wrapper backlog |

---

## 7 — Found and left unfixed

1. **The Bedrock wrapper** (§4). Backlogged with its site list and its blocking decision.

2. **`weekly-session` jobs still carry `attempts: 1`** (`queue.ts:263`). Deliberately left:
   the retry change was scoped to the per-post generation jobs the Build D finding was
   about, and a weekly session is a different shape of work with a different failure cost.
   Worth a look, not worth widening this session's blast radius.

3. **The hashtag gate cannot see a client's *intended* new tags.** If a client launches a
   campaign hashtag that is one edit from an existing one — plausible, e.g.
   `#greenhouse` → `#greenhouse2` is fine but `#greenhouseseason` → `#greenhousesseason`
   would be flagged — the gate will treat it as corruption and the repair will "fix" it back.
   The ratio rule makes this unlikely rather than impossible. A curated per-client allowlist
   would close it; none exists today, and inventing one was outside this brief.

4. **`ApprovalDb` is structurally typed with `any` members.** The core needs a DB handle
   from two packages whose Drizzle instances have different generic parameters, and the
   honest alternatives were a cross-package type import or a cast at each call site. Recorded
   because it is a real looseness at a boundary that otherwise has none.

5. **The worker has no approval test of its own.** Its rules are now the app suite's rules,
   which is the point of the dedup — but the worker's *fan-out* after approval (enqueue,
   per-post failure marking) is still only covered indirectly.
