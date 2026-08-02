# Beat grounding — what the draft assembler knows, and what it could know

**Date:** 2026-08-01 · **Environment:** UAT (`.env.local` → `hayabusa.proxy.rlwy.net:24746/railway`) · **Mode:** read-only

**Subject:** Ivy T (`c79cf1c5-b51d-4a9b-aedc-48577df43e8f`), channel `instagram`.
**The artefact:** cycle `0b9677e5-d06d-4de5-9207-527cd837333a` (`cycle_month = 2026-08`, status `scheduled`) holds
30 live `status='draft'` beats for **September 2026**, every one `basis: 'observed'`.

The operator's finding reproduces exactly. The full September draft, as persisted:

```
2026-09-01 carousel A Supportive Friend…   "We're here when you need us"
2026-09-02 reel     Born From Real Need    "Built because something was missing"
2026-09-03 carousel Ethical Without Comp.  "Ethics aren't optional for us"
2026-09-04 reel     Personal Relationships "Real connections, not just transactions"
2026-09-05 carousel Simplify Your Morning  "Fewer decisions, better mornings"
…  (7 pillars, round-robin, 30 consecutive days)
2026-09-30 reel     Born From Real Need    "Something real needed to exist"
```

Compare what the *same database* holds for the months the old planner produced:

```
2026-06-21 reel     "Nicola Public Launch — International T-Shirt Day"
2026-06-28 carousel "Sunday Style: Claire"
2026-07-17 carousel "WSG: Connie Violet"
2026-07-24 carousel "WSG: Maggie Almond"
2026-07-26 carousel "Sunday Style: Sally Sweatshirt × 3 Colours"
```

The regression is not a data problem. Every input needed to write the second list is present, current, and
already in the assembler's own process. The assembler simply never opens it.

---

## 1. Trace of one beat, end to end

Beat: `position = 4`, `scheduled_date = 2026-09-05`, `format = carousel`,
`pillar = Simplify Your Morning`, title **"Fewer decisions, better mornings"**.

### 1.1 The reads (worker side)

`engine/src/content-cycles/draft-plan.ts` → `assembleAndPersistDraft`:

| Line | Read | What it takes | What it discards |
|---|---|---|---|
| `draft-plan.ts:154-160` | `content_cycles` | `cycleMonth`, `status`, `structuredBrief`, `intakeJson` | — |
| `draft-plan.ts:171-175` | `client_planning_config` | **`pillars` only** | `recurring_series`, `categories`, `posting_times`, `cadence`, `competitors`, `register_map` |
| `draft-plan.ts:177-181` | `client_product_catalogue` | **`id` only** — an existence probe | the entire 49-family catalogue |
| `draft-plan.ts:183-187` | `client_channels` | `postsPerWeek` | — |
| `draft-plan.ts:189` → `loadHistory` (`:44-66`) | `ig_posts`, **all 10 months** | `timestamp`, `likesCount`, `commentsCount`, `mediaType` | **`caption`** — mapped at `:58` into `HistoryPost`, then never read again |
| `draft-plan.ts:190` | `ig_posts.updated_at` | staleness | — |
| `draft-plan.ts:197` | `plan_inputs` via `loadDurableInputs` | `type`, `content` | `id`, `lifecycle`, `origin`, `used_in_cycle_id` |
| `draft-plan.ts:209-210` | `structured_brief` | **`products.length > 0` → one boolean** | `products[]`, `schedule[]`, `content_asks[]`, `focus[]` |
| `draft-plan.ts:234-239` | `voice_snapshots` | `snapshotMd`, first 2 000 chars | — |

Nothing reads `content_cycle_posts` history. Nothing reads the catalogue body. Nothing reads a caption.

### 1.2 The assembly (pure)

`packages/engine/src/draft-assembly.ts:145` `assembleDraft` receives exactly:

```ts
{ clientId, cycleId, channel, month, posts, pillars, candidates, temperature,
  hasCatalogue: boolean, hasBriefedLaunch: boolean, configPostsPerWeek, floorSlots, staleTrawlWarning }
```

- `observeHistory(posts)` (`draft-history.ts:131`) → cadence 7.48/wk over 10 months; formats
  `reel 183 @ 42.1`, `carousel 86 @ 31.9`, `image 7 @ 21.1`. **`observeFormats` (`draft-history.ts:104`)
  filters on `mediaType` and reads `likesCount`/`commentsCount`. `caption` is never touched anywhere in
  this file.**
- `resolvePillarWeights(pillars)` (`pillar-weights.ts:41`) → no stored `sharePct` on any of Ivy T's
  7 pillars, so `basis: 'equal'`, share `1/7 = 0.142857…` each.
- `buildSkeleton` (`draft-skeleton.ts:179`) → `slotCount = min(30, round(7.48 × 30/7)) = 30`;
  `spreadDates` (`:78`) needs `ceil(30 / 4.29) = 7` preferred weekdays, so all seven are chosen and every
  day in September becomes eligible → **one post per calendar day**. `spreadFormats` (`:108`) tilts by
  engagement, `spreadPillars` (`pillar-weights.ts:65`) round-robins the seven equal pillars — hence the
  perfectly cyclic pillar column.
- `allocateSlots(30, null, candidates)` (`draft-allocator.ts:69`) → `temperature` is **hardcoded `null`**
  at `draft-plan.ts:207`, so line `:80` returns immediately: all 30 slots `proven`, candidates ignored.

### 1.3 The SUBJECT

There are only two title paths (`draft-assembly.ts:176-178`):

```ts
title: alloc.candidate
  ? experimentTitle(alloc.candidate.content, slot.format)   // never reached — temperature is null
  : deterministicTitle(slot.pillar, slot.format)            // → "Simplify Your Morning — Carousel"
```

`deterministicTitle` (`draft-assembly.ts:56-59`) is `${pillar} — ${Format}`. **The pillar name IS the
subject. There is no other subject-bearing input in the function.**

### 1.4 The phrasing pass — the whole prompt context

`packages/engine/src/draft-phrasing.ts`. `buildUserMessage` (`:105-121`) produces, per beat, exactly
one line:

```
- position 4: pillar "Simplify Your Morning", format "carousel" (chosen because this pillar is 14% of their posting)
```

plus a voice header. That is the model's entire input for that beat: **a pillar name, a format word, and a
percentage.** The system prompt (`:30-45`) then forbids everything that would make a title concrete:

> - Restate ONLY what the evidence gives you. The pillar, the format, and nothing else.
> - NEVER name a product, a colourway, a collection, a price, or a date.
> - NEVER state a metric, a number, a percentage, or a performance claim.

and `validatePhrasing` (`:94`) enforces it with `FORBIDDEN` (`:48-56`), rejecting the whole batch on one
violation. `applyPhrasing` (`:163`) swaps `"Simplify Your Morning — Carousel"` for
`"Fewer decisions, better mornings"`.

**The model behaved perfectly.** Given a pillar tagline and a prohibition on specificity, a paraphrase of
the pillar is the only legal output. The generic beats are not a prompt-quality failure; they are the
contract working as written on an input that contains nothing else.

### 1.5 The persisted row

`draft-plan.ts:252-262`:

```ts
{ cycleId, clientId, channel, scheduledDate, format, pillar, caption: null,
  status: 'draft', position, beatMeta, sourceMeta: { title } }
```

Live row for 2026-09-05: `source_meta = {"title": "Fewer decisions, better mornings"}`. The old planner
wrote `category`, `whoPosts`, `postingTime`, `notes`, `competitorInsight` into the same column
(11 distinct keys observed across Ivy T's non-draft rows). The assembler writes one.

Its `beat_meta`, verbatim from UAT:

```json
{ "slotType": "proven",
  "assumptions": [
    "No launches or restocks are on record for this month — the draft assumes a business-as-usual month.",
    "No pillar weights are on record, so the month splits evenly across pillars." ],
  "rationaleEvidence": {
    "basis": "observed",
    "pillarShare": 0.14285714285714285,
    "cadenceBasis": { "months": 10, "source": "observed", "postsPerWeek": 7.48 },
    "formatEngagement": { "posts": 86, "format": "carousel", "avgEngagement": 31.9 } } }
```

### 1.6 One honesty defect found in passing

`detectAssumptions` (`draft-assembly.ts:84-86`) raises
*"No product catalogue is cached, so no beat names a specific product or colourway"* **only when
`hasCatalogue` is false.** Ivy T has a catalogue (49 families, refreshed 2026-07-01), so the line is
suppressed on all 30 beats — confirmed: `0` of `30` carry it. But no beat names a product either, because
the phrasing prompt forbids it outright. The client is therefore told by omission that products were
considered when they were not. Whatever else changes, this assumption's condition should become
"the catalogue was not *used*", not "the catalogue does not exist".

---

## 2. Inventory: available, unused

Sizes are Ivy T's live UAT payloads (`pg_column_size`), i.e. the realistic per-assembly cost.

### 2.1 Product catalogue — `client_product_catalogue`

- **Accessor today:** `draft-plan.ts:177-181` already queries this table. It selects `id`. Changing
  `.select({ id })` to `.select({ catalogue })` is a one-word edit on an existing round-trip.
- **Shape:** `{ families: ProductFamily[], flagged: ParsedProduct[], statusBreakdown }`
  (`packages/engine/src/catalogue/parse-catalogue.ts:42-54`). Per family:
  `{ family, name, style, kids, variants: [{ colourway, status, kids, sales: { netItemsSold, netSales, returns } }] }`.
- **Live content:** 49 families, `source_month = 2026-06`, refreshed 2026-07-01. Top by units sold:
  Erin 3/4 T-Shirt (103), Hannah Midweight T-Shirt (69, 18 colourways), Megan Oversized Midi Dress (37),
  Dotty V T-Shirt (35), Elle Semi-Fitted Dress (32).
- **Reachable:** yes, same query, same package, no new dependency. Formatters already exist:
  `buildCatalogueGroundingBlock` (`engine/src/catalogue/validate-catalogue.ts:199`, ranks by
  named-in-intake → pre-order/back-soon → units sold, caps at 60 families) and the lighter
  `loadProductIndex` (`app/src/lib/agent/catalogue.ts:34`).
- **Cost:** **9.6 kB, 0 extra queries.**

### 2.2 `ig_posts` captions — nine months of what she has actually covered

- **Accessor today:** `loadHistory` (`draft-plan.ts:44-66`) **already loads them into memory** at line 58
  and hands them to `assembleDraft`. `draft-history.ts` never reads the field.
- **Shape:** `IgPost { timestamp, caption, likesCount, commentsCount, mediaType }` — exactly five keys,
  verified: all 276 posts across 10 months carry all five. `videoViewCount` is absent from every row.
- **Live content:** 276 posts, 2025-11 → 2026-08. **100% `mediaType` coverage** (the deep-trawl fix
  landed — `draft-history.ts:18` and `draft-assembly.ts:90-92` still describe the old 19-of-50 gap and
  are now stale). **100% captioned**, mean caption 688 characters.
- **Reachable:** yes — already in the assembler's arguments. Zero new I/O.
- **Cost:** **0 kB marginal, 0 extra queries.** The data is loaded and thrown away today.

### 2.3 Per-post engagement and format performance

- Already used, but only in aggregate-by-format. `observeFormats` (`draft-history.ts:104-128`) computes
  `{format, posts, sharePct, avgEngagement}` and nothing else. Per-post engagement is discarded.
- Engagement is `likes + comments` (`draft-history.ts:58`), the only definition the schema supports.
  Reels — 183 of 276 posts — are judged on the metric reels are worst served by. That limitation is
  already documented at `draft-history.ts:12-15` and does not change.
- **Cost:** 0. Same array.

### 2.4 Recurring series — `client_planning_config.recurring_series`

- **Accessor today:** `draft-plan.ts:171-175` already queries this row and selects `pillars` only.
- **Shape:** `RecurringSeries { name, dayOfWeek, time, format, whoPosts }` (`packages/engine/src/types.ts:141`).
- **Live content — four series, none of them in the September draft:**

  | name | dayOfWeek | time | format | whoPosts |
  |---|---|---|---|---|
  | Sunday Style | Sunday | 8pm | Carousel | Sprigly |
  | WSG (Weekend Style Guide) | Saturday | 6pm | Carousel | Sally posting |
  | Notes from the Founder | monthly | monthly | null | Sally only |
  | What our customers see | monthly | monthly | Carousel | Sprigly |

  The old planner honoured all of them (`planning.ts:297`). Also unread on the same row:
  `categories` (10 values, documented as *authoritative*), `posting_times` (`sundayStyle: 8pm`,
  `wsg: 6pm`, `launch: 6am`, `morning: 7am`, `evening: 7pm`), `cadence`.
- **Reachable:** yes, same query. **Cost: 2.3 kB, 0 extra queries.**

### 2.5 `plan_inputs` backlog — evergreen ideas she has already given us

- **Accessor today:** `loadDurableInputs(db, clientId, month)` (`packages/engine/src/intake-signals.ts:103`),
  called at `draft-plan.ts:197`.
- **This is the sharpest finding.** `draft-allocator.ts:11-15` and `draft-assembly.ts:130` both state the
  candidate list is `[]` for every client because all live `plan_inputs` are `type='note'`. **That comment
  is stale.** Running the exact `loadDurableInputs` window for `planMonth = 2026-09` against UAT returns
  **20 rows** — 14 `lifecycle='used'`, 6 `lifecycle='candidate'`, all `type='idea'`, `status='active'`,
  `origin='client'`, both relevance bounds NULL (so they are permanently in-window).
- Sample of the six never-used ones, in her words:
  - *"Why never to wear polyester or synthetics, especially in summer."*
  - *"It's just a sweatshirt (or is it)' — a post breaking down what makes our sweatshirts super…"*
  - *"A hard-working wardrobe of incredible organic cotton staples makes life easier."*
  - *"Life is busy — make decision-making easy with a simple set of quality wardrobe staples."*
  - *"We bring you simple things that work — from work presentations to hugs at the school gate."*
- The candidates are loaded, ranked, and then discarded — **not** because the backlog is empty, but
  because `temperature` is hardcoded `null` at `draft-plan.ts:207` and `allocateSlots` short-circuits at
  `draft-allocator.ts:80`.
- **Two defects in the existing wiring, both cheap:**
  1. `loadDurableInputs` does not select `planInputs.id`, so `draft-plan.ts:200` synthesises
     `id: \`${d.type}-${i}\`` → `beat_meta.sourceRef` becomes `"idea-0"`, an array index. `sourceRef` is
     documented as `plan_inputs.id` (`packages/db/src/schema.ts:1015`). A beat cannot currently trace to
     its idea.
  2. It does not filter or order by `lifecycle`, so 14 already-used ideas rank alongside the 6 fresh ones.
- **Cost:** **4.1 kB, 0 extra queries** (the call already happens).

### 2.6 `structured_brief` from prior cycles

- **Accessor today:** already selected at `draft-plan.ts:157`, reduced to one boolean at `:209-210`.
- **Shape:** `StructuredBrief` (`packages/engine/src/types.ts:324`) —
  `{ products: [{product, colourway, status, launch_date, content_from}], schedule: [{date, type, product, colourway, note}], content_asks, focus, conflicts, plan_window }`.
- **Live content:** the 2026-06 cycle's brief carries `focus: ["Connie sweatshirt"]`, three products
  (Cobalt restock / Grey Marl restock / Violet new, all `launch_date: 2026-07-17`), and a `schedule[]`
  whose entries are typed `launch`, `weekend-style-guide`, `sunday-style`, `colour-palette` — i.e. the
  brief already speaks the recurring-series vocabulary. The **2026-08 cycle's brief is NULL**, which is
  why `hasBriefedLaunch` is false and the "business-as-usual month" assumption fires correctly.
- **Reachable:** the current cycle's, yes, free. Prior cycles' briefs need one extra query
  (`content_cycles` by `clientId` ordered by `cycle_month desc`) — 4.0 kB for both of Ivy T's.
- **Caveat:** a prior cycle's brief describes a *past* month. Useful as "what she has already run", never
  as "what is happening in September".

### 2.7 Post history — `content_cycle_posts`

- **Accessor today:** none. The assembler reads this table only to `DELETE` its own previous drafts
  (`draft-plan.ts:264-270`).
- **Shape:** `scheduled_date`, `format`, `pillar`, `caption`, `status`, `hook`, `script`, `position`,
  `source_meta`, `beat_meta`, `review_state`, `deleted_at`.
- **Live content:** 74 non-draft live rows across three cycles. `source_meta` carries 11 distinct keys —
  `title`, `category`, `whoPosts`, `postingTime`, `notes`, `competitorInsight`, `original`,
  `pendingInstruction`, `clientWritesOwn`, `day`, `generationError`. Category distribution:
  Product launch/offer 15, Brand 10, WSG 8, Sunday Style 7, Styling 5, Testimonials 3, Regular feature 2,
  Educational 2, null 40.
- **Reachable:** yes — one indexed query on `(client_id, status ≠ 'draft', deleted_at IS NULL)`.
  Must use `excludeDraftPosts()` (`packages/db/src/schema.ts:1132`) or the assembler will read its own
  prior proposals as history.
- **Cost:** one extra query, **152 kB** if captions are selected; **~12 kB** for
  `(scheduled_date, format, pillar, source_meta)` alone, which is all any coverage computation needs.

---

## 3. Coverage analysis: what is deterministically computable

All four were run against live UAT. Results below are real output, not sketches.

### (a) Products never featured, or not since date X — **CHEAP**

```sql
with fams as (select distinct lower(f->>'name') nm
              from client_product_catalogue, jsonb_array_elements(catalogue->'families') f
              where client_id = $1 and channel = $2),
     posts as (select (p->>'timestamp')::timestamptz ts,
                      lower(p->>'caption') cap,
                      (p->>'likesCount')::int + (p->>'commentsCount')::int eng
               from ig_posts, jsonb_array_elements(posts) p
               where client_id = $1 and channel = $2)
select nm, count(posts.ts) mentions, max(posts.ts)::date last_seen, round(avg(posts.eng),1) avg_eng
from fams left join posts on posts.cap ~ ('\m' || nm || '\M')
group by nm;
```

Live result (43 distinct catalogue names against 276 captions):

| never featured | last featured before 2026-05 |
|---|---|
| Bea, Fiona, Jane, Layla | Heather 2025-12-17 · Thia 2025-12-22 · Jules 2026-02-03 · Lydia 2026-02-22 · Jen 2026-02-22 · Maya 2026-03-08 · Sam 2026-03-14 · Nora 2026-04-07 · Sadie 2026-04-18 · Kate 2026-04-22 |

Two hazards, both already solved elsewhere in the codebase:
- **Brand/founder collisions.** `ivy` (84 hits) is the brand; `sally` (64) is both the founder's name and
  a real product family. `deriveBrandTokens` (`validate-catalogue.ts:44`) and the `ambiguousNames` set
  used by `indexCatalogue` (`:69`) exist precisely for this and must be reused, not reinvented.
- **Parser artefacts.** One catalogue name reads `Erin Midweight` where `Erin` is the family — a
  `parse-catalogue.ts` style-modifier edge case. Never-featured claims should be suppressed for names
  that are a prefix of another catalogue name.

Cost: catalogue blob (9.6 kB, already-queried row) + the caption array already in memory. Computable
**in-process, zero extra queries**, or as one SQL statement.

### (b) Under-served pillars — **CHEAP, with a caveat**

`ig_posts` has no pillar column, so historical pillar share can only come from
`content_cycle_posts.pillar` — what Sprigly *planned*, not what she *posted*. Live:

| pillar | planned | share | equal target |
|---|---|---|---|
| Stable Foundations | 16 | 21.6% | 14.3% |
| Simplify Your Morning | 9 | 12.2% | 14.3% |
| Ethical Without Compromise | 9 | 12.2% | 14.3% |
| A Supportive Friend… | 7 | 9.5% | 14.3% |
| Born From Real Need | 7 | 9.5% | 14.3% |
| Understands Real Women | 6 | 8.1% | 14.3% |
| Personal Relationships | 6 | 8.1% | 14.3% |
| *(New idea / Weather)* | 14 | 18.9% | — |

Cost: one query, `(scheduled_date, pillar)` only, ~2 kB. Cheap.

**But the target it is measured against does not exist.** No Ivy T pillar carries `sharePct`, so
`resolvePillarWeights` returns `basis: 'equal'` and every pillar's target is 14.3% by default. An
"under-served" claim against a default is a claim about arithmetic, not about the client. This is the one
computation of the four that is cheap to run and weak to cite until pillar weights are real. Do not
backfill them with a model call — `pillar-weights.ts:5-15` is right about why.

### (c) Recurring formats due — **CHEAP, and the highest-value gap**

Two independent sources agree, which is what makes this citable:

| series | last in PLAN (`content_cycle_posts.source_meta.category`) | last in CAPTIONS (`ig_posts`) | occurrences in captions |
|---|---|---|---|
| Sunday Style | 2026-07-19 (Jun 4, Jul 2, Aug 0) | 2026-07-26 | 23 |
| WSG | 2026-07-31 (Jun 4, Jul 3, Aug 0) | 2026-07-31 | 25 |
| Notes from the Founder | 2026-07-23 | 2026-06-26 | 3 |
| What our customers see | 2026-07-29 | never (phrase not used in captions) | 0 |

Sunday Style is declared weekly (`dayOfWeek: 'Sunday'`) and has run ~4×/month. September's draft contains
zero. Computing "due" is `dayOfWeek` matched against the month's calendar — the same `weekdayOf` helper
`spreadDates` already uses (`draft-skeleton.ts:69`). Caption matching is a `LIKE` on data already loaded.

Cost: one query on `content_cycle_posts` + in-memory caption scan. **Cheap.**
Prefer the plan-history source as primary (it is a structured `category` field, not a phrase match) and
the caption source as corroboration.

### (d) Format / topic engagement leaders — **format CHEAP, topic MEDIUM, per-post attribution NOT FEASIBLE**

- **Format:** already computed. Reel 183 posts @ 42.1; carousel 86 @ 31.9; image 7 @ 21.1.
- **Topic/product:** the query in (a) already returns `avg_eng` per product name. Live leaders (n ≥ 5):
  Sophie 82.5 (n=6) · Joy 51.4 (n=5) · Arabella 50.9 (n=7) · Ivy 45.1 (n=84) · Nancy 40.8 (n=30).
  Small-n is the hazard — Nora 143.0 is a single post. Any surfaced claim needs a sample floor; the
  codebase already sets one at `DRAFT_MIN_POSTS = 15` (`draft-skeleton.ts:25`) for a comparable decision.
- **Per-post attribution ("how did the post we planned for 24 July do?") is NOT feasible.** `ig_posts`
  stores no post id and no permalink (confirmed: exactly five keys on all 276 rows), so the only join key
  is the date, and it does not hold: over 2026-06-01→now, 44 dates carry both a plan post and an IG post,
  15 dates carry an IG post with no plan post, 18 carry a plan post with no IG post — and multiple posts
  land on the same day. **Do not build a "which of our beats performed" loop on a date join.** Any
  engagement evidence must stay at the aggregate level ig_posts can actually support.

---

## 4. The honesty constraint

Every beat carries structured, non-prose evidence (`BeatRationaleEvidence`,
`packages/db/src/schema.ts:982-1007`), and the reason it is structured rather than prose is stated at
`:975-977`: prose would make the phrasing pass's output indistinguishable from its input. Any new input
must yield the same kind of artefact. Concretely, per proposal:

| Input | New evidence field (proposed) | Live example, verbatim from UAT |
|---|---|---|
| Catalogue × captions | `productCoverage: { product, lastFeatured \| null, mentions }` | `{ product: 'Jules', lastFeatured: '2026-02-03', mentions: 5 }` → *"Jules — not featured since 3 February"* |
| " (never) | same, `lastFeatured: null` | `{ product: 'Fiona', lastFeatured: null, mentions: 0 }` → *"Fiona has never appeared in a caption"* |
| Recurring series | `seriesDue: { name, dayOfWeek, lastPlanned, monthsObserved }` | `{ name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-19', monthsObserved: 2 }` → *"Sunday Style last ran 19 July; it is a weekly series"* |
| Plan-history pillar share | `pillarObserved: { planned, of, sharePct }` | `{ planned: 6, of: 74, sharePct: 8.1 }` → *"Personal Relationships was 8% of the last three months' plan"* |
| Backlog idea | fix `sourceRef` to the real `plan_inputs.id`; add `candidateRank.lifecycle` | *"You asked for this in June and it hasn't run yet"* |
| Topic engagement | `topicEngagement: { term, avgEngagement, posts, clientAvg }` | `{ term: 'Sophie', avgEngagement: 82.5, posts: 6, clientAvg: 38.6 }` → *"Sophie posts average 83 against your 39"* |

Rules that must hold, drawn from what the current design already enforces:

1. **Absence is a value.** `lastFeatured: null` and `basis: 'template'` (`draft-assembly.ts:100-107`) are
   the model. Never emit a zero where the honest answer is "not observed" — this is exactly the
   distinction `observeFormats` protects at `draft-history.ts:99-102`.
2. **Sample size travels with the number.** `formatEngagement` already carries `posts`
   (`schema.ts:994`). Any new engagement figure carries its `n` or is not emitted.
3. **The phrasing contract must widen, not open.** The correct change is to pass the *evidence* into
   `buildUserMessage` (`draft-phrasing.ts:105`) and relax `FORBIDDEN` (`:48-56`) **only** for facts the
   beat actually holds — i.e. validate a named product against that beat's own `productCoverage`, not
   against a blanket allow. A product name in a title with no `productCoverage` in its evidence must
   still be rejected by `validatePhrasing`, and rejection must still fail the whole batch (`:88-92`).
4. **The date/`launch`/`restock` bans stay unless the brief supplies them.** Ivy T's September cycle has
   `structured_brief = NULL`; on that month, "launch" remains a fabrication and the existing regexes are
   correct.
5. **The catalogue assumption must state use, not existence** (§1.6).

---

## 5. Recommendation — smallest build, ordered by value per effort

Every item below is reachable from `assembleAndPersistDraft` today. Combined new I/O: **one query.**

**A. Widen the phrasing prompt to carry the evidence the beat already has.**
`buildUserMessage` (`draft-phrasing.ts:105-121`) currently discards `formatEngagement`, `cadenceBasis`,
`slotType`, `assumptions` and `sourceRef` — they are all on the `DraftBeat` it is handed. This is a
one-function change with no new reads, and it is the prerequisite for every item below: without it, a
richer assembler produces the same generic titles. *Value: high. Effort: hours.*

**B. Turn on the backlog.** Not a new feature — a stale comment and a hardcoded `null`.
- Add `id` and `lifecycle` to `loadDurableInputs`'s select (`intake-signals.ts:106-115`), so
  `beat_meta.sourceRef` is a real `plan_inputs.id` and `lifecycle='used'` rows can be deranked.
- Give `temperature` a value at `draft-plan.ts:207`.
- Correct `draft-allocator.ts:11-15` and `draft-assembly.ts:130`: the backlog is not empty; UAT has 20
  in-window `type='idea'` rows for September, 6 never used.
  Six of thirty September beats would immediately carry her own words. *Value: very high. Effort: hours.*

**C. Schedule the recurring series.** Select `recurringSeries` and `postingTimes` alongside `pillars` at
`draft-plan.ts:171-175` (same query), place each series on its `dayOfWeek` before the general spread, and
write `category`, `whoPosts`, `postingTime` into `sourceMeta` as the old planner did. This alone restores
"Sunday Style" and "WSG" to a month that currently has neither, and it is the single largest visible
difference between the September draft and the June/July plans. *Value: very high. Effort: 1–2 days —
the placement interacts with `spreadDates`/`spreadFormats`, which is the only non-trivial part.*

**D. Catalogue coverage grounding.** Change `.select({ id })` to `.select({ catalogue })` at
`draft-plan.ts:177-181` and compute product coverage against the captions already in memory (§3a),
reusing `deriveBrandTokens`/`ambiguousNames`. Attach `productCoverage` to beats and let a validated
phrasing pass name the product. *Value: high. Effort: 2–3 days — the collision handling is where the
care goes.*

**E. Plan-history read.** One new query on `content_cycle_posts` (`scheduled_date, format, pillar,
source_meta`, `excludeDraftPosts()`, ~12 kB) to supply series cadence corroboration and observed pillar
share. *Value: medium. Effort: 1 day.* Defer if C and D land — its main output is (b), which is the
weakest of the four analyses while pillar weights remain default.

**Explicitly not recommended:** any per-post engagement attribution joining `ig_posts` to
`content_cycle_posts` (§3d), and any backfill of `sharePct` via a model call (`pillar-weights.ts:5-15`).

### Must NOT change

- **Slot count.** 30 for September, from `slotCountFor` (`draft-skeleton.ts:132`) and the client-stated
  floor (`:145`). Series placement must *occupy* slots, never add them.
- **Cadence derivation.** Observed 7.48/wk over 10 months, `cadenceBasis.source = 'observed'`. New inputs
  reorder and re-subject slots; they do not change when the month posts.
- **Temperature semantics.** Allocation-only, never a model sampling temperature
  (`draft-allocator.ts:1-17`). Item B sets its value; it does not redefine it.
- **Replacement pool policy.** `replacementTier` (`draft-transforms.ts:118-129`) — client-touched and
  client-added are `null` (never replaceable), tier 2 is last-resort-oldest-first, and `POOL_EMPTY_NOTE`
  (`:196`) is the one refusal sentence. New evidence changes `byWeakestEvidence`'s *inputs*; the tier
  ordering and the immunities do not move.
- **Determinism.** No `Date.now()`, no randomness, every sort with an explicit final tiebreak
  (`draft-skeleton.ts:1-12`). Caption scanning and coverage joins must sort by a total key.
- **Phrasing never blocks.** One call, one retry, whole-batch rejection, fallback to deterministic titles
  (`draft-phrasing.ts:16-19, 88-92, 143-159`).
- **The draft fence.** `status='draft'` rows stay invisible to plan readers via `excludeDraftPosts()`
  (`schema.ts:1129-1132`) — including to any new history read the assembler itself performs.

### Stale comments to correct while in the file

- `draft-history.ts:16-18` and `draft-assembly.ts:90-92` — the `mediaType` gap is closed: 276 of 276
  Ivy T posts are typed.
- `draft-allocator.ts:11-15`, `draft-assembly.ts:130` — the idea backlog is not empty.
