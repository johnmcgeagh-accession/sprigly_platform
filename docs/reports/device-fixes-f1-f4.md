# Four device fixes — the week, the direction, the jump, the voice

Branch `dev`. Four commits, never pushed. All four from live testing on 31 July 2026.

| | |
|---|---|
| `dff7507` | F1 — a week is Monday to Sunday, and the agent is told which one |
| `f6bcabd` | F2 — cross-month goes both ways: the digest is what you browse, not what you can reach |
| `58c5df0` | F3 — the jump, round 5: the sheet stops producing the click, instead of eating it |
| `ed26d35` | F4 — voice, simplified: no meter, and the words land in the box as they are heard |

---

## F1 — "NEXT WEEK" RESOLVES WRONG

### Where it resolved, and what it resolved to

Asked on Friday 31 July, the agent answered about **7–13 August**. That is today + 7 through
today + 13 — a rolling seven days starting a week from now. The answer is Mon 3 – Sun 9 August.

**Nothing computed 7–13.** There is no today+7 week rule anywhere. The bucketing was never wrong:
`bucketCycleState` (`cycle-state.ts`) has anchored on Monday since it was written, with the same
`(getDay() + 6) % 7` shift the week strip, the month grid, the desktop calendar and the weekly
session all use, and it produced Mon 3 – Sun 9 correctly.

It produced it and threw it away. `answerQuery` (`query.ts:45,65`) reads `cycleState.summary` and
nothing else, and the summary stated today, the plan's calendar window and every post's ISO
date — and **never stated where the week began**. So the phrase was left as arithmetic for a
small model, and it did the arithmetic the words most naively suggest. The `thisWeek` / `nextWeek`
arrays holding the right answer were computed on the line above the summary and discarded.

The parser's prompt did carry a rule — *"next week = the week starting the coming Monday"* — but
the parser is not what answers a query, and the query prompt had nothing.

### The fix: state the answer, don't set the exercise

The same treatment that closed the past-date inversion and the month boundary.

`agent/weeks.ts` is now the single definition. A week runs **Monday to Sunday inclusive**, and the
module both computes the windows and prints them:

```
WEEKS RUN MONDAY TO SUNDAY. Today is Fri 31 July.
THIS WEEK is 2026-07-27 to 2026-08-02 (Mon 27 July to Sun 2 August).
NEXT WEEK is 2026-08-03 to 2026-08-09 (Mon 3 August to Sun 9 August).
"Next week" means THAT Monday-to-Sunday block — never "seven days from today". Read the dates
off these lines; do not count forward from today.
```

Those lines go into **both** prompts: the plan state (so the query answerer reads them) and the
parser's user message, above the day table. `bucketCycleState` also prints the counts from the
buckets it already had, so the prose and the data cannot describe different weeks. `cycle-state`'s
private `weekStart` is gone — `currentWeekPosts` and `bucketCycleState` take the shared window.

The last sentence is the one that closes it. Naming the boundary is not enough: *next week* has an
everyday reading — "in a week's time" — that is not the calendar one, and the model has to be told
which is meant.

**The context span's `today + 7` rule is untouched.** It picks which cycles to LOAD, and it is
correct as it stands; this was the resolver, and they are different questions.

### Fixtures

`weeks.test.ts`, 23 tests. The operator's day pinned exactly — including `nextWeek.from !==
addDays(today, 7)` and `nextWeek.to !== addDays(today, 13)`, so the answer that was given is
unsayable. Every weekday anchor of one week returning the same two windows, with **Sunday**
called out: on Sun 2 August, next week starts *tomorrow*, and today + 7 lands on the 9th, which is
that week's LAST day — a naive reading names a range starting six days late, and no other weekday
exposes it. Month, year and leap-February boundaries. Then the plumbing: the windows reaching the
plan state, the counts coming from the buckets, and both prompts carrying the rule.

---

## F2 — CROSS-MONTH WAS ONE-WAY

### The refusal was not ours

*"October is not in your current plan view"* is not written anywhere in this codebase. The model
composed it — from what it was handed.

### The reference-resolution path, cited

X1b fixed the destination guard. The **candidate set** was still the span:

- `plan-context.ts:191-192` — `cycles` was loaded from `span.map(loadPlanPosts)`;
- `PlanContext.posts` was that union — the resolution set;
- `turn.ts:210` — `const posts = planCtx.posts`, handed to `resolveMoveSource` and
  `resolvePostRef`.

The span from **August** is `{viewed August, its neighbours, the cycle holding today and
today + 7}`. October is not in it, so there was no October post to find and the turn said so.

The reverse worked, which is what made it read as arbitrary: from **October** the span reaches
August through the now-rule, because next week is in it.

### The fix: the digest and the resolution set are different things

> The **digest** is what the model BROWSES. It costs tokens on every turn, so it stays the span.
> The **resolution set** is what a reference may REACH — and a reference does not need to have
> been browsed. The client said "the 16th of October" out of their own head.

`buildPlanContext` now loads every cycle from **last month onward** (`resolutionCycles`) and marks
which are printed (`ContextCycle.inDigest`). The lower bound is the date gate rather than a cap: a
post in a finished month is read-only anyway, so loading a year of history to refuse a reference is
spend with no outcome. For the operator that is five or six indexed reads; the digest — the part
billed on every turn — is unchanged.

### Two consequences of a wider set, both handled

A wider candidate set makes references that used to be certain ambiguous by construction. Both
were found by fixtures written for the fix, and both are real behaviour the client would have felt.

**"The 16th" now exists in five months.** `resolvePostRef` and `resolveMoveSource` give the month
**on screen** first refusal: one match there wins outright, and *several* there is the ambiguity to
put to the client — rather than four posts from months they never mentioned. Only when the viewed
month does not answer at all does the reference reach across, which is precisely the case the
client had to name another month to create.

**A named month must be a hard filter.** `resolveTargets` scopes to it before any branch runs, and
an empty result is an empty result. Falling through would let "the 16th of October", asked from
August, match August's 16th — the day-number branch has no month in it. The stated cost: a month
*word* inside a caption ("the August sale") is no longer findable by that word alone.

The month list stops reading as a boundary — a month whose posts are not printed now says
*"posts not listed below — name a date or a title and I WILL find the post"* — and the parser
prompt carries the operator's sentence as a worked example, with an explicit ban on answering that
a month "is not in your current plan view".

### Fixtures

Added to `cross-month.test.ts` (36 total): the operator's sentence verbatim from the August view,
with and without a `fromDate`; **both directions on the same client on the same day**; a reference
**by title two months away** (November, from August); the resolution set proven wider than the
digest; and the four ambiguity cases the widening created — a bare "the 16th" meaning August's
from August and September's from September, a named month overriding the month on screen, and a
genuinely ambiguous in-month reference still asking about *two* posts rather than four.

---

## F3 — THE JUMP, ROUND 5

### Reading the operator's trace

```
1ms      select user:grid         2026-08-29   ← onClick@…
4325ms   cycle user:next-month    d5670806-…   ← a_@…
4326ms   cycle switch             d5670806-…
6346ms   select user:month-change 2026-09-02   ← a0@…
```

Backwards. The jump the client SEES — landing on 2 September — is `select user:month-change` at
6346ms, two seconds after the switch: that is the refetch settling, and it is the "wait ~1s" in
the report. The **cause** is at 4325ms, 4.3 seconds after the day tap: i.e. at the moment they
closed the post they had opened.

**The call site.** `cycle user:next-month` is written in one place — `CommittedSurface.tsx:336`,
the `onNextMonth` closure — and reachable from one control, `PlanShell.tsx:131`
`<ArrowBtn dir="next">`. Something clicked the month arrow. The day-view trace says the same
thing with no other user event in it at all.

### The geometry, measured rather than reasoned about

Run in the browser against the real surface at 390×844:

```
NEXT-MONTH BOX {"x":129.42,"y":32,"width":40,"height":40}
GRABBER BOX    {"x":0,"y":67.53,"width":390,"height":34}
OVERLAP Y px = 4.47
```

The sheet's close control overlaps the month arrow. 4.5px at that height — and **more on a phone
with browser chrome**, because the panel is `h-[92%]`: at 700px of visible height the grabber
starts at y 56 and the overlap is 16px, half its height. A thumb closing the sheet at x ≈ 150 is
over the arrow.

### Why round 4's guard didn't hold

`Sheet.tsx` dismissed on `pointerup`, unmounted inside that handler, and armed a capture-phase
click-eater disarmed by `setTimeout(disarm, 0)` — on the stated assumption that *"a browser
dispatches the compatibility click in the same input-dispatch turn as the pointerup"*. Nothing
specifies that. It is a race, iOS loses it the other way, and a guard that is right most of the
time on a navigation bug is indistinguishable from no guard.

### The fix is not a better guard

**A tap now closes on `click`.** The compatibility click is consumed by the grabber itself — still
mounted, because nothing has closed yet — so there is no second click to land anywhere. No window,
no coordinates, no ordering assumption; the class is gone rather than mitigated.

A keyboard activation is a click with **no pointer sequence in front of it**, and that absence is
what keeps Enter closing a sheet whose grabber is its only close control.

A **drag** still dismisses on `pointerup`, having no click of its own to close on, and keeps the
guard — now disarmed by the next `pointerdown` rather than by a timer. A compatibility click is
never preceded by its own pointerdown, so that is a fact about how input works rather than a bet
on scheduling. The timer survives only as a 1200ms ceiling.

### Reproduced first, and proven red

`september-jump.interaction` models the browser honestly: `pointerdown`, `pointerup`, then **one**
compatibility click a macrotask later, onto whatever is under the finger *at dispatch time*. If
the sheet closed on pointerup the grabber is gone and the click lands on the shell; if it is still
there, the grabber eats its own click. Deciding the target in the harness would be writing the
answer down.

Four cases fail on the pre-fix `Sheet.tsx` — verified by reverting it and re-running — with
`expected 'September 2026' to be 'August 2026'`, which is the operator's report in one line. Seven
new cases in total: the day view, the month view, the previous arrow, the day not following, the
arrow still working when meant, the grabber still closing, and the drag path still guarded.

`sheet-close.interaction` (round 4's file) is rewritten around the prevention rather than the
mitigation, and gains the keyboard case and the drag guard's disarm-on-pointerdown.

---

## F4 — VOICE, SIMPLIFIED

### The meter is deleted

`Waveform.tsx` goes, and `audio-contention.ts` with it — the latter's whole subject was whether a
browser may hold two microphone captures at once, and that is not a question this surface asks any
more. The meter was a third thing to look at, a second audio consumer to referee, and a frame
budget spent on decoration; it answered *"is it hearing me?"* less well than the words do.

`one-capture.interaction` is stronger for the deletion: the count it guards is now **zero on every
platform**, including Chromium, where a second capture was tolerated and was the only reason the
meter survived there after WebKit lost it.

### Why final results sometimes didn't land

Only **finals** were written into the composer. Interims were rendered as a preview *underneath*
it and discarded. So the one route from heard to in-the-box was a final — and a final is not
guaranteed to arrive:

- `stop()` on iOS tears the session down without flushing a part-recognised utterance, and **both
  Send and Stop call it**;
- `onend` restarts a session WebKit ended by itself, and the tail goes with it;
- `clearSpeaking` wiped the preview on `speechend` **and** on `audioend`.

Each of those left the client having watched their sentence appear under the field and then
vanish. That is the reported "sometimes they don't land", and it is structural rather than flaky.

### The transcript goes straight into the field

The composer holds `typed + finals + interim`, rebuilt on every result. Whatever the engine has
heard is **already where it is going**, so stopping keeps it; a final only confirms what is on
screen. The client reads it and presses send when ready.

The typing the preview existed to protect is protected by **rebasing** instead: a manual edit
becomes the new base, so speaking after typing appends and typing after speaking is never undone
by the interim that arrives a moment later. Submit resets both authors, or the next dictation
would append to a sentence already sent.

**The trade, stated:** an interim is a guess the engine may revise, so a capture cut off mid-word
leaves a word that may be wrong. A word to correct beats a sentence to say again.

**The listening state** is the Speak control's own `aria-pressed` and label, and the text
appearing. `pulse` is gone from `useSpeechInput` — it existed only to give the animation something
to tick on, and re-rendered the sheet several times a second for it.

### Fixtures

`voice-sheet.interaction`: the interim landing in the field with no second surface; **stopping
keeps the tail** (the words that used to be lost); a session the engine ends by itself keeping it
too; append-and-rebase both ways; and the meter's absence with the control's pressed state as the
whole listening signal. `one-capture.interaction`: no meter, zero `getUserMedia`, on both
platforms. `small-truths`' meter block is removed with the component it tested.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` (app) | clean, after every commit |
| `pnpm --filter @sprigly/worker... build` | **exit 0** from a cleaned `dist` — the command Railway runs |
| app unit / interaction (Node 22) | **1164 passed**, 14 skipped (was 1127) |
| worker unit (`engine`) | **301 passed**, 38 skipped — unchanged |
| shared (`packages/engine`) | **377 passed** — unchanged |
| e2e — mobile | **17 passed** |
| e2e — tenant-b | **8 passed** |
| e2e — desktop | 36 passed / 18 failed — **identical to the `b84710a` baseline, test for test** |
| tokens fence | 10 passed |
| terminology fence | 6 passed |
| draft invisibility | 5 passed |
| detector | 0 findings on every changed component |

**The worker's BUILD was not a gate, and should have been.** `tsc --noEmit` in `app/` and
`vitest` in `engine/` both pass over a test file that imports across a package boundary by
relative path; the worker's own `tsc` does not, because `engine/tsconfig.json` sets
`rootDir: "src"` and includes the tests, so an import climbing out of it is TS6059. Two such
imports were introduced in the X2 session and only Railway saw them. The command that would have
caught them is the one Railway runs — `pnpm --filter @sprigly/worker... build` — and it is now
part of this report's gate list rather than assumed to follow from the type-check.

**Fence proof.** `git diff b96678c HEAD -- '*terminology.fence.test.ts' '*tokens.fence.test.ts'
'*draft-invisibility.test.ts'` is **empty**.

**Desktop e2e proof.** The failing list was captured at HEAD and diffed against the list measured
at `b84710a` last session (checked out detached, packages rebuilt, run, restored). Identical — 18
tests, same names, same lines, spanning `desktop.spec`, `hooks`, `scripts`, `format`, `refine`,
`a11y` and `agent`. None is a file this session touched.

**Net new fixtures**, 37 tests: `weeks` (23), `cross-month` (+9), `september-jump` (+7),
`voice-sheet` (+4 net), `one-capture` (+1 net), less the meter cases deleted with the component.

### Deliberate test changes, and the argument for each

1. **`cross-month`'s "when it CANNOT see the week"** asserted the plan state contained no
   `'2026-08'`. It now names next week's dates, and that is the improvement: the answerer can only
   say "next week is the 3rd to the 9th and I can't see it" if it has been told which dates those
   are. What must still be absent is any August *post*, and that is what it asserts.
2. **`date-inversion`'s past-row check** searched the whole summary for `2026-07-29`; F1 added week
   lines above the rows, which name dates too. It searches the post rows specifically.
3. **`cross-month`'s month-list marker** — F2 changed what an unprinted month says, from a
   boundary to an invitation, so the fixture asserts the new sentence.
4. **`sheet-close.interaction`** — round 4's file, rewritten around the prevention. `tapGrabber`
   now completes the gesture the way a browser does and lets the *target* of the compatibility
   click be decided by what is mounted. Gains the keyboard case and the drag guard's
   disarm-on-pointerdown; loses the two that asserted a click being eaten on the tap path, because
   there is no such click any more.
5. **`sheets.interaction`'s two grabber-tap cases** — the gesture is unchanged, the event it
   completes on is not, so the fixtures complete it.
6. **`voice-sheet.interaction`'s interim case** asserted the exact opposite of F4's ruling. It is
   inverted, and three cases are added for the reliability half it was hiding.
7. **`one-capture.interaction`'s two meter cases and `small-truths`' meter block** — the component
   is deleted; the counting tests stay and get stronger.

---

## Found and left unfixed

- **`resolveTargets` cannot find a month word inside a caption once the reference is read as
  naming that month.** The hard filter F2 needs makes "the August sale post" scope to August-dated
  posts. A date-named month is the overwhelmingly common case and the one that reaches across
  months at all, so this is the right side of the trade — but it is a real narrowing and it is
  stated in the code.
- **The transcript's `changed days` line still varies between runs.** It reads the localStorage
  visit stamp, and a first visit marks nothing by design, so a clean profile prints `(none)` and a
  warm one prints the marked day. The spec asserts neither; it is the record that is inconsistent.
- **The 18 desktop e2e failures**, and the two `DATABASE_URL` suite failures in app and ten in the
  worker. All measured identical on a clean tree; unchanged for eight sessions.

## Still open

- **F1 and F2 are prompt changes as well as code changes.** The arithmetic and the resolution are
  deterministic and fixtured; whether Haiku reads the week lines rather than counting, and whether
  it emits a move for a month whose posts it cannot see, is decided at run time. Both fail safe —
  a model that ignores the week lines gives the answer it gave before, and one that refuses to
  emit the cross-month move produces a clarify rather than a wrong change.
- **F3 is verified in jsdom and by measurement, not on the device.** The mechanism is named, the
  geometry is measured in a real browser, and the reproduction is red without the fix — but the
  operator has the instrument armed, and the thing worth watching for is a trace with `cycle
  user:next-month` still in it. If it appears again the cause is a different one, because this one
  cannot produce a second click.
- **The interim-in-the-field trade has not met a real accent on a real network.** How often an
  engine revises a word it has already streamed is the one thing only the device can say, and it
  is the thing that decides whether the kept tail reads as reliable or as noisy.
- **Nothing here is verified on hardware.**
