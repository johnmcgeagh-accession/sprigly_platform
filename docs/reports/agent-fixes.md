# Agent & surface fixes — pre-conversation-sheet

Branch `dev`. Seven commits, one per fix, none pushed. The conversation-sheet redesign follows
this session; nothing here restyles the sheet's layout — behaviour and bugs only, so the
redesign inherits correct machinery.

| | |
|---|---|
| `3a071a6` | F1 — a future date can no longer be called past |
| `02b6368` | F2 — the time-jump's survivor, and a position that survives it |
| `b58d410` | F3 — "Friday's post" means the next Friday |
| `3b8f1eb` | F4 — Apply goes background |
| `ae939ad` | F5 — an added post gets the full generation |
| `7b837ca` | F6 — the detail sheet's fields are editable by hand |
| `2a50c39` | F7 — four small truths |

---

## F1 — the date inversion

### The evidence

Live, from the phone, on 30 July 2026:

> "The post on the 14th of August is in August 2026, which is in the past (today is 30 July 2026)."

A date a fortnight in the FUTURE, called past, in the same sentence as the correct today.

### The mechanism, established

**The deterministic guards were never backwards.** `isEditableDate` is a lexical `>=` on ISO
strings (`app/src/lib/edit-scope.ts:26`), and the turn calls it the right way round on both ends
of a move (`app/src/lib/agent/turn.ts` — the source guard and the destination guard). Every
write path funnels through the same predicate; none of them can produce that sentence.

**The prompt context could, and did.** Three findings, each with its line:

1. **Digest rows carried no year.** `cycleDigest` printed `fmtDate(p.date)` — `Fri 14 Aug`
   (`app/src/lib/agent/selectors.ts:41`, the old `cycle-state.ts:139`). "Is that past?" was
   then date arithmetic set as homework for a small model, from a line that does not say which
   year it is in. The sentence above is Haiku failing that homework out loud.
2. **The query answerer's plan context contained no today at all.** `bucketCycleState` consumed
   `today` for week-bucketing and threw it away; its `summary` — the ENTIRE plan state
   `answerQuery` sees (`app/src/lib/agent/query.ts:56`) — listed posts with no year and no
   reference day. The one other path that puts free prose in front of a client was reasoning
   about pastness from nothing.
3. **The agent's clock was not the gate's clock.** `runPlanAgentTurn` computed today from
   `new Date()` on the server's local calendar (the old `turn.ts:38`), while every editability
   decision is Europe/London (`edit-scope.ts:17`). On a UTC host between 23:00 and midnight
   London those disagree by a day — invisible in CI, where both clocks agree.

### The fix

The prompt now **states the answer instead of setting the exercise**:

- every digest row carries its full ISO date, and rows before today are marked
  `[past — read-only]`, computed with `isEditableDate` — the write gate's own predicate
  (`cycle-state.ts`, `cycleDigest(posts, today)`);
- the query answerer's plan state opens with `TODAY IS <iso>` and marks past rows the same way
  (`cycle-state.ts`, `bucketCycleState`), and `QUERY_SYSTEM_PROMPT` forbids calling a date past
  unless its row says so — compare the ISO dates, never month names (`query.ts`);
- the task-parser prompt gets the same rule, plus: the parser does not enforce editability —
  a past-dated edit is refused downstream, in words that name the real date (`task-parser.ts`,
  the DATES section);
- the turn's today is `editScopeToday()` — London, e2e-freezable through the same door as
  production (`turn.ts`, `agentToday`).

### The fixture

`app/src/lib/agent/date-inversion.test.ts`, pinned to the day of the screenshot (2026-07-30):
editing/moving **14 Aug is permitted** with no refusal anywhere in the reply; moving **29 Jul is
refused** with the honest copy ("29 July… already passed") and never blames the future date; the
digest marks 29 Jul `[past — read-only]` and does NOT mark 14 Aug; the query plan-state opens on
today and marks the same rows. 6 tests, plus the 17 existing screenshot-case fixtures unchanged.

**Checked everywhere `isEditableDate`-adjacent guards feed agent context:** the turn's move
guards (correct, now on the London clock), the digest, the query summary, the parser prompt —
all above. `proposals.ts`'s apply gate already used `editScopeToday` (correct). The engine's
intake classifier (`packages/engine/src/intake-classify.ts:155`) says "unless the date is
plainly in the past" with a plan month but no today — left alone deliberately: its failure mode
files to the backlog rather than telling a client a date has passed, and its direct-path prompt
is pinned byte-identical by fixtures. Worth a look in its own session.

---

## F2 — the time-jump's survivor

### The audit: every in-page mover of `selectedDay`, named

| site | trigger |
|---|---|
| `WeekStrip` day tap / swipe / arrow keys | gesture |
| `MonthGrid` pick, month-summary | gesture |
| Today button | gesture |
| ‹ › month arrows → `switchCycle` → month change → re-anchor | gesture |
| the re-anchor itself (`CommittedSurface`/`DraftSurface`, `anchoredMonth`) | fires ONLY on a `month` change, and `month` changes only through `switchCycle` |

Refetches never touch it: `refreshPlan`, an applied change, `pollJob` settling — all replace
post arrays and nothing else. Visibility/focus handlers: none exist on the surface (the only
listeners in the tree are a resize handler in the legacy `PlanApp` and the sheet's ghost-click
swallow). The suspects from the brief — re-anchor on refetch, receipt-driven month replacement —
are not reachable in the shipped code.

### The mechanism that survives all of that

**The full reload nobody pressed.** iOS Safari evicts a backgrounded tab and reloads it on
return; pull-to-refresh does the same on purpose. The URL carries no position, so `page.tsx`
re-runs the today-based landing (`resolveLandingCycleId`, `app/src/lib/cycle-nav.ts:56`) and the
surface re-anchors with `defaultDayFor` (`surface/dates.ts:109`) — the operator who was standing
on the 12 July review lands on today, having touched nothing. Intermittent (only when Safari
evicted), forward when the operator was behind today, and invisible to every in-page fix —
which is exactly why it survived the ghost-click patch.

### The fix

**The selection rule, enforced by construction:** `setSelected` now takes a named reason, and
every mutation site is `user:*` or `restore:*` (`CommittedSurface.tsx`, `DraftSurface.tsx`).

- `nav-state.ts` — the position (cycle, day, view) persisted to `sessionStorage` on every
  change; restored on mount. Session-scoped on purpose: it survives reloads OF THIS TAB —
  including eviction-reloads — and dies with the tab, so a fresh magic-link open still lands by
  the server's rule. A stored day is honoured only on its own cycle+month; `?cycle=` (the
  approval redirect) outranks the restore; the restore outranks the landing heuristics, because
  "where they were standing" is not a guess.
- `PlanRoot.tsx` restores the viewed CYCLE on mount (phone surfaces only — the desktop shell
  holds no per-day position).

### The instrument

`?nav=trace` on the plan link arms an on-screen log (`nav-trace.ts`, `NavTracePanel.tsx` — the
`mic=trace` pattern: sessionStorage-armed, ring buffer, copy button, renders nothing unless
armed). It records every selection change **with its mover** and every refetch beside it. The
panel colours the one line that matters: a `select` whose reason is not `user:*` or `restore:*`
renders red — that line, if it ever appears, is the next mechanism, timestamped.

### The tests

`time-jump.interaction.test.tsx` (7): a refetch replacing the post arrays under a live
selection — fresh identities, an extra post, a moved post, an emptied month — never moves it;
a remount restores the day the client was standing on; a stored day from another cycle or month
is ignored; explicit month navigation still re-anchors. Interaction-test setups clear
`sessionStorage` so a persisted position cannot leak between tests.

---

## F3 — resolution rules

**a)** `resolveTargets`'s weekday branch returned every post on every matching weekday — a month
with three posted Fridays made every bare "Friday" a question the calendar already answers. With
`today` (threaded from the turn), it resolves to the earliest on-or-after occurrence that holds
posts; only when THAT day holds several is the reference ambiguous — and the clarify now LISTS
the candidates (`whichOfThese`, turn.ts) for every action, not just moves. Today counts when
today is that weekday. What makes the default safe: the interpretation's move line now shows
BOTH resolved dates (`Sat 8 Aug → Wed 12 Aug`, `Interpretation.tsx`), so a wrong resolution is
visible and discardable before anything applies.

**b)** The parser prompt gains a **day table** — today + 14 days, each with its weekday,
computed not recalled (`dayTable`, `task-parser.ts`, exported pure) — so "tomorrow", "next
week", "the 14th" and "next Friday" are string lookups against today and the viewed month
rather than model arithmetic. The prompt's RELATIVE REFERENCES section states the rules and the
one-Discard cost of a visible wrong guess.

Fixtures (`resolution-rules.test.ts`, pinned mid-month 2026-08-12, Fridays on 7/14/21):
"move Friday's post to Saturday" → one proposal on the 14th, no question, both dates on the
line; two posts on that Friday → asks, listing the two by title and naming the day; ambiguity
on a rewrite lists too; the day table opens on today, marks tomorrow, and crosses the month
boundary with the right weekdays. One deliberate test change: the interpretation test pinned
the destination-only move tail; the source date is the field F3a exists to surface.

---

## F4 — Apply goes background

Tapping Apply used to hold the sheet on "Applying…" while `applyChanges` ran its sequential
chain — and each proposal can poll a generation job for most of a minute.

- **The sheet closes on the tap.** `VoiceSheet.apply()` is fire-and-forget: `onApply(ids)` then
  `onClose()`, immediately. Discard closes the same way.
- **The application runs behind it**, still sequential — the ordering is load-bearing (a hook
  proposal resolves the post its add wrote, `refProposalId`). `applyChanges` is quiet and
  returns `{ applied, failed, changedPostIds }`; `decide()` gains `{ quiet }` (desktop callers
  keep their flashes) and returns what each approval touched — `approveProposal` now reports
  `changedPostIds` through the approve route.
- **The standard what-changed treatment lands when it settles**: a `SummaryChip` in the shell's
  chip slot (`1 moved · 1 added`, `applied-summary.ts`) expanding into the itemised lines, and
  the draft month's changed treatment (solid accent edge, wash, badge) on the touched cards
  (`DayPanel`, `changedIds`). Chip and highlights are separate state with separate lifetimes
  (spec §3); both reset on a month switch. Deletes are deliberately not highlighted — there is
  no card left to mark.
- **Failure goes through the single feedback channel, naming what didn't apply**:
  `Move "…" … still here to try again` — never a bare count.

Tests: Apply closes before the promise resolves and no premature receipt shows; the chip lands
on settle with the card marked; the chip expands and clearing keeps the highlights; a failure
names the line.

---

## F5 — the full generation

**The mechanism, established rather than assumed.** An added REEL was already covered: the
worker enqueues its combined hook+script job the moment the caption lands — for every shape job
on any path (`engine/src/content-cycles/consumer.ts:298` → `script-ready.ts`, commits
`54aeada`/`73bf1f7`), and the fan-out integration tests pin that chain. The genuine hole was
the **carousel's hook**: standalone hook jobs were enqueued only in `phase2.ts`'s fan-out — on
no add path at all, agent or manual.

**The fix.** `enqueueFollowOnGeneration` (`post-generation.ts`): carousel → the standalone hook
job, `autoSelect` (phase2's own reasoning — no human is mid-flow to pick a candidate); reel →
deliberately nothing (enqueuing the combined job before the caption exists would burn its
retries against a row that isn't ready — the worker chain is the mechanism); single → nothing.
Best-effort: a hook is an enhancement, never a reason to fail the add. Called from BOTH the
agent add (`proposals.ts`, `kind:'add'` with instruction) and the manual add sheet
(`POST /api/posts`).

Fixtures: agent-added carousel enqueues its hook alongside the caption; agent-added reel
enqueues NO standalone hook (its pair arrives combined or not at all); the seam tested for all
three formats plus enqueue-failure isolation. "Honestly pend" was already true: the detail
sheet's empty hook/script tabs state why a field is empty and offer the generate action.

---

## F6 — manual editing

A pencil beside Copy on each detail-sheet tab: the field becomes a plain textarea **in place**
(the Shape pattern — same sheet, tabs and action row step aside, no modal-on-modal, one dialog
throughout). Save goes through the **existing** per-field path — `saveCaption`/`saveHook`/
`saveScript` → `PATCH /api/posts/:id` → `patchPost`'s `caption_saved`/`hook_saved`/
`script_saved` ledger rows, actor `client` via the session (`mutations.ts:107`). Cancel
discards; the field is byte-identical. Save is disabled while unchanged; a refused save keeps
the textarea and the words. No pencil on a read-only (past-dated) post.

Tests (`detail-edit.interaction.test.tsx`, 9): each field type through its own save path; saved
words render on reload; cancel byte-identical with nothing called; refusal keeps the words;
read-only hides the pencil.

---

## F7 — small truths

**a) The real format icon.** The day/month CARDS were already honest (`FormatTile(post.format)`);
the offender was the month view's day summary: `rowsFromPosts` never set `format`, so the
format-led row fell through `format ?? 'single'` (`rows.tsx:115`) and drew the image tile for
reels and carousels alike. The row now carries `post.format` — one derivation, the same source
the detail sheet reads.

**b) The waveform.** The one-pipeline fix wired `speaking` to `onspeechstart`/`onspeechend`
alone (`useSpeechInput.ts:127` as it was) — and iOS WebKit doesn't reliably fire either, so on
exactly the platform the activity meter exists for, words arrived through `onresult` while the
bars gated on a flag nothing set. A result IS speech detected, so it now marks `speaking` with
a 2s decay; `onspeechend` still clears immediately where it exists; real silence produces no
results and still flatlines. "Listening…" + moving bars when speech events flow; flatline only
in real silence.

**c) Theme-color follows the sheet.** While any sheet is up, every `theme-color` meta blends
the canvas toward `chrome-deep` at the scrim's own alpha (.34) and restores on the last close
(`theme-color.ts`, wired in `Sheet.tsx`) — counted, because sheets stack. The bottom band needs
no meta: the sheet's own `bg-surface` already runs under the home indicator. Tones are read
from the meta the server wrote and the live CSS token, so an admin theme switch carries through.

**d) Structured answers.** A digest answer went to a text node whole, asterisks and all. It now
renders through the `AgentSays` register as structure (`agent-prose.ts`): markers stripped, one
block per line, day-group headers weighted; one-line replies stay plain prose. Minimal by
design — the full conversational rendering arrives with the redesign.

Tests (`small-truths.interaction.test.tsx`, 10): real format per row; the bars move on speaking
and flatline on silence; the meta dims and restores, including stacked sheets; no asterisk
reaches the screen.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` | clean, after every commit |
| unit / interaction (Node 22) | **917 passed**, 14 skipped |
| tokens fence | 10 passed |
| terminology fence | 6 passed |
| draft invisibility | 5 passed |
| detector | 0 findings on every changed component (`CommittedSurface`, `DraftSurface`, `PlanShell`, `DetailSheet`, `DayPanel`, `VoiceSheet`, `Interpretation`, `Feedback`, `Sheet`, `Waveform`, `rows`, `icons`, the new `nav-*`/`theme-color`/`agent-prose`/`applied-summary` modules) |

**Fence proof.** `git diff HEAD~7 -- terminology.fence.test.ts tokens.fence.test.ts
draft-invisibility.test.ts` is **empty** — no fence was touched, let alone relaxed.

### Pre-existing, and not fixed here

`src/lib/edit-scope.test.ts` and `src/lib/post-generation.test.ts` fail on a missing
`DATABASE_URL` — unchanged from the last three sessions, identical on a clean tree. The 5
unhandled-rejection errors in `voice-sheet.interaction.test.tsx` also reproduce on a clean
tree (a test's `onSubmit` mock returning undefined) — noted, not touched.

### Deliberate test changes, and the argument for each

1. **`screenshot-cases.test.ts`** — the `e2e-fake` mock now exposes `e2eTodayIso` instead of
   `e2eTodayDate`, because the turn reads today through `editScopeToday()` (the write gate's
   clock); the frozen day goes in through the same door production's freeze uses.
2. **`interpretation.interaction.test.tsx`** — the move-line assertion pinned the
   destination-only tail; F3a exists to surface the source date, so it now expects both (a
   no-source case added).
3. **`sheets.interaction.test.tsx`** — the Apply test held the sheet open until `applyChanges`
   resolved and asserted a toast; F4's contract is the opposite, and the test now proves the
   sheet is gone before the promise settles. The fake gains `agentReply` (mirroring what the
   real hook stores before `ask` resolves) and the new `applyChanges` shape.
4. **Interaction test setups** clear `sessionStorage` in `beforeEach` — the nav-state
   persistence is per-tab by design, and a test file is one jsdom "tab" running many renders.
5. **`proposals.test.ts`** — the `post-generation` mock gains `enqueueFollowOnGeneration`
   (mirroring the new import), plus the two F5 fixtures.

---

## Still open

- **Nothing about the microphone or theme-color is verified on hardware.** F7b/F7c are reasoned
  from the code and the platform documentation; `?mic=trace` (now with `rec:result`-driven
  `speechstart` marks visible in the log) and a device pass are the verification.
- **The cross-month move limit** still stands (carried): an in-month move works from any month;
  a move across a month boundary refuses honestly.
- **The desktop Approvals view** remains the second consent path, untouched — `decide()` keeps
  its flashes there. The two flows still express different products; that decision is still
  waiting to be taken deliberately.
- **The engine's intake classifier** resolves "plainly in the past" with no today in its prompt
  (F1's one adjacent guard left alone, for the reasons above).
- **The manual add path's carousel hooks now auto-select** (F5). If the operator would rather
  the manual path leave the hook for the client's own picker, it is one argument at the
  `enqueueFollowOnGeneration` call in `POST /api/posts`.
