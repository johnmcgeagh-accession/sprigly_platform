# The conversation sheet, round 2

Branch `dev`. Five commits, never pushed.

| | |
|---|---|
| `93fe768` | C5 — the September jump: the strip's own controls walked out of the month |
| `9a91916` | C4 — a reel's hook and script are one act |
| `f4e42aa` | C1 — one conversation per SESSION |
| `fef957f` | C3 — the pending change is the referent |
| `9e5f9a5` | C2 — a Claude-style composer, a mic you tap, a FAB that says chat |

---

## C5 — the September jump, round 3

### The named suspect did not reproduce

The brief's prime suspect was the background-apply settle → refetch → re-anchor path. I built a
harness that drives the **real stack** — `PlanRoot`, the real `usePlanData`, the real surface,
with only the network faked (`september-jump.interaction.test.tsx`) — applied from the sheet, and
let the refetch chain settle completely. **Month and day both held.** They held even when the
refetch was made to answer with another month's posts entirely, which is the worst case that path
can produce.

Both earlier fixtures tested the surface in isolation with a hand-built `PlanData`. That is
exactly why neither could see a mover living in the hook or the root, and why this round started
by building something that could.

### The mechanism, found and named by the trace

```
select user:strip 2026-09-04 ← CommittedSurface.tsx:75
```

**`WeekStrip.canPage` tested one thing and `page()` did another** (`WeekStrip.tsx`, as it was):

```ts
const canPage = (n) => weekOf(addDays(selected, n * 7)).some((iso) => monthOf(iso) === month);
const page    = (n) => onSelect(addDays(selected, n * 7));
```

`canPage` asks whether the **week** it would land on overlaps the viewed month. From 28 August the
week of Mon 31 Aug does overlap August — it contains the 31st — so the chevron was **enabled**, and
the **day** it then selected was seven days on: **4 September**.

The consequence is the report verbatim: the day header reads *Friday 4 September*, the week renders
seven days whose posts belong to a cycle nobody fetched, and the month title still says August. The
plan has jumped a month and taken the posts with it.

Three controls did it — the chevrons, the swipe and the arrow keys — because all three moved by
arithmetic and only the chevrons consulted a guard at all. The swipe and the keys had none.

**The fix** is `dates.clampToMonth`, applied in ONE place: `WeekStrip.move()` is now the only way
any of the three changes the selection, and a day past the edge is pulled to that month's nearest
day. Leaving the month stays the ‹ › **month** arrows' job, because that is the mechanism that
refetches. A side effect worth noting: 30 and 31 July were previously **unreachable** by the pager,
which dead-ended at the 29th; the clamp makes them reachable (the e2e assertion was updated to say
so).

### A second finding, about the LAST fix

**F2's session restore had never once run.** React runs child effects before parent effects, so
`CommittedSurface`'s `saveNavState` overwrote the inherited position with the month the server had
just landed on — and `PlanRoot`'s restore then read it back, found it equal to the viewed cycle,
and returned. The writer beat the reader to the same key, every mount. The trace says it plainly:
`select mount` and `land mount` present, `cycle restore:session` never.

`nav-state.ts` now snapshots the inherited position at module load — before any component has
mounted, let alone saved — and `readNavState` serves that snapshot to the CYCLE restore. The DAY
restore keeps reading live, because they are different questions: "which month was this tab on
before this page load began" versus "where was I standing on this exact cycle and month", and the
day is refused unless cycle AND month both match, so it can drag nobody anywhere.

### The instrument

`?nav=trace` now records each entry's **call site** — `file:line`, with the function name where the
engine gives one — rendered in its own column and included in `copy`. A reason string is what a
call site *claims*; the frame is what it *is*, and the two disagreeing is how the next unfound
mover gets caught. It is what produced the line quoted above.

### Fixtures

`september-jump.interaction.test.tsx`, 10 tests: the apply-then-refetch cases that held (including
the wrong-month refetch); the four ways out of the month (chevron, forward swipe, backward swipe,
arrow keys); in-month movement still working; the arrow-key clamp landing on the month's last day;
and the restore now firing, with the no-op case beside it.

---

## C4 — hook/script/caption coherence

### The reachable paths, established

| # | entry point | job | |
|---|---|---|---|
| 1 | detail sheet · Script tab | `/api/plan/script` → `enqueueScriptJob` | combined ✓ |
| 2 | detail sheet · **Hook tab** | `/api/plan/hooks` → `enqueueHookJob` | **SOLO ✗** |
| 3 | **agent "generate hooks"** | `proposals.ts` approve → `enqueueHookJob` | **SOLO ✗** |
| 4 | phase-2 fan-out | `HOOK_FORMATS` = carousel only; reels via `script-ready.ts` | combined ✓ |
| 5 | add path (F5) | `enqueueFollowOnGeneration` → carousel only | combined ✓ |

`script.ts` writes a reel's hook AND script in one model call precisely so they cannot disagree —
*"the split this replaces welded a mismatched hook onto a reel"* (`73bf1f7`). Paths (2) and (3)
bypassed that. A hook written by (2) had never seen the script that followed it, which is the
video; (3) is the same hole reachable by simply asking out loud.

### The fix

Both redirect for reels. `/api/plan/hooks` enqueues the combined job and answers
`{ combined: true }` with a `script_…` jobId — the poller already routes by prefix — and
`proposals.ts` does the same on approve (returning no `hookPostId`, because the combined job
**writes** both fields rather than returning candidates to pick). Carousels are untouched: no
script to cohere with, so the standalone hook and its three candidates remain right for them.

**Caption absent → REFUSED, not generated.** Both fields are built from the caption and there is no
machinery here that writes one first, so the route 422s `caption_required` — and the draft
placeholder is not a caption either, which is the fresh-reel case. The agent path blocks while
staying approvable. The sheet already renders that refusal as *"the hook and the script are built
around the caption, so that has to come first."*

The Hook tab on a reel now says **"Write the hook and script"**, offers the length, and explains
that the pair is written together — the button no longer promises less than it does.

### Fixtures

`hooks/route.test.ts`, 10 tests, asserting **the job**: one enqueue, of the combined kind,
caption-grounded, never the solo hook; the post's own script length honoured; the busy case a noop;
the carousel path unchanged; the guards intact. Plus the agent's reel-redirect and no-caption block
in `proposals.test.ts`, and both tabs of a reel in `sheets.interaction`.

---

## C1 — per-session chat

Round 1 made the thread per-**cycle** and everlasting. Reopening showed every exchange the month had
ever had, and the parser's context window was that same list — so a reference from three weeks ago
competed with what the client had just said, and they scrolled past a wall of history to say one
sentence. A session is the unit the client thinks in.

- `POST /api/plan/conversation` starts a conversation for the viewed cycle; the sheet calls it on
  open and carries the id on **every** turn, which makes the context window the session's. `GET`
  reads **by id**, and can no longer be asked what a month has ever said.
- `ensureConversation` no longer adopts the cycle's most recent thread. `resolveCycleConversation`
  is gone — it existed only to answer the question that produced the wall.
- `ask()` takes the sheet's `conversationId` rather than a page-level ref, and writes that ref back
  only for the **desktop** agent bar; a sheet session's id must never leak into the next one.
- The framing turn renders **immediately** on open, before the POST settles — a sheet that waits on
  the network is a sheet that opens blank.

**Nothing is deleted.** Every turn stays in `agent_messages` under its own conversation row; what
changed is which one the sheet asks for.

**Fixtures:** a reopen shows a clean sheet (jsdom and e2e); the session id rides every turn; a new
session's window contains none of the last one's — **and `thread-context`'s in-session "move it
back" still passes**, which is the half the ruling must not break.

---

## C3 — the pending proposal is the referent

The video: an add sits unapplied on screen and the client says *"instead of a single image make it
a reel."* That landed as a `change_format` against a post that **does not exist** — the add was
still a proposal — so the correction either refused or left two contradictory adds for the client
to apply both.

An unapplied interpretation is the most recent thing said **and** the thing on screen, so an
utterance that could plausibly be about it is about it:

- The sheet sends the **open** turn's proposals with each ask. `turn.ts` loads only those **still
  pending** — the sheet's list is what it last knew, and one applied or discarded since is not what
  they are looking at — and puts them in the prompt as a `PENDING` block.
- The parser prompt states the rule, its escape hatch (*"only when the utterance PLAINLY names
  something else"*), and three worked examples. A task carrying `"amends": true` **supersedes**.
- `turn.ts` rejects the superseded proposal and creates the amended one through the ordinary path —
  same derivation, same guards, same summary. Rejecting first is deliberate: if the new one is then
  refused by a guard, the client is left with neither, which is the honest reading of *"not that
  one, this one"* where *this one* is refused.
- The sheet marks that turn `superseded` — **visible**, because the thread is the record, and not
  applicable, because two versions of one change must never both be.

**Fixtures:** `pending-referent.test.ts` (7) — the video's exact case (amended add: `format: reel`,
same title, same date, old one rejected); a pending move plus an unrelated ask, both surviving as
separate turns; a correction of that move amending it; a proposal no longer pending not being a
referent; no pending block when nothing pends. `conversation-sheet` covers the sheet half: the
referent is sent, the old turn loses its Apply, an unrelated ask leaves both applicable, and a
resolved turn is never offered as a referent.

---

## C2 — the composer, and the FAB

### Why the pulses waited — one line

`useSpeechInput` set **`interimResults = false`**. With interims off, a `SpeechRecognition` fires
`onresult` **once per utterance, at the end**, when the engine has finalised the phrase. Every pulse
the meter had was therefore a report that a sentence was already over — the bars sat still while the
operator talked and only twitched when they stopped.

F7b fixed the **flag** (marking `speaking` on a result). It could not fix the **timing**, because
the event itself arrives too late. A live meter cannot be driven by an end-of-sentence event.

Interims are on now: several a second while speech is in progress. Only **finals** are appended to
the field; interims render as a live preview **beneath** it (`voice-partial`), so the client's own
typing is never overwritten by a guess the engine is about to revise. The speaking-decay drops from
2s to 900ms, which interims make safe.

### The composer

A **full-width text panel** with the controls beneath it, keyboard-focused on entry from both entry
points. The old row put the field between two 48px buttons — 176px at 320px, about four words, on a
surface whose promise is *say what you want*. The mic is a labelled **Speak / Stop** pill that starts
the capture on **tap**.

This reverses round 8's fix 5 ("it listens the moment it opens"), and the reversal is the point:
opening a live microphone on sight is a decision made for the client. `start()` remains synchronous
on the gesture's own task — the tap **is** the gesture now, so the `useLayoutEffect` that existed to
preserve the *open* gesture's activation is gone. `stopSpeech` on close is unchanged: a capture that
outlives its sheet is the one bug here nobody would see and everybody would feel.

### The FAB

The Sprigly leaf knocked out of a speech bubble (`ChatMarkGlyph`). A microphone named one way in to
a surface that is now a conversation you can also speak to.

**Screenshot-checked at size**, and it mattered: the first draft read as a blob at 26px — the leaf
was too narrow and its centre split too subtle. Widened, with the stem opened up, it holds at 26px
and degrades to a legible mark to about 18px.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` | clean, after every commit |
| unit / interaction (Node 22) | **986 passed**, 14 skipped |
| e2e — mobile | **17 passed** |
| tokens fence | 10 passed |
| terminology fence | 6 passed |
| draft invisibility | 5 passed |
| detector | 0 findings on every changed component |

**Fence proof.** `git diff HEAD~5 -- terminology.fence.test.ts tokens.fence.test.ts
draft-invisibility.test.ts` is **empty**.

### Deliberate test changes, and the argument for each

1. **The capture suite** (`voice-sheet`, `one-capture`) — "opens listening" is reversed by the
   ruling, so every case taps the mic first. What they test is unchanged and is the part that
   matters: one session, one `getUserMedia` budget, the transport is what happened, refusals name
   themselves. Two cases are new: interims are on, and an interim previews without touching the
   field while a final lands in it.
2. **`conversation-sheet`'s persisted-history block** — it encoded the per-cycle model the ruling
   reverses. Replaced by the per-session contract: opens a session not a history, the framing lands
   without the network, the id rides every turn, reopening is clean.
3. **`sheets.interaction`'s empty-hook-tab case** — it drove a reel through the solo path C4
   closes. It now drives a **carousel** (where the solo hook is still right), and two reel cases sit
   beside it.
4. **`proposals.test.ts`'s generate_hook case** — same reason; the reel version asserts the
   combined job and the no-caption block.
5. **`mobile.spec.ts`'s week pager** — the clamp makes 30–31 July reachable where the pager used to
   dead-end at the 29th.
6. **Call-shape updates** across the sheet tests: `onSubmit` gained the conversation id and the
   pending-proposal list; several agent harnesses gained the two new `proposals` exports.

### Pre-existing, and not fixed here

- `src/lib/edit-scope.test.ts` and `src/lib/post-generation.test.ts` fail on a missing
  `DATABASE_URL` — unchanged for five sessions, identical on a clean tree.
- **The desktop e2e project's 16 failures** are unchanged and still predate the last two sessions
  (reproduced at `58c44e3` in the round-1 report). Still worth its own look.

---

## Still open

- **The apply-confirmation turn is still not persisted** (carried from round 1). With per-session
  threads this matters less — the confirmation lives as long as the session that produced it — but a
  remount inside a session still loses it.
- **`amends` is a model judgement.** The prompt states the rule, the examples and the escape hatch,
  and the plumbing is fixture-covered — but whether a given sentence *is* a correction is decided by
  Haiku, and only device use will say how often it gets it wrong in each direction. The failure is
  designed to be cheap and visible: a wrong amend supersedes a turn the client can see was replaced,
  and a missed one leaves two turns they can discard.
- **The interim preview is `aria-hidden`.** It changes several times a second; announcing it would
  be unusable. The final lands in the field, which is announced — but a screen-reader user gets no
  live confirmation that dictation is being heard beyond the status line's "Listening…".
- **Nothing here is verified on hardware.** The interim-driven meter in particular is the one fix in
  this round whose whole point is what it looks like on a phone.
