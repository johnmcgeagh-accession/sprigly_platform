# Rehearsal fixes — series intent + reshape hardening

**Date:** 2026-07-21 · branch `dev`
**Spec:** `docs/reports/ivy-t-rehearsal-failures.md`

| commit | what |
|---|---|
| `202a8c2` | feat: a series is a rhythm, not a launch |
| `966db69` | fix: a launch arc never puts two of its own beats on one day |
| `1820c36` | feat: the replacement pool is tiered — hand beats machine, new beats old |
| `5361c2d` | fix: beat titles are derived, not echoed |
| `dfaae75` | fix: one date change, one mutation |

**Suites:** engine **296**, app **420** (+14 skipped), worker **388** (+38 skipped),
admin **31**. Type-check clean across the workspace. No migration; no DB writes.

---

# COMMIT 1 — `202a8c2` — series intent kind + applySeries

## The contract

`intake-classify.ts` gains `kind: 'series'` carrying **both** timing forms, because clients
use both:

```ts
instances:  [{ date, subject? }]                              // they listed the dates
recurrence: { startDate, intervalDays, count?, until? }       // they gave a cadence
```

Enumerated dates win over a recurrence rule when both arrive — stated in the prompt **and
enforced in `expandSeries`**. A transform that trusts the prompt to have been obeyed has a
silent failure mode.

A series with neither a list nor a rule routes `evergreen`/`ambiguous`. "We should do a
mini-series sometime" is an idea; inventing a cadence for it would be worse than filing it.

## The transform

One beat per instance, on the date asked for. No arc, no offsets, no tease — the dates ARE
the instruction. Per-instance subjects are kept, so four Fridays are four products rather
than four copies of one name.

Instances beyond the plan month are neither placed nor discarded. The transform stays pure
and returns them as `deferred`; `draft-apply.ts` writes them to `plan_inputs` with the date in
`relevant_from` (no migration — the column already exists), and the receipt says so. An
instance that could not be fitted for want of pool is deferred on the same footing.

## Fixture results — the three real-brief inputs, verbatim

### 1. Weekend Style Guide (enumerated)

> "Weekend Style Guide every Friday in August: 7th — Maggie t-shirt grey marl; 14th — Lily tee
> and Sophie short co-ord; 21st — Emily sweatshirt in Midnight; 28th — Hannah t-shirt Navy."

| | before | now |
|---|---|---|
| beats | 1, on **Sat 1 Aug** | **4**, on 7 / 14 / 21 / 28 Aug |
| titles | the raw input text | `Maggie t-shirt grey marl`, `Lily tee and Sophie short co-ord`, `Emily sweatshirt in Midnight`, `Hannah t-shirt Navy` |
| replaced | 1 | 4 — exactly one per instance, slot count flat |
| arc parts | (a second run made one) | none |

The 4 September instance from the original brief is deferred, not placed, with
`note` containing "saved to your ideas".

### 2. The mini-series (interval)

> "New mini-series starting early August, one post every 3 weeks, hook 'What I am most proud
> of…' — each one sharing a specific aspect of the brand, fabrics, team, or Sally's own story."

| | before | now |
|---|---|---|
| beats | 3: Tease **1 Aug**, Launch **1 Aug**, Follow-up 4 Aug | **2**: 1 Aug, 22 Aug |
| shape | a launch arc | a rhythm, three weeks apart |
| replaced | 3 pillar beats | 2 |

Asserted explicitly that `2026-08-04` — the old follow-up slot — is **not** among the dates.

### 3. The Navy Edit (regression guard)

> "The Navy Edit launches on 28th August at 7pm."

Still a three-part arc: Tease 23 Aug, Launch 28 Aug, Follow-up 31 Aug. A launch is still a
launch.

## Live-classifier check — NOT done, and it matters

Every fixture above tests **the transform given a correctly-classified intent**. Whether the
live model returns `kind='series'` for this text is a prompt question that cannot be pinned
without a Bedrock call, so it is not covered by any test here.

**This is the one part of Commit 1 still unverified end-to-end.** The prompt was rewritten to
name the cases explicitly ("every Friday", "one post every 3 weeks", "weekly", "a mini-series"
are ALWAYS series, NEVER launch), but that is an argument, not evidence. A manual pass feeding
the three inputs through the real classifier is the remaining check.

**17 tests** in `draft-series.test.ts`.

---

# COMMIT 2 — `966db69` — clampToMonth collision rule

`arcDates()` resolves the three parts together instead of clamping each in isolation:

- a tease colliding with the launch slides to the first free earlier day in the month
- with no earlier day (anchor **is** the month start) it is **dropped and said**
- the follow-up mirrors the rule against the month end

Dropped rather than shifted forward deliberately: a tease after its launch is not a tease, and
silently reordering an arc teaches the client our labels mean nothing.

| anchor | before | now |
|---|---|---|
| **1 Aug** | Tease 1, Launch **1**, Follow-up 4 | Launch 1, Follow-up 4 + *"no room for a tease"* |
| 2 Aug | Tease 1, Launch 2, Follow-up 5 | unchanged |
| 3 Aug | Tease 1, Launch 3, Follow-up 6 | unchanged |
| 6 Aug+ | full −5/0/+3 | unchanged |
| 31 Aug | Tease 26, Launch **31**, Follow-up **31** | Tease 26, Launch 31 + *"follow-up moves to next month"* |
| 30 Aug | Tease 25, Launch 30, Follow-up **31** | unchanged (31 is free) |

**One spec deviation, deliberate.** The brief said "anchor 3rd (tease shifts to 1st/2nd)". At
anchor 3, the clamped tease already lands on the 1st, which is strictly before the launch — no
collision, so no shift. It keeps the 1st, preserving maximum build-up. Within the spec's
"1st/2nd", and the better of the two. My first test asserted the 2nd and failed; **the test was
wrong, not the code**, and I corrected the test.

Two sweep tests walk **all 31 anchors** and assert distinctness and tease/launch/follow-up
ordering for every one, so a future offset change cannot reintroduce this quietly. A 30-day
month is covered separately — the end bound is not hardcoded to 31.

**12 tests** in `draft-arc-boundary.test.ts`.

---

# COMMIT 3 — `1820c36` — tiered replacement pool

```
null   clientTouched · client_added · client-origin experiment    — their hand
0      template basis                                             — nothing justified it
1      observed, weakest evidence first
2      an earlier input's UNTOUCHED beat  — last resort, oldest application first
```

Tier-2 ordering is by `position`, which is a true application-order key here: `writeOps`
assigns from `max(position) + 1` per application, so a later application's beats always sort
after an earlier one's.

**Tier dominates everything.** Neither weak evidence nor date proximity can promote a tier-2
beat above a tier-0 one — both are asserted.

**Emphasis stays in tiers 0–1.** Displacing an earlier named ask to make room for a new named
ask is defensible; quietly re-pillaring what it is *about* is not.

## Tier-policy test results

| test | result |
|---|---|
| NEVER replaceable: touched, hand-added, client experiment, touched-input | ✓ |
| tier 0 = template, 1 = observed, 2 = earlier input | ✓ |
| a beat with no meta at all is tier 0 | ✓ |
| **order**: `template → observed-weak → observed-strong → input-weak` | ✓ |
| a tier-2 beat is not promoted by looking weak | ✓ |
| nor by sitting on the client's exact date | ✓ |
| within tier 2, oldest application first (by position) | ✓ |
| pool-empty → receipt, nothing applied, remedy named (launch + event) | ✓ |
| partial placement still reported as partial | ✓ |
| tier-2 displacement named: *"Made room by replacing a post from an earlier request."* | ✓ |
| pluralised for an arc displacing three | ✓ |
| **quiet** when only tiers 0–1 moved — saying it every time is noise | ✓ |
| emphasis will not re-pillar an earlier input's beat, but still tilts observed ones | ✓ |
| **the rehearsal end state** (16 client_input + 5 observed): pool = 21, observed first, inputs behind | ✓ |

That last one is the point of the commit. ivy-t's real month had a pool of **5 of 21**; it is
now **21 of 21**, correctly ordered, with the client's own hand still untouchable.

Pool-empty copy is one shared sentence that names a remedy:

> "Every beat this month is either yours or already earning its place — add a day or drop
> something to make room."

**16 tests** in `draft-pool-policy.test.ts`.

## ⚠️ Two prior tests changed — both deliberate policy inversions

Flagging rather than burying, since the standing rule is that prior suites stay unmodified:

1. **`protects a beat a previous client input created`** — asserted exactly the behaviour this
   commit replaces. Split into three tests: an earlier input's untouched beat is now tier 2
   (`isReplaceable → true`); a hand-added beat is still `null`; and a previous input's beat the
   client *touched* goes back to protected.
2. **`does nothing, loudly, when every beat is protected`** — tracks the new pool-empty copy.

Neither is weakened; both gained assertions. `git diff` on that file is +22/−4. No other prior
suite, and no fence, was touched — `draft-invisibility.test.ts`, `draft-view.test.tsx` and
`cycle-nav.test.ts` are byte-identical to session start.

---

# COMMIT 4 — `5361c2d` — echo titles

`deriveTitle` is deterministic and model-free: split on hard clause separators, take the first
**substantive** clause, drop trailing enumerations and dangling dates, cap at 60 on a word
boundary. The full text stays in `beat_meta.rationaleEvidence.reason` — receipts and rationales
still quote the client verbatim; only the card label shortens.

## Real titles from ivy-t's plan, before → after

| stored title (the actual row) | derived |
|---|---|
| `Weekend Style Guide every Friday in August: 7th — Maggie t-shirt grey marl; 14th` | `Weekend Style Guide every Friday in August` |
| `14th August — the stock leaves the factory for our next drop. Tease it: can you…` | `the stock leaves the factory for our next drop` |
| `15th August — our factory in Portugal starts its annual summer shutdown until 7t…` | `our factory in Portugal starts its annual summer shutdown…` |
| `In the Navy Edit build-up, include colour-reveal content — who can guess the mai…` | `In the Navy Edit build-up, include colour-reveal content` |
| `A throwback post using the video of Sally fitting the pre-production long sleeve…` | `A throwback post using the video of Sally fitting the…` |

**"First substantive", not "first"** — a correction I made after printing the real output
rather than trusting green tests. Clients lead with the date constantly, and taking clause one
titled two beats `"14th August"` and `"15th August"`: inside the cap, passing every test I had
written, and useless — it only repeats the date column. A bare date is a position, not a
subject.

Short subjects pass through untouched (`The Navy Edit`, `Maggie t-shirt grey marl`, …), and a
comma is **not** treated as a clause break, so "Lily tee and Sophie short co-ord set, in navy"
survives whole.

**One ordering trap, caught and tested.** The series ordinal `" — 2"` is exactly the separator
`deriveTitle` cuts on, so composing it before derivation collapsed every instance back to the
bare series name. The ordinal is now appended *after*, with a test pinning that instances stay
distinguishable.

**20 tests** in `draft-title.test.ts`.

---

# COMMIT 5 — `dfaae75` — date-change single-fire

Commits on blur (Enter blurs) instead of `onChange`, and drops no-ops. The field is
uncontrolled with `key={beat.date}`, so it remounts when the server's authoritative date
returns and cannot drift from its beat.

| input | commits? |
|---|---|
| `2026-08-01 → 2026-08-14` | **yes** |
| `2026-08-24 → 2026-08-24` (the logged no-op) | no |
| cleared (`''`) | no |
| half-typed (`2`, `20`, `202`, `2026`, `2026-0`, `2026-08`, `2026-08-`) | no |
| the intermediate values of one real edit | **exactly one** |
| re-blur after committing | no |

The rule is extracted as `isRealDateChange` and tested directly — the app harness is a node
environment, and a rule that can only be verified by clicking is a rule that rots.

**8 tests** in `date-commit.test.ts`.

---

# Boundaries honoured

- **No brief-decomposer** — backlogged. It consumes the series kind, so it comes after.
- **No assembly-status guard** — backlogged.
- **No application-level undo** — backlogged.
- **Fences untouched** — `git diff 48b359e` on `draft-invisibility.test.ts`,
  `draft-view.test.tsx` and `cycle-nav.test.ts` is empty. `excludeDraftPosts` unmodified.
- **Prior suites** — only the two policy tests in Commit 3, flagged above.
- **No writes to any database.**

---

# Worth recording

- **`app/src/lib/edit-scope.test.ts` and `post-generation.test.ts` fail to load without
  `DATABASE_URL`** — they parse env at import. Confirmed pre-existing by stashing every change
  and re-running. With the env loaded the app suite is 420 passed; without it, 394 passed and
  2 suites unloadable. Worth fixing so `pnpm test` is honest by default, but not in this
  session.
- **`packages/db` still has no `test` script**, so `pnpm --filter @sprigly/db test` silently
  succeeds while running nothing. Carried over from the previous report; still unaddressed.
- **`@sprigly/engine` must be rebuilt** before app/worker type-check picks up engine changes —
  they resolve to `dist`, not `src`. Caught it as a type error on the first run of Commit 1.
- **The live-classifier check on Commit 1 is the one outstanding verification**, and it is the
  headline fix. Everything downstream of a correct `kind='series'` is now pinned by tests; that
  the model produces it is currently argued, not demonstrated.
