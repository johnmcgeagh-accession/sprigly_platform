# Conversational spend: audited, honest, cheap

Branch `dev`. Three pieces of work: close the audit path so conversational calls reach the ledger
(W1), cache the invariant prefix so they cost less (W2), and make the tier question answerable by
evidence rather than argument (W3).

Headline: the sheet's turn loop was spending on every message and writing nothing down; it now
writes one row per call — all three of them on a query turn. The rows it writes are honest to a millionth of a penny rather than
rounded up to whole pence. And the prefix each turn re-sent — **5,712 tokens, verified live** — is
now cached, so a turn after the first pays full price on about 76 tokens instead of 5,775.

---

## W1 — the conversational audit path

### (a) Four sites where the guard was already waiting

Every one of these calls goes through an engine function that has taken an `AuditLogger` since it
was written and logs behind `if (audit && clientId)`. None of them were being passed one. The
guard never fired, no error was raised, and the spend simply did not appear.

| Site | File | Call | Was passing |
|---|---|---|---|
| 4 | `app/src/lib/draft-apply.ts:336` | `classifyIntake` (single-input reshape) | neither |
| 7 | `app/src/app/api/plan/intake/route.ts:57` | `extractStructuredBrief` | `clientId` only |
| 8 | `app/src/app/api/plan/intake/route.ts:94` | `distributeBriefAnswers` | `clientId` only |
| 9 | `app/src/app/api/plan/preview/route.ts:65` | `previewBrief` | `clientId` only |

All four now use the same `createAuditLogger(db)` `draft-apply.ts` already uses at `:540` for the
brief path. Sites 7 and 8 were the more embarrassing pair — `clientId` was already threaded
through, so the only missing ingredient was the auditor itself.

Site 9 is worth calling out. `preview/route.ts` opens with a header promising "≤ ~20 Haiku calls
per planning session … a small fraction of one Sonnet commit extraction". That envelope was
argued, never measured, because not one of those calls reached the ledger. It can now be checked
against what actually happens.

### (b) The two writes that did not exist at all

Unlike the four above, these two call sites had no logging code to enable — the calls were simply
unaccounted for.

**`task-parser.ts` → `parseTasks`.** The only entry to the plan agent, so every sheet turn is
exactly one call through here. That made it the single largest unmeasured spend in the product.
It now takes an optional `{ audit, clientId }` and writes `plan-agent:parse-tasks`.

The write sits **after** a successful call and **before** parsing, deliberately: a model that
returns junk still spent and belongs on the ledger; a model that never returned did not. The two
failures were already kept distinct in this file's control flow, and the ledger now respects the
same distinction.

**`query.ts` → `answerQuery`.** Writes `plan-agent:answer-query`, with `knowledgeUsed` on the row
so a question answered from plan state alone is distinguishable from one that pulled retrieval in.

Both writes are wrapped so a ledger failure can never change what the client is told.

### (c) Titan

`amazon.titan-embed-text-v2:0` matched no family in the price map, so `computeCostPence` returned
a hard `0`. Added at **1.58p per 1M input tokens** ($0.02/MTok × 79p/USD), zero output — embeddings
return a vector, not tokens.

Both provider rows carry the same figure, and that is not an oversight. Titan is an Amazon model
with no Anthropic equivalent, invoked directly with a bare model id rather than through a
cross-region inference profile — so it carries no cross-region premium *and* it does not match the
`eu.`/`us.` prefix `detectProvider()` keys on. Writing the rate once per provider keeps the table
uniform and makes the answer right whichever way the id is classified.

### (d) The rounding fix

`computeCostPence` ended in `Math.ceil(...)` and `audit_log.cost_pence` was an `integer`. Between
them, the ledger **could not represent any cost between zero and one penny**. Everything cheap
posted as 1p.

On the batch paths that was a rounding artefact on the last digit. On this path it was the entire
measurement:

| Call | Real cost | Posted as | Overstated by |
|---|---|---|---|
| Haiku parse turn (~4.5k in / 40 out) | 0.325220p | 1p | ~3× |
| Titan query embed (~60 tokens) | 0.000095p | 1p | ~10,500× |

Two calls four orders of magnitude apart arrived on the ledger identical.

**Migration `0091_cost_pence_subpenny.sql`** widens the column to `numeric(12,6)`. Like every
migration in this repo it is run by an operator with `psql -f`, never by a deploy step; a
`.down.sql` sits alongside it.

Why that and not the alternatives:

- **Reinterpret the integer as hundredths of a penny.** No DDL — but it silently redefines every
  existing row (a stored `1` would stop meaning 1p and start meaning 0.01p), needs a ×100 data
  migration across all history, and leaves the column name lying. Cheap in DDL, expensive in truth.
- **`double precision`.** Returns a JS number with no string handling — but these values get summed
  across thousands of rows, and that is exactly where binary floating point drifts.
- **`numeric(12,6)` — chosen.** The column keeps its name, its unit, and every existing value
  bit-for-bit: Postgres widens integer → numeric losslessly, so a row that said `3` still says
  `3.000000` and still means three pence. No reinterpretation, no backfill, no reader made wrong.
  It simply gains a fractional part it never had. Six places is micropence — enough that a single
  Titan embed is a real row rather than a fake `0`, and a million of them still sum exactly.

The migration is **widening only**, so it is safe to apply ahead of the code: an old integer-writing
deploy keeps working against the new column. Apply it *before* deploying the app. `audit_log` has
three foreign keys and no check constraints, indexes, or triggers, so nothing hangs off the type
change — but `ALTER TYPE` does rewrite the table under an `ACCESS EXCLUSIVE` lock. The table is
append-only and small; apply out of hours or accept a brief pause on audit writes.

Rounding now happens at **render only**. `admin/audit` shows sub-penny costs in pence (`0.33p`)
rather than as `£0.00`, because a column of `£0.00` reads as free and defeats the point of storing
the truth.

### (e) Reconciliation

`app/src/lib/agent/cost-ledger.test.ts` — 12 tests. Drives real turns through `runPlanAgentTurn`
with the model faked and the database faked, but **the ledger real**: the actual
`DrizzleAuditLogger` and the actual `computeCostPence` run, writing through a recording
`db.insert`. What it counts is what production would insert.

Output from a scripted five-turn session, one turn of which is a query:

```
ROWS=6 MESSAGES=10 EMBEDS=1
  plan-agent:parse-tasks     in= 4500 out=  40  cost_pence=0.325220
  plan-agent:parse-tasks     in= 4500 out=  40  cost_pence=0.325220
  plan-agent:parse-tasks     in= 4600 out=  55  cost_pence=0.337640
  plan-agent:answer-query    in=  900 out=  30  cost_pence=0.073140
  plan-agent:parse-tasks     in= 4500 out=  40  cost_pence=0.325220
  plan-agent:parse-tasks     in= 4500 out=  40  cost_pence=0.325220
TOTAL=1.711660p   OLD_CEIL_WOULD_BE=6.000000p
```

Reconciles as: **5 turns → 5 parse rows**, one per turn, never zero and never two. **10
`agent_messages`** (user + assistant per turn) against 5 parse rows — the counts agree. The query
turn adds exactly one `answer-query` row; the four non-query turns add none. And the same session
that now totals **1.71p** would have posted **6.00p** under the old ceil, a 3.5× overstatement.

The test also asserts that a model reply which is unparseable junk still posts a row (it spent),
and that the metadata carries the *shape* of a turn — digest size, catalogue size, whether a thread
or pending change was present — but never the client's words. A cost row is not a transcript.

---

## W2 — prompt caching for the turn loop

### What changed

`ModelCompleteParams.messages[].content` widened from `string` to `string | MessagePart[]`, where a
part is either text or a `cache_point` breakpoint. Every existing caller passes a string and is
untouched.

The parser's user message is now split at that breakpoint, reordered from narrative order into
**stability order**:

```
[ system prompt ]                    invariant for the life of the deploy
today + day table                    invariant for the day
viewed month + cycle months          invariant for the session
PLAN DIGEST                          invariant until the plan changes
CATALOGUE                            invariant until the catalogue changes
──────── cache_point ────────
PENDING                              changes per turn
THE CONVERSATION SO FAR              grows every turn
Client message                       always new
```

Previously `PENDING` and the thread sat **above** the digest, which put variable text in front of
the invariant bulk. Prefix caching matches from the front and stops at the first differing byte, so
in that order nothing could ever have been cached. The parts either side of a breakpoint read as
one continuous message to the model — a `cachePoint` is a billing marker, not a separator — so the
prompt's meaning is unchanged. `renderUserMessage()` is exported so the split stays testable.

### Verified live

Run against `eu.anthropic.claude-haiku-4-5-20251001-v1:0`, eu-west-2, on 2026-07-31 via
`pnpm --filter @sprigly/app cache-check` (3 turns, a few tenths of a penny):

```
cache-check: 3 turns through the real parser path.
Prefix carries a 686-char digest and a 181-char catalogue.

turn   inputTokens   cacheRead   cacheWrite   outputTokens
   1            25           0         5712            109
   2            63        5712            0             88
   3            88        5712            0             95

RESULT: CACHING WORKS. Turn 1 wrote 5712 tokens;
        later turns read the prefix back and paid full price on ~76 input tokens.
```

**Before/after input-token shape**, per turn:

| | Full-price input | Cache write | Cache read |
|---|---|---|---|
| Before (every turn) | ~5,775 | — | — |
| After, turn 1 | 25 | 5,712 | 0 |
| After, turns 2+ | 63–88 | 0 | 5,712 |

The invariant prefix is **5,712 tokens** — system prompt, day table, cycle months, digest,
catalogue. That was being re-sent and re-charged in full on every single message.

Two things the run confirms empirically. First, Bedrock reports `inputTokens` **excluding** both
cached-read and cached-write tokens (turn 1: 25 input alongside 5,712 written) — so the counters are
disjoint, not overlapping. Second, the prefix clears Haiku 4.5's minimum cacheable length; had it
not, the calls would have succeeded at full price with no error and no warning, which is precisely
the silent failure mode the harness exists to rule out.

At Bedrock Haiku rates (69p/1M input, cache reads ~10%, writes 1.25×), a ten-turn session moves
from ~3.99p of input to ~0.90p — roughly **78% off the input side**, break-even part-way through
the second turn.

### Per-site cache support

- **Bedrock (`bedrock-client.ts`)** — full support. `cachePoint` blocks on `complete` and
  `completeStreaming`, `cacheReadInputTokens`/`cacheWriteInputTokens` surfaced on the result and
  logged onto the audit row. This is the deployed path.
- **Anthropic (`anthropic-client.ts`)** — **breakpoints are dropped, deliberately.** Anthropic
  supports caching, but this package pins `@anthropic-ai/sdk ^0.27.0`, where caching was still a
  beta surface (`client.beta.promptCaching.messages`) with no `cache_control` on the GA message
  params and no `cache_read_input_tokens` on `usage`. There is no way to express the breakpoint
  through the call this client makes, so parts are concatenated back into the continuous string the
  model would have seen anyway. The prompt is byte-identical to the uncached one and
  `cacheReadTokens` stays *absent* rather than reporting a zero that would read as a cache miss to
  investigate. Enabling it needs an SDK upgrade, not a code change. This is the local-dev path;
  `MODEL_PROVIDER=bedrock` everywhere deployed.
- **Titan embeddings** — not applicable; `InvokeModel`, no prompt caching.

### Closed: caching no longer makes `cost_pence` understate

This section previously flagged an open defect. `computeCostPence` priced `inputTokens` only, and
Bedrock reports cache tokens separately from it, so the commit that made the conversation cheap
made its cost unreadable:

| Turn shape | True cost | Posted (before) | |
|---|---|---|---|
| 25 in + 109 out + 5,712 **write** | 0.534497p | 0.041837p | 92.2% light |
| 63 in + 88 out + 5,712 **read** | 0.076144p | 0.036731p | 51.8% light |

Fixed. `computeCostPence` now takes the cache counts and prices them at the published Bedrock
multipliers for the Anthropic families — **cache read 0.1× the base input rate, cache write 1.25×**
(the five-minute entry, which is what `cachePoint: { type: 'default' }` creates; the one-hour cache
is 2×). Both sources are cited in `price-map.ts`, and the constant is expressed as a ratio so a
base-rate correction propagates instead of leaving three numbers to update by hand.

The counts come from the row's own `metadata`, where the conversational writes were already
recording them — so no call site changed. Non-numeric values under those keys are ignored rather
than coerced: `cost_pence` is `numeric(12,6)` and a `NaN` reaching it is a failed insert at best.

Historical rows are untouched. Backfilling would mean inventing cache counts for calls made before
caching existed; correctness is forward from here.

---

## W3 — tier evidence, not tier faith

`classify-check` gained `--model`. **No default was changed.** `classifyIntake` and
`decomposeInput` still default to sonnet, in the CLI and in production; the flag is read once and
passed per call, and an un-flagged run is byte-identical to what it always was, prompt included.

A `--model` typed without a value now exits 1 rather than silently falling back to sonnet — running
the default and reporting a pass would be exactly the tier faith the flag exists to replace. Both
guard paths were verified to exit before any Bedrock call.

The run's summary line now names the tier, so a pasted result can never be misattributed:

```
14/16 passed  ·  15 classify calls (Bedrock), 1 pre-parsed (no spend)  ·  model: haiku  ·  fixture: …
```

### Commands for the operator

Baseline first — the fixtures have never been run against the current prompt on sonnet either, so
a haiku number is meaningless without one to compare it to. Run both in the same sitting.

```bash
# 1. Baseline: 16 fixtures + Sally's brief decompose-check, on the production default (sonnet)
pnpm --filter @sprigly/worker classify-check

# 2. The same fixtures and brief on haiku
pnpm --filter @sprigly/worker classify-check --model=haiku
```

Spend per run: 15 classify calls (1 of the 16 cases is a date-leading typed row caught by the
deterministic pre-parse and costs nothing), plus 1 decompose call and one classify per segment of
the ~700-word August brief. Both runs together are pennies.

**What would justify the swap**, and it is the fixtures' call, not an argument's: haiku matches
sonnet's pass count on the 16 cases, *and* the decompose-check produces the same segmentation with
the same per-segment kinds. Anything less — particularly a miss on `correction` or `cadence`, where
a wrong route silently reshapes a client's month — means the tier stays where it is. If the
fixtures hold, the swap is a follow-up commit that changes `modelName`'s default, on its own, with
these two outputs quoted in the commit message.

---

## What is still dark

**Nothing on the conversational path.** Both gaps this report previously flagged are closed: the
query embed is billed (`plan-agent:query-embed`), and cached turns are priced at their true cost.

A query turn now produces three rows for its three billable calls:

```
  plan-agent:parse-tasks   eu.anthropic.claude-haiku-4-5-20251001-v1:0   in= 4600 out=  55  cost_pence=0.337640
  plan-agent:query-embed   amazon.titan-embed-text-v2:0                  in=   60 out=   0  cost_pence=0.000095
  plan-agent:answer-query  eu.anthropic.claude-haiku-4-5-20251001-v1:0   in=  900 out=  30  cost_pence=0.073140
```

One caveat worth keeping visible: an embedding client that cannot report its token usage produces
**no row at all** rather than an estimated one. Today only `BedrockTitanClient` implements
`embedWithUsage`, so that branch is theoretical — but if another provider is added without it, its
embeds will be silently unbilled, and the honest failure mode is silence rather than invention.

---

## Files changed

**Ledger**
- `packages/audit/src/price-map.ts` — titan family; `Math.ceil` → micropence precision; cache multipliers
- `packages/audit/src/price-map.test.ts` — sub-penny and titan guarantees (12 tests)
- `packages/audit/src/audit-logger.ts` — formats to 6dp on write; prices cache tokens from metadata
- `packages/audit/src/audit-logger.test.ts` — the metadata→money seam (11 tests)
- `packages/db/src/schema.ts` — `cost_pence` → `numeric(12,6)`
- `packages/db/migrations/0091_cost_pence_subpenny.sql` (+ `.down.sql`) — new; hand-applied migration (this repo's convention: migrations are run by an operator with `psql -f`, not by a deploy step)
- `admin/src/app/admin/audit/page.tsx` — rounds at render; sub-penny shown in pence

**Audit path**
- `app/src/lib/draft-apply.ts` — site 4
- `app/src/app/api/plan/intake/route.ts` — sites 7, 8
- `app/src/app/api/plan/preview/route.ts` — site 9
- `app/src/lib/agent/task-parser.ts` — parse write + cache split + `renderUserMessage`
- `app/src/lib/agent/query.ts` — answer write
- `app/src/lib/agent/turn.ts` — one logger per turn, threaded to both call sites
- `app/src/lib/agent/model.ts` — note on why the ledger is *not* behind this seam
- `app/src/lib/agent/cost-ledger.test.ts` — **new**, 16 tests
- `packages/embedding-client/src/types.ts` — `EmbedUsage`, optional `embedWithUsage`
- `packages/embedding-client/src/bedrock-titan-client.ts` — keeps `inputTextTokenCount`
- `packages/knowledge/src/retrieve.ts` — optional auditor; bills `plan-agent:query-embed`

**Caching**
- `packages/model-client/src/types.ts` — `MessagePart`, `ModelMessage`, cache counters
- `packages/model-client/src/bedrock-client.ts` — `cachePoint` + usage counters
- `packages/model-client/src/anthropic-client.ts` — drops breakpoints, documented
- `packages/model-client/src/index.ts` — exports
- `app/scripts/cache-check.mts` — **new**, operator-run live verification
- `app/package.json` — `cache-check` script; `vite-node` devDependency
- `engine/src/content-cycles/plan-validation.test.ts` — `messageText()` helper for the widened type

**Tier evidence**
- `engine/src/content-cycles/classify-check-cli.ts` — `--model`

## Verification

| Suite | Result |
|---|---|
| `@sprigly/app` | 1024 passed, 14 skipped |
| `@sprigly/worker` (engine) | 415 passed, 38 skipped |
| `@sprigly/model-client` | 26 passed |
| `@sprigly/audit` | 32 passed |
| Type-checks | `app`, `web`, `worker` all clean |
| Builds | `model-client`, `db`, `audit`, `engine` all clean |

The engine and app suites need `DATABASE_URL` set to any parseable value (a pre-existing
requirement of their import graph, unrelated to this work).

## Migration status

**`0091` has been applied to UAT** (2026-07-31; `cost_pence` is `numeric(12,6)` there, verified
with `\d audit_log`). **Production has NOT had it applied.**

This repo does not run migrations from a deploy step, so it will not apply itself anywhere. Until
it is run against a given database, `cost_pence` there remains `integer` and the writes above round
on insert — the code change alone does not deliver the fix.

## Deploy order

1. Apply `0091_cost_pence_subpenny.sql` by hand. It is widening-only, so the running deploy keeps
   working against it.
2. Deploy the app.
3. Run `pnpm --filter @sprigly/app cache-check` against the deployed environment to confirm caching
   is live there too — the harness is cheap and the failure it catches is silent.
