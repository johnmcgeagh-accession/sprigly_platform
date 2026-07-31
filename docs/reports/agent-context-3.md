# Agent context, round 3 — the boundary, the partial apply, and the jump's round 4

Branch `dev`. Seven commits, never pushed.

| | |
|---|---|
| `0e1774f` | G5 — the jump's fourth mover: a padding day is a tap, and the tap was never clamped |
| `1128f70` | G6 — the what-changed pill goes; the day dots are the whole changed-surface |
| `5bf5d01` | G3 — the vanished launch post: a guard refusal is not a 200 that applied |
| `aeab116` | G2 — a month ends on the calendar's last day, not on the plan's last post |
| `6721e40` | G1 — a pending intent: the question turn's answer has somewhere to go |
| `753955c` | G4 — the structure stops waiting for the content |
| `cae2c57` | the e2e gate could not run, and had been lying for one commit when it could |

---

## G1 — pending questions are referents

### What the parser actually received

The brief calls the current items-only serialisation the bug and asks for it to be cited. It is
half right, and the half it is wrong about is the more useful half — so this was measured before
anything was changed, by running the real `threadForParser` over the screenshots' thread:

```
CLIENT: I want to launch the raspberry set
ASSISTANT: could not do: Is the raspberry set new, or an existing one coming back?
CLIENT: It's new. Angle is fresh.
```

The question text **did** travel. `conversation.ts:151` (as it was) serialised a clarify's
`unresolved` item, question and all. What it did not carry was that the question was **open**:
`could not do:` is the label of an ask that was DROPPED. And nothing anywhere held the slots the
three turns had filled.

So "Reels" arrived at the parser as a complete utterance with no verb, no subject and no target,
against a thread whose last line said the previous request had failed. The only available reading
is *the client said a word*, and the only safe response to that is to ask what they mean. **"What
would you like to do with the reels?" is not a failure of understanding — it is a failure of
state.**

### The mechanism

| | |
|---|---|
| `conversation.ts:151` | a question serialises as `asked: "…"`; a genuine dead end still says `could not do:`. The discriminator is a question mark — what the thing *is*, not a flag someone has to remember to set |
| `types.ts` `PendingIntent` | the assembly as an object: `action`, `slots` (subject / angle / format / count / date), the `question` asked, and `asked[]` — which slots have already been put to the client |
| `turn.ts:474` | the intent is stamped onto the assistant message that asked, with the question **`cannot()` actually put on screen** rather than the model's claim |
| `conversation.ts:175` `latestPendingIntent` | only the **last** assistant turn's counts. An assembly the conversation has moved past is not resurrected |
| `turn.ts:188`, `turn.ts:230` | read from the same `listTurns` call as the thread, serialised by `conversation.ts:186`, and placed **first** in the variable block (`task-parser.ts` `buildUserMessage`) — ahead of PENDING and the thread |
| `task-parser.ts` `normalizeTask` | validated, never trusted: unknown slots dropped, unrecognised action → null intent, count clamped 1–10, and an intent on a **non-clarify** task is discarded — an assembly must not outlive its question |

The prompt's standing instruction *"THE CLIENT CANNOT REPLY TO A TASK … NEVER phrase a task as a
question"* was written for the desktop approvals list and is now false: in the sheet they can, and
do. It is replaced by a narrower rule — prefer a guess; a question is legitimate in exactly one
case, an assembly with a slot that cannot be guessed; and it **must** carry its intent. One
question per slot, then default.

### Fixtures

`pending-intent.test.ts`, 19 tests. The screenshots' thread turn by turn: the launch ask opening
the assembly; the answer merging (angle in, subject still there); **"Reels" arriving with the
launch attached**, so the turn after it is the count question and never *what would you like to do
with the reels?*; and "three" resolving into three reel proposals with no question surviving. The
second fixture is the mid-assembly amend — "actually make it the 19th" replaces the date, keeps
subject, angle and format, and the context it was decided against showed the old date, which is
what makes it an amendment rather than a new request. Plus the escape hatch, the abandoned
assembly, and the validation.

---

## G2 — the month boundary is the calendar

### Where it came from

There is no "runs up to the 28th" rule in this codebase. `canAddPost` (`add-policy.ts:40`) gates on
today; the move guard compares **plan months** (`turn.ts`); a cycle plans a whole calendar month.
The sentence was the only inference the evidence permitted. Both context builders listed the posts
and said nothing about the month, so the plan's extent was readable only as `max(scheduled_date)` —
last post the 28th, therefore plan ends the 28th. A gap at the end of a month read as the end of
the month, and the same reasoning would have refused the 30th of any month whose last post was the
27th.

### Two derivations, both fixed

**Labelling.** `cycle-state.ts:48` `planWindowLine` states the plan's first and last date and that
an empty date inside it is *empty, not absent*. It opens `cycleDigest` (`cycle-state.ts:190`) and
`bucketCycleState` (`cycle-state.ts:213`) — the latter matters because the query answerer reads
that summary and nothing else. Both prompts say it in words too (`task-parser.ts` DATES,
`query.ts` `QUERY_SYSTEM_PROMPT`).

**Placement.** `turn.ts:96` `defaultAddDate` put an undated add two days after the last post. From
the 30th that is 1 November — a post proposed into a month this cycle does not plan, which the move
guard would then refuse to bring back. Clamped to the plan month, floored at today.

### Fixtures

`month-boundary.test.ts`, 12 tests, on the report's own October cycle (last post the 28th): the
add on the **31st** proposed with no refusal, the move onto the 31st permitted, the window's
arithmetic through two Februaries and a 30-day month, an empty plan still stating its window, and
the three default-date cases including the clamp.

---

## G3 — partial application must surface

### Why F4's failure-naming never fired

`applyFailureMessage` has named what didn't apply since F4. It is called only when `applyChanges`
reports a non-empty `failed`. It never did.

A guard refusal in `approveProposal` is **not an HTTP error**. It writes the reason to the proposal
row, sets the status to `failed`, and returns 200 with an ordinary body. `usePlanData.decide` read
`res.ok`, saw 200, and returned `{ ok: true }`. So a past-dated add, an exhausted AI-change quota
and a thrown mutation all travelled that line into the **applied** list. `failed` came back empty,
the failure sentence was never composed, the chip counted the refused item among the successes, the
highlights covered it, and the thread said *"Done — 3 changes are in"* over a plan holding two.

The reason existed the whole time. It was in the database.

### The mechanism

| | |
|---|---|
| `proposals.ts:304` `refuse()` | one shape: writes the row **and** the response. Every guard goes through it |
| `proposals.ts:195` `failed` | the explicit signal, distinct from `blocked` — blocked did not consume the proposal, failed did |
| `proposals.ts:43` `dateRefusal` | an add names its **date**, a move names the **end** that was refused, the quota names the number. What the client can act on |
| `[id]/approve/route.ts` | forwards both halves |
| `usePlanData.ts:733` | reads `failed` (and the status, belt and braces) instead of the transport; the row comes out of pending, and the failure is **not** retryable |
| `applied-summary.ts:64` | the reason travels into the sentence, and the tail matches the failure — *"still here to try again"* for a blocked dependency, *"Tell me another date and I'll put it in"* for a refusal, which consumed the proposal and left nothing to press |

The rescue is a promise unless something can resolve it, so
`POST /api/plan/conversation/confirm` writes the settled report back as a turn — closing the
*confirmation never persisted* item carried since round 1 — and, for a **single** refused change,
seeds a `PendingIntent` from the proposal's own stored payload (`proposals.ts:132`
`loadProposalPayload`). "The 30th then" now lands in the slot it belongs to. The client sends the
text and the ids; the intent is derived server-side, because it rides into the next prompt.

### Fixtures

`partial-apply.interaction.test.tsx`, 7 tests, real stack, the October arc with the middle item
refused: all three attempted in order, the confirmation naming *Add "Launch day"* and **not** "3
changes are in", the guard's own sentence, the in-thread rescue, and the two that applied counted
and highlighted — with the refused one absent from the applied panel. **Five of the seven fail with
the `decide` fix removed.** Plus `proposals.test.ts` (31): every refusal path reports `failed` + a
reason, an applied one reports neither; and `confirm-route.test.ts` (11): persistence, ownership,
the seeded rescue, and the three cases that correctly seed nothing.

---

## G4 — slow population

### The two things "ages" meant

CONTENT — captions, hooks, scripts — is a model call per post and takes as long as it takes.
STRUCTURE — the rows existing, the calendar drawing them — should be an approve, a row write, one
refetch, a render. They were welded together.

`decide` did `await pollJob(jobId)` — 1600ms before its first read, then a Bedrock call — **inside**
the loop `applyChanges` runs sequentially, then refetched the whole plan again. Item 2's row was not
written until item 1's caption had been generated.

### Timings

Measured by `apply-timing.interaction.test.tsx`: three-post launch arc, network stubbed, a job
completing in two polls (~3.2s each). The absolute numbers are the harness's; the shape is the
finding.

| | before | after |
|---|---|---|
| approve #1 fires | 1ms | 1ms |
| approve #2 fires | 3205ms | 2ms |
| approve #3 fires | 6408ms | 3ms |
| **structure visible** (last row on the calendar) | **not within a 20s budget** | **13ms** |
| `GET /api/plan` refetches for the batch | 9 | 1 |
| job polls on the critical path | 4+ | 0 |
| job polls after structure | — | 3 |

With a real caption in place of the harness's 3.2s, those gaps are the minutes the operator saw.
The stall was structural: **not a slow render, and not slow generation either — a serialisation
that made the fast thing wait for the slow one.**

### The fix

Pass 1 approves everything with `deferContent` (`usePlanData.ts:757`) — the row is complete when
the approve returns, since `addGeneratingPost` inserts it as `generating` — then **one** refetch,
and the cards render as *On its way*, which is what they honestly are. Captions poll in the
background and refetch as each lands.

The one real dependency is kept: a hook or refine on a reel created in the same batch needs its
caption first. Pass 2 pays for it *after* the structure is up, and only when something is actually
blocked. `pollJob` gains `quiet` — three captions landing during one apply would strobe the single
feedback channel with three "Updated the caption." lines. The words appearing on the cards are the
notification.

---

## G5 — the jump, round 4

### Reproduced, from a named call site

Round 3 put `clampToMonth` on `WeekStrip.move()` and called it *"the ONLY way any of them changes
the selection"*. It was not. The fourth mover is the plainest control on the surface — **a finger
on a day cell** — which called `onSelect(iso)` raw.

`weekOf(selected)` renders seven consecutive days regardless of month, so the week of Mon 31 August
draws six September cells. Round 3's own clamp is what made 31 August reachable (the report records
the same for 30–31 July), so the fix **opened** this door. The harness reproduces it from the
recording's gesture sequence — page to the month's end, tap the Friday:

```
select mount default            ← CommittedSurface.tsx:70
select user:strip 2026-08-21    ← CommittedSurface.tsx:75
select user:strip 2026-08-28    ← CommittedSurface.tsx:75
select user:strip 2026-08-29    ← CommittedSurface.tsx:75
select user:strip 2026-08-30    ← CommittedSurface.tsx:75
select user:strip 2026-08-31    ← CommittedSurface.tsx:75
select user:strip 2026-09-04    ← CommittedSurface.tsx:75      ← THE JUMP
```

That last line is **byte-identical** to the one round 3 convicted the chevron on. The chevron was
one way to produce it; the cell tap is the other, and only the first was fixed. The month grid has
it worse — one tap on a September padding cell from a cold August mount, no month-edge walk needed
at all.

No fix without a named call site, and this one is named.

### The fix

`WeekStrip.tsx:102` `select()` clamps, and out-of-month cells are `disabled`
(`WeekStrip.tsx:153`) — the file's own grammar for a month edge, the same treatment the pager
buttons take. `MonthGrid.tsx:73` takes it as an opt-in `lockToMonth`, because the **move picker**
owns no position and a cross-month move is the point of it. Leaving the month stays the ‹ › month
arrows' job, because that is the mechanism that refetches.

### The instrument, shipped to the operator

`?nav=trace` is an instruction to retype a magic-link URL on a phone — which by definition happens
*after* the session you wanted to watch. **Three taps on the wordmark** (`PlanShell.tsx:183`)
toggle it in place, mid-session, via `navTraceArm`/`navTraceToggle` (`nav-trace.ts:71`, `:83`),
persisted in `sessionStorage` for the tab. The panel appears on the third tap rather than on the
next navigation — `NavTracePanel`'s subscription is unconditional now; it used to return early when
the trace was off, so arming it mid-session did nothing until something else re-rendered the shell.
On a surface whose bug **is** a navigation, that is an instrument that hides exactly when it is
needed.

A suspect row is red-lined as built: the whole row carries the tone and the **call site is at full
opacity** rather than 0.5 — it is the one cell that has to survive being photographed off a phone.

### Fixtures

`september-jump.interaction.test.tsx`, 19 tests (was 10). The five new jump cases — the strip
drawing September cells on the week of 31 August, tapping one, the in-month tap still working, and
the grid's padding cells — plus five for the instrument: absent until armed, two taps are not
three, three arm it with the panel landing immediately, three more disarm it, and an armed trace
recording the mover with its call site.

---

## G6 — the what-changed pill removed

Two surfaces answered one question: a header pill counting the receipts and a panel naming them,
over day dots already marking the days those changes happened on. The month header carried a number
the calendar underneath was already showing, and tapping it replaced the plan with a list of the
plan.

Gone: the `badge` pill, `whatChangedOpen`, the panel, its three test ids, and `changeWord` — which
existed to write that panel's lines and had no other reader. Kept: the `/api/plan/changes` read and
the seen-state, because the dots are computed from them.

The fixtures that covered the row now cover its **absence**, in jsdom and e2e — a deleted surface
with no fixture is one that can come back by accident. The e2e transcript records the marked days
instead of the row's lines, and decays the mark by selecting the day on the calendar, which is
where the change is.

Terminology fence intact (proof below). One related move: `PROPOSAL_REFUSED` is named in
`lib/agent/types.ts` so the status has one definition and the fence keeps its bare-"failed" rule
without an exemption.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` | clean, after every commit |
| unit / interaction (Node 22) | **1068 passed**, 14 skipped |
| e2e — mobile | **17 passed** (was 13 passed / 4 failed) |
| e2e — desktop | 36 passed / 18 failed — **identical at `73710ba`**, measured |
| tokens fence | 10 passed |
| terminology fence | 6 passed |
| draft invisibility | 5 passed |

**Fence proof.** `git diff 73710ba HEAD -- terminology.fence.test.ts tokens.fence.test.ts
draft-invisibility.test.ts` is **empty**.

**New fixtures**, 111 tests across eight suites: `pending-intent` (19), `month-boundary` (12),
`partial-apply` (7), `apply-timing` (4), `september-jump` (19, +9), `what-changed` (8),
`confirm-route` (11), `proposals` (31, +7).

### The gate itself was broken, and is fixed (`cae2c57`)

Two independent faults, the second hidden by the first.

`scripts/test-db.sh` had not been told about `0091_cost_pence_subpenny`, so it refused to build a
database at all — correctly; that is the bug the manifest check exists to prevent.

With the suite able to run, four mobile conversation specs failed on *"Which post did you mean?"*.
Prompt caching (`0988a39`) split the parser's user message into `MessagePart[]`, and
`makeFakeModelClient` still did `.map(m => m.content).join('\n')` — which on an array of parts
yields `[object Object]`. **Every e2e parse has seen an empty message since that commit.** It reads
both shapes now, because a fake with an opinion about how the real call is packaged goes stale the
next time that changes.

### Deliberate test changes, and the argument for each

1. **`what-changed.interaction`'s row block** — the ruling deletes the surface it tested, so it
   now asserts the absence, and `changeWord`'s case went with the function.
2. **`conversation.spec.ts`'s next-visit case** — same ruling; it decays the mark by selecting the
   changed day on the calendar instead of tapping the row.
3. **`transcript.spec.ts`** — records the marked days rather than the row's lines.
4. **`sheets.interaction`'s F4 block** — `applyChanges` gained `failures`, so the fixtures return
   the real shape (typed from the hook, so they cannot drift from it again).
5. **`conversation-sheet.interaction`'s two call-shape assertions** — `onApply` gained the
   conversation id.
6. **`mobile.spec.ts`** — unchanged this round.

### Pre-existing, and not fixed here

- `src/lib/edit-scope.test.ts` and `src/lib/post-generation.test.ts` fail on a missing
  `DATABASE_URL` — unchanged for six sessions, identical on a clean tree.
- **The desktop e2e project's 18 failures.** Reproduced test-for-test at `73710ba` in a separate
  worktree with only the two gate repairs applied, so none of them is this session's. They are now
  the largest standing gap in the suite and want their own session.

## Still open

- **`intent` is a model judgement.** The plumbing is fixture-covered and the prompt carries the
  raspberry exchange verbatim with the failing line marked — but whether Haiku attaches an intent
  to a given question, and merges a given answer into it, is decided at run time. The failure is
  designed to be cheap: a missing intent degrades to exactly today's behaviour, and a wrong merge
  costs one Discard.
- **The G4 timings are the harness's, not a device's.** What they measure is the *shape* — what
  blocks on what — which is what changed. A phone on a real network has not been timed.
- **Nothing here is verified on hardware**, and G5's deliverable is explicitly a device action: the
  fourth mover is fixed and named, but if the jump survives again, the operator should triple-tap
  the wordmark, reproduce it, and screenshot the red line.
- **The desktop e2e failures** above.
