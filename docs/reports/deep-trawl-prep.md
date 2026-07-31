# Deep trawl + mediaType — September data prep

**Date:** 2026-07-31 · branch `dev`
**Commits:** `d401488` (W1a), `f4f8388` (W1b), `6721e40` (W2 — pre-existing, see §8)
**Ran against:** UAT (`hayabusa…:24746`) — written. Production (`yamabiko…:59459`) — read only,
two `SELECT`s under `PGOPTIONS=-c default_transaction_read_only=on`, no writes.

---

## 0. The short version

The mapper was not broken. ivy-t's 31 untyped posts were stale rows, and a 300-deep probe
found the actor emits only the three type strings the mapper already handles. What was
broken is that a mapper miss and a stale row are **indistinguishable downstream**, so the
question could only be answered by going and looking — which is the thing the fix now
removes the need to do.

The depth work landed and ran. ivy-t's UAT history went from 65 posts across 3 months to
**278 across 12**, with mediaType coverage from **34/65 to 278/278**.

**One thing needs a decision before September is drafted.** The deep trawl reached three
posts from 2022–2025 that sit years before her continuous posting run, and `observeCadence`
divides post count by the full first-to-last span. Her derived cadence has therefore
**collapsed from ~6.0 to 1.30 posts/week**, which would build September at **≈6 slots
instead of ≈30**. UAT is in that state right now. See §6 — it is one `DELETE` to undo.

---

## 1. W1a — the mediaType mechanism

### What was claimed, and what the data says

The brief said `mapApifyMediaType` returns nothing for 31 of ivy-t's 50 stored posts. The
31 is real. The cause is not the mapper.

**Evidence 1 — the untyped posts are segregated by row, not scattered through them.**
UAT `ig_posts` for ivy-t, before any of tonight's writes:

| month | posts | typed | row created | row updated |
|---|---|---|---|---|
| 2026-05 | 3 | **0** | 2026-07-10 09:42 | 2026-07-10 09:42 |
| 2026-06 | 28 | **0** | 2026-07-10 09:42 | 2026-07-10 09:42 |
| 2026-07 | 34 | **34** | 2026-07-10 09:42 | 2026-07-31 04:01 |

A mapper that misses a type string scatters its losses through every month that contains
that format. This is 0/3, 0/28, 34/34 — an all-or-nothing split on the row, and the two
untyped rows are the two that were written on 10 July and never re-trawled. The typed row
is the one that has been rewritten since.

**Evidence 2 — production, whose rows were all written after the key shipped, has no gap
at all.** 35 posts, 35 typed, same client, same account, same code:

| month | posts | typed | formats | written |
|---|---|---|---|---|
| 2026-06 | 16 | 16 | reel 11, carousel 5 | 2026-07-21 |
| 2026-07 | 19 | 19 | reel 9, carousel 9, image 1 | 2026-07-17 |

Prod's 2026-06 holding 16 posts where UAT held 28 is a separate finding — see §3.

**Evidence 3 — the actor emits nothing the mapper misses.** A 300-deep probe of
`ivy_thebrand` returned 278 owned items carrying exactly three distinct `type` values:

```
Video 184   Sidecar 87   Image 7
```

All three map. `type` was present on 278 of 278 items. There is no unmapped string to add.

### So what actually changed

The real defect is that **the loss is silent and its evidence is ambiguous**. The mapper
returns `undefined`, the writer omits the key, and an omitted `mediaType` is byte-identical
to one written before the key existed. Format derivation then narrows to whatever is left
and reports full confidence over the subset.

- **`tallyUnmappedMediaTypes`** (`engine/src/lean-line.ts`) counts every raw value the
  mapper could not place, keyed by the raw string, with an absent `type` tallied separately
  under `(absent)` — the two have different fixes.
- Both writers log it at `warn` with the value, the count and the batch size, at the moment
  of the loss: `ig-producer.ts` (the monthly trawl) and `onboard.ts` `stageTrawl`
  (onboarding and the deep trawl). `stageTrawl` also returns it, because its caller is a CLI
  with an operator reading the output.
- The admin upload path (`admin/src/lib/ingest/ingest-ig.ts`) says the same thing back in
  its result message — it is the path a human pastes hand-edited JSON into.
- The mapper now matches **case-insensitively on a trimmed value**. Not a fix for an
  observed miss: `competitor-gather.ts`'s `normalizeType` has always lowercased, and two
  copies of one rule disagreeing about casing is exactly the silent divergence this commit
  is about.

**Tested with the real shapes.** `lean-line.test.ts` asserts the live `Video`/`Sidecar`/
`Image` mix tallies empty; `ig-producer.test.ts` asserts the warn fires with
`{ Story: 2, '(absent)': 1 }` and that the posts are **still stored** — only their format is
unknown, they are not dropped.

### Recorded, not fixed

**Every `Video` becomes a `reel`.** Apify separates the two on `productType` (`clips` = a
reel, `feed` = an in-feed video), which no writer reads, because `ig_posts`' mediaType enum
has no member to put a feed video in. On ivy-t's 278 items the conflation costs nothing —
all 184 videos are `clips`:

```
Video   / productType=clips               184
Sidecar / productType=undefined            81
Sidecar / productType=carousel_container    6
Image   / productType=undefined             6
Image   / productType=feed                  1
```

An account that posts in-feed video would have those posts counted as reels. Fixing it
needs a fourth enum member and a migration, so it is noted rather than smuggled in.

---

## 2. W1b — depth as a parameter

`APIFY_RESULTS_LIMIT` was a constant in two files. It is now `resultsLimit`, a parameter on
`trawlInstagramPosts` and on `stageTrawl`, **both defaulting to 50**. Nothing routine
changes. The new CLI passes its own.

**The Apify timeout had to move with it.** `APIFY_TIMEOUT_MS = 120_000` was hard-coded in
the shared fetch helper, and a 300-post call does not return inside it — the first deep
probe aborted at exactly 120s. `fetchApifyPostsForHandle` takes an options object with
`timeoutMs`; the deep trawl defaults to 15 minutes. The measured 300-post call took **132
seconds**. The abort message now names the limit and says why.

### The CLI

```
pnpm --filter @sprigly/worker deep-trawl <client-slug> <handle> --channel <channel> --limit <n> [--dry-run] [--allow-shrink] [--timeout-s <n>]
```

Nothing is defaulted — slug, handle, channel and depth are all typed out. **The handle must
match the one stored on that client's channel**, or the run refuses:

```
$ pnpm --filter @sprigly/worker deep-trawl ivy-t wrong_handle --channel instagram --limit 300 --dry-run
Handle mismatch: you typed "wrong_handle" but ivy-t/instagram is stored as "ivy_thebrand".
Refusing — this is the guard that stops one account's history landing on another client.
```

That is the guard a sandbox check would otherwise provide. A slug typo alone would
otherwise write four years of one account's history onto another client, quietly and
irreversibly.

No Bedrock is spent anywhere in this path. Apify credits scale with `--limit`.

### Conflict behaviour — the answer to "can this regress a row"

**The `ig_posts` upsert is a REPLACE, not a merge.** `onConflictDoUpdate` on the unique
`(client_id, channel, month)` sets `posts` to the whole incoming array. That is correct when
the incoming month is deeper than the stored one and wrong when it is shallower — and
shallower is not hypothetical:

- the **oldest month a deep trawl reaches is partial by construction** — the depth ran out
  part-way through it;
- a post **deleted from Instagram** since the last trawl does not come back.

So `planWrites` (a pure function, `engine/src/deep-trawl.ts`, six tests) compares every
month before it is written:

| stored vs incoming | action | writes |
|---|---|---|
| no stored row | `insert` | yes |
| incoming > stored | `deepen` | yes |
| incoming == stored | `unchanged` | yes |
| incoming < stored | `skipped_would_shrink` | **no** |
| incoming < stored, `--allow-shrink` | `shrink_forced` | yes |

A skipped month is named in the output and warned in the log. **A month the trawl did not
reach never enters the plan, so it cannot be touched.** Nothing is ever deleted. No schema
changes; prod is current through 0091 and no migration was needed or written.

---

## 3. ivy-t on UAT — before and after

Ran `--dry-run` first, then for real. Apify: `raw=300 owned=278 droppedForeign=22
skippedHidden=0 droppedInvalid=0`. **Unmapped media types: none — all mapped.**

### BEFORE (65 posts, 3 months, 34/65 typed, 2026-05-15 .. 2026-07-30)

```
   2026-05  posts=  3  typed=  0  (none)
   2026-06  posts= 28  typed=  0  (none)
   2026-07  posts= 34  typed= 34  reel 18, carousel 12, image 4
```

Format mix over typed posts: **reel 53%, carousel 35%, image 12%.**

### The plan — every month new or deeper, none refused

```
   2022-06  stored=  0 → incoming=  1  (+1)   insert
   2023-11  stored=  0 → incoming=  1  (+1)   insert
   2025-03  stored=  0 → incoming=  1  (+1)   insert
   2025-11  stored=  0 → incoming= 19  (+19)  insert
   2025-12  stored=  0 → incoming= 37  (+37)  insert
   2026-01  stored=  0 → incoming= 31  (+31)  insert
   2026-02  stored=  0 → incoming= 29  (+29)  insert
   2026-03  stored=  0 → incoming= 36  (+36)  insert
   2026-04  stored=  0 → incoming= 28  (+28)  insert
   2026-05  stored=  3 → incoming= 30  (+27)  deepen
   2026-06  stored= 28 → incoming= 29  (+1)   deepen
   2026-07  stored= 34 → incoming= 36  (+2)   deepen
```

### AFTER (re-read from the database — 278 posts, 12 months, 278/278 typed, 2022-06-23 .. 2026-07-31)

```
   2022-06  posts=  1  typed=  1  reel 1
   2023-11  posts=  1  typed=  1  reel 1
   2025-03  posts=  1  typed=  1  carousel 1
   2025-11  posts= 19  typed= 19  reel 14, carousel 5
   2025-12  posts= 37  typed= 37  reel 29, carousel 7, image 1
   2026-01  posts= 31  typed= 31  reel 20, carousel 10, image 1
   2026-02  posts= 29  typed= 29  reel 20, carousel 9
   2026-03  posts= 36  typed= 36  reel 25, carousel 11
   2026-04  posts= 28  typed= 28  reel 20, carousel 8
   2026-05  posts= 30  typed= 30  reel 17, carousel 12, image 1
   2026-06  posts= 29  typed= 29  reel 17, carousel 12
   2026-07  posts= 36  typed= 36  reel 20, carousel 12, image 4
```

Format mix over typed posts: **reel 66%, carousel 31%, image 3%.**

### What the depth changed about the format mix

| format | before (34 typed) | after (278 typed) |
|---|---|---|
| reel | 53% | **66%** |
| carousel | 35% | 31% |
| image | **12%** | **3%** |

Image was over-weighted **four-fold** by the shallow window — 4 posts in a single month read
as one-in-eight of her output when across a year it is one-in-thirty-three. Any format
decision taken from the 34-post sample was reading a month, not a habit.

---

## 4. Pillar weights, before and after depth

`onboard-client --calibrate` re-derived voice and pillars from the deepened history —
**files only, no DB writes**, 2 Bedrock calls (Sonnet, in=57339/out=3074 and
in=57082/out=207). Captions analysed went from **50 across 3 months to 278 across 12**.

| before (50 captions) | | after (278 captions) | |
|---|---|---|---|
| Style Inspiration | 28% | Product Launches | **30%** |
| Product Spotlights | 25% | Outfit Inspiration | 25% |
| Brand Values & Quality | 20% | Brand Values & Ethics | 20% |
| Founder & Team Stories | 15% | Founder Story & Community | 15% |
| Promotions & Sales | 12% | Promotions & Sales | 10% |

The shape is stable — five pillars, the same four themes, the same middle three weights —
which is itself worth knowing: the shallow derivation was not wrong, it was **imprecise at
the top and blind at the edges**.

What depth actually bought:

- **The top two swapped.** Product went 25% → 30% and became the lead; styling went 28% →
  25%. On three months of summer, styling looked like the spine. Over a year, launches are.
- **Seasonal content became visible.** The after-pillar for promotions names *"Black Friday
  discounts"* — a thing that only exists in the November and December months the shallow
  window could not see. Same for the values pillar, which now names *"ethical Portuguese
  manufacturing"* and *"slow fashion"* rather than the generic "organic cotton, ethical
  production".
- **Community entered the frame.** "Founder & Team Stories" → "Founder Story & Community",
  now naming customer reviews and milestones — content that clusters around anniversaries
  the three-month window sat between.

Files: `docs/calibration/ivy-t-2026-07/` (before) and `docs/calibration/ivy-t-2026-07-deep/`
(after). Both untracked, as that directory already was.

---

## 5. Runbook

### 5.1 Deep-trawl ivy_thebrand on UAT, and verify

```bash
cd ~/Workspaces/sprigly/dev

# Confirm which database you are pointed at. UAT has THREE clients — the earl-of-east row
# is the discriminator; production does not have it.
set -a && . ./.env.local && set +a
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -Atc "SELECT slug FROM clients ORDER BY slug"
# expect: earl-of-east / ivy-t / sprigly     host hayabusa.proxy.rlwy.net:24746

# Plan it. Writes nothing; prints the per-month plan and the projected breakdown.
pnpm --filter @sprigly/worker deep-trawl ivy-t ivy_thebrand --channel instagram --limit 300 --dry-run

# Read the plan. Every month should say insert or deepen. If any says
# skipped_would_shrink, STOP and understand why before going further.

# Apply. ~2.5 minutes at depth 300.
pnpm --filter @sprigly/worker deep-trawl ivy-t ivy_thebrand --channel instagram --limit 300
```

The CLI prints its own verification — counts, date range and format breakdown per month,
re-read from the database after the write, plus the unmapped-media-type line. There is no
separate verify step to run.

### 5.2 The same on PRODUCTION

The pnpm script sources `../.env.local`. **It has no production form** — running against
prod means invoking the CLI directly with the prod environment sourced, deliberately:

```bash
cd ~/Workspaces/sprigly/dev

# FINGERPRINT FIRST — the gate. Prod has ivy-t and sprigly and NO earl-of-east.
set -a && . ./.env.prod && set +a
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -Atc "SHOW transaction_read_only; SELECT slug FROM clients ORDER BY slug"
# expect: on / ivy-t / sprigly              host yamabiko.proxy.rlwy.net:59459
# If earl-of-east appears, you are on UAT. Stop.

# .env.prod carries no APIFY_API_KEY — take it from the UAT env explicitly, so the one
# credential that is not prod's is the one you had to type.
export APIFY_API_KEY="$(grep '^APIFY_API_KEY=' .env.local | cut -d= -f2-)"

cd engine
npx tsx src/deep-trawl-cli.ts ivy-t ivy_thebrand --channel instagram --limit 300 --dry-run
```

Read the plan, then drop `--dry-run`. **Expect prod's 2026-06 to `deepen` from 16 to ~29** —
that row is truncated (see §1, evidence 2) because a 21 July run at depth 50 only reached
back to early June. Prod holds no rows before 2026-06, so every earlier month is an
`insert`.

`PGOPTIONS` above applies only to the `psql` fingerprint. The trawl itself must write, so do
not export it into that shell.

### 5.3 Compare pillar weights before and after depth

Files only. No DB writes, no client created. Two Bedrock calls.

```bash
cd ~/Workspaces/sprigly/dev/engine
set -a && . ../.env.local && set +a

# The env schema wants GOOGLE_CLIENT_ID / _SECRET; .env.local only carries the _UAT forms.
# This is why the pnpm `onboard-client` script fails on --calibrate as it stands.
export GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID_UAT" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET_UAT"

npx tsx src/onboarding/onboard-client-cli.ts --calibrate ivy-t --channel instagram \
  --out-dir ~/Workspaces/sprigly/dev/docs/calibration/<label>
```

Then read `derived-pillars.json` against the pre-depth run in
`docs/calibration/ivy-t-2026-07/`, and `DIFF-SUMMARY.md` for the caption count and month
span that produced each. The comparison is structural — it does not score, it lays the two
side by side for a human to judge.

---

## 6. **Before September is drafted — the cadence collapse**

This is the one thing tonight's work makes worse, and it is live on UAT now.

`draft-plan.ts` `loadHistory` reads **every stored month**, and `observeCadence` computes
`postsPerWeek` as post count over the **full first-to-last span**. The deep trawl reached
three posts that predate ivy-t's continuous posting run by years:

```
2022-06-23   2023-11-18   2025-03-15   |   then 2025-11-15 onward, 275 posts, unbroken
```

Measured over what is now stored:

| window | posts | span | posts/week | September slots |
|---|---|---|---|---|
| all 12 months (what runs today) | 278 | 214.2 weeks | **1.30** | **≈6** |
| from 2025-11 (the real run) | 275 | 36.9 weeks | **7.46** | ≈30 (day-capped) |
| before the deep trawl | 65 | 10.9 weeks | ~6.0 | ≈26 |

**`configPostsPerWeek` cannot rescue this.** `buildSkeleton` uses the observed rate whenever
history is not thin and the rate is above zero — and 278 posts is emphatically not thin, so
the configured cadence is never consulted. The only lever that outranks observed cadence is
`floorSlots`, which comes from a client-stated `kind:'cadence'` intake.

Three ways out, in increasing order of effort:

1. **Drop the three outlier months.** One statement, and re-runnable — the rows come back
   from any deep trawl that reaches them.
   ```sql
   DELETE FROM ig_posts
   WHERE client_id = 'c79cf1c5-b51d-4a9b-aedc-48577df43e8f'
     AND channel = 'instagram'
     AND month IN ('2022-06', '2023-11', '2025-03');
   ```
   Restores 7.46 posts/week. Costs three posts of caption corpus out of 278 — the pillar
   derivation would not notice.
2. **Trawl less deep.** At `--limit 200` the window likely stops after 2025-11 and the
   outliers are never reached. Untested; `--dry-run` would show it.
3. **Teach `observeCadence` to ignore a sparse leading tail** — the durable fix, and the
   only one that survives the next deep trawl of the next client. Not attempted tonight; it
   changes a function four other things read.

**Recommendation: (1) now, (3) as its own piece of work.** Do not draft September until one
of them is applied — as it stands the skeleton would be built at six slots.

Note this is not caused by the deep trawl so much as **exposed** by it: the same collapse
would hit any account whose early posts are sparse, and nothing warned about it before.

---

## 7. Gates

| gate | result |
|---|---|
| `pnpm --filter @sprigly/worker... build` | pass (all 11 packages + worker) |
| `pnpm --filter @sprigly/web type-check` | pass |
| engine `vitest run` | **31 files, 462 passed**, 4 skipped |
| admin `vitest run` | 4 files, 60 passed |

Engine tests need `DATABASE_URL` in the environment or ten suites fail at import on
`packages/db/src/client.ts`'s env parse. That is pre-existing and unrelated; a dummy value
is enough (`DATABASE_URL='postgres://u:p@127.0.0.1:5432/none'`), and with it the suite is
fully green. Worth its own fix — a green-looking run that skipped ten files is the same
class of quiet loss as §1.

New tests: 14 in `deep-trawl.test.ts` (the shrink guard, London-month grouping, the
snapshot summary, the owner refusal), 5 in `lean-line.test.ts` (the tally), 5 in
`ig-producer.test.ts` (the warn, and depth reaching the Apify body).

Node here is v20.19.5. The engine suites are node-environment so this is sound, but the
jsdom-based app tests would silently skip — they were not part of this work and were not
run.

---

## 8. W2 — already done

**The apply-confirmation turn is persisted. No work was needed and none was done.** It
landed in `6721e40` ("feat: a pending intent — the question turn's answer has somewhere to
go"), after `5eafdd4` — the round-2 conversation-sheet report that still lists it as open.

- `app/src/app/api/plan/conversation/confirm/route.ts` — writes the settled report as an
  `assistant` turn with `metadata.confirmation`, ownership-checked against
  `conversations.clientId`, text capped at 500 chars. Its header names the round-1
  carryover explicitly.
- `app/src/components/plan/surface/CommittedSurface.tsx:206-212` — fires on both the success
  and the failure text, best-effort so a failed write cannot change what the client already
  read on screen.
- It also carries the G3 rescue: a single non-retryable refusal is written back as a
  `PendingIntent` derived server-side from the proposal's stored payload, so "the 30th then"
  has a referent.
- Covered by `app/src/app/api/plan/conversation/confirm/confirm-route.test.ts`.

`docs/reports/conversation-sheet-2.md:278` is stale and still lists it under "Still open".
Left alone — correcting another report's findings was not this session's brief.

---

## 9. Still open

- **The cadence collapse (§6).** Blocks September. Needs an operator decision tonight.
- **`Video` → `reel` conflates reels with in-feed video (§1).** Latent on ivy-t, real for
  the next client. Needs a fourth enum member and a migration.
- **A shallow trawl will undo a deep one.** The monthly `ig-trawl` job still runs at 50 and
  replaces the month it targets. On an account posting ~30/month it will hold that month
  steady, but nothing stops a re-trawl narrowing a month the deep run had filled. The guard
  added tonight lives in the deep-trawl path only — `trawlInstagramPosts` writes
  unconditionally. Moving `planWrites` into the routine trawl is a small change and probably
  the right one.
- **Prod is untouched.** §5.2 has the commands; nothing there has been run.
- **The 22 dropped foreign items** at depth 300 are posts tagging ivy_thebrand, correctly
  filtered by the owner guard. Noted only so the 300 → 278 gap is not read as a loss.
- **An aborted Apify call may leave the run going server-side.** The first probe aborted at
  120s locally; whether the actor run continued and consumed credits was not checked. Worth
  knowing before anyone tunes `--timeout-s` down.
