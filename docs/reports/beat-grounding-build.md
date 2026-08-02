# Beat grounding — the build

**Date:** 2026-08-02 · **Branch:** `dev` · **Spec:** [beat-grounding.md](./beat-grounding.md)
**Acceptance target:** ivy-t cycle `0b9677e5-d06d-4de5-9207-527cd837333a`, September 2026, UAT.

A, B, C and D all landed, plus one fix that D's own acceptance run found. **E is deferred**,
with one exception named in §7.

| commit | piece |
|---|---|
| `d9690a8` | A — the evidence travels: a per-beat licence, not a blanket ban |
| `ecba6d6` | B — the backlog was never empty; the dial above it was pinned to null |
| `783dc1d` | C — the standing commitments come back: series occupy slots, they never add them |
| `a411b97` | D — the catalogue was queried on every assembly and never opened |
| `1ce8619` | D-fix — one typo is not a vocabulary: the ambiguity guard has to be proportional |

---

## 1. Where September started

Every beat, before this session. Thirty pillar paraphrases:

```
2026-09-01 carousel  We're here when you need us
2026-09-02 reel      Built because something was missing
2026-09-05 carousel  Fewer decisions, better mornings
2026-09-13 carousel  Confidence starts with solid foundations
2026-09-30 reel      Something real needed to exist
```

## 2. Where it finished

```
p  date        day  fmt       slot        title                                        evidence
0  2026-09-01  Tue  carousel  proven      Here When You Need a Style Friend            pillar
1  2026-09-02  Wed  reel      experiment  Why never to wear polyester or synthetics…   plan_inputs 043e6bd6, lifecycle candidate
2  2026-09-03  Thu  carousel  proven      Quality and Ethics, No Compromise            pillar
3  2026-09-04  Fri  reel      proven      The People Behind What We Build              pillar
4  2026-09-05  Sat  carousel  proven      WSG (Weekend Style Guide): Bea               series (Saturday) + Bea NEVER featured
5  2026-09-06  Sun  carousel  proven      Sunday Style: Fiona                          series (Sunday)   + Fiona NEVER featured
6  2026-09-07  Mon  carousel  proven      Dressed for Real Life, Real Women            pillar
7  2026-09-08  Tue  reel      proven      Notes from the Founder: Jane                 series (monthly)  + Jane NEVER featured
8  2026-09-09  Wed  carousel  experiment  Weekend Style Guide: — Carousel              plan_inputs 15dd0814, lifecycle candidate
9  2026-09-10  Thu  reel      proven      Why Ethics Is Built Into Everything          pillar
10 2026-09-11  Fri  carousel  proven      The Relationships That Shape What We Do      pillar
11 2026-09-12  Sat  carousel  proven      WSG (Weekend Style Guide): Layla             series + Layla NEVER featured
12 2026-09-13  Sun  carousel  proven      Sunday Style: Heather                        series + Heather last 2025-12-17 (3 captions)
13 2026-09-14  Mon  reel      experiment  A hard-working wardrobe of incredible…       plan_inputs 4da97127, lifecycle candidate
14 2026-09-15  Tue  carousel  proven      A Friend Who Knows Your Wardrobe             pillar
15 2026-09-16  Wed  reel      proven      How a Real Need Became Something More        pillar
16 2026-09-17  Thu  reel      experiment  We bring you simple things that work…        plan_inputs 7cef7563, lifecycle candidate
17 2026-09-18  Fri  reel      proven      Getting Personal About How We Work           pillar
18 2026-09-19  Sat  carousel  proven      WSG (Weekend Style Guide): Thia              series + Thia last 2025-12-22 (1 caption)
19 2026-09-20  Sun  carousel  proven      Sunday Style: Jules                          series + Jules last 2026-02-03 (5 captions)
20 2026-09-21  Mon  reel      proven      Clothes That Understand How You Live         pillar
21 2026-09-22  Tue  reel      proven      Honest Advice From a Trusted Friend          pillar
22 2026-09-23  Wed  carousel  proven      What our customers see: Jen                  series (monthly) + Jen last 2026-02-22 (2)
23 2026-09-24  Thu  reel      experiment  It's just a sweatshirt (or is it)'…          plan_inputs 7f8e67f1, lifecycle candidate
24 2026-09-25  Fri  reel      proven      Staying Close to the People We Dress         pillar
25 2026-09-26  Sat  carousel  proven      WSG (Weekend Style Guide): Lydia             series + Lydia last 2026-02-22 (8 captions)
26 2026-09-27  Sun  carousel  proven      Sunday Style: Maya                           series + Maya last 2026-03-08 (12 captions)
27 2026-09-28  Mon  reel      proven      Style That Works for Real Women              pillar
28 2026-09-29  Tue  reel      experiment  Life is busy — make decision-making easy…    plan_inputs bea1bef8, lifecycle candidate
29 2026-09-30  Wed  reel      proven      Built Because Something Was Missing          pillar
```

**Against the bar.** The report's opening quoted the June/July plan lines the draft had stopped
producing. Side by side:

| what the old planner wrote | what September now writes |
|---|---|
| `Sunday Style: Claire` | `Sunday Style: Jules` |
| `WSG: Maggie Almond` | `WSG (Weekend Style Guide): Lydia` |
| `What Our Customers See: Connie` | `What our customers see: Jen` |
| `Notes from the Founder: July` | `Notes from the Founder: Jane` |

10 beats name a product · 10 beats are a recurring series (all 8 weekly instances on their own
weekday, both monthlies spaced) · 6 beats carry her own sentences · 4 remain pillar-only after
subjects ran out. Slot count 30, dates 1–30 — **unchanged from before the session**.

`whoPosts` and `postingTime` are on every series beat again: `Sally posting`/`6pm` for WSG,
`Sprigly`/`8pm` for Sunday Style, `Sally only`/`monthly` for Notes from the Founder.

Cycle assumptions are now two, and the catalogue line is correctly **absent** because ten beats
name a product:

```
No launches or restocks are on record for this month — the draft assumes a business-as-usual month.
No pillar weights are on record, so the month splits evenly across pillars.
```

---

## 3. Per-commit acceptance

### After A+B (`ecba6d6`)

A is not separately observable on this cycle: it widens what the prompt carries, and the fields
it newly carries (`productCoverage`, `seriesDue`) do not exist until C and D populate them. Its
effect on the 24 non-experiment titles is a re-phrasing, not a change of subject. So A and B
were re-assembled together, and B's effect is exact and countable:

```
p   date        slot        title                                                    sourceRef
2   2026-09-03  experiment  Why never to wear polyester or synthetics, especially…   043e6bd6-4d4d-48a5-a9d1-19d326abeb21
7   2026-09-08  experiment  Weekend Style Guide: — Reel                              15dd0814-a32f-4fe5-a34f-876bda47e39c
12  2026-09-13  experiment  A hard-working wardrobe of incredible organic cotton…    4da97127-e037-43e1-a368-e5c8272709fd
17  2026-09-18  experiment  We bring you simple things that work — from work…        7cef7563-a643-4310-8f29-ff27809b19ff
22  2026-09-23  experiment  It's just a sweatshirt (or is it)' — a post breaking…     7f8e67f1-cd46-4869-ab63-45ac39542209
27  2026-09-28  experiment  Life is busy — make decision-making easy with a…         bea1bef8-752b-4980-b59c-dcf6a4f26267
```

Exactly the six `lifecycle='candidate'` rows — the ideas she has sent and never seen run — and
none of the fourteen `lifecycle='used'` ones. Every `sourceRef` is a real `plan_inputs.id`; the
other 24 beats were still pillar paraphrases at this point.

### After C (`783dc1d`)

Ten series beats appeared, on the right days, with the right posting metadata:

```
4   2026-09-05 Sat  WSG (Weekend Style Guide): Simplify Your Weekend    Sally posting  6pm
5   2026-09-06 Sun  Sunday Style: Build From the Ground Up             Sprigly        8pm
7   2026-09-08 Tue  Notes from the Founder: A Word From Me             Sally only     monthly
11  2026-09-12 Sat  WSG (Weekend Style Guide): Your Easy Weekend Edit  Sally posting  6pm
12  2026-09-13 Sun  Sunday Style: Foundations Worth Coming Back To     Sprigly        8pm
18  2026-09-19 Sat  WSG (Weekend Style Guide): Keep Your Weekend Simple Sally posting 6pm
19  2026-09-20 Sun  Sunday Style: Start With What Holds                Sprigly        8pm
22  2026-09-23 Wed  What our customers see: Real Stories, Real Wardrobes Sprigly      monthly
25  2026-09-26 Sat  WSG (Weekend Style Guide): Effortless Weekends…    Sally posting  6pm
26  2026-09-27 Sun  Sunday Style: The Pieces That Stay                 Sprigly        8pm
```

All four Saturdays, all four Sundays, both monthlies spaced eleven slots apart. No experiment
landed on a claimed slot. Slot count and dates unchanged.

### After D (`a411b97`) and D-fix (`1ce8619`)

The full list in §2. D's run is what found the D-fix defect — see §5.

---

## 4. The phrasing-validation rule, as implemented

`validatePhrasing(beats, titles, vocab)` — `packages/engine/src/draft-phrasing.ts`. Three
checks, in order of how badly they break trust:

**1. Every beat that wanted a title got one.** Fixed-title beats are exempt. A beat is
*title-fixed* when `slotType === 'experiment'` and `candidateRank.origin === 'client'` — her own
sentence, which the pass is shown for context (marked `KEEP AS IS`) and never asked to write.
`applyPhrasing` refuses to replace it even if the model returns one; the guarantee that she
reads her own words back cannot depend on the model having obeyed an instruction. The predicate
deliberately mirrors the immunity `replacementTier` already grants those beats.

**2. Per-beat naming licence.** For each policed name that occurs in a title as a standalone
word (case-insensitive, alphanumeric lookaround boundaries so `WSG (Weekend Style Guide)` and
`WSG` both anchor):

```
a product name → must equal this beat's rationaleEvidence.productCoverage.product
a series name  → must equal this beat's rationaleEvidence.seriesDue.name
```

Absence of the evidence is itself the answer: a beat carrying no `productCoverage` may name **no**
product, which is the old blanket ban, preserved exactly where there is nothing to relax it
against. A series name matches through its bracketed expansion, so "WSG", "Weekend Style Guide"
and the full configured string are one series.

**The vocabulary is an allowlist of things to POLICE, not to permit.** A name absent from it is
invisible to the check. That asymmetry is why the caller curates it (§5): policing "Joy" would
reject an honest title for using an ordinary word, not catch a fabrication.

**3. The outright bans, unchanged and unconditional.** Percentages, prices, ordinal dates, month
names, launch/restock/sale/offer/drop, "back in stock", "sold out"/"best-selling"/"top-performing".
September's `structured_brief` is NULL — no beat carries evidence for any of them, so there is
nothing to relax them against. Tested explicitly: a beat that legitimately names Jules still
fails on "Jules launches this month", "Jules on the 28th", "Jules, up 40%", "Jules, now £30".

**One bad title still fails the whole batch**, and the batch still falls back to the deterministic
titles. That matters more now than it did: after C and D the deterministic titles are themselves
concrete — `Sunday Style: Jules — Carousel` — so a fallback month is a grounded month, not a
pillar month.

---

## 5. What D's acceptance run found

The ambiguity guard shipped as *"exclude any catalogue name she has ever written in lower case"*.
Run against her live captions it excluded **Connie** — the flagship July launch the whole summer
plan was built around — on the strength of one caption:

> "…my grey marl **connie** (which will officially be back this July)."

One lower-case occurrence against forty-two capitalised ones. An absolute rule cannot tell a typo
from a vocabulary.

`1ce8619` makes it a comparison: a name is a word before it is a product when she writes it as an
ordinary lower-case word **at least as often** as she writes it as a product. The `> 0` guard is
as load-bearing as the comparison — a never-mentioned product scores 0 and 0, and those are
exactly the products the module exists to surface.

Live exclusions after the fix, from her real 43 catalogue names and 276 captions:

| name | reason | why |
|---|---|---|
| Ivy | brand | `deriveBrandTokens('Ivy T')` — 84 captions about the company |
| Joy | ambiguous | 4 × "pure joy" against 1 × "The Joy vest" |
| Rose | ambiguous | 1 lower-case, 1 capitalised — a tie |
| Erin Midweight | parse-artefact | no captions of its own; "Erin" is the real family |

**39 usable names, 17 stale for September, capped at 10.** Connie is retained
(2026-07-31, 42 captions) and will become eligible the moment it goes ninety days quiet.

---

## 6. Fences — none moved

| fence | status |
|---|---|
| **Slot count** | 30, from `slotCountFor` + the cadence floor. Series and coverage occupy; neither adds. Pinned: `buildSkeleton with recurring series — the fences hold`. |
| **Cadence derivation** | 7.48/wk observed over 10 months. Dates are chosen before any series is consulted and are byte-identical with and without. |
| **Temperature semantics** | Allocation-only. The count formula, the even spacing and the revert-to-proven clamp are untouched; `reservedIndices` changes only *where* experiments land, never how many. |
| **Replacement pool** | `replacementTier` untouched — client-touched and client-added still `null`, tier 2 still last-resort-oldest-first, `POOL_EMPTY_NOTE` unchanged. |
| **Determinism** | No `Date.now()`, no randomness. Series iterate in name order (not config array order), products sort on a total key (null-first, then date, then name), exclusions sort by name. Pinned by byte-identical re-assembly and order-shuffling tests. |
| **Phrasing never blocks** | One call, one retry, whole-batch rejection, deterministic fallback. Unchanged. |
| **The draft fence** | The new history read goes through `excludeDraftPosts()` **and** `deletedAt IS NULL`. Without it the assembler would read its own previous proposal back as history and date every series to the month it just invented — and it re-runs on every Ask touch, so the error would compound rather than show. |

`git diff HEAD` on `*terminology.fence.test.ts`, `*tokens.fence.test.ts`,
`*draft-invisibility.test.ts` is **empty**.

## 7. Deviations and deferrals — stated, not buried

**E is deferred, with one exception.** C needs `lastPlanned` to be a fact, and that lives in
`content_cycle_posts`. So the narrow slice of E that dates recurring series **did** land
(`loadSeriesHistory`: `scheduled_date` + `source_meta`, non-draft, non-deleted, ~12 kB). E's
actual subject — observed pillar share — is **not** built. The report's own §3b is why: with no
`sharePct` on any ivy-t pillar, "under-served" would be measured against a 14.3% default, which
is a claim about arithmetic rather than about the client.

**`postingTimes` was not read**, though the brief named it. `RecurringSeries.time` already carries
each series' own posting time (`8pm`, `6pm`, `monthly`) and it is what the old planner wrote to
`source_meta.postingTime` — verified against the live rows. Selecting a second column to supply a
value already in hand would repeat the exact defect this build exists to fix. `categories` **is**
read, because it is documented as authoritative and a series must file under one of the client's
own category values or under none.

**A relocating series is deliberately not built.** A series claims a slot that already exists on
its weekday; where the month has none it is *not placed*, and that becomes a named assumption
("… runs on Sundays, but this month has no slot there — it isn't in the draft"). Moving a slot to
satisfy a series would move a date her own posting rhythm chose — a cadence decision wearing a
scheduling costume. Ivy-t posts daily so nothing was unplaced here; a 3-day-a-week client would
see the assumption.

**Three things the run shows that are worth a look, none of them blocking:**

1. **`Weekend Style Guide: — Carousel`** (position 8). `experimentTitle` takes the first line of a
   backlog idea, and `15dd0814`'s first line is a bare label above a dated multi-line schedule.
   The title is hers and it is honest; it is also nearly empty. That input is arguably a
   `kind:'series'` intent rather than an evergreen idea, and C now schedules WSG properly anyway.
2. **`WSG (Weekend Style Guide): Lydia`** — the model uses the full bracketed configured name.
   Legal under the vocabulary and accurate, but clunky beside the old planner's `WSG: Maggie
   Almond`. A display form on `RecurringSeries` would fix it.
3. **"Sally" is under-claimed.** The sweatshirt shares a name with the founder, who signs her
   posts, so its mention count reads 64 and it is never picked as stale. That is an *under*-claim
   — the product simply doesn't get a beat — which is the safe direction, and the count travels
   with the evidence so the number can be judged. Guessing which "Sally" is the sweatshirt would
   be the unsafe direction.

**Scope taken beyond the brief, deliberately:** `app/src/lib/draft-rationale.ts` gained a series
clause and a product clause. Without them a beat titled `Sunday Style: Jules` would render its
reason from `formatEngagement` alone — the client would read "carousels average 32 likes" under a
title naming a product, with no trace of *why that product*. The acceptance bar is "every named
fact traceable to that beat's evidence", and the surface is where the client reads the trace. It
is a pure lib function (no React, no components, no tokens), so the detector and the token/
terminology audit do not apply; it is covered by 15 new unit tests.

---

## 8. Gates

| gate | result |
|---|---|
| `pnpm --filter @sprigly/engine test` | **503 passed** (was 377) — +40 `draft-recurring`, +32 `draft-coverage`, +37 `draft-phrasing`, +17 `draft-assembly` |
| `pnpm --filter @sprigly/worker... build` | **exit 0** — the command Railway runs |
| worker unit (`engine`) | **301 passed**, 38 skipped — unchanged |
| `tsc --noEmit` (app) | clean, after every commit |
| app unit/interaction (**Node 22**) | **1180 passed**, 14 skipped (was 1164) |
| tokens fence | 10 passed |
| terminology fence | 6 passed |
| draft invisibility | 5 passed |
| detector | n/a — no component touched |

**Two pre-existing failures, unchanged and unrelated:** `app/src/lib/edit-scope.test.ts` and
`app/src/lib/post-generation.test.ts` fail to *collect* because they import a module that parses
`DATABASE_URL` at import time. Present at the session baseline, present now, same two files. The
worker's 11 failing integration files are the same known baseline (0 test failures in both cases).

**Node 22 matters.** Under the default Node 20 the app run reports 744 passed and looks green
while silently skipping every jsdom file. All app figures above are Node 22
(`/opt/homebrew/opt/node@22/bin`).

**Acceptance runs write to UAT.** Each `draft-assemble` invocation replaces only this cycle's
`status='draft'` rows, which is what that path is for. No other row was touched; nothing was
pushed.
