# Cross-month, credits, titles, enqueue, deletions

Branch `dev`. Six commits, never pushed.

| | |
|---|---|
| `2c2e67b` | X1 — the month is where they are looking, not the limit of what they may change |
| `99dd779` | X3 — a post the client named lands with that name on it |
| `93f564f` | X4 — the enqueue gap: one add path, and a sweep that finds a stranded post |
| `ec86c35` | X5 — two deletions: the second thinking indicator, and the applied chip |
| `a03ec88` | X2 — the AI-change cap: announced before the work, banked when it bites, and sold |
| `95b782b` | X5b — the transcript records the chip's absence, not a count scoped to the visible week |

---

## THE CONTEXT-ASSEMBLY SEAM

**`app/src/lib/agent/plan-context.ts` → `buildPlanContext(clientId, viewedCycleId, today)`.**

That function is now the whole answer to *what does the agent know about the plan*. `turn.ts`
calls it once and reads the object; it no longer calls `loadPlanPosts`, `getCycleMonth` or
`getClientCycleMonths` at all. The query answerer takes the same object
(`answerQuery({ …, context })`).

X1 is a deliberate interim — the endgame is tool use, the agent fetching what it needs per turn
(roadmap Stage I, Bug 4) — so the widening is behind one call on purpose. **The migration
replaces this file's innards and nothing in the turn loop moves.** Two properties have to survive
it, and both are stated in the file:

- `PlanContext.posts` is **the resolution set** — the posts a reference may resolve to. A selector,
  a postId or a date can only ever reach a post that is in there. That single fact is the whole of
  X1: August was untouchable from October because August's posts were never loaded.
- `PlanContext.cycles` is **what maps a post or a date back to the cycle that owns it**. Every
  mutation is scoped with it.

### The span, and why it is what it is

Two rules, unioned. Each is defensible on its own, which is the point — one arbitrary number
would be re-argued for every client with an unusual month layout.

1. **Where the client is standing** — the viewed cycle and the cycle either side of it in the
   client's OWN month order (not calendar arithmetic: a client with a gap has neighbours across
   that gap, and those are the months "next"/"last" mean to them).
2. **Where NOW is** — the cycle whose plan month contains today, and the one containing
   today + 7 days. *Today*, *this week* and *next week* are DATE words: they mean the same thing
   whatever month is on screen.

Typically three months; never more than five. Rule 2 is the stated reason for going past ±1, and
it is what makes the operator's own case work: **October on screen on 31 July still sees August**,
not because August neighbours October but because next week is in it.

Cost: linear in months, and it sits entirely inside the parser's cached prefix (the `cache_point`
in `task-parser.ts`), so a five-month span is paid for once per plan change rather than once per
turn. It is still the reason tool use is the endgame and this is not.

`planWindowLine` now takes a LIST and names every month in scope; `describeCycles` marks which
months are **loaded** (`[posts listed below]`) versus merely on record
(`[posts NOT listed — you can still add or move INTO this month]`), so a month that exists but was
not loaded does not read as absent.

---

## X1 — CROSS-MONTH

### The two failures, and what they actually were

Neither was a rule.

**"moving posts to a different month isn't available yet."** One guard in `turn.ts` comparing the
destination's month against the viewed cycle's plan month. That is not a permission rule —
permission is the DATE rule (today-or-later) plus ownership, and both ends were already checked
three lines above it. The guard is gone.

**August unreachable from October.** `loadPlanPosts(clientId, cycleId)` — one cycle. Every
reference to an August post resolved to nothing, so the only honest answer was "I can't see that".
The span is the fix.

### (b) The cycle-membership decision

**The row keeps its `cycle_id`. Cycles span BY DATE on the calendar. That is the smallest correct
version, and it is the model already shipped.**

The evidence is in `plan.ts` and was written before this session:

- `loadCrossMonthPosts` (plan.ts:150–178) serves every post whose `scheduled_date` falls in the
  viewed month **whatever cycle owns it** — "a cross-month-moved post therefore appears in the
  month view its date lands in, on its date";
- `toPlanPost` keeps each post's own `cycleId` — "so a post surfaced in another cycle's month view
  still routes edits to its real cycle (edit gates are date+client based, not cycle based)";
- `PlanDesktop.tsx:273` and `CommittedSurface.doMove` already handle the cross-month move a client
  makes by hand.

So a September date on an August post renders in September and edits as September, with nothing
re-parented. Re-parenting would have disturbed four things that all key on `cycle_id`: `position`
ordering within a cycle, the phase-2 fan-out's accounting, the `post_edits → content_cycles` join
the AI-change cap counts through, and the ledger's cycle attribution. None of them needed to move.

What DID need to move is the proposal payload. It carried the **viewed** cycle; it now carries the
**post's own** cycle, because `approveProposal` scopes its write by `(client, cycle, post)` and an
August post edited from the October view would have found nothing to update.

### (c) Adds in another month

`add_post` resolves its destination cycle from the DATE's month, not from the viewed cycle. The
lookup looks past the span deliberately — the span governs what can be READ, not where a change
may LAND, so a client with a March cycle can be given a March post from the August view even
though March's rows were never loaded.

A month with **no** cycle is refused and named:

> There's no March 2027 plan yet, and I can't start one — that's a planning run, not an edit. Pick
> a date in a month you already have, or ask us to set March 2027 up.

Nothing invents a cycle. A cycle is a planning run with a brief, a fan-out and a cost; a row
conjured by an add would be a month-shaped object with none of them.

### (d) The fixtures, from the live failures

`cross-month.test.ts`, **27 tests**, the real `runPlanAgentTurn` pinned to 2026-07-31 with October
on screen.

| fixture | what it pins |
|---|---|
| *"Yes move it to September 24 next month"* (from August) | resolves, proposes, both dates on the interpretation line, and `not.toMatch(/different month/)` |
| *"forward by 12 days"* → *"No, forward brings it earlier in August"* | the three pending proposals are superseded and rejected; the corrected arc lands 2/4/6 Aug, all `cycleId: 'cyc-aug'`, no cross-month refusal |
| *"what's happening next week"*, 31 July, October up | the query answerer's PLAN STATE carries `2026-08-05` and `TODAY IS 2026-07-31` — from a cycle that is **not** the one on screen. And with only November on record, the state names November's window and nothing else |
| an August edit from the October view | the digest holds `p-aug-14`; the rewrite proposes against `cycleId: 'cyc-aug'` |

Plus the span rule as a pure function (`selectSpan`: neighbours, the now-rule, the straddling
week, the ≤5 bound, gaps, an empty client), the multi-month digest, X1c's add and its honest
refusal, and the undated-add placement staying inside the month on screen.

---

## X2 — THE AI-CHANGE CAP

### (f) What the cap is, today

| | |
|---|---|
| **value** | `client_channels.ai_change_limit`. Default **30** when a channel has no row (`DEFAULT_AI_CHANGE_LIMIT`) |
| **scope** | per **(client, channel)**. A client's Instagram allowance and their email allowance are separate counts against separate limits |
| **override** | `client_channels.ai_change_limit_override_until` in the future ⇒ unlimited for the duration |
| **window** | the calendar month in **UTC**, resetting on the 1st |
| **one "change"** | one `post_edits` row with `passed = true` |

**What writes a `post_edits` row** — i.e. what actually costs: `shape.ts` on a successful caption
write (a caption written for a new post, and an instructed rewrite), `refine.ts` (a hook or script
refine), and `weekly-session.ts`. A generation that FAILS writes nothing and is not counted,
because nothing was delivered. Structural edits — move, delete, reorder, format, a manual caption
— have never written one and are free.

**Why UTC.** `post_edits.created_at` is a naive timestamp written by the database. Counting against
a Europe/London boundary would compare a UTC column to a London instant and silently mis-count
every summer. The visible cost is one hour on 1 July; the alternative is a wrong count for five
months of the year.

**Where it now lives.** `packages/db/src/ai-change-usage.ts` — the limit's default, the window and
the counting join, in one place, because a second process reads the same allowance now (the
worker's banked-run trigger). `app/src/lib/usage.ts` is a thin caller.
`packages/engine/src/ai-change-cap.ts` holds what the numbers MEAN — is it spent, what is banked,
how a failure is classified, what the client is told — and is deliberately pure: it does not
re-export from `@sprigly/db`, because that package's entry point constructs the database client
and a re-export would drag a connection behind a copy helper.

**One thing found and left as-is:** `generate_hook` is *gated* by the cap in `approveProposal`
(`isRewriteBlocked` → refuse) but `hook.ts` writes no `post_edits` row, so it is never *counted*
against it. A client can generate unlimited hooks until some other path exhausts the allowance,
at which point hooks stop too. It is counted as expensive by the announcement (X2a), which is the
honest reading of what it costs us; making the ledger agree is a worker change and is named below
under **Found and left unfixed**.

### (a) The agent raises it before the work

The turn counts the proposed changes that will spend an allowance — `add`, `rewrite`, `refine`,
`hook`; a move, a delete and a format change are structural and free — and compares that with what
is left. When it would not fit:

> That needs 3 changes written, and you've none left this month — they refresh on 1 August. I can
> save the whole thing and write it the moment they do. Want me to?

Three facts and an offer, in the order the client needs them. **It is an announcement, not a
gate**: the proposals are still made and still applyable, and an unreadable allowance changes
nothing about what the client may ask for (the read is wrapped, and a turn with no expensive
change never performs it at all). The notice rides on the turn as `capNotice` and is persisted in
the message metadata, so a reopened thread shows the same turn it showed live.

### (b) Banked requests are first-class

`markPostBanked` writes a **flag** — `source_meta.quotaBanked`, plus `quotaBankedAt` — beside the
`pendingInstruction` that was already being kept. The flag is the fact and the message is only
copy: three things need to tell a banked post from a broken one (the surface, the sweep, the
release), and none of them can do it from prose that will be improved later.

**The banked-run trigger lives in the scheduler tick** — `engine/src/content-cycles/banked-changes.ts`,
`releaseBankedChanges`, injected into `runContentCycleTick` alongside `sweepFailedGenerations`,
**and** into a new 10-minute `generation-retry-tick`. It fires on *"there is allowance and there
is banked work"*, never on *"it is the 1st"*: the allowance also comes back when an operator raises
a limit or sets an override mid-month, and a date check would miss that entirely.

Two decisions inside it worth naming. The allowance is read **once per (client, channel) and spent
down in memory**, because `post_edits` is only written when the job completes — re-reading after
each enqueue would return the same number and release fifty posts into a budget of three. And the
flag is cleared **after** the job is genuinely queued, so a failed enqueue leaves the post banked
with its message still true.

### (c) A distinct client state

`isPostOnTheWay(post)` excludes banked posts, so they never render *On its way*. They carry their
own state instead — no dots and no motion, because nothing is in flight — with the stored message
naming the reset date and the instruction we are holding read back to the client:

```
Oak tree launch
Waiting for your changes to refresh on 1 August.
"Launch the oak tree candle."
○ Waiting on your changes
```

The month footer stops counting them as being written. The day-mark keeps the ring, deliberately:
the ring says *no words on this one yet*, which is true of both states, and the difference between
"coming" and "waiting until the 1st" is a sentence with a date in it that a 5px dot cannot carry.

Terminology fence intact — the copy avoids *failed*, *failure*, *retry* — and asserted twice: once
in the fence itself, once against the rendered DOM.

### (d) Where the upsell interest lands

**`ui_events`, event `ai_change_upsell_interest`**, written by `POST /api/plan/upsell-interest`.

```sql
SELECT c.name, e.created_at, e.payload
  FROM ui_events e JOIN clients c ON c.id = e.client_id
 WHERE e.event = 'ai_change_upsell_interest'
 ORDER BY e.created_at DESC;
```

The payload carries `{ cycleId, changesWanted, used, limit, remaining, resetsOn }`. Every number
except *how many they wanted* is read **server-side** — this row is what an operator quotes back
in a conversation about money, so it does not take the client's word for its own allowance.

Deliberately not `plan_activity`: nothing about the plan changed, and putting a non-mutation in
the mutation ledger is how the ledger stops meaning anything.

The surface is one affordance — **"Need more this month?"** — on the turn where the agent raised
the cap, replaced on tap by *"Noted — we'll be in touch about it."* A refused write leaves the
offer standing rather than claiming something was filed. There is no price, no plan change and no
payment flow, and a fixture asserts the absence of all three.

### (e) The sweep's classification rule

| class | detected by | treatment |
|---|---|---|
| **QUOTA** | the `quotaBanked` **flag**, never the wording. One concession: rows written before the flag existed are matched on the stable half of the old sentence, `/used all \d+ ai changes/` | **never retried.** Excluded in the WHERE clause too, so a client sitting on fifty banked posts cannot eat the pass cap and starve a post that is genuinely stuck. Released by `releaseBankedChanges` |
| **TRANSIENT** | an explicit marker list over the stored error — timeouts, `ETIMEDOUT`/`ECONNRESET`, throttling, 5xx, "temporarily" | retried, bounded by `MAX_SWEEP_ATTEMPTS`. The **10-minute `generation-retry-tick`** is what delivers "minutes, not the daily tick"; the 05:00 pass is a backstop behind it |
| **DETERMINISTIC** | an error that is PRESENT and unrecognised — almost always a gate or critic refusal | stops on the **first** pass and becomes an operator item immediately (admin → Failed Posts), which is both cheaper and sooner than the two paid passes it used to get |

**ABSENT is not UNRECOGNISED, and they get opposite answers.** Every writer of `generation_failed`
records a reason, so a row with none was written by something we cannot account for — calling that
deterministic would strand it permanently. It is treated as transient, and the retry is bounded, so
being wrong costs two attempts; being wrong the other way costs the post.

The **stranded** case (X4) is none of the three: there is no error at all because nothing ran. It
is checked before classification and always re-enqueued, under the same spend bound.

---

## X3 — TITLES FROM THE CONVERSATION

There is no title column. `source_meta.title` is the slot title every surface reads
(`card-text.ts`), and the agent's add path never wrote one — so a launch arc the interpretation had
named *"Oak tree tease"* and *"Oak tree launch"* landed as rows both reading **Untitled**,
indistinguishable until a caption existed to derive a heading from.

The subject the parser already extracted **is** the title. It travels on the add payload — the same
string the interpretation line showed the client — and `addGeneratingPost` writes it to the row.
`titleFromSubject` (in `selectors.ts`, beside `postTitle`) drops the trailing stop, collapses
whitespace and caps at the same 44 characters `postTitle` uses, so a written heading and a derived
one are never a different shape. Absent stays absent: an add with no stated subject genuinely has
no title, and *Untitled* is the honest rendering of that. `/api/posts` takes the same rule, so a
post added by hand and one added by conversation are headed the same way.

`added-titles.test.ts`, 7 tests — the three-post arc titled from its own interpretation lines, the
resulting card reading `Oak tree launch` through the real `cardText`, and the *Untitled* case
pinned as the before.

---

## X4 — THE ENQUEUE GAP

### What the status counts could not tell you

planned 54, edited 40, generation_failed 4, **new 63** — and `new` is not a leak. A **successful**
generation resolves `generating → 'new'` (`engine/src/content-cycles/shape.ts:170`). `new` is the
finished state.

### The gap was one branch

The agent's add proposal enqueued generation only when the client had stated a subject. A bare add
fell to `addDraft`: status `'new'`, the scaffolding placeholder in the caption column, and nothing
on the queue, ever. **That post is unrecoverable by construction:** `isOnTheWay` is false for
`'new'` so it never even reads as in flight, the sweep only looked at `generation_failed`, and it
is indistinguishable in the counts from a post that generated fine.

`/api/posts` had already closed exactly this hole for the client's own add slot, and said so —
*"CAPTION GENERATION ENQUEUES REGARDLESS; AN INSTRUCTION ONLY STEERS IT"*. The agent path was left
behind. There is one path now, with `defaultCaptionBrief` shared from `post-generation.ts` so the
neutral brief is one wording rather than one per door.

### Does the sweep need a second status? Yes — but not `new`

Sweeping `new` would re-generate every post the client has ever added, daily, forever.

The status that needed covering is **`generating` with nothing on the queue**. The insert precedes
the enqueue by design (the reverse would let a job run against a row that does not exist), so a
process dying between them — a container restart, a deploy landing mid-request — leaves a row
reading *On its way* with nothing behind it. That is the exact stuck state the sweep's own header
says must not exist, and nothing was looking for it.

The sweep now takes `generation_failed` **OR** (`generating` older than `STRANDED_GENERATING_MS`,
2h). The age bound only narrows the scan; `clearOrBusy` is the real arbiter — a job that IS
waiting/active/delayed still reports busy and is skipped. Stranded posts are counted separately,
because a non-zero count is a different fault from a failure.

---

## X5 — TWO DELETIONS

### (a) The duplicate thinking indicator

With the sheet open, the top feedback bar rendered a second *"Sprigly is thinking"* over the
thread's own dots — `z-40` against the sheet's `z-31`, so it sat under the wordmark, above the
conversation, saying what the conversation was already saying.

**Why `ask({ silent })` does not cover it, cited.** `silent` gates the two RESULT renderings only:
`setFlashView('approvals')` at `usePlanData.ts:661` and `agentFlash(r.message)` at
`usePlanData.ts:662`. The busy state is a different thing — `setAgentBusy(true)` at
`usePlanData.ts:623` runs **unconditionally, before `opts` is consulted at all** — and it must,
because the sheet's own in-thread dots are driven by exactly that flag
(`busy={data.agentBusy}`, `CommittedSurface.tsx`). Suppressing it in the hook would put the
thread's indicator out too.

So the rule lives where the two surfaces are: while the thread is open it owns the agent's voice
and its working state, and the bar carries only what is about the plan behind it. Both surfaces
take it. Fixtures: the bar speaks with the sheet closed and is silent with it open; and exactly one
`agent-dots` exists on the surface during an in-flight turn, inside the sheet.

### (b) The applied chip and its dropdown, deleted

Gone: `SummaryChip` in the committed surface's chip slot, `appliedChip`, `chipOpen`, the
`applied-panel` / `applied-line` / `applied-clear` surface, and `appliedChipLabel` — which had no
other reader. Same ruling that took the "What changed" header row last round (G6), applied to the
last member of the family.

**Two boundaries I drew, both flagged for the operator to overrule:**

1. **`changedIds` — the mark on the cards this apply touched — is KEPT.** The day dots read the
   ledger since the **last visit**, so a change made in this session never gets one
   (`readAndStampVisit` has already stamped). Removing the card mark as well would leave an apply
   with no on-calendar surface at all. If the ruling meant the dots and *only* the dots, this is
   the line to move.
2. **`SummaryChip.tsx` itself stays**, because the DRAFT month still uses it — and its expansion is
   `ReceiptPanel`'s per-segment outcomes and rationale, which is a different fact rather than a
   re-listing of the calendar. The component could not be deleted without taking that with it.

Fixtures assert the absences in jsdom (`sheets`, `partial-apply`) and in both e2e specs.
`partial-apply`'s applied-list assertion moved to the confirmation turn — the fact it protected
(the refused item never joins the two that applied) is unchanged and is now read where it is
actually said.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` (app) | clean, after every commit |
| app unit / interaction (Node 22) | **1127 passed**, 14 skipped (was 1068) |
| worker unit (`engine`) | **301 passed**, 38 skipped (was 278) |
| shared (`packages/engine`) | **377 passed** (was 360) |
| e2e — mobile | **17 passed** |
| e2e — tenant-b | **8 passed** |
| e2e — desktop | 36 passed / 18 failed — **identical at `b84710a`, measured, test for test** |
| tokens fence | 10 passed |
| terminology fence | 6 passed |
| draft invisibility | 5 passed |
| detector | 0 findings on every changed component |

**Fence proof.** `git diff b84710a HEAD -- '*terminology.fence.test.ts' '*tokens.fence.test.ts'
'*draft-invisibility.test.ts'` is **empty**.

**Desktop e2e proof.** Checked out `b84710a` detached, rebuilt `packages/db` and
`packages/engine`, ran `--project=desktop`, captured the failing test list, returned to `dev` and
diffed it against HEAD's. Identical — 18 tests, same names, same lines. They span `desktop.spec`,
`hooks`, `scripts`, `format`, `refine`, `a11y` and `agent`; none is a file this session touched.

**New fixtures**, 74 tests across six suites: `cross-month` (27), `added-titles` (7),
`cap-announcement` (11), `banked.interaction` (11), `ai-change-cap` (17 — shared package),
`banked-changes` (12 — worker). Plus additions to `generation-sweep` (+11), `sheets.interaction`
(+3) and `proposals` (+1).

### Deliberate test changes, and the argument for each

1. **`screenshot-cases`' "the AUGUST view builds an AUGUST prompt"** asserted
   `planDigest` did NOT contain `'Sep'`. That single fact is what made August untouchable from
   October. It asserts the marker instead of the absence — which is what it was really protecting:
   the prompt must not lose track of which month is on screen, because a bare "the 5th" resolves
   there.
2. **Eight agent fixtures gain `listClientCycles` to their `cycle-state` mock.** The seam reads the
   client's cycles through one named function; a spread mock has to return it.
3. **`agent-route.test.ts`'s `cycle-state` mock becomes a spread of the real module.**
   `plan-context` builds the span from `listClientCycles`, so a wholesale stub would have to
   re-implement half the module. Its `add_note` case now expects `cycle-1` rather than the stub id
   `cycle-x`: the month→cycle lookup answers from the span before it reaches the database, and
   September's cycle IS `cycle-1`.
4. **`proposals`' "a BARE add_post inserts a blank draft, no generation"** asserted the X4 gap. It
   now asserts the fix, including the neutral brief's own wording and the insert-before-enqueue
   ordering.
5. **`sheets.interaction`'s chip assertions** and **`partial-apply`'s applied-panel read** — the
   X5b ruling deletes the surface they read from; both re-point at the confirmation turn and the
   marked card, and a new case asserts the absence.
6. **`conversation.spec` / `transcript.spec`** — same ruling: the chip assertion becomes
   `toHaveCount(0)`, and the transcript records the absence.
7. **`generation-sweep.test`'s drizzle mock** gains `or`, `lt`, `inArray` (X4's second status) and
   mocks the REAL `ai-change-cap` — the classification is what the fixtures are about, and a stub
   would be testing the stub.

---

## Found and left unfixed

- **`generate_hook` is gated by the cap but never counted against it.** `approveProposal` refuses
  a hook when the allowance is spent, but `hook.ts` writes no `post_edits` row, so hooks do not
  consume the allowance they are blocked by. The announcement counts a hook as expensive, which is
  the honest reading of what it costs; making the ledger agree is a worker change (one insert in
  `hook.ts`, matching `refine.ts`) and it changes what clients are billed for, so it wants a
  decision rather than a patch.
- **The AI-change usage query is shared; `getUsageForCycle`'s channel lookup is not.** The count
  and the limit are one definition in `@sprigly/db`; resolving a cycle to its channel is still two
  lines in the app. Harmless today because the worker joins the channel in its own query, and worth
  knowing if a third caller appears.
- **A cross-month move by HAND is not held to the agent's destination rule.** The agent refuses a
  move into a month with no cycle, because the post would land somewhere the client cannot navigate
  to. `MoveSheet` (`canMoveTo={data.canEdit}`) and `PATCH /api/posts/:id` gate on date only, so the
  same move made with a finger still succeeds and the post leaves the visible months. The snackbar
  names the destination month, which is the mitigation that already existed; the rule is not the
  same on both paths.
- **The transcript's `changed days` line varies between runs.** It reads the localStorage
  visit-stamp, and a first visit marks nothing by design — so a clean profile prints `(none)` and a
  warm one prints the marked day. The spec asserts neither; it is the record that is inconsistent,
  not the surface.
- **`src/lib/edit-scope.test.ts` and `src/lib/post-generation.test.ts`** fail on a missing
  `DATABASE_URL` — unchanged for seven sessions, identical on a clean tree. The worker's 10
  suite-level failures are the same cause, also measured identical on a stashed tree.
- **The 18 desktop e2e failures** above. Measured at `b84710a` this session and identical; still
  the largest standing gap in the suite, and still wanting their own session.

## Still open

- **The span is a guess with a reason, not a measurement.** Rule 2 exists because the operator
  asked about next week from October. Nobody has watched a client whose months are further apart
  than that, and the first thing to check if a reference fails to resolve is whether its month was
  in the span at all — the digest names every month it loaded, so the answer is in the prompt.
- **Nothing about the cap has run against a real allowance.** The arithmetic, the classification,
  the release loop and the surface are all fixture-covered, and the two things that are not are the
  ones only production has: whether `post_edits` counts what the operator thinks it counts on a
  live month, and whether the 10-minute tick's two queries stay as cheap as they look at real row
  counts.
- **The banked state has never been seen by a client.** It is reachable only by exhausting a real
  allowance. The most likely wrong thing about it is the copy, not the mechanism.
- **`capNotice` is computed from the parser's own item list**, so a turn the parser under-decomposes
  under-counts the cost. That fails safe — the client is told less often than they should be, never
  more — but it means the number is as good as the decomposition.
- **Nothing here is verified on hardware.** The banked card, the cap turn and the upsell affordance
  are asserted in jsdom; the phone is where they actually live.
