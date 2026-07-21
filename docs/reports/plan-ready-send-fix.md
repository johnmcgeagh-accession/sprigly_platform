# Plan-ready send fix, and the admin page that blocked it

**Date:** 2026-07-21
**Branch:** `dev`
**Spec:** `docs/reports/round-two-email-and-surface.md`

Two independent workstreams. Both completed; neither hit a stop condition.

| commit | workstream | contents |
|---|---|---|
| `e544dba` | W2 | admin client page survives an intake_json without planContent |
| `4906e82` | W1 | the plan-ready send outcome is real, and failures retry |
| `7996699` | W1 | approval lands on the month it just approved |

W2 is committed first because it was the blocker: the admin page crash made the OAuth
section unreachable, and the missing Gmail connection is the *operational* half of W1 that
no amount of code fixes.

---

# WORKSTREAM 1 — the send outcome, and the landing

## Commit `4906e82` — the send outcome is real, and failures retry

### (a) The outcome stops being discarded

`engine/src/content-cycles/planning.ts:694` — `sendAppReadyNotification` was
`Promise<void>`; it is now `Promise<boolean>`, returning what `deliverTemplatedEmail`
already reported. That function's own contract said whose job this was:

> *"Returns true on a confirmed send, false on any resolve/render/send failure (all logged,
> never thrown — **the caller decides** whether to stamp a send-log column)."*
> — `email-send.ts:59-62`

### (b) A claim that doesn't become a delivery is given back

Claim-first is kept — it is what stops two concurrent settlements both emailing. What
changes is the failure path. New `releasePlanReadySend` in `packages/db/src/plan-ready-claim.ts`,
called from `plan-ready.ts` on a false send.

**Before:**

```ts
await sendAppReadyNotification(deps, cycle.clientId, client?.name ?? '', monthLabel, appUrl, autoApproved);
logger.info({ cycleId, autoApproved, monthLabel }, 'plan-ready: settled and sent');
return 'sent';
```

**After:**

```ts
const sent = await sendAppReadyNotification(deps, cycle.clientId, client?.name ?? '', monthLabel, appUrl, autoApproved);
if (!sent) {
  await releasePlanReadySend(db, cycleId);
  logger.warn({ cycleId, autoApproved, monthLabel }, 'plan-ready: send failed — claim released, will retry');
  return 'send_failed';
}
logger.info({ cycleId, autoApproved, monthLabel }, 'plan-ready: settled and sent');
return 'sent';
```

`'send_failed'` joins the `SettleOutcome` union. `'settled and sent'` now logs only on a
true send.

**What this looked like on UAT, before the fix** — three consecutive lines at 09:23:02:

```
[INFO] email-send: not sent (non-fatal)  key="plan_ready"  err="No Gmail tokens for client"
[INFO] plan-ready: settled and sent      cycleId="040d6a1a-…"  monthLabel="October 2026"
[INFO] content-cycles: plan-ready settlement  outcome="sent"
```

**What it will look like now:**

```
[INFO] email-send: not sent (non-fatal)  key="plan_ready"  err="No Gmail tokens for client"
[WARN] plan-ready: send failed — claim released, will retry   cycleId="040d6a1a-…"
[INFO] content-cycles: plan-ready settlement  outcome="send_failed"
```

I should be plain that the reasoning in the original commit was wrong. I justified
claim-before-send on the grounds that *"deliverTemplatedEmail is best-effort and never
throws — a failure is logged, not raised."* True, and irrelevant: it **does** report failure,
as a return value, and the intermediate function dropped it. The trade I described was not
the trade the code made.

### (c) The retry arm

`sweepUnsentPlanReady` (`plan-ready.ts`) selects approved cycles with no send stamp and runs
each through the **same** `settlePlanReady` path. Injected into the daily tick as
`sweepPlanReady` (`scheduler.ts`), wired in `consumer.ts` where the planning/Gmail deps live —
the same pattern `sendEmail`, `assembleDraft` and `autoApprove` already use, so the scheduler
keeps no model or Gmail dependency and the tick is unchanged when it is absent.

It runs **first** in the tick, so a transport fixed since yesterday delivers before the tick
spends time on anything else.

Candidate selection is deliberately loose (approved, unsent). Everything that makes a send
*correct* — settled, has a link, not already claimed — is re-checked by `settlePlanReady`, so
the sweep cannot send anything a live settlement would not have.

No backoff machinery: once a day **is** the backoff. Every attempt logs. The pass is capped
at 50 and a capped pass says so, rather than reporting a clean run over a truncated list.

### Tests

```
✓ a FAILED send releases the claim and reports send_failed — never sent
✓ a SUCCESSFUL send keeps the stamp and reports sent
✓ CONCURRENT settlements with a failing send: one attempt, claim released once
✓ SWEEP delivers a settled-but-unsent cycle once the transport works
✓ SWEEP skips cycles mid-generation
✓ SWEEP skips unapproved cycles — not this path to announce
✓ SWEEP skips a cycle that already sent
```

Three pre-existing tests in that file mocked the send as `mockResolvedValue(undefined)`,
which is now falsy and therefore "failed". Updated to `true` — a fixture consequence of the
signature change, not a weakened assertion.

## Commit `7996699` — approval lands on the approved month

`DraftPlanView.tsx` replaced `window.location.reload()` with
`window.location.assign('/?cycle=<cycleId>')`, and `resolveLandingCycleId`
(`app/src/lib/cycle-nav.ts`) gained `requestedCycleId`, preferred over every heuristic.

Ownership is enforced by **membership of the cycle list**, which `loadCycleList` already
scoped to this client and channel. A foreign or stale id therefore falls through to the
ordinary rule silently — no error, and no signal that the cycle exists.

`cycleId` is threaded `page.tsx → DraftPlan → DraftPlanView`, and `PlanRoot` passes the
viewed cycle so the in-shell draft surface behaves identically.

```
✓ POST-APPROVAL: lands on the approved cycle, not the date-derived one
✓ outranks the draft-wins branch too — explicit beats every heuristic
✓ a FOREIGN or stale cycle is ignored silently — falls through to the ordinary rule
✓ an absent param leaves ordinary arrival byte-unchanged
✓ an empty string is not a request
```

`git diff 88778ee -- app/src/lib/cycle-nav.test.ts` shows **additions only** — the
draft-wins tests pass unmodified.

---

# WORKSTREAM 2 — the admin client page crash

## The source

`admin/src/app/admin/clients/[id]/IntakePanel.tsx:38`:

```ts
const intake = existingIntake ?? defaultIntake();
```

`??` fires only on **null**. A non-null object *missing* `planContent` passes straight
through, and line 42 `intake.planContent.answers` throws — the minified
`f.planContent.answers`.

## The data condition, from UAT

```
     slug     | cycle_month |     status     | is_null | has_plancontent | has_receipts
--------------+-------------+----------------+---------+-----------------+--------------
 earl-of-east | 2026-09     | scheduled      | f       | f               | t
 ivy-t        | 2026-07     | workbook_built | f       | t               | f
 sprigly      | 2026-07     | scheduled      | f       | t               | f
```

Cycle `040d6a1a`'s `intake_json` has exactly **one** top-level key:

```
  top_level_keys
-------------------
 draftApplications
```

The approval arc produces this shape and the planning arc never does: `draft-apply.ts`
`persistReceipt` spreads receipts onto whatever is already there, and for a draft-flow cycle
that is nothing. ivy-t and sprigly carry the full planning-arc shape, which is why only this
client broke.

Worth noting the type lied: `IntakeJson` declares every field required, but the column is
`jsonb` cast to it — the type describes what the planning arc writes, not what the table can
hold.

## What was guarded

One normalisation, field-wise, covering **four** reads through the same object:

| line | read |
|---|---|
| `:42` | `intake.planContent.answers` |
| `:45` | `intake.planContent.freeNotes` |
| `:46-48` | `intake.businessContext` |
| `:50-51` | `intake.otherChannel['general']?.[0]` |

`normaliseIntake` fills only genuinely absent fields, so stored values survive. Defaults are
empty — **not invented** — and the panel now says so:

> *"No intake answers for this cycle — nothing has been captured yet."*

The form stays usable, because it is where an admin enters the intake in the first place.

**Siblings checked and already safe:** `page.tsx:475-477` (`c?.intakeJson?.planContent?.answers ?? {}`)
and `intake-signals.ts:44` (`intakeJson?.planContent ?? null`). `IntakePanel.tsx:38` was the
only unguarded read.

## Tests

Admin had **no test harness at all** — no vitest dep, no config, no tests. Added
`vitest ^1.6.0` (matching the three other packages), a config mirroring `app`'s, and one test
file. Nine tests, including the exact UAT shape.

Verified the tests actually catch the bug: reverting the guard to the old line reproduces it
in the suite —

```
"TypeError: Cannot read properties of undefined (reading 'answers')"
```

— the unminified form of the reported error.

## Item 3 — section isolation (backlog observation, not built)

The client page is a **single server component** rendering every section, with `IntakePanel`
as one client component among them. There are **no error boundaries anywhere in
`admin/src`** (`find admin/src -name "error.tsx" -o -name "*ErrorBoundary*"` → nothing). So
one section's render error takes the entire page, which is exactly how an intake-shape
problem made the OAuth section unreachable.

**Backlog: an error boundary per section**, so a broken panel degrades to a message in its
own box rather than a blank page. Not built.

---

## Suite results

| package | result |
|---|---|
| `@sprigly/app` | **426 passed** |
| `@sprigly/worker` | **419 passed** |
| `@sprigly/engine` | **230 passed** |
| `@sprigly/web` (admin) | **9 passed** (new harness) |
| `@sprigly/db` | **7 passed** |

Type-check clean across all five.

---

## ⚠️ UAT: cycle 040d6a1a is still unsent, with a stale stamp

Verified just now:

```
     plan_ready_sent_at     |       approved_at       | approved_by | generating
----------------------------+-------------------------+-------------+------------
 2026-07-21 09:23:01.437+00 | 2026-07-21 09:21:32.234 | client      |          0
```

That stamp records the failed attempt from **before** this fix. Nothing in these commits
clears it retroactively, so the sweep will skip the cycle — it only considers cycles with
`plan_ready_sent_at IS NULL`.

**To let the sweep deliver it post-deploy, release the stamp:**

```sql
UPDATE content_cycles SET plan_ready_sent_at = NULL, updated_at = now()
 WHERE id = '040d6a1a-9ad4-4d32-bda2-d67b01f70512';
```

**Order matters.** Run this *after* earl-of-east has a Gmail connection, otherwise the next
sweep will fail the send again (correctly), release the claim again, and you will have
spent a day's cadence for nothing. The connection is the fix; this SQL only re-arms the
retry.

The cycle is settled (0 generating, no pending jobs), so the next daily tick after both
steps will pick it up and deliver.

---

## Boundaries honoured

- **No transport or identity changes.** The missing Gmail connection is an operational fix;
  nothing here works around it.
- **No month-picker UI** — still backlogged, and still the thing that turned a wrong landing
  into "October doesn't show".
- **Fences untouched.** `git diff` since session start on `draft-invisibility.test.ts` and
  `excludeDraftPosts` is empty.

## Also worth recording

- The admin package now has a test harness where it had none. Two things it surfaced:
  `admin/tsconfig.json` sets `jsx: "preserve"`, so the vitest config needs
  `esbuild: { jsx: 'automatic' }`; and `IntakePanel` pulls in `@sprigly/db` through its
  server actions, so tests stub them.
- The sweep's 50-per-pass cap is a guard against an unbounded scan, not a rate limit. If it
  ever logs a capped pass, that is a signal something upstream is leaving cycles unsent en
  masse and is worth investigating rather than raising the cap.
