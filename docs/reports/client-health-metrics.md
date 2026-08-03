# Client health metrics — adoption and divergence

**Built:** 3 August 2026 · **Branch:** `dev` · **Commits:** `c207f4e`, `51119d5`, `dd622da`
**Figures in this report are from PRODUCTION**, read-only, on 3 August 2026.

---

## 0. The headline, first

Ivy T, Instagram, July 2026, under the definitions as shipped:

| | |
|---|---|
| **Adoption** | **10 of 36** published captions matched a Sprigly caption — **27.8%** |
| **Divergence** | **3.9%** across those 10 matched posts |

The 2 August ad-hoc query reported 19 of 37. That number is not reproducible under any
word-overlap definition I could construct at a 0.85 threshold, and §4 sets out why. What *is*
reproducible, and stronger than the headline suggests, is the finding behind it: **the regime
change from 13 July is real, sharp, and not a threshold artefact.**

| | posts | mean best overlap | range | matched at 0.85 |
|---|---|---|---|---|
| 1–12 July | 14 | 0.427 | 0.297 – 0.553 | **0** |
| 13–31 July | 22 | 0.769 | 0.356 – 1.000 | **10** |

Nothing published in the first twelve days of July comes within 0.30 of the threshold. From the
13th, ten posts clear it and eight more sit in a band that §5 argues is almost certainly adoption
too. The measure did not have to be tuned to see this; it falls out of the first definition tried.

---

## 1. Definitions as shipped

### M1 — Adoption

> Of the captions published on a channel in a calendar month, the proportion whose words match a
> caption Sprigly wrote.

- **Denominator** — captions published that month, from `ig_posts`. A trawled post with no caption
  leaves the denominator rather than counting as a miss: a reel posted without words is not a
  decision to write her own, and scoring it as an adoption failure would be an accusation.
- **Match** — best word overlap ≥ `ADOPTION_MATCH_THRESHOLD` (0.85), against **any** Sprigly
  caption for that client + channel, from any month. Named constant, never a literal
  (`packages/engine/src/caption-overlap.ts`).
- **Overlap** — multiset word containment, **directional with the published caption as the
  denominator**: what share of *her* words are in *ours*.

The direction is not arbitrary. M2 is defined as `1 − overlap` meaning "how much of the published
text is not ours", and that sentence is only true in this direction. The other direction answers
"how much of our draft survived", which is a different question. Multiset rather than set because
a caption that says *linen* four times and one that says it once are not the same caption.

Tokenising drops case, punctuation and emoji, and keeps a hashtag as its bare word (`#LinenLove` →
`linenlove`). Hashtags are kept rather than stripped because she appends her own tag block to
captions she otherwise pastes verbatim, and those tags are genuinely not our text. Measured both
ways: it moves no July post across the threshold, so the conservative choice was free.

### M2 — Divergence

> For matched pairs only, the mean of `1 − overlap`.

Unmatched posts move M1 and never touch M2. Folding an unmatched post in as "100% diverged" would
make one number say two things and neither honestly. When nothing matched, divergence is `null`,
never `0`.

### The refinement — instructed edits

The brief asked that text changed via `post_edits` (she asked, Sprigly rewrote) not count as
divergence, and that divergence be measured against the **final** Sprigly caption rather than the
original.

**Shipped, and implemented as a maximum over the whole chain rather than as a swap to the final.**
Every version Sprigly wrote goes into the pool; the comparison takes the best. A caption she
published verbatim after asking us to rewrite it scores 1.00 against the reshape and contributes
zero divergence — which is what the refinement wanted — without needing a separate rule, and
without the failure mode a swap would have: if she published the *original* after we reshaped it,
"measure against the final" would charge us divergence for our own later edit. `max` cannot do
that.

The effect is measurable. 23 July matches either way, but reports **14.8% divergence from the
baseline and 3.6% from the reshape**. The first would have told the operator her voice was
drifting when all that happened is she asked for a change and we made it. It is pinned in the
tests.

### The correction the brief did not ask for, and the metric needs

**`content_cycle_posts.caption` is a shared artefact, not a Sprigly caption.** The app's caption
box writes the client's own typing straight into that column (`app/src/lib/mutations.ts`,
`patchPost` → `set.caption`). Matching a published post against it scores *her* writing as *our*
adoption.

This is not a hypothetical. Ivy T has 719 `caption_saved` rows with `origin = 'user'`, and 11 of
the 23 live posts in the July plan carry one. Matching naively against the live caption gives
**17 of 36**. Seven of those seventeen are her text on both sides of the comparison.

So the pool is the **Sprigly chain**, assembled per planned post from the three things that can
only be ours:

| source | why it is ours |
|---|---|
| `source_meta.original.caption` | the generated baseline, captured once and never overwritten by an edit or a regen (`app/src/lib/revert.ts`) |
| every `post_edits.caption_after` where `passed` | an instructed rewrite — she asked, the model wrote |
| `content_cycle_posts.caption` | **only** where no `plan_activity` row records a `caption_saved` with `origin = 'user'` against that post |

`plan_activity.actor` is deliberately *not* used to narrow the third rule. That column is null on
every row written before migration 0090, which is most of the history, and treating unattributed
as "not her" would put her words back in our pool.

### Why the match is textual, and stays that way

`ig_posts` carries five keys per post — `timestamp`, `caption`, `likesCount`, `commentsCount`,
`mediaType` — and no post id, no permalink, nothing that names our row. `beat-grounding.md` §3d
measured the only candidate key, the date, and found it does not hold: over 2026-06-01 onward, 44
dates carry both a plan post and an IG post, 15 carry an IG post with no plan post, 18 the
reverse, and several days carry more than one post.

**This constraint is permanent until the Meta Graph API lands**, and it is why every number here
is a **floor rather than a measurement**. A caption she rewrote past the threshold reads as
unmatched; a caption two of our posts could both explain is credited to whichever scores higher.
It undercounts, and the only way it could overcount is the shared-artefact hazard the chain rule
closes.

---

## 2. Computation — on read, not materialised

**Decided: computed on read**, with React's per-request `cache` as a de-duplicator (not a
performance strategy — it does not survive the request, so the number is always current).

Measured on Ivy T, the largest real client, via
`pnpm --filter @sprigly/worker client-health-measure ivy-t` (checked in at
`engine/src/client-health-measure-cli.ts`):

```
trawled months    10
published caps    275
plan posts        80  (0 with no Sprigly text)
Sprigly variants  153  (22,211 words)
comparisons       42,075 for the whole history
query time        493ms  (4 queries, 2 round trips)
buildPool         5.1ms
score, all months 69ms
score, one month  4.4ms
```

The 493ms is my laptop reaching Railway across the internet in two round trips. It is latency, not
database work, it is the same latency every other query on that page already pays, and a
materialised table would not remove it — the table would have to be read too.

So the real trade is **69ms of CPU on the trend page, 4.4ms on the client page**, against a
refresh trigger on four write paths: the monthly trawl, every caption save, every instructed
reshape, every plan regen. Four places to forget, and forgetting any one leaves the operator
reading a stale number that looks current — the one failure a measure built to be believed cannot
afford. On-read wins, and it is not close.

**Headroom.** Both factors are bounded by how much a person can post and how much we can plan. A
client posting daily for three years against a 600-variant pool is ~40× this: under 3s for a full
history, under 200ms for the one month the client page renders.

### Two changes the measurement paid for

The first run was 274ms for the full history. Two changes took it to 69ms with byte-identical
output:

1. **Hoist the tokenised pool out of the per-month loop.** It was being rebuilt for each of the
   ten months — 22,000 words tokenised ten times. `buildPool` is now called once and passed in.
2. **Replace the mutable decrementing copy in the bag intersection** with `Σ min(count_a, count_b)`
   over two precomputed count maps. The per-comparison allocation, not the arithmetic, was the
   cost. `captionOverlap` remains as the readable definition and a test asserts the two forms agree
   on every fixture pair, so the fast path cannot quietly become a different measure.

---

## 3. The admin surface

**On the client page** (`ClientHealthPanel.tsx`, one per channel, directly under the cycle card):

- The current month and **the last complete month beside it, always**. The current month is
  partial by definition — the trawl runs monthly, so on the 3rd it holds one post and reads as an
  honest "0 of 1", which is true and useless. Showing the last complete month costs a strip of the
  panel and stops the operator drawing a trend from a sample of one.
- Every figure as **"10 of 36 · 27.8%"**. The count leads and is never omitted: 1 of 1 and 30 of 30
  are both 100% and only one of them means anything. Divergence carries its own count instead —
  "3.9% across 10 matched posts" — because a mean over one pair is not a trend.
- **The method, on the screen.** Not a tooltip, not a doc: two paragraphs under the numbers saying
  the match is textual, why there is no join, what the threshold is, and to read the figure as a
  floor.

**Click through** to `/admin/clients/[id]/health/[channel]`: month, published, matched, adoption %,
divergence %, plus a CSS bar chart (no library — the data is ten numbers).

### Honest empty states

Three states, not a number with a footnote:

| state | what it says |
|---|---|
| `not_trawled` | "No Instagram posts have been trawled for this month, so there is nothing to measure yet." |
| `no_captions` | "4 posts trawled, none with a caption — nothing to compare." |
| `no_plan` | "12 captions published, but no Sprigly caption exists to compare them against." |

`MonthHealth` is a discriminated union whose unmeasured members **carry no `adoption` field at
all**, so rendering a number for a month we never trawled is a compile error rather than a
rendering choice. That is not theoretical — writing the trend chart against `pct === null` instead
of `state === 'measured'` failed `tsc` on exactly this. In the chart, unmeasured months get a
hatched slot and no bar: a zero-height bar is the same lie told in pixels. A *measured* 0% still
gets a bar, floored at 1.5% height, because an invisible bar and an absent one would read the same
and they mean different things.

---

## 4. Reconciling with the 2 August query — 19 of 37 vs 10 of 36

Three separate discrepancies, and it is worth separating them.

**The denominator (37 vs 36).** `ig_posts` for 2026-07 holds 36 posts today, all 36 with captions,
all 36 with July timestamps. The trawl has been re-run since 2 August (the August row now exists
and holds one post). Either the July row changed, or the original count included something this
one does not. One post, and not worth chasing.

**The numerator (19 vs 10).** I could not reproduce 19 at 0.85 under any definition tried: bag or
set intersection, hashtags kept or stripped, published-denominator or planned-denominator,
Jaccard, or Dice. The closest any of them gets on the naive pool is 17, and that 17 is the number
that counts her own typing as our adoption. **My working conclusion is that the ad-hoc query
compared against the live `content_cycle_posts.caption` and used a looser effective threshold than
0.85** — at ≥0.60 the shipped chain gives exactly 17, and at ≥0.50 it gives 22. That brackets 19.

**A warning worth recording.** I first ran this against `.env.local` (UAT) and got **4 of 36**.
The UAT copy's plan captions differ materially from production's. Anyone re-checking these numbers
must use `.env.prod`, read-only.

### Threshold sensitivity, on the shipped pool

| threshold | matched | divergence |
|---|---|---|
| ≥ 0.95 | 7 of 36 | 0.9% |
| ≥ 0.90 | 7 of 36 | 0.9% |
| **≥ 0.85** | **10 of 36** | **3.9%** |
| ≥ 0.80 | 10 of 36 | 3.9% |
| ≥ 0.75 | 14 of 36 | 9.2% |
| ≥ 0.70 | 15 of 36 | 10.3% |
| ≥ 0.60 | 17 of 36 | 13.0% |
| ≥ 0.50 | 22 of 36 | 20.7% |

0.85 sits in a flat spot (0.80–0.85 give the same answer), which is the property you want from a
cut. It is not, however, in a *gap* — the next band up is populated, and §5 is about what is in it.

---

## 5. The corroboration, and why 10 is a genuine floor

The match uses no date. But the plan row that wins each comparison has one, and it agrees:

| published | overlap | best plan row | |
|---|---|---|---|
| 13 Jul | 0.892 | 13 Jul | same date |
| 14 Jul | 0.892 | 14 Jul | same date |
| 15 Jul | 1.000 | 15 Jul | same date |
| 17 Jul | 0.993 | 17 Jul | same date |
| 17 Jul | 1.000 | 17 Jul | same date |
| 18 Jul | 1.000 | 18 Jul | same date |
| 20 Jul | 0.992 | 19 Jul | one day out |
| 23 Jul | 0.964 | 23 Jul | same date |
| 24 Jul | 0.988 | 24 Jul | same date |
| 30 Jul | 0.893 | 30 Jul | same date |

**Nine of ten land on the exact planned date, chosen on words alone.** That is independent
evidence the textual method is finding the right post, and it is evidence §3d's rule permits —
observing that the dates agree is not the same as joining on them.

Now the near misses, 0.50–0.85:

| published | overlap | best plan row | |
|---|---|---|---|
| 16 Jul | 0.798 | 16 Jul | same date |
| 21 Jul | 0.745 | 21 Jul | same date |
| 22 Jul | 0.769 | 22 Jul | same date |
| 25 Jul | 0.668 | 25 Jul | same date |
| 27 Jul | 0.766 | 27 Jul | same date |
| 29 Jul | 0.770 | 29 Jul | same date |
| 31 Jul | 0.660 | 31 Jul | same date |
| 31 Jul | 0.530 | 31 Jul | same date |
| 1, 2, 7, 8 Jul | 0.508–0.553 | various, none matching | — |

**Every near miss from 13 July onward lands on its own planned date. Every near miss before it
does not.** The eight in the first group are our captions, rewritten past the threshold — which is
precisely the undercount the "floor" language exists to describe. The four in the second group are
her own posts scoring mid-range on shared vocabulary, which is what a genuine non-match looks like.

So the honest reading of July is: **10 of 36 measured, and around 18 of the 22 posts from 13 July
are ours in some form.** The operator should read the panel's number as the conservative one and
the trend as the real signal.

---

## 6. Tests

**`packages/engine/src/caption-overlap.test.ts` — 27 tests.** Fixtures are verbatim July captions
(`caption-overlap.fixtures.ts`), pulled from production on 3 August:

- the four cases named in the brief — a verbatim match at 1.00 (15 July), a heavily-edited match
  (13 July, 0.892), an unmatched self-written post (5 July), and a month with no IG data;
- the threshold at the boundary — `>=` not `>`, 8-of-9 words matching and 7-of-9 not, a
  caller-supplied threshold moving the verdict and not the score;
- the two measures' independence — adding an unmatched post changes adoption and leaves divergence
  bit-identical;
- the chain — a reshape carrying a match the baseline cannot reach (0.43 → 0.99 on 24 July), the
  newest reshape winning without the older one dragging the mean down, an instructed reshape
  costing no divergence (14.8% → 3.6% on 23 July), and a client-typed caption never entering the
  pool;
- the readable and fast overlap forms agreeing on every fixture pair.

**`admin/.../ClientHealthPanel.test.tsx` — 18 tests** over the rendered markup: the count precedes
the percentage, singular/plural on a one-pair mean, each empty state's actual sentence, the
fallback month's presence and label, and the method text.

**`admin/.../client-health.fence.test.ts` — 6 tests (the detector).** It checks what the compiler
cannot: that every state the `MonthHealth` union can hold is **named** on both surfaces, reading
the states out of the engine source rather than keeping its own copy.

*It found two on its first run.* Both surfaces reached `no_plan` by falling off the end of a
ternary — so a fourth state added later would have rendered `no_plan`'s sentence. Both are now
`switch` statements with a `never` in the default.

**The audit behind the detector.** A sweep of every percentage rendered in a JSX text position
across `admin/` and `app/` returned exactly the surfaces this build adds, and nothing else. The
defect class arrives with this feature; there was no pre-existing offender to fix.

---

## 7. Gates

| gate | result |
|---|---|
| `pnpm --filter @sprigly/worker... build` | clean |
| `packages/engine` vitest | 544 passed (27 new) |
| `admin` vitest | 84 passed (24 new) |
| `admin` `tsc --noEmit` | clean |
| `admin` `next build` | compiles; new route registers as `ƒ /admin/clients/[id]/health/[channel]` |
| app terminology + tokens fences | 18 passed, untouched by this build |

`next build` fails to prerender `/`, `/_not-found` and `/admin/workflows` when Clerk's env is
absent, and succeeds with `.env.local` loaded. Pre-existing and environmental.

---

## 8. Known limits — read these before trusting a number

1. **`plan_activity` starts 18 July 2026.** The client-typed exclusion can only see edits from
   that date. A caption she typed before then leaves no ledger row, so the live caption enters the
   pool as ours. Bounded by the baseline: **1 of July's 10 matches** (15 July) rests on a live
   caption with no generated baseline behind it and cannot be verified either way. Six more were
   won by a live caption that *does* have a baseline, so the row is provably ours in origin even
   if she tweaked the text; three came from instructed reshapes. Across all of Ivy T, **3 of 80**
   plan rows are live-only-and-unverifiable.

2. **The client-typed flag is coarse.** `caption_saved` with `origin = 'user'` fires on autosave,
   so it means "she touched the text", not "she wrote it from scratch". This makes the exclusion
   *conservative* — it drops our caption from the pool when she fixed a typo in it. The chain
   recovers most of that through the baseline and the reshapes; excluding every touched post
   outright would give 7 of 36 instead of 10.

3. **The pool is unbounded by month.** As specified: a published caption is matched against every
   Sprigly caption for that client, from any month. Correct — she may post our 5 July caption on
   the 12th — but it means the pool grows over time and a very long-lived client's adoption figure
   becomes slightly more permissive. Nothing in ten months of Ivy T shows this mattering: no
   pre-13-July post matched anything, including four full months of plans.

4. **Months key on `ig_posts.month`**, and posts whose timestamp falls outside their row's month
   are dropped rather than bucketed elsewhere. On Ivy T's ten months there are none. Dropping is
   the behaviour that stays honest if the trawl ever changes.

5. **Workspace convention.** `caption-overlap.fixtures.ts` holds verbatim client captions in
   `dev/`, which the workspace `CLAUDE.md` reserves for code. The captions are public Instagram
   posts plus Sprigly's own output — no contact detail, no commercial term, no correspondence —
   and the tests pin exact scores, which a paraphrase would destroy. Flagging it rather than
   deciding it: say the word and they move behind a fixture loader pointed at `clients/`.

---

## 9. What would change these numbers

- **The Meta Graph API.** A real post id turns every figure here from a floor into a measurement,
  and makes the whole chain rule unnecessary for matching (though still useful for divergence).
- **An operator edit surface in admin.** `OPERATOR_ACTOR` exists and nothing writes it yet
  (`app/src/lib/activity.ts`). The first operator caption edit that records `origin = 'user'` will
  drop that post from the Sprigly pool as though the client had typed it. Whoever builds that
  surface must use `OPERATOR_ACTOR`, and this measure must then exclude on `actor = 'client'`
  rather than on `origin = 'user'`.
- **A second consumer.** If the app or the worker ever needs adoption, the loader moves from
  `admin/src/lib/` to `@sprigly/db` beside `ai-change-usage.ts`. The pure scorer is already in the
  right place.
