# Cycle 040d6a1a (earl-of-east, Oct 2026) — what generated, and why it isn't the approved month

**Date:** 2026-07-21
**Branch:** `dev`
**Mode:** read-only. UAT only (`10.160.160.193`), `PGOPTIONS='-c default_transaction_read_only=on'` verified on connect. SELECTs only, no writes, no fixes.

---

## Verdict up front

**No whole-plan run fired.** These rows are the approval fan-out's output. `planning_trace`
holds zero rows for this cycle, the cycle is still `status='scheduled'`, and every row
carries `beat_meta` — which the planning writer never sets.

The content diverges because **the approved beat set was not the beat set the operator
believes was approved.** Of the 11 beats approved at 07:36:56, **7 were generic hand-added
beats whose only subject was a pillar name**, 3 were launch-arc beats, and 1 was the sole
surviving assembler beat. Six of the nine arc beats — including all three Meadow beats —
were **hard-deleted between 07:31:04 and approval**, by direct draft mutations, not by any
transform.

Hooks and scripts are a separate, purely structural defect: **7 hook jobs ran and were paid
for, but `hook.ts` never writes to the database** — it returns candidates for a human to
choose, and in this path nobody chooses. Scripts are then deliberately gated on a hook
landing, so they never enqueued at all.

---

## 1. What is actually in `content_cycle_posts`

11 rows, all live (`deleted_at IS NULL`), all `status='new'`, all with `beat_meta`, **none**
with a hook or script.

```
    date    | dow |  format  |         pillar         |                 title                  | status | bm | hk | sc | pos | created  | updated
------------+-----+----------+------------------------+----------------------------------------+--------+----+----+----+-----+----------+----------
 2026-10-01 | Thu | carousel | Everyday Ritual        | Everyday Ritual                        | new    | t  | f  | f  |  10 | 07:22:43 | 07:37:15
 2026-10-01 | Thu | reel     | Everyday Ritual        | Everyday Ritual                        | new    | t  | f  | f  |  25 | 07:33:07 | 07:37:10
 2026-10-04 | Sun | carousel | Product & Fragrance    | Product & Fragrance                    | new    | t  | f  | f  |  26 | 07:33:15 | 07:37:28
 2026-10-06 | Tue | single   | Brand Story & Culture  | Brand Story & Culture                  | new    | t  | f  | f  |  24 | 07:32:58 | 07:37:31
 2026-10-08 | Thu | reel     | Home & Space           | Home & Space                           | new    | t  | f  | f  |  23 | 07:32:26 | 07:37:44
 2026-10-16 | Fri | single   | Everyday Ritual        | Everyday Ritual                        | new    | t  | f  | f  |  21 | 07:32:04 | 07:37:44
 2026-10-22 | Thu | carousel | Product & Fragrance    | restock of the ceramics range — Follow  | new    | t  | f  | f  |  19 | 07:31:04 | 07:37:55
 2026-10-26 | Mon | single   | Brand Story & Culture  | wilderness candle launch — Tease        | new    | t  | f  | f  |  11 | 07:24:49 | 07:38:00
 2026-10-29 | Thu | single   | Workshops & Experience | An afternoon spent making something     | new    | t  | f  | f  |   9 | 06:32:00 | 07:38:06
 2026-10-31 | Sat | carousel | Workshops & Experience | wilderness candle launch — Follow-up    | new    | t  | f  | f  |  13 | 07:24:49 | 07:38:21
 2026-10-31 | Sat | reel     | Home & Space           | Home & Space                           | new    | t  | f  | f  |  27 | 07:33:23 | 07:38:13
```

**Provenance, from `beat_meta`** — this is the key table:

```
 scheduled_date |               title                |  slot  |    basis     | touched
----------------+------------------------------------+--------+--------------+---------
 2026-10-01     | Everyday Ritual                    | proven | client_added | true
 2026-10-01     | Everyday Ritual                    | proven | client_added | true
 2026-10-04     | Product & Fragrance                | proven | client_added | true
 2026-10-06     | Brand Story & Culture              | proven | client_added | true
 2026-10-08     | Home & Space                       | proven | client_added | true
 2026-10-16     | Everyday Ritual                    | proven | client_added | true
 2026-10-22     | restock of the ceramics range — Fo  | proven | client_input | true
 2026-10-26     | wilderness candle launch — Tease    | proven | client_input |
 2026-10-29     | An afternoon spent making somethin  | proven | observed     |
 2026-10-31     | wilderness candle launch — Follow-  | proven | client_input |
 2026-10-31     | Home & Space                       | proven | client_added | true
```

**7 of 11 are `client_added`** — the Build B manual add (`draft-mutations.ts:addBeat`,
whose evidence is documented as `{basis:'client_added'} and nothing else`). Their
`source_meta.title` is just the pillar name, because that is all `addBeat` records.

**Position gaps are the story of the deletions.** Live positions are
`9, 10, 11, 13, 19, 21, 23, 24, 25, 26, 27`. Missing: **12, 14, 15, 16, 17, 18, 20, 22**.
Positions are assigned `max(position)+1` at write time (`draft-apply.ts:252`), so the arcs
occupied contiguous runs:

| application | positions | survives |
|---|---|---|
| Wilderness (07:24:47) | 11, **12**, 13 | Tease + Follow-up — **Launch (12) gone** |
| Meadow (07:27:42) | **14, 15, 16** | **none** |
| Ceramics (07:31:01) | **17, 18**, 19 | Follow-up only — **Tease + Launch gone** |

---

## 2. What was approved, and the diff

The surviving record is `content_cycles.intake_json.draftApplications` — **7 receipts**:

```
            at            |    scope     |                 source_text                  | changed | reason
--------------------------+--------------+----------------------------------------------+---------+----------------------
 2026-07-21T07:24:47.128Z | month_scoped | The wilderness candle launches on the 31st    |       3 |
 2026-07-21T07:27:42.288Z | month_scoped | We're also relaunching the Meadow candle on…  |       3 |
 2026-07-21T07:28:14.645Z | evergreen    | Meadow candle launch is the 10th not the 1st  |       0 | validation_failed
 2026-07-21T07:28:41.288Z | evergreen    | Meadow candle launch is the 10th not the 1st… |       0 | validation_failed
 2026-07-21T07:29:23.429Z | evergreen    | Saw a lovely unboxing reel idea…              |       0 | classified_evergreen
 2026-07-21T07:29:38.120Z | evergreen    | We should do a founder story.                 |       0 | classified_evergreen
 2026-07-21T07:31:01.762Z | month_scoped | Actually there's a restock of the ceramics…   |       3 |
```

Joining every receipt's `changedIds` against live rows — **the diff**:

```
            at            |                src                 |               post_id                | still_exists |                 title
--------------------------+------------------------------------+--------------------------------------+--------------+-------------------------------------------
 …07:24:47Z | The wilderness candle launches on  | 1530fe4a-…097b | t | wilderness candle launch — Tease
 …07:24:47Z | The wilderness candle launches on  | ef3ca5c5-…a316 | t | wilderness candle launch — Follow-up
 …07:24:47Z | The wilderness candle launches on  | 8f650f89-…f9d1 | f | —
 …07:27:42Z | We're also relaunching the Meadow  | b1670bd1-…7c62 | f | —
 …07:27:42Z | We're also relaunching the Meadow  | 2ba459f1-…a852 | f | —
 …07:27:42Z | We're also relaunching the Meadow  | bf2bd59c-…252b | f | —
 …07:31:01Z | Actually there's a restock of the  | 21bd2a73-…5873 | t | restock of the ceramics range — Follow-up
 …07:31:01Z | Actually there's a restock of the  | b0373aa2-…31eb | f | —
 …07:31:01Z | Actually there's a restock of the  | f53b3971-…2929 | f | —
```

**Nine arc beats were created. Three survive.** The operator's description ("only one
Wilderness post, nothing for Meadow") matches — they have two Wilderness beats, but the
Launch itself is missing from all three arcs.

---

## 3. Which path wrote the current rows — timeline

**CONFIRMED: the approval fan-out, not a whole-plan run.**

| time (2026-07-21) | event | evidence |
|---|---|---|
| 06:32:00 | one assembler beat created (pos 9) | `created_at`, `basis='observed'` |
| 07:22:43 | first hand-added beat (pos 10) | `basis='client_added'` |
| 07:24:47 | Wilderness arc applied (pos 11–13) | receipt |
| 07:27:42 | Meadow arc applied (pos 14–16) | receipt |
| 07:28:14 / 07:28:41 | two Meadow date corrections → backlog | receipts, `plan_inputs` |
| 07:29:23 / 07:29:38 | two genuine evergreen ideas → backlog | receipts |
| 07:31:01–07:31:04 | Ceramics arc applied (pos 17–19) | receipt, `created_at` |
| **07:32:04 – 07:33:23** | **6 beats hard-deleted; 6 `client_added` beats inserted (pos 21–27)** | position gaps + `created_at` |
| **07:36:56.909** | **approved, `approved_by='client'`** | `content_cycles.approved_at` |
| 07:37:02 – 07:38:16 | 7 `content-cycle:hook` Bedrock calls | `audit_log` |
| 07:37:08 – 07:38:21 | 11 shape jobs (11 critic + 14 repair calls) | `audit_log`, `plan_activity` |
| **07:38:21.55** | **`plan_ready_sent_at` — settlement fired, email sent** | `content_cycles` |

**Ruling out a whole-plan run** — four independent proofs:

1. `SELECT count(*) FROM planning_trace WHERE cycle_id='040d6a1a…'` → **0 rows.** Every
   planning run writes gate/critic/repair trace rows.
2. `content_cycles.status` is still **`'scheduled'`**. `runPlanningForCycle` transitions
   `→ planning → workbook_built` (`planning.ts:1170-1171`), and additionally refuses to run
   at all unless status is `intake_confirmed` (`planning.ts:824`).
3. **Every row carries `beat_meta`.** The planning writer's insert (`planning.ts:1025`)
   never sets it; only the draft assembler and the transforms do.
4. `draft_csv_ref`, `workbook_ref`, `posts_sync_status` are all NULL — a completed planning
   run stamps them.

**The 5am scheduler-tick never touched this cycle.** Every scheduler stamp is NULL:
`ask_sent_at`, `nudge_sent_at`, `last_call_sent_at`, `ask_skip_reason`, `request_sent_at`,
`ig_input_status`, `ig_input_checked_at`. And it could not have: `client_channels.content_cycle_schedule`
is **NULL** for this channel, so there is no `cutoffDay`; `deriveTouchSchedule`
(`packages/engine/src/touch-schedule.ts:32-48`) returns `configured: false`, `dueTouch`
returns null, and `evaluateAutoRunForClient` returns `'skipped'` before any branch.

`audit_log` corroborates: only `content-cycle:hook`, `content-cycle:planning-critic` and
`content-cycle:planning-repair` — the per-post signature. A baseline run would show
`content-cycle:planning` generation calls, of which there are none.

---

## 4. Not applicable

No whole-plan run fired, so there is no trigger path to identify. §3 rules it out four ways
and shows the auto-run branch was unreachable for this client (no `cutoffDay`).

---

## 5. Why the content diverges, and why hooks/scripts are absent

### 5a. The captions are generic because the beats were

**CONFIRMED.** 7 of the 11 approved beats are `client_added` with `source_meta.title` equal
to the pillar name. The fan-out's caption instruction (`phase2.ts:40`) is:

```ts
return `Write the caption for this post. It is the "${title}" slot in this month's plan${pillar ? `, under the ${pillar} pillar` : ''}. Keep it to that subject.`;
```

For those 7 beats that renders as *'It is the "Everyday Ritual" slot in this month's plan,
under the Everyday Ritual pillar'* — a prompt containing no subject beyond a pillar name.
The model returned generic seasonal copy, which is the correct response to that instruction.

This is not a prompt defect and not a fan-out defect. **The fan-out generated exactly what
it was asked to generate.** The 3 arc beats that survived did get their subject — their
captions are about the wilderness candle and the ceramics restock.

### 5b. Hooks: the jobs ran, the results were never written

**CONFIRMED, and this is a real defect.**

```
            action             | n  |  first   |   last
-------------------------------+----+----------+----------
 content-cycle:hook            |  7 | 07:37:02 | 07:38:16
```

Seven hook calls for exactly the seven eligible posts (4 carousels + 3 reels — `HOOK_FORMATS`
is `{reel, carousel}`, `phase2.ts:31`). Every one succeeded and was billed. Yet
`hook IS NULL` on all 11 rows.

The cause: **`engine/src/content-cycles/hook.ts` contains no database write at all.** Its
only exit is `return { candidates }` (`hook.ts:127`), surfaced as `job.returnvalue` for
`GET /api/jobs/:id` (`consumer.ts:148`). A hook is stored only when a human picks a
candidate and saves it.

The approval fan-out enqueues these jobs with no human in the loop. **A hook can never land
via this path.** The Bedrock spend is real; the output is discarded.

### 5c. Scripts: never enqueued, by design, on a precondition that can't be met

**CONFIRMED.** Zero `content-cycle:script` calls. `phase2.ts:22-23` states it plainly:

> *"Ordering matters for reels: a script needs a hook and a caption, so scripts are enqueued
> by the client AFTER a hook lands rather than blindly here (see enqueueScriptsForReady)."*

Scripts are gated on a hook landing. Per §5b a hook never lands in this path. So the chain
is: **no hook write → no script enqueue → no scripts.** `script.ts:83` *does* write, so
scripts would work if they were ever enqueued.

### 5d. Settlement declared the month ready anyway

`plan_ready_sent_at = 07:38:21.55`, immediately after the last caption. The settlement
predicate is "nothing generating AND no pending shape/hook/script job" — which was true: the
hook jobs had completed (having written nothing), and no script job ever existed. The
predicate has no notion of *unresolved* hooks, so it correctly reported a month that is
structurally incomplete.

---

## 6. The Meadow question

**The beats existed. All three were deleted before approval. Separately, the client's two
attempts to correct the date never reached the month at all.**

1. **Created.** The 07:27:42 receipt is `month_scoped` with 3 `changedIds` and 6 rendered
   diff lines — a full three-beat arc was allocated (`applyLaunchArc`, `draft-transforms.ts:164`)
   at positions 14–16.
2. **Deleted.** All three ids resolve to no row (§2). Positions 14, 15, 16 are absent.
3. **The corrections were misrouted.** At 07:28:14 and 07:28:41 the client wrote *"Meadow
   candle launch is the 10th not the 1st"* — twice. Both were classified `evergreen` with
   reason **`validation_failed`**, meaning the classifier's structured output failed its
   schema contract (`packages/engine/src/intake-classify.ts:133-138`) and fell back to the
   backlog. Both landed in `plan_inputs` as ideas:

```
    t     | type | origin | lifecycle |                    content
----------+------+--------+-----------+------------------------------------------------
 07:28:16 | idea | client | candidate | Meadow candle launch is the 10th not the 1st
 07:28:43 | idea | client | candidate | Meadow candle launch is the 10th not the 1st October
```

So the client twice told the system its Meadow dates were wrong, and both times the system
filed the correction as a future idea rather than changing the month — and told them so only
via a receipt reading "added to your ideas".

### What deleted the six arc beats — CONFIRMED negative, INFERRED positive

**It was not a transform, and not a re-assembly.** Confirmed:

- Every month-scoped transform persists a receipt (`draft-apply.ts:266`, `persistReceipt`).
  There are exactly **7 receipts, the last at 07:31:01.762** — yet the deleted set includes
  the ceramics Tease and Launch, created at **07:31:04**. Nothing that writes receipts ran
  after them.
- The displacement protection is intact end to end. `isReplaceable` excludes
  `isClientOriginated` (`draft-transforms.ts:67-68`), which returns true for
  `basis === 'client_input'` (`:62`) — exactly what the arc beats carry
  (`clientInputMeta`, `draft-transforms.ts:186`). It is persisted (`draft-apply.ts:122`),
  re-read (`:69`) and mapped faithfully (`:56`). The surviving arc rows prove the value is
  stored correctly. A transform *could not* have chosen them.
- A re-assembly would have deleted every draft row including the 07:24 Wilderness beats,
  which survive with their original `created_at`.

**Inferred:** the deletions were direct `dropBeat` calls from the client surface, in the
07:32:04–07:33:23 window, interleaved with the six `addBeat` insertions that carry
`client_added` + `clientTouched: true`. Six deletions, six additions, ninety seconds — the
"hand edits" in the symptom description.

**This is inference, not proof, and it cannot be made proof from the data.** `dropBeat` is a
deliberate hard delete with no tombstone (`draft-mutations.ts:196-202`, documented at
`:190-195`), draft mutations write no `plan_activity` (the ledger holds only the 11
`caption_saved` rows), and `ui_events` is empty for this client. **A client can destroy an
arc they asked for, minutes after asking for it, and the system retains no record that it
happened.** That absence is itself a finding.

---

## Plain statement: mechanism, and the smallest correct fix

**Mechanism.** Three separate things produced the current state; only one is a code defect.

1. **The approved month genuinely was mostly generic beats.** Seven of eleven were
   hand-added with no subject but a pillar name, after six arc beats had been hard-deleted.
   The fan-out then generated faithfully from what it was given. *Not a defect — the
   generation did its job on a degraded input.*
2. **The client's Meadow date correction was swallowed twice** by `validation_failed`
   falling back to the backlog. *A defect in classifier robustness / fallback routing, and
   the most user-visible of the three.*
3. **Hooks cannot land via the approval fan-out, and scripts are gated behind hooks.**
   Seven Bedrock calls were made and discarded. *An unambiguous structural defect.*

**Smallest correct fix:** make the hook job persist its top candidate when it runs as part
of the approval fan-out. That is the single break in the chain — `hook.ts` returns candidates
and writes nothing (`hook.ts:127`), which both leaves reels hookless and, because
`phase2.ts` defers scripts until "a hook lands", prevents scripts from ever being enqueued.
Writing the chosen hook restores both in one change, and stops paying for output that is
thrown away. The interactive path (client picks from candidates) is unaffected if the write
is conditioned on the fan-out context rather than applied unconditionally.

The other two need decisions, not just code, so I am not proposing fixes for them:

- **Draft deletions leave no trace.** Whether that should change is a product call
  (a tombstone or a ledger entry for draft drops), but until it does, "where did my beats
  go?" is unanswerable from the data — as this investigation found.
- **`validation_failed` silently demotes a month-scoped correction to a backlog idea.**
  A retry, or surfacing "I couldn't apply that — say it another way?", would have saved this
  month. Which of those is right is a product decision.

---

## Out-of-scope observations

1. **The Wilderness date disagrees with the brief.** The receipt records *"launches on the
   31st"*, and the surviving beats are Tease 10-26 / Follow-up 10-31 — the Tease lands
   **five days before** the launch and the Follow-up **on** it. The operator's account says
   the 24th. Worth checking whether the arc offsets (`LAUNCH_ARC`) place a Tease sensibly
   when the anchor is the last day of the month; `clampToMonth` will compress any part that
   would fall into November.
2. **Only one assembler beat survived** the session (10-29, `basis='observed'`). The
   assembled draft was almost entirely replaced by client action before approval — worth
   knowing when judging whether the assembler is earning its keep.
3. **`posts_sync_status` is NULL** for a cycle that has generated posts. It is only stamped
   by the planning path, so an approval-arc cycle never gets sync provenance.
4. **Migration 0089 is applied on UAT** (`plan_ready_sent_at` populated), confirming the
   settlement build is live there. Prod still lacks 0084/0086/0087/0089.
