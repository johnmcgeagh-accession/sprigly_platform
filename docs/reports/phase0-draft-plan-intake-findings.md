# Phase 0 — Draft-Plan & Intake Arc: Investigation Findings

**Date:** 2026-07-20
**Branch:** `dev`
**Mode:** Read-only investigation. No code, schema, migration, config, or test file was created or modified. No migrations run, no jobs started, no external APIs called (no Apify runs, no Bedrock calls). All database access was `SELECT` / `\d` against the **dev** database (`DATABASE_URL` from `.env.local`, host `hayabusa.proxy.rlwy.net`).

**Sandbox client note:** the brief named `earlofeastlondon`. The actual slug in the database is **`earl-of-east`**. Clients present: `earl-of-east`, `ivy-t`, `sprigly`.

---

## Headline

**I-2 is a seam, not a refactor.** The system already contains a working, shipped, per-post generation path that reads a fixed `content_cycle_posts` row, generates content only, and writes back content only — `shape.ts` for captions, `hook.ts` / `script.ts` / `refine.ts` for hooks and scripts. Hooks and scripts have *never* been produced by the planning run; per-post is their only granularity. What does not yet exist is the orchestrator that materialises an approved beat list into rows and fans those existing jobs out, plus one code-level guard to make structure genuinely immutable rather than merely requested in a prompt.

The two significant negatives found: **pillar weights do not exist anywhere in the database** (I-1), and **`structured_brief.schedule` is a sparse subset of the plan, not a plan skeleton** (I-2) — 12 beats against 31 posts for ivy-t's August cycle.

---

# I-1 — Draft-assembly inputs

## 1. The onboarding CLI's derivations

**Entrypoints:** CLI at `engine/src/onboarding/onboard-client-cli.ts` (220 lines); testable core at `engine/src/onboarding/onboard.ts` (572 lines).

Stages C–F are invoked at `onboard-client-cli.ts:155-167`:

```ts
155  const voice   = await deriveVoiceProfile({ model, captions, brandName: name, channel });
156  const pillars = await derivePillars({ model, captions, brandName: name });
157  const cadence = computeCadence(timestamps);
158  const mix     = computeFormatMix(mediaTypes);
...
164  await writePlanningConfig(db, clientId, channel, {
165    pillars: toConfigPillars(pillars.pillars), cadence: cadence.cadence,
166    categories: DEFAULT_CATEGORIES, registerMap: DEFAULT_REGISTER_MAP,
167  });
```

The core file's header (`onboard.ts:1-11`) states each stage is individually runnable with injected `db` + `model`. That holds — the derivation functions are not CLI-entangled. The entanglement is in **what the CLI does with the output**.

### 1a. Pillar classification — does not exist as classification

| | |
|---|---|
| Logic | `onboard.ts:339-351` `derivePillars()` — one Bedrock Sonnet call over the whole caption corpus |
| Prompt | `onboard.ts:312-317` (`PILLARS_SYSTEM`) |
| Parser | `onboard.ts:323-337` `parsePillarsResponse()` — deterministic, pure |
| Output lands | `client_planning_config.pillars` (JSONB) via `toConfigPillars()` → `writePlanningConfig()` (`onboard.ts:355-357`, `378-397`) |
| Per-cycle invocable? | Mechanically yes; blocked in substance — see below |

**Blocker 1 — it is not per-post.** The model receives the flat caption list (`onboard.ts:341-348`) and returns corpus-level pillars. No caption is ever labelled; nothing writes a pillar back onto an `ig_posts` post object.

**Blocker 2 — the weight is computed then discarded.** The model *does* return `sharePct` (`onboard.ts:314`), and `DerivedPillar` carries it (`onboard.ts:319`). `toConfigPillars` drops it:

```ts
// onboard.ts:355-357
export function toConfigPillars(derived: DerivedPillar[]): Pillar[] {
  return derived.map((p) => ({ name: p.name, tagline: p.description, keyMessages: [], contentIdeas: [] }));
}
```

The comment at `onboard.ts:353-354` is explicit: *"share is kept only in the review file"*. `sharePct` survives only into `pillars.json` / `review-summary.md` in `os.tmpdir()/sprigly-onboarding/<slug>/` (`onboard-client-cli.ts:183, 195, 205`).

Proven against live data — no `sharePct` key exists on any stored pillar:

```sql
SELECT c.slug, k, count(*) FROM client_planning_config cpc JOIN clients c ON c.id=cpc.client_id,
LATERAL jsonb_array_elements(cpc.pillars) p, LATERAL jsonb_object_keys(p) k GROUP BY 1,2 ORDER BY 1,2;
```
```
     slug     |      k       | count
--------------+--------------+-------
 earl-of-east | contentIdeas |     5
 earl-of-east | keyMessages  |     5
 earl-of-east | name         |     5
 earl-of-east | tagline      |     5
 ivy-t        | contentIdeas |     7
 ivy-t        | keyMessages  |     7
 ivy-t        | name         |     7
 ivy-t        | tagline      |     7
```

**There is no pillar weight in the database for any client.** A draft assembler needing pillar weights must either re-run `derivePillars` (a non-deterministic model call) or build per-post classification that does not exist.

### 1b. Cadence — clean, deterministic, ready

| | |
|---|---|
| Logic | `onboard.ts:81-101` `computeCadence(timestamps: string[]): CadenceResult` |
| Purity | Fully pure — no db, no model, no I/O. Header `onboard.ts:79-80`: *"Deterministic — NO model call."* |
| Output lands | `client_planning_config.cadence` (JSONB) |
| Per-cycle invocable? | **Yes, immediately** — takes a bare `string[]` |

```
 earl-of-east | instagram | {"maxPerWeek": 4, "minPerWeek": 3, "postsPerMonthMax": 15, "postsPerMonthMin": 12}
 ivy-t        | instagram | {"maxPerWeek": 5, "minPerWeek": 3, "postsPerMonthMax": 20, "postsPerMonthMin": 16}
```

One behaviour to know before reuse — `onboard.ts:90-91`:

```ts
const weeks = Math.max(windowDays / 7, 1 / 7);
const rawPerWeek = postCount / Math.max(weeks, 1);   // clamp weeks≥1
```

`weeks` is floored at `1/7` on line 90 then re-clamped to `≥1` on line 91, so the first floor is dead. Any window under 7 days is treated as a full week, deflating the rate. Deliberate for onboarding (inline comment: *"so a 1-week burst doesn't explode the rate"*), but for a **per-cycle** assembler on a single month's window this materially compresses short months.

### 1c. Format mix — clean function, output goes nowhere

| | |
|---|---|
| Logic | `onboard.ts:112-122` `computeFormatMix(mediaTypes: Array<string \| undefined>): FormatMix` |
| Purity | Fully pure (`onboard.ts:110`: *"Deterministic — no model call."*) |
| Output lands | **Nowhere in the database** |

The mix becomes a display string (`onboard-client-cli.ts:159-161`), is printed to console (`:210`), and embedded in `review-summary.md` (`:192`). `writePlanningConfig` (`onboard.ts:374-397`) has no format-mix field; `PlanningConfigWrite` is `{ pillars, cadence, categories, registerMap }` only.

Call-site sweep confirms nothing downstream consumes it:

```
grep -rn "formatMix\|imagePct\|reelPct\|carouselPct" --include="*.ts" . | grep -v node_modules
→ onboard.test.ts:81,86,92 (tests) · onboard-client-cli.ts:160 (display) · onboard.ts:106,121 (definition)
```

The planning prompt (`planning.ts:288-297`) passes pillars, cadence, recurring series, posting times, categories — **no format mix**.

### 1d. Per-cycle invocability — the real blocker

A full sweep for `computeCadence | computeFormatMix | derivePillars | loadIgPostsWindow | toConfigPillars | THIN_CAPTION_FLOOR` finds every non-test hit in `onboard.ts` (definitions) or `onboard-client-cli.ts` (the single call site). **No per-cycle path calls any of them.**

What *does* run per cycle is the trawl only — `ig-trawl`, enqueued from `admin/src/app/admin/clients/[id]/actions.ts:225, 252, 437`, executing `engine/src/ig-producer.ts`. It fetches 50 posts, filters to one target month (`ig-producer.ts:143`), upserts that month's `ig_posts` row (`:186-192`), and re-derives nothing. Cadence, pillars, and format mix are computed once at onboarding and frozen.

### 1e. Smallest extractable functions

`computeCadence` and `computeFormatMix` need **no extraction** — already exported, pure, dependency-free.

The one function genuinely needed is the reader:

```ts
// onboard.ts:234
export async function loadIgPostsWindow(
  db: Db, clientId: string, channel: string
): Promise<{ captions: string[]; timestamps: string[]; mediaTypes: string[]; postCount: number; months: string[] }>
```

Dependencies: `drizzle-orm` (`eq`, `and`) and `igPosts` from `@sprigly/db`. No model, no Apify, no Drive, no filesystem. Already reused by `--skip-trawl` and `--calibrate` (`onboard-client-cli.ts:54, 138`).

**Its gap:** it flattens to three *parallel arrays* and drops `likesCount`/`commentsCount` entirely (`onboard.ts:243-248`), reads every month with no window bound, and returns no per-post correlation — you cannot tell which `mediaType` belongs to which `timestamp`. A sibling returning intact rows plus a month filter is ~15 lines:

```ts
loadIgPosts(db: Db, clientId: string, channel: string, months?: string[]): Promise<Array<IgPost & { month: string }>>
```

`IgPost` is already exported from `engine/src/lean-line.ts:164`.

## 2. Engagement metrics

**Schema** — `packages/db/src/schema.ts:876-888`: `ig_posts` is `clientId`, `channel`, `month` (YYYY-MM), `posts` (JSONB array), unique on `(client_id, channel, month)`.

**Element contract** — `engine/src/lean-line.ts:156-165` (`igPostSchema`), a *closed* Zod object:

```ts
timestamp: z.string(),
caption: z.string().optional(),
likesCount: z.number().int().nonnegative(),
commentsCount: z.number().int().nonnegative(),
mediaType: z.enum(['image', 'reel', 'carousel']).optional(),
```

**Actual stored keys**, enumerated rather than assumed (33 rows returned; exactly five distinct keys ever appear): `caption`, `commentsCount`, `likesCount`, `mediaType`, `timestamp`. Every `earl-of-east` month carries all five. **ivy-t 2026-05 and 2026-06 have no `mediaType` key at all** (3 and 28 posts); only 2026-07 (19 posts) has it — consistent with the schema comment at `schema.ts:868`.

Representative element (`earl-of-east` 2026-04):

```json
{
  "caption": "Reintroducing our core collection. Six scents, each defined as a complete world...",
  "mediaType": "image",
  "timestamp": "2026-04-08T10:44:59.000Z",
  "likesCount": 124,
  "commentsCount": 4
}
```

### What is missing

- **No post id, no permalink, no URL.** There is therefore **no join key** from a published post to anything else in the system.
- **No views, reach, saves, shares, impressions.** `videoViewCount` *is* returned by Apify (declared on `RawApifyPost`, `engine/src/apify-ig-fetch.ts:29`) but dropped by every writer: `onboard.ts:205`, `ig-producer.ts:151-159`, `admin/src/lib/ingest/ingest-ig.ts:44-51`. Reel performance is invisible; a reel and a static image are compared on likes alone.
- **No pillar.** Verified 0 across all clients.

Engagement is defined throughout as `likesCount + commentsCount` — `lean-line.ts:229`, `planning.ts:347`.

`content_cycle_posts` (`schema.ts:943-972`) *does* carry `pillar` and `format` — but these are *planned* posts, not published ones, and the table holds no engagement column. With no post id on either side, **per-pillar engagement is structurally unreachable, not merely unimplemented.**

### Verdict

- **Per-format engagement: computable today, deterministically. Yes.**
- **Per-pillar engagement: NOT computable today, by any query.**

### Candidate query, RUN against `earl-of-east`

```sql
WITH p AS (
  SELECT ip.month,
         COALESCE(e->>'mediaType','(untyped)') AS media_type,
         (e->>'likesCount')::int    AS likes,
         (e->>'commentsCount')::int AS comments
  FROM ig_posts ip
  JOIN clients c ON c.id = ip.client_id
  CROSS JOIN LATERAL jsonb_array_elements(ip.posts) e
  WHERE c.slug = 'earl-of-east' AND ip.channel = 'instagram'
)
SELECT media_type, count(*) AS posts,
       round(100.0*count(*)/sum(count(*)) OVER (),1) AS pct_of_mix,
       sum(likes+comments) AS total_engagement,
       round(avg(likes+comments),1) AS avg_engagement,
       round(avg(likes),1) AS avg_likes,
       round(avg(comments),1) AS avg_comments,
       max(likes+comments) AS max_engagement
FROM p GROUP BY media_type ORDER BY posts DESC;
```

```
 media_type | posts | pct_of_mix | total_engagement | avg_engagement | avg_likes | avg_comments | max_engagement
------------+-------+------------+------------------+----------------+-----------+--------------+----------------
 image      |    23 |       74.2 |              879 |           38.2 |      37.7 |          0.6 |            128
 carousel   |     8 |       25.8 |              559 |           69.9 |      66.3 |          3.6 |            167
(2 rows)
```

This single query yields **both** the format mix (`pct_of_mix`, matching `computeFormatMix`'s denominator = typed posts) and per-format engagement. Note `earl-of-east` has posted **zero reels** in the window, so the reel row is *absent* rather than zero — an assembler must handle missing format rows, not assume three.

Per-month cadence, also deterministic and RUN:

```
  month  | posts |   first    |    last    | posts_per_week
---------+-------+------------+------------+----------------
 2026-04 |     4 | 2026-04-04 | 2026-04-29 |           1.13
 2026-05 |    13 | 2026-05-05 | 2026-05-31 |           3.50
 2026-06 |    11 | 2026-06-01 | 2026-06-25 |           3.20
 2026-07 |     3 | 2026-07-02 | 2026-07-10 |           2.63
```

(2026-07 is partial — trawled on or after 2026-07-10.) This reproduces `computeCadence`'s arithmetic in SQL including the ≥1-week clamp, so cadence can be done in SQL without the TypeScript.

## 3. Thin-data floor

```sql
SELECT c.slug, count(DISTINCT ip.month) AS ig_posts_rows, count(e.*) AS posts_total,
       count(*) FILTER (WHERE e->>'mediaType' IS NOT NULL) AS with_mediatype,
       count(*) FILTER (WHERE btrim(coalesce(e->>'caption','')) <> '') AS with_caption,
       count(*) FILTER (WHERE e ? 'pillar') AS with_pillar
FROM clients c
LEFT JOIN ig_posts ip ON ip.client_id=c.id AND ip.channel='instagram'
LEFT JOIN LATERAL jsonb_array_elements(ip.posts) e ON true
GROUP BY 1 ORDER BY 1;
```
```
     slug     | ig_posts_rows | posts_total | with_mediatype | with_caption | with_pillar
--------------+---------------+-------------+----------------+--------------+-------------
 earl-of-east |             4 |          31 |             31 |           31 |           0
 ivy-t        |             3 |          50 |             19 |           50 |           0
 sprigly      |             0 |           0 |              0 |            0 |           0
```

Month spans: `earl-of-east` 2026-04 → 2026-07 (31 posts); `ivy-t` 2026-05 → 2026-07 (50 posts).

### On "classified"

**No post is pillar-classified anywhere — 0 of 81 across all clients.** The only classification on a post is `mediaType` (format):

- **earl-of-east: 31/31 (100%)** — clean.
- **ivy-t: 19/50 (38%)** — the 31 unclassified are 2026-05/2026-06 (pre-`mediaType`). ivy-t's format mix would therefore derive from a **38% sample skewed entirely to the most recent month**, reported as authoritative: `computeFormatMix` silently uses `counted` as its denominator (`onboard.ts:119-121`) and surfaces no coverage warning; the CLI prints only *"(over N typed posts)"* (`onboard-client-cli.ts:160`).
- **sprigly: no `ig_posts` rows at all.**

### The one enforced minimum

`THIN_CAPTION_FLOOR = 15` — `onboard.ts:28`, rationale at `onboard.ts:25-27`. Applied at `onboard.ts:225`, enforced at `onboard-client-cli.ts:147-151` (exit code 2 unless `--force-thin`).

Three limits on that floor:

1. **It counts captions only** — never posts-with-`mediaType`, never timestamp span. A client with 20 captions but 3 typed posts passes with a format mix built on n=3.
2. **It gates only the trawl path.** `--skip-trawl` (`onboard-client-cli.ts:137-140`) reads from `ig_posts` and never checks the floor. `--calibrate` requires only `captions.length > 0` (`:55`).
3. **It is enforced nowhere else in the system.** No per-cycle path, no planning gate, no critic imposes any minimum post count.

### Degradation profile

| Derivation | Fails at | Degrades at | Enforced? |
|---|---|---|---|
| Cadence | 0 posts → all-zero `Cadence` (`onboard.ts:84-86`), written to config as-is | <2 posts → `windowDays=0`; any window <7 days → rate deflated by the ≥1 clamp (`onboard.ts:91`) | **No** |
| Format mix | 0 typed posts → all-zero mix (`onboard.ts:120`), indistinguishable from "genuinely no reels" | Partial `mediaType` coverage silently narrows the denominator — ivy-t at 38% today | **No** |
| Pillars | 0 captions → model still called with an empty list; no guard | <15 captions per the floor's own rationale | Onboarding trawl path only; bypassed by `--skip-trawl`/`--calibrate` |
| Per-format engagement | 0 typed posts → no rows | Small-n: earl-of-east's carousel figure rests on **n=8** | **No** |

**Against the sandbox:** earl-of-east's 31 posts clear the 15-caption floor, but per-format engagement rests on n=23 image / n=8 carousel / **n=0 reel**, and monthly cadence ranges 1.13–3.50 posts/week across four months — a 3× swing that makes single-month cadence volatile. A per-cycle assembler reading one month of earl-of-east would see 3 posts (2026-07), well under any reasonable floor.

**Structural ceiling:** `APIFY_RESULTS_LIMIT = 50` (`onboard.ts:31`, mirrored in `ig-producer.ts`). History is capped at the 50 most recent posts regardless of account age. ivy-t sits exactly at 50 — its history is **truncated**, and its 2026-05 row holds only 3 posts, a clipping artefact rather than a real cadence. Any cadence derived over ivy-t's full window is wrong at the old end.

**UNVERIFIED:** the behaviour of `derivePillars` with an empty or near-empty caption array against a live model (no Bedrock calls permitted). That no guard exists is proven by inspection (`onboard.ts:339-351` has no length check); the resulting model behaviour is not.

---

# I-2 — Generation pipeline seam (PRIORITY)

## 1. How the generate-plan path consumes schedule beats today

**Answer: advisory context, rendered as prompt text. There is no code that maps beats → generated posts.**

`BriefScheduleBeat` appears in exactly three non-dist files:

```
packages/engine/src/brief-extract.ts:28, 233   (extraction)
packages/engine/src/types.ts:280, 309          (type definition)
packages/engine/src/index.ts:60                (re-export)
```

It appears **nowhere** in `engine/src/content-cycles/`. The planning worker never destructures a beat.

The single consumption point is `renderStructuredBriefSection` (`planning.ts:201-233`), called once at `planning.ts:282` inside `buildPlanningUserMessage`. Beats become lines of text (`planning.ts:206-213`):

```ts
const schedule = sb.schedule.map((b) => {
  const who = [b.product, b.colourway].filter(Boolean).join(' ');
  const when = b.dateRange ? `${b.dateRange.start} to ${b.dateRange.end}` : b.date;
  return `  - ${when} (${b.type})${who ? ` — ${who}` : ''}: ${b.note}`;
}).join('\n');
```

Wrapped in strongly-worded but non-binding framing (`planning.ts:222`):

> `FIXED DATED BEATS (authoritative schedule — use THESE dates exactly; do not invent, shift, or de-collide dates. …)`

The word "authoritative" is doing prompt work, not code work. The entire plan — dates, formats, pillars, slot count, captions — comes from **one streaming Bedrock call** (`planning.ts:812-817`) parsed by `parsePlanResponse` (`parse-plan.ts:15`). Nothing verifies that the returned dates match the beats.

The only other structural consumer of `structuredBrief` is `surfaceConflicts` (`planning.ts:247-260`), which appends ⚠️ reviewer notes post-generation, and `indexCatalogue` for product grounding (`planning.ts:471`).

### Beats are a sparse subset, not a plan skeleton — the most consequential finding

```sql
select c.slug, cc.cycle_month, cc.status,
       jsonb_array_length(coalesce(cc.structured_brief->'schedule','[]'::jsonb)) as beats,
       (select count(*) from content_cycle_posts p where p.cycle_id=cc.id and p.deleted_at is null) as posts
from content_cycles cc join clients c on c.id=cc.client_id order by c.slug, cc.cycle_month;
```
```
     slug     | cycle_month |     status     | has_brief | beats | posts
--------------+-------------+----------------+-----------+-------+-------
 earl-of-east | 2026-07     | workbook_built | t         |     0 |    12
 earl-of-east | 2026-08     | workbook_built | t         |     0 |    13
 ivy-t        | 2026-05     | workbook_built | t         |    19 |    28
 ivy-t        | 2026-06     | workbook_built | t         |     7 |    31
 ivy-t        | 2026-07     | workbook_built | t         |    12 |    31
 sprigly      | 2026-07     | scheduled      | t         |     3 |     1
 sprigly      | 2026-08     | scheduled      | f         |     0 |     0
```

**earl-of-east has a persisted brief with zero beats in both cycles** yet produced 12 and 13 posts. ivy-t's July cycle has 12 beats against 31 posts. Beats today are *client-briefed dated asks* — a handful of launches and recurring series — not a month structure. A draft plan needs a beat per slot (~31); `structured_brief.schedule` carries roughly a third of that, and for one live client, none.

### In practice the model does comply

ivy-t 2026-07 cycle (target month August), beats vs generated post titles:

```
 beat 2026-08-02 sunday-style        → post 2026-08-02 carousel "Sunday Style — 3 x Erin T-Shirts"
 beat 2026-08-15 factory-feature     → post 2026-08-15 carousel "Factory Feature — Portugal Summer Shutdown"
 beat 2026-08-28 launch              → post 2026-08-28 reel     "The Navy Edit — Launch Post"
 beat 2026-08-28 weekend-style-guide → post 2026-08-28 carousel "WSG — Hannah T-Shirt Navy (Launch Day)"
 beat 2026-08-30 sunday-style        → post 2026-08-30 carousel "Sunday Style — The Navy Edit Part 1"
```

Beats *are* honoured — including the legitimate two-beats-one-date case on 28 Aug. But by prompt compliance alone. Nothing would detect or repair a miss.

## 2. Can the pipeline act as "phase 2"? Where is the seam?

**Yes — and the pattern is already shipped.** `shape.ts` is precisely a fixed-structure, content-only generator, at post granularity.

`engine/src/content-cycles/shape.ts:1-10` states the contract outright:

> *"Rewrites a single post's caption from a client instruction ("make it softer"), reusing the EXACT planning generate + validate machinery (`assembleShapeContext` → `regeneratePost` → `applyCodeGate` → `applyCritic` → catalogue)… **Writes ONLY the caption (+ status='edited'); structural fields are Phase 2's job.**"*

Its flow (`shape.ts:52-178`): load cycle + one post → `assembleShapeContext` → reconstruct a `PlanPostRow` from the stored row (`shape.ts:75-90`) → `regeneratePost` with the instruction as feedback → `applyCodeGate` → `applyCritic` → catalogue validation → write back **caption and status only** (`shape.ts:139-145`).

The date, format, pillar, and position on the `content_cycle_posts` row are never written. They are inputs.

### The function boundaries that constitute the seam

| Boundary | Location | Role in a phase-2 design |
|---|---|---|
| `assembleShapeContext(cycle, deps)` | `planning.ts:423-600` | **Pure reads, no Bedrock, no writes** (stated `planning.ts:415-419`). Loads config, gather, catalogue, voice, prompts, critic context. Reusable verbatim. |
| `regeneratePost(post, feedback, ctx, trace?)` | `plan-validation.ts:195-262` | Single-post generation. Exported *specifically* so shape can drive it (`:192-194`). |
| `applyCodeGate` / `applyCritic` | `plan-validation.ts:274`, `:563` | Per-post loops, 1:1 row preservation. |
| `applyCatalogueValidation` | `catalogue/validate-catalogue.ts` | Deterministic caption rewrite. |
| `addGeneratingPost` | `app/src/lib/mutations.ts:182-211` | **Creates a row with fixed date/format/pillar and empty caption, status `'generating'`.** |
| `startPostGeneration` | `app/src/lib/post-generation.ts:21-41` | Enqueues the shape job for such a row. |

`addGeneratingPost` + `startPostGeneration` is already, today, "materialise a fixed slot, then generate content into it." That is the phase-2 primitive, in production, at n=1.

### The smallest change that would make beats authoritative

1. **A beat→row materialiser.** Insert one `content_cycle_posts` row per approved beat with `scheduled_date`, `format`, `pillar`, `position` set and `caption` null — the `addGeneratingPost` shape generalised to a batch. New code, but small and non-invasive.
2. **A fan-out over the existing per-post path.** Enqueue shape (caption), then hook, then script per row. All three job types, their routes, and their idempotency already exist (see I-3).
3. **One structural guard in `regeneratePost`** — see §3. Three lines.

Nothing in `assembleShapeContext`, `plan-validation.ts`, or the catalogue validator needs to change.

## 3. Critic / gate / repair versus structure

### What the gate checks — and does not

`codeGateCheck` (`plan-validation.ts:125-159`) checks exactly five things, all caption- or vocab-related: `instruction-leak`, `em-dash`, `empty-caption`, `invalid-category`, `invalid-pillar`.

**It never checks `date`, `day`, `format`, `postingTime`, or slot count.** There is no structural validation anywhere in the loop.

### Slot count is safe; per-row structure is not

Both loops preserve row count 1:1 — `applyCodeGate` (`plan-validation.ts:274-329`) and `applyCritic` (`:563-605`) each iterate the input array and `out.push(post)` exactly once per index. Slot count cannot drift after generation.

**But `regeneratePost` replaces the whole row object.** It returns `parseSinglePost(result.content)` (`plan-validation.ts:243`) — the model's fresh JSON — and callers assign it wholesale (`plan-validation.ts:291`: `post = await regeneratePost(...)`). Structure is preserved *only* by asking, at `plan-validation.ts:214`:

> `'Return the corrected post as a SINGLE JSON object with the same field names. Keep date, day, title, format, postingTime and whoPosts unchanged unless a problem requires changing them…'`

**So yes — a repair path can currently mutate structure**, and nothing would detect it. This is the one genuine correctness gap for a fixed-beat design, and it already exists today for the plain planning run.

**The fix is three lines** at the `regeneratePost` return, merging the structural fields from the input over the model output:

```ts
return { ...after, date: post.date, day: post.day, format: post.format, postingTime: post.postingTime };
```

That makes structure immutable in code rather than in prose, for both the planning loop and the shape handler, with no signature change.

### What a critic would still need to check with beats fixed

Everything it checks now — all of it is caption-level and orthogonal to structure: voice/register against `voice.md` and `register_map`, sign-off, pillar-voice consistency, the `clientWritesOwn` flag, instruction leaks, em-dashes, and catalogue product/colourway validity. The critic never reasons about dates or cadence. Fixing structure removes nothing from its job.

What would become newly checkable (and does not exist today): **did the generated caption actually serve its beat?** Nothing verifies caption-to-beat fidelity, because nothing associates a caption with a beat.

## 4. Seam or refactor?

**Seam.** Stated plainly:

- The pipeline is already split at exactly the right joint. `assembleShapeContext` is pure-read context assembly; `regeneratePost` + gate + critic + catalogue is content generation over one post; the write step is a separate concern. `shape.ts` composes them without touching structure, and has been doing so in production.
- Hooks and scripts have *never* been part of the planning run — per-post is their only mode (I-3).
- The whole-plan single-call generator (`planning.ts:812-817`) would become one of two entry paths, not something to dismantle. It stays for clients without an approved draft.

Scope of the actual build:
1. Beat→row materialiser (new, small).
2. Batch fan-out over existing hook/script/shape jobs (new, orchestration only).
3. Structural-field merge in `regeneratePost` (3 lines, fixes an existing latent bug).
4. A decision on where beats live (see D1) — the only part with schema implications.

The refactor risk sits entirely in item 4, not in the generation pipeline.

---

# I-3 — Hooks & reel scripts, current state

**Headline: hooks and scripts are not produced by the planning run at all.** They are a separate, on-demand, per-post Stage 6 feature with their own job types, prompt workflows, and API routes. Per-post regeneration already exists and is the *only* way they are ever created.

## 1. Where they are generated

**Not in planning — proven.** Grepping `planning.ts` for `hook`/`script`/`overlay` returns only prose comments (lines 24, 90, 418). The single post-insert site is `planning.ts:1056`, and `postRows` is built without any `hook:`/`script:` key. Every post leaves the planning run with `hook = NULL`.

| Concern | File | Workflow / step | Model | Temp |
|---|---|---|---|---|
| Hook candidates | `engine/src/content-cycles/hook.ts` | `plan_hooks` / `generate` | sonnet | 0.8 |
| Reel script | `engine/src/content-cycles/script.ts` | `plan_scripts` / `generate` | sonnet | 0.6 |
| Hook/script refine | `engine/src/content-cycles/refine.ts` | `plan_hooks`/`plan_scripts` + `refine` | sonnet | 0.5 |

Constants at `hook.ts:16-20`, `script.ts:16-19`.

**Worker dispatch** (`consumer.ts`): `case 'hook'` → `runHookForPost` (`:136-137`); `case 'script'` → `runScriptForPost` (`:144-145`); `case 'shape'` with `data.target === 'hook'|'script'` → `runFieldRefine` (`:126-129`, deliberately riding the shape job to reuse its jobId and poll flow).

**Prompts live in the database**, not files. `packages/prompts/src/index.ts` is a 48-line `DbPromptResolver` reading `prompt_templates`, preferring a client-specific row (highest `version`) and falling back to the `client_id IS NULL` global.

```
workflow_id  | step_name | client   | version | len
plan_hooks   | generate  | (global) |       1 |  828
plan_hooks   | refine    | (global) |       1 |  911
plan_hooks   | generate  | ivy-t    |       1 | 2745
plan_hooks   | generate  | ivy-t    |       2 | 4737
plan_scripts | generate  | (global) |       1 |  742
plan_scripts | generate  | ivy-t    |       1 | 2524
plan_scripts | generate  | ivy-t    |       2 | 6057
plan_scripts | refine    | (global) |       1 | 1061
```

Only `ivy-t` has client overrides; **`earl-of-east` resolves to the global prompts.** Seeded by migrations `0071`, `0072`, `0073`, `0083`.

**Grounding.** Hooks (`hook.ts:92-100`): resolved system prompt + `ctx.voiceMd` via `assembleShapeContext` + the post's own `format`/`pillar`/`caption` + 6 randomly sampled active `hook_patterns` matching the format, rendered as structure with a disavowed illustration:

```ts
`${i + 1}. [${p.category}] STRUCTURE: ${p.pattern}\n   (illustration only — imitate the STRUCTURE, never this content: "${p.example}")`
```

Scripts (`script.ts:50-57`): voice, `pillar`, the post's **existing hook used verbatim as the opening line**, `caption`, and a word budget from `WORDS_PER_SECOND = 2.2` (`script.ts:19,48`).

## 2. Where they live on the post record

`packages/db/src/schema.ts:955-958`:

```ts
hook:          text('hook'),                            // reel/carousel hook — null until generated (0070)
script:        text('script'),                          // reel script — null until generated
scriptLengthSeconds: integer('script_length_seconds'),  // 15|30|60|90
overlay:       text('overlay'),                         // null until generated
```

**These four columns are the only carriers in the entire database**, verified exhaustively via `information_schema.columns` — only `content_cycle_posts.hook`, `.script`, `.script_length_seconds` match.

Population:

- **`hook`** — *never written by the generator*. `runHookForPost` returns `{ candidates: string[] }` and makes no `UPDATE` (`hook.ts:103-107`; header `hook.ts:2-3` states this). The user picks in the UI and it saves via `PATCH /api/posts/:id` → `app/src/lib/mutations.ts:82`. Pick handler `PostEditor.tsx:189`.
- **`script` + `script_length_seconds`** — written directly by the worker, `script.ts:63-65`.
- **via refine** — `refine.ts:95-97`, which also bumps `status` to `edited`.
- **`overlay`** — declared but **UNVERIFIED as ever populated**; no writer found, zero non-null rows.

Nothing else carries this data: `source_meta` key census for earl-of-east returns `category, clientWritesOwn, competitorInsight, day, notes, original, postingTime, title, whoPosts` — no hook/script keys. `post_steps` is a shot-list/checklist table (`label, lead_days, done, done_at, sort, created_by`, 67 rows), unrelated.

Real row (earl-of-east):

```
format                | reel
scheduled_date        | 2026-09-17
pillar                | Brand Story & Culture
hook                  | If you only remember one thing about the All Sinners collaboration,
                        make it this: it started with a question, not a brief.
script_length_seconds | 30
script (head)         | HOOK: If you only remember one thing…
                        BEAT 1 (0–8s) — We asked what a song would smell like…
                        (Close shot: hands turning an unlit candle slowly, low warm light)
overlay               | (null)
status                | edited
```

The hook is a verbatim instantiation of the `One-thing rule` pattern — the library is demonstrably in effect.

## 3. Per-post regeneration — yes, and it is the only path

**Per-post is the native granularity. There is no whole-plan hook/script generation to contrast it with.**

- `app/src/app/api/plan/hooks/route.ts` — body is `{ targetPostId }` only (`:20`); gated by `gatePostEdit` (`:24`); 422 `format_unsupported` unless reel/carousel (`:31-33`); enqueues `{ type: 'hook', clientId, cycleId, targetPostId }` (`:35`); returns `{ mode: 'pending', jobId }`.
- `app/src/app/api/plan/script/route.ts` — `{ targetPostId, lengthSeconds }`, `lengthSeconds ∈ {15,30,60,90}` (`:15,27`); 422 unless reel (`:37`); 422 `hook_required` unless hook **and** caption present (`:38`).
- `app/src/app/api/posts/[id]/shape/route.ts` — per-post refine with `target: 'caption'|'hook'|'script'` (`:23-27`).

Idempotency is per-post: `hookJobId(cycleId, targetPostId)` (`queue.ts:119`), `scriptJobId(...)` (`:177`), returning `{ busy: true, jobId }` if in flight (`:127, :185`). Workers select exactly one row by `(id, cycleId, clientId)` (`hook.ts:70-74`, `script.ts:38-42`); `script.ts:78` returns a single-element `changedPostIds`.

UI: `PostEditor.tsx:170` labels the button `post.hook ? 'Regenerate hooks' : 'Generate hooks'`; `:222` likewise for scripts. Shipped, user-facing.

**Risk flagged — the whole-plan regen path does not handle hooks/scripts.** `plan-merge.ts` grep for `hook|script` returns **zero matches**; its `ExistingPost` interface (`:21-28`) carries only `id, scheduledDate, status, caption, title, hasPostEdit`. Per `planning.ts:1051-1057`, posts classified `replace`/`drop` are deleted and the new plan inserted fresh. **A post carrying a hook/script but no `post_edits` row would lose both.** Posts with client work survive intact. This is a latent data-loss edge, not a feature.

`app/src/app/api/posts/[id]/retry-generation/route.ts` is caption-only (`:39-42`).

## 4. Which formats get hooks

**Hooks: reels + carousels. Scripts: reels only.** Enforced at four layers.

| Layer | Hook | Script |
|---|---|---|
| Engine | `hook.ts:31` `FORMAT_TAG = { reel, carousel }`; throws `hook.ts:77` | `script.ts:44` throws unless `format === 'reel'` |
| Refine | `refine.ts:51` reel\|carousel | `refine.ts:54` reel |
| API | `plan/hooks/route.ts:31-33` → 422 | `plan/script/route.ts:37` → 422 |
| UI | `PostEditor.tsx:94` | `PostEditor.tsx:99` |

`PostEditor.tsx:93`: *"Hooks: reels + carousels only (product decision)."*

Verified against stored data — zero violations:

```
 slug         | format   | posts | with_hook | with_script
 earl-of-east | carousel |     8 |         0 |           0
 earl-of-east | reel     |     3 |         1 |           1
 earl-of-east | single   |    14 |         0 |           0
 ivy-t        | carousel |    44 |         2 |           0
 ivy-t        | reel     |    32 |        11 |           9
 ivy-t        | single   |    30 |         0 |           0
 sprigly      | reel     |     1 |         1 |           1
```

**Coverage is sparse** — only 13 of 36 eligible reels and 2 of 52 eligible carousels have hooks — corroborating the on-demand model. Nothing is generated until a user presses the button.

Nice touch: `PostEditor.tsx:156-158` retains hidden hook/script when a format changes away from an eligible one, and says so.

## `hook_patterns`

Schema `schema.ts:1261-1279` (migration 0070): `name, category, pattern, example, formats: text[], active: boolean, createdAt`.

- **Read by exactly one place** — `hook.ts:83-86`: `active = true`, in-memory format filter, uniform random sample of 6 via Fisher-Yates (`hook.ts:38-45`). Throws if no active pattern matches.
- **Written by no application code.** Seed/migration-managed only (0070). No admin UI.
- **42 rows, all active**, across seven categories: `contrarian`, `curiosity`, `identity`, `instructional`, `pain`, `promise`, `proof`. Some format-specific (`Checklist open`, `Complete guide` = carousel-only; `POV`, `Live test`, `Open loop` = reel-only).

**Designed extension seam, currently inert** — `hook.ts:33-37`:

> `── ANALYTICS-WEIGHTING SEAM ──` … *"When per-pattern performance data exists, weight the pick HERE (e.g. Thompson sampling on hook→save/publish rates) — swap this function's body only."*

Nothing records which pattern produced a chosen hook, and the chosen pattern is not persisted on the post. Closing that loop requires capturing pattern provenance at pick time — relevant to any temperature/experimentation design (D4).

---

# I-4 — Apify reels & transcription feasibility

## 1. The actor and its input

One actor in the codebase: **`apify~instagram-scraper`** via `run-sync-get-dataset-items`. `engine/src/apify-ig-fetch.ts:80-93`:

```ts
const res = await fetch(
  `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyApiKey}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      directUrls:    [`https://www.instagram.com/${handle}/`],
      resultsType:   'posts',
      resultsLimit,
      addParentData: false,
    }),
    signal: controller.signal },
);
```

That is the **complete** input — four keys. No `scrapeVideos`, no `downloadMedia`, no `expandOwners`, no proxy config. Timeout `APIFY_TIMEOUT_MS = 120_000` (`:43`), enforced by `AbortController` (`:75-76`).

**Call graph** (`runIgTrawlJob` does not call Apify directly):

| Layer | File:line |
|---|---|
| BullMQ consumer, `case 'ig-trawl'` | `engine/src/content-cycles/consumer.ts:151-156` |
| CLI entry | `engine/src/ig-trawl.ts:43-50` |
| `runIgTrawlJob` | `engine/src/ig-producer.ts:209-267` |
| → `trawlInstagramPosts` | `ig-producer.ts:248-252` → `:76` |
| → `fetchApifyPostsForHandle` | `ig-producer.ts:102` → `apify-ig-fetch.ts:68` |

`resultsLimit`: client trawl `APIFY_RESULTS_LIMIT = 50` (`ig-producer.ts:30`); competitor gather `COMPETITOR_LIMIT = 50` (`competitor-gather.ts:41`), `GATHER_CONCURRENCY = 3` (`:42`), `MAX_COMPETITORS = 5` (`:43`). Same helper serves both — this is the only Apify input in the system.

`APIFY_API_KEY` is optional in the env schema (`engine/src/env.ts:29`) and deliberately absent from the main worker env (`ig-producer.ts:10-11`: *"the worker never calls Apify"*).

## 2. What is stored for reels

The declared type reads six fields (`apify-ig-fetch.ts:24-32`): `caption`, `timestamp`, `likesCount`, `commentsCount`, `videoViewCount`, `type`, `ownerUsername`. No `videoUrl`, no `transcript`, no id.

The persisted shape is narrower — `ig-producer.ts:152-161` projects to five keys before writing, validated by the closed `igPostSchema` (`lean-line.ts:156-164`). Reels are identified only by `mapApifyMediaType` mapping Apify `'Video'` → `'reel'` (`lean-line.ts:171-178`).

**Confirmed against the live database:**

```sql
select k, count(*) from ig_posts i, jsonb_array_elements(i.posts) p, jsonb_object_keys(p) k
group by k order by 2 desc;
```
```
       k       | count
---------------+-------
 commentsCount |    81
 timestamp     |    81
 likesCount    |    81
 caption       |    81
 mediaType     |    50
```

**Five keys. That is the entire universe of stored post data.**

```
    mt    | count
----------+-------
 carousel |    17
 image    |    24
 reel     |     9
 (null)   |    31
```

A full real reel object (ivy-t):

```json
{
  "caption": "Tonight is the night 🙌\n\nBefore Connie lands at 6pm…",
  "mediaType": "reel",
  "timestamp": "2026-07-17T05:30:00.000Z",
  "likesCount": 12,
  "commentsCount": 0
}
```

**Answer: neither.** No transcript, no video URL. And no post identifier of any kind — no `id`, `shortCode`, `url`, or permalink — so **a stored reel cannot be resolved back to its source post** without re-scraping.

**No raw payload survives anywhere else.** A schema-wide sweep for `raw|payload|transcript|video|media|url|asset` returns `agent_proposals.payload`, `competitor_gather_cache.raw_data`, `plan_activity.payload`, `prospect_sheets.url`, `ui_events.payload`. `competitor_gather_cache.raw_data` is misleadingly named — its shape is `CompetitorGatherData` (`packages/engine/src/types.ts:212-217`) whose posts are `ScoredIgPost` (`:157-170`), twelve derived/scored fields built by `scorePost` (`competitor-gather.ts:68-89`). No URL, no transcript, no ID — and the table is **empty (0 rows)**.

Brute-force scan for CDN artefacts:

```sql
select count(*) filter (where posts::text ~* 'cdninstagram|instagram.com|\.mp4|oe=|_nc_ht') as hits,
       count(*) as rows from ig_posts;
```
```
 hits | rows
------+------
    0 |    7
```

Same scan across `agent_proposals.payload` and `plan_activity.payload`: 0 hits each. A repo-wide grep for `videoUrl|video_url|transcript|displayUrl|shortCode` returns zero Instagram-related hits (the only `transcript` matches are browser speech input in `app/src/components/plan/useSpeechInput.ts`).

## 3. Feasibility of a download + transcribe step

### 3a. Where it would slot

The key structural fact works in our favour: `apify-ig-fetch.ts:99` is a **TypeScript cast, not a runtime parse**:

```ts
rawPosts = body as RawApifyPost[];
```

The runtime objects retain **every** key the actor returned. Proof that extra keys survive: the next statement reaches past the interface to log an undeclared field (`apify-ig-fetch.ts:105`):

```ts
firstUrl: (rawPosts[0] as Record<string, unknown>)?.['url'],
```

So whatever media fields the actor emits are live in memory and flow untouched through the owner filter (`:122-124`), hidden-count filter (`:137-142`), and month filter (`ig-producer.ts:143`). They are destroyed at exactly one place: the projection at `ig-producer.ts:152-161`.

**The insertion point is `ig-producer.ts`, between line 149 and line 152** — after `monthPosts` is computed and the `empty_month` early-return has fired, before `mapped` collapses the objects. At that point you hold full-fidelity items for precisely the posts you intend to persist (owner-filtered, engagement-visible, month-scoped) — the minimum work set.

Two follow-ons:

1. `igPostSchema` (`lean-line.ts:156-164`) is a closed Zod object and `igPostsArraySchema.parse` at `ig-producer.ts:168` is the gatekeeper — a `transcript?: z.string().optional()` must be added or the write throws at `:173`. Being the single shared contract (`ig-producer.ts:7-8`), one edit covers the trawl writer, `loadHistoricPosts`, and the lean-line reader.
2. The second writer, admin manual upload (`admin/src/lib/ingest/ingest-ig.ts:17`, validator `:33-52`), has its own hand-rolled `IgPost` interface and would silently strip `transcript` unless updated in parallel.

**Retry amplification is a real hazard.** `runIgTrawlJob`'s catch (`ig-producer.ts:254-266`) rethrows anything not classified as an Apify auth/quota error, and BullMQ retries (comment at `:255-257` says 5×). A transcription step throwing on transient download or ASR failure would re-run the **entire** job including a fresh paid Apify scrape. Any transcribe step must be internally fault-tolerant (per-post try/catch, persist with `transcript` absent) rather than propagating.

### 3b. Video URL availability and expiry

**Cannot be assessed from stored data, because no URL is stored.** Five keys only; the regex scan above returned 0 hits across all 7 rows. There is no signed-token sample to show.

**UNVERIFIED:** whether `apify~instagram-scraper` returns a `videoUrl` for `type: 'Video'` items under the exact input at `apify-ig-fetch.ts:85-90`, and what expiry parameters such a URL carries. Establishing it requires an actor run or fetching the actor's output schema — both out of scope here.

What *is* provable: the pipeline logs a raw `url` field it never typed (`apify-ig-fetch.ts:105`), so the actor demonstrably returns fields beyond the seven in `RawApifyPost`. Media URLs being among them is plausible but unconfirmed.

The design implication holds either way. The trawl is a **monthly batch job**, and any URL captured during the scrape would need consuming **within the same job execution**. Instagram CDN URLs are conventionally short-lived signed URLs. Persisting one for later processing would be the wrong shape — transcription must happen inline, between `ig-producer.ts:149` and `:152`, or not at all.

### 3c. Storage implications

```
 rows | posts | total  | avg_posts_bytes | max_posts_bytes
------+-------+--------+-----------------+-----------------
    7 |    81 | 128 kB |            4551 |           10446
```
```
 avg_post_obj | avg_caption
--------------+-------------
          671 |         528
```

The nine stored reels: 636–1452 bytes each (captions 478–1300 chars).

**Storage is a non-issue.** Reels are 9 of 81 stored posts (11%). A 30–60s reel transcript runs ~80–150 words, ~500–1,000 bytes — comparable to the 528-byte average caption already stored, under the largest existing post object (1,452 bytes). Adding transcripts to every reel grows the table by single-digit kilobytes against a current total of 128 kB.

The real cost is **not storage**: (i) per-video download and ASR spend and latency inside a job with a 120s Apify abort budget and no transcription infrastructure whatsoever (grep for `transcribe|whisper|ffmpeg` across `engine/`, `packages/`, `apps/` returns nothing; the only Bedrock usage is the text `model-client`); (ii) the retry amplification at `ig-producer.ts:265`; (iii) the unresolved URL-expiry question in 3b.

---

# I-5 — Intake surface & `plan_inputs` extension points

## 1. The classifier in `POST /api/plan/intake`

**File:** `app/src/app/api/plan/intake/route.ts` (212 lines).

The branch point — `route.ts:178` computes the boolean, `:181` branches:

```ts
177  const hasIntakeContent = Object.values(answers).some((v) => v.trim().length > 0) || freeNotes.trim().length > 0;
178  const prePlanning = PRE_PLANNING_STATUSES.has(cycle.status);
179
180  // ── THE CLASSIFIER ──────────────────────────────────────────────────────────
181  if (prePlanning) {
```

There is exactly **one** classification axis today: **cycle lifecycle position**. It is a set membership test, not a model call.

`packages/db/src/structured-brief-invalidate.ts:28-30`:

```ts
export const PRE_PLANNING_STATUSES: ReadonlySet<string> = new Set([
  'scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed',
]);
```

`'failed'` is deliberately excluded (`:26`) because a failed cycle's `prior_status` may be post-planning.

**Pre-cutoff route** (`:181-200`): gated on `hasIntakeContent` (`:184`) → `mergeIntake` (`:134-146`; new answers spread over old at `:140`, `freeNotes` appends with a blank-line separator at `:138`) → `distributeIntoEmptyAnswers` fills **only empty** slots (`:98`), timeboxed to `EXTRACT_TIMEOUT_MS = 25_000` (`:33`), non-fatal → persist `intake_json` (`:191`) → `clearStructuredBriefIfPrePlanning` (`:194`) → `extractAndPersistBrief` (`:52-65`), an inline Sonnet extraction racing the same timeout, writing `content_cycles.structured_brief`, failure swallowed (`:62-63`) → returns `{ mode: 'brief_updated', prePlanning: true }`.

**Post-cutoff route** (`:202-211`): `intake_json` is never touched. Short-circuits to `mode: 'noop'` with no content (`:203-205`). Otherwise flattens answers + freeNotes into a newline-joined `instruction` (`:206-209`) and hands it to `runPlanAgentTurn` (`:210`) — the same parse→propose loop the agent route uses, landing in `agent_proposals`. Returns `mode: 'proposed'`.

**The always-path**, before the classifier — `durableItems` written unconditionally (`:170-175`):

```ts
172  for (const item of durableItems) {
173    try { await saveDurableInput({ clientId, type: item.type, content: item.text, source }); durableSaved++; }
174    catch { /* best-effort; a single bad item never fails the whole submit */ }
```

### Where a second axis (month-scoped vs evergreen) would slot in

The design *already* encodes a crude version of this axis, structurally rather than by classification:

- **month-scoped** ≙ `answers`/`freeNotes` → `intake_json` (bound to `cycleId`)
- **evergreen** ≙ `durableItems` → `plan_inputs` with `cycle_id = NULL` (`app/src/lib/agent/notes.ts:56`)

The split is decided **on the client**, not by any classifier. `app/src/components/plan/IntakeCapture.tsx:30` hardcodes the type:

```ts
const durableItems = durableText.trim() ? [{ type: 'idea' as const, text: durableText.trim() }] : [];
```

`'next_cycle'` is accepted by the wire format (`route.ts:119`) but **nothing in the app UI ever emits it** — a dead branch on the write path.

| Change | Location |
|---|---|
| Parse an incoming scope axis off the body | `route.ts:108-131` `parseBody` — the only per-item classification is the ternary at `:119` |
| Widen the item type | `route.ts:106` `type DurableItem = { type: 'idea' \| 'next_cycle'; text: string }` |
| The classifier branch | `route.ts:181` — a second axis makes this a 2×2, so routing must move out of the bare `if (prePlanning)` into a small resolver |
| The evergreen write | `route.ts:173` → `saveDurableInput` (`notes.ts:51-64`) — hardcodes `cycleId: null` (`:56`) and accepts no `relevantFrom`/`relevantTo`, so a month-scoped durable is unrepresentable through this entry point |
| Month-scoped alternative | `saveNote` (`notes.ts:23-38`) already accepts `cycleId`, `relevantFrom`, `relevantTo` — but writes `type: 'note'` (`:30`), which is **excluded** from `DURABLE_INPUT_TYPES` and therefore invisible to the generator (§3) |

**Cheapest slot-in:** extend `parseBody` (`route.ts:108`) to carry a scope, and make `route.ts:173` dispatch between `saveDurableInput` (evergreen, `cycle_id` NULL, null bounds) and a relevance-bounded variant (month-scoped, `relevant_from`/`relevant_to` = the plan month). **No schema change needed for that axis** — the relevance-window columns exist and are already honoured by the shared query.

## 2. `plan_inputs` schema

Source of truth `packages/db/src/schema.ts:1105-1132`. Live verification:

```
$ psql -c "\d plan_inputs"
         Column          |            Type             | Nullable |      Default
-------------------------+-----------------------------+----------+-------------------
 id                      | uuid                        | not null | gen_random_uuid()
 client_id               | uuid                        | not null |
 cycle_id                | uuid                        |          |
 type                    | text                        | not null |
 content                 | text                        | not null |
 source_proposal_id      | uuid                        |          |
 created_at              | timestamp without time zone | not null | now()
 relevant_from           | date                        |          |
 relevant_to             | date                        |          |
 status                  | text                        | not null | 'active'::text
 source                  | text                        | not null | 'web'::text
 consumed_by_proposal_id | uuid                        |          |
Indexes: plan_inputs_pkey (id) · plan_inputs_client_type_idx (client_id, type)
         plan_inputs_source_proposal_uniq UNIQUE (source_proposal_id)
FKs: → clients(id), agent_proposals(id) ×2, content_cycles(id)
```

Schema and live DB agree exactly — 12 columns, **no drift**.

| Requirement | Exists? | Evidence |
|---|---|---|
| A `source` field | **Yes** | `schema.ts:1120` — `text('source').notNull().default('web')` |
| A lifecycle/status field | **Yes** | `schema.ts:1119` — `text('status').notNull().default('active')` |
| Cycle binding, nullable? | **Yes, nullable** | `schema.ts:1110`, inline comment `// nullable`; confirmed by `\d` |
| Relevance/expiry consumed at extraction | **Yes** | `schema.ts:1117-1118` — `relevant_from`/`relevant_to`, both nullable dates, consumed by `loadDurableInputs` (§3) |

### Current allowed values as used in code (no DB CHECK constraints exist)

**`type`** — `'note'` (`notes.ts:30`), `'idea'`/`'next_cycle'` (`notes.ts:47, 57`), `'note'` in e2e seed (`seed-e2e.ts:139`). Declared at `schema.ts:1111`.

**`status`** — `'active'` (`notes.ts:34, 60`, plus column default), `'expired'` (`notes.ts:94`, when `relevant_to < today`), `'dismissed'` (`notes.ts:125`), `'integrated'` (`notes.ts:138`, sets `consumedByProposalId` in the same `.set()`). Documented `schema.ts:1113-1116`.

**`source`** — `'web' | 'voice'` (`schema.ts:1120`), from `SaveNoteArgs.source`/`SaveDurableInputArgs.source` defaulting to `'web'` (`notes.ts:31, 59`). In `intake/route.ts:173` the value is the request's `source`, parsed at `:114` as `b.source === 'voice' ? 'voice' : 'web'` — so **`source` currently encodes the input *transport*, not the input *origin*.**

### Live data

```
 slug  | type |   status   | source | count | with_cycle | with_from | with_to
-------+------+------------+--------+-------+------------+-----------+---------
 ivy-t | note | dismissed  | web    |     2 |          0 |         2 |       0
 ivy-t | note | integrated | web    |     1 |          0 |         0 |       0
```

Three rows total, all ivy-t, all `type='note'`, all `cycle_id IS NULL`. **Zero `idea`/`next_cycle` rows exist in production** — the durable path has never fired with live data, and no row has ever had `relevant_to` set.

### Exactly what is missing

**(a) `source = 'client' | 'competitor'` — MISSING as a concept; the column name is taken.**
`source` exists but its live domain is `{web, voice}` (transport). It is written at `notes.ts:31, 59` and read for display at `notes.ts:109, 117, 128`. Overloading it would collide with the transport values and with `NoteView.source` surfaced to the UI (`notes.ts:69`). Missing: a **new** column, e.g. `origin text NOT NULL DEFAULT 'client'`, plus a migration. Nothing reserves that name (verified by grep). The transport value still needs a home — currently `source`.

**(b) Lifecycle `candidate/used/measured/proven/declined/stale` — the COLUMN exists, the VOCABULARY does not.**
`status` exists, is untyped at the DB level, and is already a lifecycle — but its live vocabulary is `active | expired | dismissed | integrated`. The requested vocabulary is longer and has a measurement stage with no analogue today.

Missing: the value set, plus every reader that hardcodes `eq(planInputs.status, 'active')` would **silently drop** rows in a new state. Those readers are:

- `packages/engine/src/intake-signals.ts:62` (question A / suppression)
- `packages/engine/src/intake-signals.ts:112` (`loadDurableInputs` — the generator's source)
- `app/src/lib/agent/notes.ts:98, 113, 126`
- `app/src/app/page.tsx:66`
- `app/src/app/api/plan/route.ts:61`
- `app/src/app/api/plan/preview/route.ts:37`
- `engine/src/content-cycles/weekly-session.ts:143`

No transition helper exists for `measured`/`proven` — the three writers (`notes.ts:94, 125, 138`) cover only expire/dismiss/integrate.

**UNVERIFIED:** whether `active` is intended to map onto `candidate` or is orthogonal. Nothing in the code indicates intent.

**(c) A `used_in_cycle` reference — MISSING; the nearest things are not it.**
`cycle_id` (`schema.ts:1110`) is the **capture** cycle, and durables deliberately set it NULL (`notes.ts:56`, comment `:42-43`: *"durable items are cycle-INDEPENDENT"*); live data confirms `with_cycle = 0`. Reusing it conflates capture with consumption. `consumed_by_proposal_id` (`schema.ts:1121`) points at `agent_proposals`, not `content_cycles`, and is set only by `markNoteIntegrated` (`notes.ts:138`).

Missing: a new nullable `used_in_cycle uuid REFERENCES content_cycles(id)` + migration + index if queried. **Nothing today records which cycle consumed an input** — `loadDurableInputs` (`intake-signals.ts:103`) reads but writes nothing back, so a durable is re-read by every subsequent plan month whose window overlaps, indefinitely.

## 3. How `loadDurableContext` selects today

Two thin wrappers of the same name, both calling one shared query:

| Wrapper | File:line |
|---|---|
| Intake route | `app/src/app/api/plan/intake/route.ts:38-43` |
| Worker generator | `engine/src/content-cycles/planning.ts:671-680` |

Both identical: `loadDurableInputs(db, clientId, planMonth)` then `rows.map(r => \`[${r.type}] ${r.content}\`)`, wrapped in a try/catch returning `[]` (`route.ts:42`, `planning.ts:677-678`).

**The query** — `packages/engine/src/intake-signals.ts:103-117`:

```ts
export async function loadDurableInputs(db: Db, clientId: string, planMonth: string): Promise<DurableInputRow[]> {
  const monthStart     = `${planMonth}-01`;
  const nextMonthStart = firstOfMonthAfter(planMonth);
  const rows = await db
    .select({ type: planInputs.type, content: planInputs.content })
    .from(planInputs)
    .where(and(
      eq(planInputs.clientId, clientId),
      inArray(planInputs.type, DURABLE_INPUT_TYPES),
      eq(planInputs.status, 'active'),
      or(isNull(planInputs.relevantFrom), lt(planInputs.relevantFrom, nextMonthStart)),
      or(isNull(planInputs.relevantTo),   gte(planInputs.relevantTo,   monthStart)),
    ));
  return rows.map((r) => ({ type: r.type, content: r.content }));
}
```

Precisely:

1. **client scope** (`:110`)
2. **type** — `IN ('idea','next_cycle')` (`:111`, `DURABLE_INPUT_TYPES` at `:36`). **`'note'` is excluded** — notes never reach the generator through this path. Given all three live rows are `type='note'`, **this query currently returns zero rows for every client.**
3. **status** — `= 'active'` only (`:112`), a hardcoded literal
4. **relevance-window overlap with the plan month** (`:113-114`), null bounds treated as open. `firstOfMonthAfter` (`:84-88`) exists specifically to avoid the old `${planMonth}-31` literal that threw for <31-day months (`:78-82`)
5. **`cycle_id` is NOT filtered at all**
6. No `ORDER BY`, no `LIMIT`

`planMonth` is `cycle_month + 1` — `nextMonth(cycle.cycleMonth)` (`route.ts:54`); the gate's equivalent is `planMonthOf` (`intake-signals.ts:70-74`).

This one query is shared by three callers — the planning gate `hasPlannableInput` (`:126`), the intake route (`route.ts:40`), and the worker generator (`planning.ts:675`) — deliberately, so gate and generator cannot diverge (`intake-signals.ts:97-101`).

**Divergent readers worth knowing:**

- `app/src/app/api/plan/preview/route.ts:33-41` — **no type filter**, sentinel bounds `'9999-12-31'`/`'0000-01-01'`, `LIMIT 12`. The one reader that would surface `type='note'` rows into a durable-shaped payload.
- `app/src/app/page.tsx:64-67` and `app/src/app/api/plan/route.ts:59-62` — the read-only "remembered" list: type `IN ('idea','next_cycle')` + `status='active'`, no window filter, `ORDER BY created_at DESC`.
- `engine/src/content-cycles/weekly-session.ts:141-145` — `type='note'` + `status='active'` with a week-window overlap.

**Where lifecycle filtering slots in:** `intake-signals.ts:112` is the single line. Swapping `eq(planInputs.status, 'active')` for `inArray(planInputs.status, PLANNABLE_STATUSES)` changes the gate, the intake route, and the generator together — the point of the shared construction. Two caveats:

- The same swap must be applied independently at `intake-signals.ts:62` — a **separate** query with its own `eq(..., 'active')` and a different window (capture-time `created_at >= cycle.created_at`, not relevance overlap). The asymmetry is deliberate and documented at `:13-21`; do not collapse them.
- `DURABLE_INPUT_TYPES` (`:36`) is typed `string[]`, so a new lifecycle status produces **no type error anywhere** — every drop is silent. Window test coverage at `packages/engine/src/intake-signals.test.ts:196-201`.

## 4. Client config storage & the flag pattern

Four distinct per-client config homes:

| Home | Shape | Migration to add a field? | Citation |
|---|---|---|---|
| `clients.settings` (jsonb) | free-form | No | `schema.ts:57` |
| `client_configs.settings` (jsonb) | free-form — **the feature-flag home** | No | `schema.ts:92` |
| `client_channels` | typed columns, per-(client, channel) | **Yes** | `schema.ts:570-597` |
| `client_planning_config` | typed jsonb columns, per-(client, channel) | Yes | `schema.ts:777-798` |

**The flag pattern** — `app/src/lib/flags.ts` is the canonical and currently only flag module:

```ts
 4  * Flags live in `client_configs.settings` (jsonb, default `{}`), read server-side.
 5  * This module is intentionally pure (no `@sprigly/db` import) so the predicate is
 6  * unit-testable without a DATABASE_URL — the DB read is done at the call site
10  /** Swaps the client plan surface to the redesign. Per-tenant, default OFF. */
11  export const PLAN_REDESIGN_FLAG = 'plan_redesign';
18  export function readPlanRedesignFlag(settings: Record<string, unknown> | null | undefined): boolean {
21    return settings?.[PLAN_REDESIGN_FLAG] === true;
22  }
```

Four defining properties: (1) storage is a key in `client_configs.settings` jsonb (`schema.ts:92`, `.default({}).notNull()`) — **no migration** for a new flag; (2) purity — no `@sprigly/db` import; (3) strict `=== true` read, with `flags.ts:13-16` explicit that `"false"`, `1`, and truthy strings must all read off; (4) read at the call site — `app/src/app/page.tsx:84-90`.

**Write pattern (merge, never clobber)** — `admin/src/app/admin/clients/[id]/actions.ts:535-550`: read-modify-write with a spread, then `revalidatePath`. Note there is **no unique constraint on `client_configs.client_id`**; onboarding guards duplicates explicitly (`onboard.ts:166-169`).

**Contrasting typed-column pattern:** the delivery surface is a column, not jsonb — `schema.ts:588` `deliverySurface: text('delivery_surface').notNull().default('both')`, validated inline in its admin action (`actions.ts:84-96`), read by the generator (`planning.ts:492-493`). Numeric-dial precedent: `aiChangeLimit: integer(...).notNull().default(30)` (`schema.ts:590`) and `postsPerWeek: integer(...)` (`:592`). And `contentCycleSchedule` (`:586`) is jsonb *specifically* so `cutoffDay` could be added without a migration (`:585`).

**Live config:**

```
     slug     |            settings
--------------+------------------------------------------------
 earl-of-east | {"plan_redesign": true}
 ivy-t        | {"plan_redesign": true}
 sprigly      | {"model":"haiku","stepModels":{…},"plan_redesign":true}
```

```
     slug     | content_cycle_enabled |  channel  | delivery_surface | ai_change_limit | posts_per_week | content_cycle_schedule
--------------+-----------------------+-----------+------------------+-----------------+----------------+-------------------------------------
 earl-of-east | f                     | instagram | app              |              30 |                |
 ivy-t        | t                     | instagram | app              |              25 |              7 | {"day":10,"hour":6,"cutoffDay":16}
 sprigly      | t                     | instagram | app              |              30 |                | {"day":13,"hour":14,"cutoffDay":18}
```

All three tenants have `plan_redesign: true` — the flag is on everywhere with no off-tenant in production. **`sprigly` has no `client_planning_config` row**, which matters if a new dial defaults from that table.

### Recommended placement for the three new flags

| Flag | Home | Rationale |
|---|---|---|
| `voice_intake_enabled` | `client_configs.settings` | Gates an app surface exactly like `plan_redesign`. Follow `flags.ts:11` + `:18-22` verbatim; strict `=== true`. Zero migration. Reuse the existing `cfg?.settings` read at `page.tsx:84-88` — add no second query. Optionally seed at `onboard.ts:168`. |
| `reels_script_enabled` | `client_configs.settings` — **note the collision** | Same pattern, but script generation is currently gated by *post format*, not config — `PostEditor.tsx:98`, `app/src/lib/agent/proposals.ts:145`, `app/src/lib/agent/turn.ts:211`. A per-client flag adds a **second** gate; those three sites plus `app/src/lib/queue.ts:153` all need the conjunction, or the flag is bypassable through the agent path. |
| `temperature` (numeric dial) | **Not** `client_configs.settings` — prefer a typed column | (a) `flags.ts` is strictly boolean (`:21`) and its own comment (`:14-16`) argues against loose coercion; a numeric dial breaks its contract. (b) Direct precedent for numeric per-client dials as typed columns: `aiChangeLimit` (`schema.ts:590`), `postsPerWeek` (`:592`), both on `client_channels` with validating admin actions. If per-channel, mirror those. If it must ship without a migration, `client_planning_config` is the per-(client, channel) home for planning knobs — but `sprigly` has no row there, so a default path is required. |

**Naming warning on `temperature`:** the name is already load-bearing in two unrelated senses. It is a model sampling parameter, passed literally at `hook.ts:102` (0.8), `script.ts:59` (0.6), `refine.ts:89` (0.5), `app/src/lib/agent/task-parser.ts:245` (0), against the typed field at `packages/model-client/src/types.ts:18`. It is *also* used for weather (`packages/weather/src/index.ts:41-42`). **UNVERIFIED:** which sense the requested dial means. A distinct name (e.g. `creativity` or `exploration`) would avoid three-way ambiguity.

---

# Decision inputs

## D1 — Beats model: new `plan_beats` table vs promoting `structured_brief.schedule`

**Recommendation: a new `plan_beats` table. The evidence supports this.**

`structured_brief.schedule` cannot carry a draft plan, for four independently sufficient reasons:

1. **Cardinality mismatch, measured.** ivy-t 2026-07: 12 beats, 31 posts. 2026-06: 7 beats, 31 posts. earl-of-east: **0 beats, 12–13 posts in both cycles.** Beats are client-briefed dated asks, roughly a third of a month at best and zero for one live client. A draft plan needs one beat per slot.
2. **Wrong shape.** `BriefScheduleBeat` (`packages/engine/src/types.ts:280-288`) is `{date, dateRange, type, product, colourway, note}` — no `format`, no `pillar`, no `position`, no per-beat status. Every field the fixed-structure contract needs is absent.
3. **Wrong lifecycle.** The brief is *extract-once and invalidate-on-intake-change*: `clearStructuredBriefIfPrePlanning` nulls the whole column when intake changes (`structured-brief-invalidate.ts:39-62`, called at `intake/route.ts:194` and `admin/.../intake-actions.ts:41`). A client-approved draft plan must survive intake edits; today it would be silently destroyed by one.
4. **No per-beat addressability.** Beats have no id, so a client cannot approve, decline, or swap one. Approval is the whole point of the arc.

`structured_brief.schedule` should stay exactly what it is — the parsed client brief, an *input* to draft assembly rather than the draft itself. A `plan_beats` row would carry `{id, cycle_id, scheduled_date, format, pillar, source_beat_ref?, origin (history|brief|experimental), status (draft|approved|declined), position}`.

**Caveat worth weighing:** `content_cycle_posts` already has most of those columns (`schema.ts:943-972`) and the entire per-post generation path is built on it. A serious alternative to a new table is materialising beats directly as `content_cycle_posts` rows in a `draft` status — reusing the app surface, the edit path, and the generation jobs for free. That is a design question, not an evidence question; both are consistent with the findings, and the second is meaningfully cheaper.

## D2 — Draft trigger timing relative to `cutoffDay` / three-touch schedule

**Recommendation: fire draft assembly at the Ask touch (`reminderDay`), before the Ask email sends. Evidence supports this.**

The schedule is a single pure derivation, `packages/engine/src/touch-schedule.ts:32-48`: `askDay = reminderDay`, `nudgeDay = cutoffDay − 3` (only when `gap ≥ AUTO_RUN_MIN_WINDOW = 5`), `lastCallDay = cutoffDay − 1`, `planRunDay = cutoffDay`. Shared by the sender (`scheduler.ts:272-274`) and the admin readout so they cannot diverge.

Live windows:

| Client | Ask | Nudge | Last call | Plan run | Window |
|---|---|---|---|---|---|
| ivy-t | 10 | 13 | 15 | 16 | 6 days |
| sprigly | 13 | 15 | 17 | 18 | 5 days |
| earl-of-east | — | — | — | — | not configured |

The Ask is the first client contact and the only touch with the full window ahead of it. Assembling the draft just before it means the Ask email can *carry* the draft — which is the whole inversion — leaving 6 days (ivy-t) for reaction, with Nudge and Last Call as existing, already-built reminder machinery needing no new touch.

Two constraints this must respect:

- The draft assembler reads `ig_posts`, which is populated by the monthly `ig-trawl`. **Trawl must complete before the Ask day.** Nothing currently enforces an ordering between them — verify before building.
- `AUTO_RUN_MIN_WINDOW = 5` (`touch-schedule.ts:16`) already collapses the Nudge on tight windows. A draft-plus-approval arc needs *at least* the current window; if anything it argues for raising the minimum, not lowering it.

**earl-of-east has no `content_cycle_schedule` at all and `content_cycle_enabled = false`** — the sandbox client is manual-only, so any timing work is testable only against ivy-t or sprigly.

## D3 — Fallback if the client never approves before cutoff

**Recommendation: run the draft as-is at `cutoffDay`, unapproved. The existing fallback already does the equivalent and the machinery is in place.**

`evaluateAutoRunForClient` (`scheduler.ts:181-256`) fires at `today.day >= cutoffDay`, and when a cycle is still pre-`intake_confirmed` it advances the cycle and enqueues planning **regardless of whether intake landed** — logging `intake ${hasIntakeInput ? 'present' : 'empty — baseline run'}` (`:238`, `:250`). Silence has always meant "proceed on what we have"; the fallback is a design precedent, not a new invention.

Applied to the inverted arc: an unapproved draft at cutoff proceeds to generation as the client's implicit acceptance. This preserves the guarantee that a client always gets a plan, which is the current contract.

**Two facts that must inform the build:**

- **The auto-run is currently a dry run.** `AUTO_RUN_ENABLED = process.env.AUTO_RUN_ENABLED === 'true'` (`scheduler.ts:72`); when false it logs `[auto-run:dry]` and takes no action (`:225-238`). **UNVERIFIED:** whether it is enabled in production — I inspected the dev database and repo only, not production environment variables.
- `content_cycles` already carries `intake_source` (`'reply' | 'confirmed' | 'fallback'`, `schema.ts:706`) and per-touch skip reasons (`ask_skip_reason` etc., `schema.ts:733-735`), so "this plan ran on an unapproved draft" has an existing, idiomatic place to be recorded. Use it — the state must be recoverable from the DB alone, matching the house style documented at `schema.ts:728-732`.

## D4 — Temperature defaults (warm start, decay, override)

**Insufficient evidence.** I recommend nothing here.

- **No prior art exists.** No temperature, experimentation, or exploration dial exists anywhere in the codebase. The only `temperature` values are hardcoded model sampling parameters (`hook.ts:102`, `script.ts:59`, `refine.ts:89`, `task-parser.ts:245`) and an unrelated weather field.
- **There is no measurement loop to tune a decay against.** Per-pillar engagement is not computable (I-1 §2) — no pillar label on any published post, no join key between planned and published posts. An experimental beat cannot currently be scored, so "decay on success" has no signal to decay against.
- **The ideas backlog is empty and untested.** `plan_inputs` holds three rows, all `type='note'`, and `loadDurableInputs` filters to `('idea','next_cycle')` — so the backlog the dial would draw from has **zero rows** and the durable path has never fired with live data (I-5 §2).
- **The closest genuine precedent is inert.** `hook.ts:33-37` marks an explicit analytics-weighting seam for Thompson sampling on hook→save rates, but nothing records which pattern produced a chosen hook, so the data does not exist there either.

What the evidence *does* support: **the measurement substrate is the prerequisite, not the dial.** Establishing a post identity that survives from plan to publication — which would simultaneously fix per-pillar engagement (I-1), enable hook-pattern weighting (I-3), and give `used_in_cycle` something to measure (I-5) — is the blocking piece. Until then any warm-start or decay constant would be an unfalsifiable guess.

---

# Unverified items and anomalies (collected)

| Item | Status |
|---|---|
| Apify video-URL presence and expiry parameters for reels | **UNVERIFIED** — no stored sample; requires an actor run (out of scope) |
| `derivePillars` behaviour on an empty/near-empty caption array | **UNVERIFIED** — no guard exists (proven by inspection, `onboard.ts:339-351`); model behaviour untested (no Bedrock calls permitted) |
| Whether `AUTO_RUN_ENABLED` is true in production | **UNVERIFIED** — dev DB and repo inspected only |
| Whether `plan_inputs.status='active'` maps onto `candidate` or is orthogonal | **UNVERIFIED** — no intent expressed in code |
| Which sense of "temperature" the dial means (sampling parameter vs allocation share) | **UNVERIFIED** — three-way name collision |
| `content_cycle_posts.overlay` | Declared (`schema.ts:958`) but **no writer found and zero non-null rows** — likely dead |

**Anomalies recorded, not fixed** (per instructions):

1. **`regeneratePost` can mutate structure.** It returns the model's full post object (`plan-validation.ts:243`) and callers assign it wholesale (`:291`). `date`/`format`/`postingTime` are preserved only by prompt request (`:214`); nothing in `codeGateCheck` (`:125-159`) validates them. Latent today; blocking for a fixed-beat design.
2. **`plan-merge.ts` is blind to hook/script.** Zero matches for `hook|script`; `ExistingPost` (`:21-28`) omits both. A whole-plan regen deletes posts classified `replace`/`drop` (`planning.ts:1051-1057`), so a post carrying a generated hook/script but no `post_edits` row loses both.
3. **Dead clamp in `computeCadence`.** `onboard.ts:90` floors `weeks` at `1/7`; `:91` immediately re-clamps to `≥1`, making the first floor unreachable.
4. **`computeFormatMix` output is persisted nowhere and consumed by nothing** (`onboard.ts:112-122`); it reaches only console output and a tmpdir review file.
5. **`loadDurableInputs` currently returns zero rows for every client** — it filters `type IN ('idea','next_cycle')` (`intake-signals.ts:111`) and all three live rows are `type='note'`.
6. **`'next_cycle'` has no producer.** Accepted by the wire format (`intake/route.ts:119`) but never emitted by the app UI (`IntakeCapture.tsx:30` hardcodes `'idea'`).
7. **ivy-t's `ig_posts` history is truncated at exactly 50 posts** (`APIFY_RESULTS_LIMIT`), making its 2026-05 row (3 posts) a clipping artefact rather than a real cadence.
8. **`sprigly` has no `client_planning_config` row**, and `earl-of-east` has no `content_cycle_schedule` and `content_cycle_enabled = false`.
