# Round two — the plan-ready email, and where approval navigates

**Date:** 2026-07-21
**Branch:** `dev`
**Cycle:** `040d6a1a-9ad4-4d32-bda2-d67b01f70512` (earl-of-east, plan month October 2026)
**Mode:** read-only. UAT only (`10.160.160.193`), `PGOPTIONS='-c default_transaction_read_only=on'`
verified on connect. SELECTs only; Redis by `--scan`/read commands; Railway logs read-only.
No fixes.

---

## Verdict

**A — the generation all worked. The email failed and the system said it succeeded.**
Every carousel and reel has a hook, both reels have scripts, the script chain fired, and
settlement was legitimate. The send then failed with `No Gmail tokens for client` —
earl-of-east has **no `oauth_connections` row at all** — and the code logged
`plan-ready: settled and sent` one line later. `plan_ready_sent_at` records *an attempt*,
not a delivery, and because the claim is at-most-once it will never retry.

**B — a navigation bug only. The October surface is correct.** October now returns
`committed-redesign` with 12 posts and is in the month menu. After approval the client is
sent to **August**, because the transition is a full page reload and the landing rule then
resolves by date.

---

# SYMPTOM A — no plan-ready email

## A1. `plan_ready_sent_at` — set

```
status             | scheduled
approved_at        | 2026-07-21 09:21:32.234
approved_by        | client
plan_ready_sent_at | 2026-07-21 09:23:01.437+00
```

So this is **not** "settlement never fired". It fired, claimed, and attempted a send.

## A2. Hooks and scripts — Commit 1's fix worked

```
    date    |  format  |             title              | status | cap | hk | sc | secs | updated
------------+----------+--------------------------------+--------+-----+----+----+------+----------
 2026-10-01 | single   | restock of the ceramics range  | new    | t   | f  | f  |      | 09:21:43
 2026-10-01 | reel     | restock of the ceramics range  | new    | t   | t  | t  |   30 | 09:22:55
 2026-10-02 | carousel | Saw a lovely unboxing reel ide | new    | t   | t  | f  |      | 09:21:58
 2026-10-02 | single   | We should do a founder story   | new    | t   | f  | f  |      | 09:22:01
 2026-10-04 | carousel | restock of the ceramics range  | new    | t   | t  | f  |      | 09:22:10
 2026-10-08 | single   | Product & Fragrance            | new    | t   | f  | f  |      | 09:26:00
 2026-10-20 | single   | Wilderness candle relaunch — T | new    | t   | f  | f  |      | 09:22:20
 2026-10-25 | reel     | Wilderness candle relaunch — L | new    | t   | t  | t  |   30 | 09:23:00
 2026-10-28 | single   | Scent as a daily ritual        | new    | t   | f  | f  |      | 09:22:36
 2026-10-28 | carousel | Wilderness candle relaunch — F | new    | t   | t  | f  |      | 09:22:49
 2026-10-29 | single   | Gather, make, take it home     | new    | t   | f  | f  |      | 09:22:49
 2026-10-31 | carousel | Everyday Ritual                | new    | t   | t  | f  |      | 09:23:01
```

```
  format  | n | with_hook | with_script
----------+---+-----------+-------------
 carousel | 4 |         4 |           0
 reel     | 2 |         2 |           2
 single   | 6 |         0 |           0
```

**6/6 hook-eligible posts have a hook; 2/2 reels have a script at 30s; singles correctly
have neither.** This is exactly the intended post-fan-out state, and it stands in for the
operator's step-10 content check: the content is there. Titles carry real subjects
(wilderness relaunch arc, ceramics restock) rather than the pillar-name husks of the
previous round.

## A3. `enqueueScriptIfReady` ran, and enqueued exactly the right jobs

Redis keys for this cycle:

```
  12  shape
   6  hook
   2  script
```

Twelve posts → 12 shape. Six hook-eligible (4 carousel + 2 reel) → 6 hook. Two reels →
**2 script**. The chain added in `54aeada` fired, and enqueued the two reel scripts and
nothing else. Both completed (`finishedOn` set, present in the `completed` set).

Every pending list is empty — `wait 0, active 0, delayed –, paused 0, prioritized 0,
failed –` — so nothing is stuck.

## A4. The settled predicate — legitimately true

Nothing generating (all 12 are `new`), no pending shape/hook/script jobs. It was true at
09:23:01 when the last hook landed, and is true now. Settlement was correct.

## A5. The claim happened. The send failed. The system reported success.

Railway worker logs, three consecutive lines at **09:23:02**:

```
[INFO] email-send: not sent (non-fatal)  clientId="d5ea71c4-…"  key="plan_ready"
                                          err="No Gmail tokens for client"
[INFO] plan-ready: settled and sent       cycleId="040d6a1a-…"  autoApproved=false
                                          monthLabel="October 2026"
[INFO] content-cycles: plan-ready settlement  outcome="sent"
```

The email explicitly did not send, and the next line says **"settled and sent"** with
`outcome="sent"`.

### Why the send failed

```
     slug     | provider |   email_address    | status
--------------+----------+--------------------+--------
 earl-of-east | — none — |                    |
 ivy-t        | drive    |                    | active
 ivy-t        | gmail    | john@sprigly.co.uk | active
 sprigly      | gmail    | john@sprigly.co.uk | active
```

**earl-of-east has no `oauth_connections` row at all.** Every intake-capture and plan-ready
email is delivered *with the client's own Gmail tokens*, pinned to the test inbox
(`email-send.ts:24`, `APP_DELIVERY_PIN = 'john.mcgeagh@gmail.com'`). No tokens, no sender:

`packages/destinations/src/generic/gmail-reply-with-attachment.ts:205-206`
```ts
const tokens = await getTokens(this.db, this.encProvider, event.clientId, 'gmail');
if (tokens === null) return { success: false, error: 'No Gmail tokens for client' };
```

`ivy-t` and `sprigly` both have live Gmail connections, which is why this has not bitten
before — earl-of-east is the first sandbox client exercised end-to-end without one.

## A6. The exact broken link

Three files, one missing signal:

**1. `engine/src/content-cycles/email-send.ts:59-62`** — returns a boolean and says who owns
it:

> *"Returns true on a confirmed send, false on any resolve/render/send failure (all logged,
> never thrown — **the caller decides** whether to stamp a send-log column)."*

**2. `engine/src/content-cycles/planning.ts:694`** — `sendAppReadyNotification` is
`Promise<void>` and **discards that boolean**. The caller was given the decision and threw
the information away.

**3. `engine/src/content-cycles/plan-ready.ts:142` then `:155-156`** — my settlement path
claims *before* sending, then logs success unconditionally:

```ts
if (!(await claimPlanReadySend(db, cycleId))) return 'already_sent';   // :142  ← stamp
…
await sendAppReadyNotification(deps, cycle.clientId, …);               // :155  ← send (void)
logger.info({ cycleId, … }, 'plan-ready: settled and sent');           // :156  ← claims success
```

The claim-before-send order was deliberate, and I justified it in that commit on the grounds
that *"deliverTemplatedEmail is best-effort and never throws — a failure is logged, not
raised."* **That reasoning was wrong.** It is true that it never throws, but it does report
failure — as a return value — and the intermediate function drops it. So the trade I
described ("a lost email if the send throws, in exchange for never a double email") is not
the trade the code makes: it loses the email on *any* failure, silently, permanently, and
reports `outcome="sent"` while doing it.

`plan_ready_sent_at` therefore means "we attempted a send", not "a plan-ready email exists".
Because it is the at-most-once key, the cycle can never be retried.

---

# SYMPTOM B — approval navigates to the wrong month

## B1. The October surface is correct

Mirroring `surfaceForCycle` against live data:

```
 committed_count | draft_count |    surface_kind
-----------------+-------------+--------------------
              12 |           0 | committed-redesign
```

And the month menu (mirroring `loadCycleList`, home = `040d6a1a`):

```
               cycle_id               | cycle_month | display_month | live | draft | is_home | in_menu
 447358e2-…                           | 2026-07     | 2026-08       |   12 |     0 | f       | KEPT
 d5670806-…                           | 2026-08     | 2026-09       |   13 |     0 | f       | KEPT
 040d6a1a-…                           | 2026-09     | 2026-10       |   12 |     0 | t       | KEPT
```

**October is committed, has its 12 posts, and is in the menu.** Nothing about the surface is
stale or wrong. **B is a navigation bug only.**

## B2. The transition

`app/src/components/plan/DraftPlanView.tsx:169` — the approve success path is:

```ts
// The surface re-renders out of draft mode on the next load: the cycle now has
// committed posts, so resolveSurfaceKind stops returning 'draft'.
window.location.reload();
```

A full reload to `/`, which re-runs `page.tsx` from scratch — including the landing rule.

## B3. Where the landing rule sends them

`resolveLandingCycleId` (`app/src/lib/cycle-nav.ts:88`):

1. `homeHasReviewableDraft` — approval moved every draft row to `generating`, so **0 drafts
   remain** → the draft-wins branch (added in `88778ee`) does **not** fire.
2. Falls through to `resolveDayCycleId(cycles, '2026-07-21')`:
   - exact match on `displayMonth === '2026-07'` → **none**; no cycle plans July
   - nearest future, ascending → `2026-08`, `2026-09`, `2026-10` → first is **`2026-08`**

> **The client lands on August (`447358e2`) — not October, the month they just approved.**

This is the same class of bug as `draft-mode-not-rendering.md`: the landing is chosen by
date, and the one piece of state that knows which month the client was working on is
discarded. The draft-wins fix closed that hole for the *arrival*; approval reopens it on the
*departure*, because approval is precisely the moment the draft stops existing.

"Today" does not help either — `todayCycleId` is the same `resolveDayCycleId`, so it also
points at August.

## B4. "October doesn't show", and "July — empty"

Two separate things, and I can only fully establish one.

**October not showing: established as a navigability problem.** There is no month picker on
the desktop surface — navigation is prev/next arrows by index plus a Today button
(`PlanDesktop.tsx:33-35, 77-79, 100`). Landing on August (index 0 of `[Aug, Sep, Oct]`)
puts October **two "next" taps away**, with no visible list of months. It is reachable, but
nothing on screen says it exists.

**"July — empty": NOT reproducible from the data, and I will not claim it.** August holds 12
live posts, so a landing on August cannot render empty. The only code path that renders the
*current real month* with zero posts is `viewedMonth`'s final fallback
(`app/src/components/plan/derive.ts:27-32`):

```ts
const src = displayMonth ?? posts.map((p) => p.date).sort()[0]?.slice(0, 7);
if (src) { … }
const now = new Date();
return { year: now.getFullYear(), month: now.getMonth() };   // ← "July"
```

That needs `viewedCycle` undefined **and** `posts` empty. I could not construct a state from
the live data where both hold after this approval. Possibilities I could not distinguish:
the reload landing before the browser had the new server render; a mobile layout difference;
or the month simply being read from a stale tab. **Flagging it as unexplained rather than
guessing** — the August landing is proven, the July rendering is not.

---

## Smallest correct fix — one for each

### A — stop claiming a send that failed

**Make the send report its outcome, and only stamp on success.** Three one-line changes:

1. `sendAppReadyNotification` (`planning.ts:694`) returns `Promise<boolean>` — pass through
   what `deliverTemplatedEmail` already returns instead of discarding it.
2. In `plan-ready.ts`, **send first, stamp second**: attempt the send, and call
   `claimPlanReadySend` only if it returned true.
3. Log `settled and sent` only on that same true.

Reversing the order reintroduces the double-send risk the claim-first order existed to
prevent — so the honest version is *claim, send, and release the claim on failure*
(`plan_ready_sent_at = NULL` when the send returns false), which keeps at-most-once for
concurrent settlements while letting a genuine failure retry on the next job. That is still
small, and it is the version I would write.

**Separately and independently: earl-of-east has no Gmail connection.** No code change fixes
that — the client needs a connection, or the pinned-inbox send needs to use a system
identity rather than the client's. Worth deciding which, because every sandbox client
onboarded without a Gmail connection will hit this silently.

### B — approval should land on the month it just approved

**Pass the approved cycle through the reload instead of re-deriving the landing.** The
smallest correct form: replace `window.location.reload()` (`DraftPlanView.tsx:169`) with a
navigation that names the cycle — e.g. `/?cycle=<cycleId>` — and have `page.tsx` prefer an
explicit cycle parameter over `resolveLandingCycleId` when it is present and belongs to the
session's client.

That is strictly smaller than changing the landing rule, and it is also more correct: "I
just approved this month" is explicit intent, and explicit intent should outrank a heuristic
about today's date. It fixes the observed bug without touching the rule that governs an
ordinary arrival.

Not part of the smallest fix, but worth recording: the absence of a month picker
(§B4) is what turned a wrong landing into "October doesn't show". A visible month list would
have made this a nuisance rather than a report.

---

## Observations, out of scope

1. **One post was written 3 minutes after settlement.** `2026-10-08` (`Product & Fragrance`)
   has `updated_at 09:26:00`, against `plan_ready_sent_at 09:23:01`. Every queue is empty and
   nothing is pending, so this was most likely a client edit after the fact rather than a
   late job — but it is worth knowing that the settled predicate cannot distinguish "done"
   from "quiet for now".
2. **`posts_sync_status` is still NULL** for this cycle. Only the planning path stamps it, so
   approval-arc cycles never get sync provenance. (Also noted last round.)
3. **The `plan_ready` and `plan_ready_auto` templates are both published and render fine** —
   the failure was purely at the transport, not the content.
4. **`autoApproved=false` in the log is correct** — this was a client approval, and the
   `plan_ready` (not `_auto`) key was selected, confirming that branch works.
