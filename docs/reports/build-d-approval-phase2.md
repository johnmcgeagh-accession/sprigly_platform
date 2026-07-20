# Build D — Approval + Phase 2 generation

**Date:** 2026-07-20 · **Branch:** `dev` (not pushed) · **Build C baseline:** `3e50e84`
**Status:** Complete. Eight commits. The loop closes.

---

## 1. The dogfood run — the proof

Full loop against **live dev data** for `earl-of-east`: assemble → one month-scoped intake
input → approve (client path) → phase 2. Real Bedrock spend, one cycle, once.

**Setup:** a new pre-cutoff cycle (`040d6a1a…`, `cycle_month=2026-09`, planning October) was
created for earl-of-east. The sprigly dogfood client was not usable — it has **zero
`ig_posts`**, so its draft would have been the thin-data template path, and earl-of-east's
existing cycles are all `workbook_built` (post-cutoff, with committed posts).

**Phase 2 was invoked inline** via the same handlers the worker calls (`runShapeForCycle`,
`runHookForPost`, `runScriptForPost`) rather than through Redis, so the run needed no live
worker. The generation path exercised is identical; only the queue hop is absent, and that
is covered by the fan-out tests.

### The intake input and its routing

```
input: "The Wilderness candle relaunches on the 24th, can we build up to it?"

REAL classifier call → scope=month_scoped kind=launch
                       subject="Wilderness candle relaunch"
                       dateRange={"start":"2026-10-24","end":"2026-10-24"}
```

**The live classifier read it correctly** — the open question Build C flagged as unproven.
It resolved "the 24th" against the plan month and read "can we build up to it?" as a launch
arc rather than an event.

### The approved beats (10)

```
2026-10-01  reel      Home & Space              Wilderness candle relaunch — Launch
2026-10-01  single    Everyday Ritual           A small moment, made deliberate
2026-10-02  single    Everyday Ritual           …
2026-10-04  carousel  Home & Space              …
2026-10-09  single    Product & Fragrance       Fragrance that builds slowly
2026-10-16  single    Brand Story & Culture     The people behind the work
2026-10-21  carousel  Everyday Ritual           Quiet rituals, one by one
2026-10-22  single    Home & Space              A room that holds the day
2026-10-28  single    Product & Fragrance       Something for the senses
2026-10-29  single    Workshops & Experiences   An afternoon spent making things
```

### Verification

```
structure drift across phase 2: 0 of 10

2026-10-01 single    status=new                caption= 274ch hook= no script= no
2026-10-01 reel      status=new                caption= 583ch hook=yes script=yes
2026-10-02 single    status=new                caption= 705ch hook= no script= no
2026-10-04 carousel  status=generation_failed  caption=  none hook=yes script= no
2026-10-09 single    status=new                caption= 614ch hook= no script= no
2026-10-16 single    status=new                caption= 732ch hook= no script= no
2026-10-21 carousel  status=new                caption= 714ch hook=yes script= no
2026-10-22 single    status=new                caption= 810ch hook= no script= no
2026-10-28 single    status=new                caption= 711ch hook= no script= no
2026-10-29 single    status=new                caption= 726ch hook= no script= no
```

**Zero structure drift across ten posts.** Every `scheduled_date`, `format` and `pillar` is
byte-identical to the approved beat. That is the structural-merge fix (`613030e`) doing its
job: shape.ts writes `{caption, status}` only, and the fields inside the regeneration are
pinned in code rather than requested in a prompt.

**One post failed** — a Bedrock 180s timeout — and landed in `generation_failed` while the
other nine completed. Exactly the partial-failure posture: a month with one broken post is
one the client can work with.

### Full generated post — the reel (with hook and script)

```
date    2026-10-01   format reel   pillar Home & Space   status new
title   Wilderness candle relaunch — Launch

hook    What autumn light taught us about how a room should smell.

caption Wilderness is back.

        There is a particular quality to autumn light indoors, the way it sits low and
        golden across a room, making everything feel a little more considered, a little
        more still. Wilderness was made for exactly that.

        Cedarwood, damp earth, and the cold-clean note of open air brought inside. She
        fills a room without announcing herself, building quietly over the first hour
        until the whole space feels grounded and unhurried.

        Our Wilderness Soy Wax Candle is live now. Head to the link in bio.

        // #earlofeast #wilderness #homerituals #scentedcandle #ritualovertoutine

script  HOOK: What autumn light taught us about how a room should smell.

        BEAT 1 (0–8s) — That low, golden quality it has — the way it makes a room feel
        still. (slow pan across a sunlit interior, dust motes, warm shadows)

        BEAT 2 (8–18s) — Wilderness is cedarwood, damp earth, cold-clean air — building
        quietly until the whole space feels grounded. (close on candle flame, soft focus)

        BEAT 3 (18–26s) — She doesn't announce herself. She just settles.
        (wide shot, room held in amber afternoon light)

        CTA: Our Wilderness Soy Wax Candle is live now — link in bio. (product close-up)
```

The beat came from the client's sentence, the caption is on-brand, and the script grounds on
the chosen hook verbatim.

**One flaw visible in that output**: the caption's final hashtag reads `#ritualovertoutine`
— a corrupted `#ritualoverroutine`. The gate does not check hashtags, so it passed. Recorded
in §9, unfixed.

### Full generated post — the carousel (with hook)

```
date    2026-10-21   format carousel   pillar Everyday Ritual   status new
title   Quiet rituals, one by one

hook    The quiet version of holding the day together.

caption The ones that quietly hold the day together.

        Not the grand gestures, but the small, deliberate acts that mark the shift from
        one part of the day to the next. The incense lit before sitting down to work. The
        reed diffuser in the hallway that meets you when you come home. The candle that
        signals the evening has properly begun.

        We think of these less as habits and more as checkpoints. Moments where the senses
        catch up with the body, where the room you are in starts to feel like somewhere
        you actually want to be.

        Swipe through for a few of the rituals we keep coming back to…
```

---

## 2. Cost

```json
{
  "totalCalls": 19,
  "byAction": {
    "content-cycle:intake-classify": 1,
    "content-cycle:planning-repair": 9,
    "content-cycle:planning-critic": 9
  },
  "inputTokens": 122007,
  "outputTokens": 3588,
  "posts": 10,
  "callsPerPost": 1.9
}
```

**1.9 calls per post against a ceiling of 13.** Nothing looped: every caption passed the
gate and the critic first time (9 captions + 9 critic judgements + 1 classify). No stop-and-
report condition. Nine posts generated for ~122k input tokens.

### The measurement was wrong, and the run is what caught it

The 19 above **undercounts**. `hook.ts` and `script.ts` made **zero** `audit.logModelCall`
writes, so the 3 hook calls and 1 script call were invisible. The true figure is **23**.

The cost guard was designed to read `audit_log` on the argument that *"reading the ledger
cannot drift, because the audit write is on the call path."* The argument was sound and the
premise was false. Both call sites are instrumented now (`4f6f79e`), and the lesson is
recorded in `phase2-cost.ts` rather than merely fixed, because the same gap reopens the next
time someone adds a model call without one.

---

## 3. Target status — the citation

Approval transitions draft rows to **`'generating'`**. Not invented for this build; it is
what the shipped path already uses:

| Step | Location |
|---|---|
| Insert | `app/src/lib/mutations.ts:203` — `addGeneratingPost` inserts `status:'generating'` |
| Read | `engine/src/content-cycles/shape.ts:111` — `isGenerating = post.status === 'generating'` |
| Success | `shape.ts:140` — `status: isGenerating ? 'new' : 'edited'` |
| Failure | `shape.ts:175` — `status: 'generation_failed'` |

An approved beat therefore enters the same lifecycle a client-added post has always used.
Phase 2 needed no new states, and the dogfood run confirms it: nine posts resolved to `new`,
one to `generation_failed`.

---

## 4. AUTO_RUN_ENABLED composition

Phase 0 could not verify its production value, and this build does not read it for a
decision or change it anywhere.

The auto-approve branch sits **inside the same gate** as the baseline enqueue and **above**
the dry-run return, so the flag governs both paths identically:

| `AUTO_RUN_ENABLED` | Cycle HAS a draft | Cycle has NO draft |
|---|---|---|
| **false** (dry) | Logs `would AUTO-APPROVE <n> draft beats … NOT the baseline planning run`. Zero mutation. | Logs the existing `[auto-run:dry]` baseline line. Zero mutation. |
| **true** (live) | Auto-approves, stamps `approved_by='auto'`, fans out phase 2. **Baseline skipped.** | Baseline path exactly as before this build. |

Asserted by test in both draft and no-draft shapes, plus a third case with no `autoApprove`
injected at all — which behaves exactly as before Build D.

Concurrency and retry, cited: worker concurrency **2** (`consumer.ts:233`); shape/hook/script
carry **`attempts: 1`** (`queue.ts:87`, `:130`, `:188`).

---

## 5. Supersession — the interim state is gone

A cycle holding drafts can no longer reach the baseline path, so a regen can no longer run
alongside surviving invisible draft rows. **Eliminated at source rather than cleaned up
after.** The caveat is struck from `docs/plans/draft-plan-intake-arc.md` in `3b3d8f8`.

---

## 6. Fence proof

```
$ git diff 3e50e84..HEAD --stat -- app/src/lib/draft-invisibility.test.ts
(empty)
```

Build A's invisibility suite is byte-unmodified across Builds **B, C and D**, and passes.

---

## 7. Tests

| Suite | Result |
|---|---|
| `@sprigly/app` | **361 passed**, 1 skipped |
| `@sprigly/worker` | **334 passed**, 1 skipped |
| `@sprigly/engine` | **213 passed** |
| `@sprigly/db` | **6 passed** |

Type-check clean across all five packages.

New in Build D: 13 approval, 9 fan-out, 9 flag, 3 scheduler auto-approve, 4 plan-merge
red/green, 3 emphasis-evidence.

Coverage against the brief: approval atomicity and every guard; **double-approve rejected**
(justified below); draft mutations dead post-approval; fan-out partial failure with the post
marked visibly; structure immutability (asserted in the dogfood run, 0/10 drift);
scheduler auto-approve replaces baseline when a draft exists; plan-merge red→green;
flag-off identical to pre-arc.

**Double-approve: rejected, not idempotent-no-op.** Chosen because approval spends money — a
quiet success is indistinguishable from a second fan-out, and paying twice is a worse failure
than an explicit "you've already approved this".

---

## 8. Commits

| Hash | Part | Behaviour |
|---|---|---|
| `9410ec3` | 0 | A re-pillared beat no longer cites the old pillar's metrics |
| `b321c26` | 1 | Gate the draft-plan arc behind `draft_flow_enabled`, default OFF |
| `3035c1f` | 2 | Approval turns a draft month into the committed plan |
| `7da3284` | 3+4 | Fan generation out across an approved month |
| `a9553a1` | 6 | A whole-plan regen no longer deletes generated hooks and scripts |
| `3b3d8f8` | 5 | A draft that reaches its cutoff goes ahead on its own (D3) |
| `4f6f79e` | 4 | Hook and script generation now reach `audit_log` |

Migrations 0087 (approval stamp) and 0088 (`plan_ready_auto`), hand-applied. 0088 needed the
`email_templates.key` CHECK widened — checked for it first this time, per the 0085 lesson,
and found it exactly where expected. `content_cycles` has no CHECK constraints, verified.

`draft_flow_enabled` is ON for `earl-of-east` and `sprigly` on dev. **IVY-t untouched** — it
is the one client with a live `cutoffDay` and real reminder sends.

---

## 9. Unexpected, and left unfixed

1. **The cost guard's premise was false.** `hook.ts` and `script.ts` never wrote to
   `audit_log`, so the first measured run reported 19 calls when 23 were made. Fixed, but
   the class of bug — a new model call added without instrumentation — will recur.

2. **A corrupted hashtag reached a generated caption**: `#ritualovertoutine` for
   `#ritualoverroutine`. The code gate checks instruction leaks, em-dashes, empty captions
   and vocab — not hashtags. A malformed brand hashtag is a small public embarrassment and
   would be cheap to catch deterministically. Out of scope here.

3. **The failed post got a hook but no caption.** My dogfood driver enqueued the hook
   regardless of whether the caption succeeded, so `2026-10-04` sits in `generation_failed`
   with a hook attached. `startPhase2` has the same shape. Arguably a hook without a caption
   is harmless, but it is not deliberate, and the ordering should be a decision.

4. **Auto-approval is implemented twice** — `app/src/lib/draft-approval.ts` and
   `engine/.../draft-plan.ts:autoApproveAndGenerate` — because the worker cannot import from
   `app/`. The rules are deliberately identical and both have tests, but this is a real
   duplication and the first place the two paths will drift.

5. **The sprigly dogfood client is unusable for this loop.** Zero `ig_posts`, so its draft is
   always the thin-data template path. Any future dogfooding needs its feed trawled first.

6. **Phase 2 was run inline, not through the queue.** The generation path is identical, but
   the BullMQ hop, worker concurrency and job retry behaviour were exercised only by unit
   tests, not by this run.

7. **`measurePhase2Cost` is client-scoped, not cycle-scoped**, because `audit_log` has no
   cycle column. It counts calls since `approved_at`, so two cycles approved for the same
   client within the same window would blur together. Adequate today, wrong under load.

8. **One post in ten hit a 180s Bedrock timeout.** That is a 10% first-pass failure rate on a
   small sample. If it holds at scale it is a real operational number, and `attempts: 1` means
   there is no automatic retry behind it — recovery depends on the client pressing regenerate.
