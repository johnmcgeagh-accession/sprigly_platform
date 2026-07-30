# The conversation sheet

Branch `dev`. Four commits, never pushed. The gate held: this ran after the agent-fixes session
landed and `docs/reports/agent-fixes.md` was written.

| | |
|---|---|
| `27137a1` | one conversation per month — persisted, readable, sent with every turn |
| `fb84047` | the conversation sheet — one thread, one composer, one month |
| `3f5b4a7` | what changed, visible — the second dot and the row that names it |
| `de95db1` | one visit, one stamp — and the Emma loop end to end |

The machinery beneath is untouched, as specified: the recognition pipeline (`useSpeechInput` —
one capture, synchronous start on the gesture's own task), extraction, interpretation derivation
(`lineFor`), apply/discard (F4: background, quiet, `changedPostIds`), receipts. The surface
reorganises around it.

---

## THE MODEL

### One conversation per month, and where it lives

**The smallest honest storage is the tables that were already being written.** `conversations`
and `agent_messages` (migration 0062) have carried every turn since the proposal agent shipped —
role, source, timestamps, and a per-message metadata blob. What was missing was not a schema; it
was a **read path** and a **resolve-by-cycle**. A new `threads` table would have been a second
copy of the same facts, with a migration and a backfill to keep them agreeing.

So, three changes and no new tables (`agent/conversation.ts`):

- `ensureConversation` attaches to the cycle's **latest** conversation before creating one. A
  turn with no `conversationId` used to start a fresh conversation every time; the month is now
  one thread across a close, a reload, and a fresh magic-link open.
- `listTurns` reads the recent turns, ownership enforced by the join. An assistant turn that
  carried an interpretation returns the **`items` stored on it at turn time** — so a reopened
  sheet re-renders the same resolved lines it showed live, never re-derived from proposal
  payloads (re-reading is where a second answer to the same question starts).
- `GET /api/plan/conversation?cycleId=` serves it. The cycle comes from the browser, so it is
  checked, not trusted — the same rule the agent route follows.

The draft month's reshape route (`/api/plan/draft/apply`) writes into the **same** per-cycle
conversation: the client's words, then the receipt's own lines. A failed reshape persists
nothing — the thread records what happened, not what didn't.

### The turns

| | |
|---|---|
| **client** | right-aligned bubbles, landing on submit — the transcript of what they said or typed |
| **agent** | the `AgentVoice` register, left. Born as the three-dot working state and **filling** as the turn resolves; the panel grows to fit. There is no full-height empty field, because the turn is only as tall as what it holds. |
| **interpretation** | the itemised understood-changes as an agent turn (`InterpretationTurn`) with Apply / Discard **inline on that turn**, and a lifecycle: `open → applying → resolved \| discarded` |

**The dead end is gone by construction, not by copy.** A question from the agent is just a turn;
the composer never unmounts, so answering is typing. That is why `InterpretationTurn` has no
Discard when nothing is applicable: the old full-sheet phase needed one as the way out, and a
thread's way out is the composer beneath it.

Apply is F4 as specified — background — but the sheet **stays**: the settled report becomes the
next agent turn. The client can close mid-apply and the chip still lands; a failure names itself
in the thread when the sheet is open, and goes to the one feedback channel when it is not
(`voiceOpenRef`, read at settle time rather than at tap time).

### Context: the thread is sent with each turn

`runPlanAgentTurn` reads a bounded window **before** this turn's message lands — so the window is
the conversation as it stood when the client spoke — and passes it as `ctx.recentThread`.
`threadForParser` serialises assistant turns **from their resolved items**, not their prose:

```
CLIENT: move the post on the 3rd to the 8th
ASSISTANT: move "Linen, one more time" 2026-08-03 → 2026-08-08
```

That is the whole reason it works. The prose fallback for that turn is *"Proposed 1 change for
review."* — a sentence with nothing a reference can grip. The parser prompt's new
**THE CONVERSATION SO FAR** section states the rules, including the one that keeps the thread
from lying: *the thread NEVER overrides the digest — resolve WHICH post from the thread, resolve
where it currently sits from the digest.*

**The fixture** (`thread-context.test.ts`): move 3rd → 8th, then *"move it back"* → the window
reaches the parser carrying both the client's phrasing and the resolved dates, and the
interpretation shows **8th → 3rd**. Plus: the window excludes the in-flight message; the
serialisation prefers items over prose; the window is bounded (12 turns).

---

## COMPOSER

Bottom of the sheet: a mic control, a text field, a send arrow. The 96px button demotes to 48px
beside the field; the waveform strip renders **inline while listening** (the F7b recogniser-event
pulses), and leaves when the capture does — it is for the capture, not decoration.

**Keyboard and voice are one flow.** Spoken chunks land in the same field the keyboard edits, and
the transport is what actually happened: a `heard` ref, not the entry point, so typed words on a
mic-opened sheet still submit as `web`. Enter sends; Shift+Enter is a newline.

The mic entry point starts listening on the gesture's own task (`useLayoutEffect`, unchanged —
WebKit's transient user activation does not survive a later task, and the cold-start permission
prompt depends on it). The typed entry point focuses the composer instead.

**The three-state heading is gone**, and its honesty is not: the microphone's real states
(getting / listening / lost / refused / unsupported) are one status line **beside the control
they describe**, carrying `role="alert"` when something is wrong. Those are facts about the
capture, not about the agent, and they no longer masquerade as the sheet's headline.

---

## FRAMING

The framing copy is the agent's **first turn** in an empty conversation — the sheet opens as a
conversation already in progress, with the agent having spoken first. A nudge question arrives
the same way, as an agent turn, answered through the composer like any other. Empty state = one
agent turn + the composer.

---

## STATUS & FEEDBACK

**One working indicator: the turn's dots.** The separate top thinking line is gone — `ask()`
gains `{ silent }`, which the sheet passes, so `agentFlash` and the Approvals flash never render
a second copy over the thread. Desktop callers omit it and keep their own.

The plan surface's what-changed chip and highlights are unchanged, and remain the post-apply
confirmation **outside** the sheet. Theme-color follows the sheet per F7c — verified live in the
acceptance run: the band leaves the canvas when the sheet opens and returns to it on close.

---

## WHAT-CHANGED VISIBILITY

**a) The recently-changed day dot.** An accent second dot beside the day's marks — same 5px
grammar, a different fact — on days holding posts changed since the **last visit**. Both the week
strip and the month grid carry it. It decays as each day is viewed.

**b) The "What changed" row**, from the month header, listing the recent receipts, tapping
through to the day. Read from the **existing** `plan_activity` ledger
(`plan-changes.ts` → `GET /api/plan/changes`): receipt-worthy actions only (a step tick is
activity, not a change to what the month says), the post joined for its date and its own resolved
title, and a move attributed to its **destination** day — the day that changed most. The words
come from the ledger action (`changeWord`), never from prose. Absent when nothing changed.

### The seen-state, and the bug it produced

`localStorage`, per cycle, not session: a fact about this device's reader that must survive
tab-death. Session scope would re-mark everything after every Safari eviction — crying wolf
daily. A **first visit marks nothing** (there is no "since"), but plants the stamp.

**The defect this session found and fixed** (`de95db1`): read-then-stamp is **not idempotent**,
and React's dev StrictMode runs mount effects twice — the second run read the first run's fresh
stamp and concluded nothing had changed. The marks vanished on exactly the visit they were for.
`readAndStampVisit` now memoises its answer per page load (module state, which dies with the page
— the definition of a visit), so StrictMode, a re-render, or a cycle switched away and back all
get the answer the visit started with.

---

## THE ACCEPTANCE RUN — the Emma loop, through the new sheet

Real app, real routes, real container database, model faked deterministically (the same
hard-gated e2e fake every spec here uses), so nothing is spent and every assertion is about our
machinery. Asserted in `e2e/conversation.spec.ts`; **rendered** by `e2e/transcript.spec.ts`,
which is what produced the thread below — regenerable rather than transcribed:

```
bash scripts/e2e.sh test --project=mobile e2e/transcript.spec.ts
```

### 1 · the sheet opens on the month's own conversation

```
CLIENT ▸ move the sweatshirt post later
```

The seed carries a prior exchange, and it is **there** — loaded from the server, not from memory.
(The empty-state framing turn is pinned in the jsdom suite, where an empty conversation can be
arranged.)

### 2 · her correction, and what we understood

```
CLIENT ▸ move the sweatshirt post later
CLIENT ▸ move the reel 33333333-…-000000000003 later and make it a carousel
SPRIGLY ▸ [open] Here's what I understood
          Move "Sixty seconds on why natural fibres earn th…"  Wed 8 Jul → Fri 24 Jul   ×
          Change "Sixty seconds on why natural fibres earn th…" to a carousel           ×
          [ Discard ]  [ Apply these 2 changes ]
```

One compound sentence, two lines, **both dates resolved on the move** (F3a), each line
individually discardable, and the actions on the turn itself.

### 3 · applied in the thread, confirmed as a turn

```
SPRIGLY ▸ [resolved] Here's what I understood
          Move "Sixty seconds on why natural fibres earn th…"  Wed 8 Jul → Fri 24 Jul
          Change "Sixty seconds on why natural fibres earn th…" to a carousel
SPRIGLY ▸ Done — 2 changes are in.
```

The turn resolves — no second Apply on a receipt — and the confirmation is the next turn. The
sheet is still open; the composer is still there. The ledger agrees: `rescheduled` and
`format_changed`, `origin=agent`, each tied to its proposal id.

### 4 · the conversation continues

```
CLIENT ▸ remember the candle relaunch is coming
SPRIGLY ▸ [open] Saved to your ideas — couldn't place a date.
                 "remember the candle relaunch is coming"
```

### 5 · the plan surface, behind the sheet

```
chip ▸ 1 moved · 1 reformatted
row  ▸ What changed · 2
       · Format changed "Sixty seconds on why natural fibres earn th…"   Fri 24 Jul
       · Moved "Sixty seconds on why natural fibres earn th…"            Fri 24 Jul
```

The moved card carries `data-changed`; the grid's 24 Jul cell carries the accent second dot; the
theme-color band returned to the canvas on close.

### 6 · reopened the next day — the same conversation

```
CLIENT ▸ move the sweatshirt post later
CLIENT ▸ move the reel 33333333-…-000000000003 later and make it a carousel
SPRIGLY ▸ [resolved] Move "Sixty seconds…" Wed 8 Jul → Fri 24 Jul
                     Change "Sixty seconds…" to a carousel
CLIENT ▸ remember the candle relaunch is coming
SPRIGLY ▸ [resolved] Saved to your ideas — couldn't place a date.
```

Persisted, re-rendered from its stored items, and **not actionable** — the proposals are spent,
so there is no Apply to press twice.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` | clean, after every commit |
| unit / interaction (Node 22) | **947 passed**, 14 skipped |
| e2e — mobile | **17 passed** (incl. the acceptance spec and the transcript) |
| e2e — tenant-b | **7 passed** |
| tokens fence | 10 passed |
| terminology fence | 6 passed — the sheet still never says "approve" |
| draft invisibility | 5 passed |
| detector | 0 findings on every changed component |

**Fence proof.** `git diff HEAD~3 -- terminology.fence.test.ts tokens.fence.test.ts
draft-invisibility.test.ts` is **empty**.

### Deliberate test changes, and the argument for each

1. **`interpretation.interaction.test.tsx`** — the component is now a TURN with a lifecycle, so
   the suite tests that: `applying` shows dots and nothing to press; `resolved` offers no second
   Apply but keeps its lines; `discarded` says so; the live region is gated to the newest turn;
   it no longer steals focus (the composer is where the client is standing, and the old
   focus-steal existed because the phase replaced the whole sheet).
2. **`voice-sheet.interaction.test.tsx`** — the mode toggle and the transcript block are gone, so
   the capture assertions re-point at the composer. What they test is unchanged: one capture,
   opens-listening on the mic entry, the transport is what happened, refusals name themselves.
3. **`sheets.interaction.test.tsx`** — Apply no longer closes the sheet, so the F4 test now
   proves the opposite half: the turn shows the dots, the confirmation is a turn, the chip lands
   outside. A second case covers the sheet closed at settle time, where the failure goes to the
   feedback channel.
4. **`narrow.interaction.test.tsx`** / **`draft-surface.interaction.test.tsx`** — assertions that
   named `voice-mode`, `voice-framing` and `voice-transcript` re-point at the thread's turns.

### Pre-existing, and not fixed here

- `src/lib/edit-scope.test.ts` and `src/lib/post-generation.test.ts` fail on a missing
  `DATABASE_URL` — unchanged from the last four sessions, identical on a clean tree.
- **The desktop e2e project has 16 failures on this branch and on `58c44e3`, the commit before
  the agent-fixes session.** I reproduced one (`drag-reschedule … ledgers origin=user`) at that
  commit and it fails identically: the ledger row never arrives. It is not this session's and not
  the last one's; it is worth its own look, because it is 16 tests wide.

---

## Still open

- **The apply confirmation turn is not persisted.** Step 6 above shows the thread without
  *"Done — 2 changes are in."* — the interpretation turn resolves, but the confirmation is
  client-side only. The fact is not lost (the ledger has it, and the What-changed row reads it),
  but the thread's own record of the exchange is one turn short of what the client saw. The fix
  is a write at the point `runApply` settles; it wants a route of its own and did not belong in
  this session's scope.
- **The thread window is 12 turns and the history read is 60.** Both are guesses that have never
  met a long month. When a client has a fifty-turn conversation, the first thing to check is
  whether "move it back" still reaches far enough.
- **Nothing here is verified on hardware.** The composer's inline waveform and the theme-color
  band are asserted in Chromium and in jsdom; the phone is where both actually live.
- **The desktop surface still holds the old Approvals path.** Untouched, correct where it lives,
  and now further from the phone's model than it was. Which one survives is still a decision
  waiting to be taken deliberately.
