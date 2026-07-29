# Mobile plan surface — design spec

**Date:** 2026-07-27, revised 2026-07-29 · branch `dev`
**Revision:** round 6 — the operator's phone check of Session A, folded in. Rounds 1–5 designed
this surface; Session A built its shell and its committed month; round 6 is what a device said
about that. The mockups are unchanged and are now the *older* document where the two disagree —
this file is the contract.
**Design context:** [`PRODUCT.md`](../../PRODUCT.md) · [`DESIGN.md`](../../DESIGN.md) ·
[`round-3-notes.md`](round-3-notes.md)
**Mockups:** [`docs/design/mockups/index.html`](mockups/index.html) — open any file directly, no build step.

---

## 0. What this is

The client plan surface — draft and committed — redesigned mobile-first around an
iOS-native, day-focused pattern. The reference interaction model is the operator-supplied
competitor screenshots (Stanley): a month label, a horizontal week strip with the selected day
as a filled pill, the day's content below, and almost no other chrome.

Four things this redesign removes, and what replaces each:

| Removed | Replaced by |
|---|---|
| The global **“Add to your plan” / “Brief this month”** button | A per-day add slot, on every editable day, under whatever that day already holds |
| The **oversized month header** (`font-serif text-[30px]` + flanking chevrons) | A button-shaped month control that opens the month overview |
| The **draft surface's month pills** and the **`MonthWheelPicker`** | One month overview, reached from that control; ‹ › arrows are the only lateral month mechanism |
| The **week feed and its scroll-spy** | The strip *selects*; the panel below shows one day. See §1.4 — this is a round-2 reversal |

### Round 2 — what the phone review changed

| # | Change | Rationale |
|---|---|---|
| **G1** | UI and body type move to the **native stack** (`-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `system-ui`). Fraunces survives as **two** brand moments: the Sprigly wordmark and the month title | A webfont for UI is the loudest “this is a website” signal there is. See §6 |
| **G2** | Format is an **icon** — video glyph, stacked squares, single square — never a word chip. The word survives as the icon's `title` and its screen-reader label | A 390px card row cannot afford three words to say something a 17px glyph says faster |
| **G3** | The word **“beat” appears nowhere client-facing**. Draft items are **planned posts** | See the terminology table, §7 |
| **G4** | **No client-facing retry or failed state.** A post still being written reads as *on its way* | Retrying is the system's job. This has a hard dependency — §5.5, gap 7 |
| **G5** | The **account chip is removed** | Nothing sits behind it. It returns when there is a settings surface to open |
| **G6** | **Exactly one lateral month mechanism** — the ‹ › arrows — and the month title becomes an unmissable button-shaped control with a chevron | The operator could not find the round-1 affordance, which is a complete answer about the round-1 affordance |
| **P1** | **One day at a time.** The strip selects; the panel shows only the selected day | §1.4 |
| **P2** | The draft **“What we assumed” panel becomes a call-to-action block**, mic-first, with one assumption re-voiced as a nudge | §2 |
| **P5** | The **detail sheet is restructured**: tabs with copy controls, reasoning behind an insights icon, three-icon action row, undo at the top | §4 |
| **P6** | The what-changed panel becomes a **fixed-height summary chip** that expands into a panel | §3 |
| **P7** | Approval becomes a **persistent tick** → a “Ready to go” sheet | §1.3 |

The brand system is **locked and applied, not replaced**. Every colour in the mockups is a token
from `app/tailwind.config.ts`.

**Scope note.** Two things visible in `PlanMobile` today are untouched by this brief and carried
forward as-is: the **Plan / Tasks** segmented control with its checklist view, and the **voice FAB**
and its overlay — though the latter is superseded on the draft surface by the voice sheet (§8).

---

### Round 3 — the critique, and the operator's third review

| # | Change | Rationale |
|---|---|---|
| **R1** | **Colour is theme tokens.** Every value reads a `--t-*` custom property with the name `theme.ts` injects; the mockups demonstrate the active theme, **Teal v1** | §6b. Round 2 hard-coded thirteen coral hexes into a surface whose whole point is that an admin can re-skin it |
| **R2** | ~~**The vivid pass.** accent-600 fills carry **chrome-deep ink**, not white~~ — **superseded by round 5.1**, see §6b | White on accent-600 is 2.61:1 and chrome-deep on it is 5.60:1, which is why round 2 flipped the ink. Round 5.1 instead introduced `accent-650` so filled controls carry white at 3.40:1 |
| **R3** | **No serif anywhere on the client surface.** Fraunces is out entirely | §6. It was never loaded, so round 2's wordmark and month title rendered as Georgia |
| **R4** | ~~A persistent bottom tab bar — Plan \| Tasks — with the FAB floating over it~~ **Superseded by N1 (round 4).** Recorded so the reasoning survives; **do not build this** | §1.2 |
| **R5** | **Week \| Month is a peer switcher**, not an overlay. No ✕, no legend, no month pills | §1.2, §1.5 |
| **R6** | **Plan \| Tasks and Today restored**, matching the live app | §1.2 |
| **R7** | **The mic is the FAB; approval is a labelled “Ready to go” pill** | §1.3. Round 2 put an unlabelled tick on the one action that spends money |
| **R8** | **The draft framing shrinks to one line**; the full copy moves into the voice sheet | §2 |
| **R9** | **Voice is live from day one**, with a live waveform, and typed input uses the same sheet | §8 |
| **R10** | **Action rows are icon-only**; the date picker crosses months; write-again happens in place | §4 |
| **R11** | **Icons v2** — clapperboard, stacked squares, framed image — screenshot-tested at 17px | §6c |

### Round 4 — near-final convergence

| # | Change | Rationale |
|---|---|---|
| **N1** | **A floating bottom nav**: a segmented pill `Day · Month · Tasks` plus a **separate** circular microphone beside it, over a blurred material | §1.2. Supersedes *both* the round-3 tab bar and the header Week\|Month switcher |
| **N2** | The header simplifies to wordmark, `‹ Month Year ›` and Today. The **Ready to go** pill takes the space the switcher vacated | §1.2 |
| **N3** | **Tapping a day in the month grid returns to Day view with that day selected** | §1.5. The grid is a picker as much as an overview |
| **C1** | **White ink requires a ≥700-tier fill; `accent-600` is non-text only** | §6b. Round 3's dark-ink-on-600 passed the gate but read muddy on the device |
| **C2** | The voice waveform is clean accent green **on white** — the dark backing panel is gone | §8 |
| **D1** | Copy leaves the committed card; it lives only in the detail sheet's tabs | §4. It belongs beside the words it copies |
| **DR1** | Draft framing is possessive-month: *“This is your October draft”* | §2 |
| **DR2** | The experiment tooltip element is **removed**; the banner pill carries the whole meaning. **Round 6 completes this** — see §2.1, the canonical definition | §2.1 |
| **V1** | Typed mode is one large field filling the sheet, with a single full-width submit pinned at the foot | §8 |
| **S1** | The action row is three equal-width buttons, icon with the **label below** | §4. This is round 3's recorded reversal, exercised |
| **R1** | The summary chip is **one control** — tap anywhere to toggle, one chevron, no ✕ | §3 |

### Round 5.1 — the operator's carry-ins into the build

Recorded here so the build reads one document. Full reasoning in
[`round-5-1-notes.md`](round-5-1-notes.md); these are the rulings, not the argument.

| # | Ruling | Where it lands |
|---|---|---|
| **X1** | **The shape-mode cancel is a quiet neutral**, not red. The operator reversed the round-5 “kin to Delete” treatment on the critique's finding (V2). `danger` is Delete's monopoly | §4 |
| **X2** | **The wordless arrow primaries stand** (shape submit, typed-mode submit). Recorded against V3 on the iMessage-send precedent — not re-opened | §4, §8 |
| **X3** | **Nothing interactive sits under the 40px floor.** The mockups measured `.readypill` 34px (the *Generate* control — the primary approval action), `.todaybtn` 34px, `.navbtn` 32px, `.bulb` 30px, `.tab` 38px. **The build takes ≥40px**; hit-area expansion is visually inert, so the numbers are not inherited silently | §6, every part |
| **X4** | **Suggestion lists are tappable or they are not chips.** The voice-sheet example prompts and the shape suggestions render as bordered capsules — the universal form of a suggestion chip — and do nothing. Either a tap seeds the field, or they are de-styled to a quiet hint list. **Tappable is the chosen resolution** | §8, Session B |
| **X5** | **The experiment marker has one definition, and it does not yet.** §0 **DR2** says the banner pill carries the whole meaning; §7 says a bare lightbulb with a tap explanation; mockup 02 renders a 30px corner bulb with neither, in the slot where every other card states its time. **Reconcile before building it** — Session B | §7, §2 |
| **X6** | **Silent and speaking must differ beyond the waveform.** Today only the bars and the heading change; the mic itself is identical — Session B | §8 |
| **X7** | **The ≤480px breakpoint is unverified.** Chrome headless clamps its viewport to 500px, so no round exercised it. **The built surface is tested at 375px and 320px** in interaction tests | §9 |

### Round 6 — the operator's phone check of Session A

Session A shipped the shell and the committed month; the operator reviewed it on a device. These
are the resulting rulings, recorded here so the build reads one document. Everything in this table
is **built in Session B**, most of it before the draft surface (they are fixes to a surface that
is already live on uat).

| # | Ruling | Where it lands |
|---|---|---|
| **P1** | **The add slot no longer creates an empty draft.** It opens a shaping sheet — format choice + a shape prompt — and the post is created *shaped*. Draft months: `addBeat` + an optional subject. Committed months: the add, then the instructed-shape path | §4.2 |
| **P2** | **The format control is reinstated in the detail sheet.** A compact segmented image / carousel / reel control, wired to the existing format mutation. **This reverses round 4's removal and supersedes the round-6 ruling that `swapFormat` should have no surface** — see §4.1 | §4.1 |
| **P3** | **Hook and script can be generated on demand.** A carousel with no hook, or a reel with no hook or script, offers a Generate action on the relevant tab. Absent ≠ broken | §4.3 |
| **P4** | **Day-view header tightened** — the top whitespace was distorting the first thing on the screen | §1.2 |
| **P5** | **The week strip pages between the month's weeks** — swipe plus edge chevrons. It was reachable only through a detour via Month view | §1.4 |
| **P6** | **Tapping a day in the month grid STAYS on the calendar** and shows a brief summary beneath the grid: one compact row per post, icon + title; tapping a row opens its detail sheet. **Supersedes N3.** The grid is the view; Day view is reached through the nav pill only | §1.5 |
| **P7** | **Sheets dismiss from the grabber** — drag down, or plain tap. Scrim-tap keeps working | §4 |
| **P8** | **A completed task ticks and moves to a Completed section** (collapsible, below). Never a silent disappearance | §1.6 |
| **P9** | **A post's tasks render in its detail sheet** — a Tasks section with the same tick interaction. They were invisible on the new surface | §4 |
| **P10** | **One feedback channel, at the top.** Undo, saves and confirmations all render in the top slot; the bottom toast is removed | §4 |
| **P11** | **A shape in flight shows a working state** over the text it is rewriting — a shimmer, cleared when the new words land | §4 |
| **P12** | **The detail-sheet action buttons are smaller.** Same three actions, same labels; the row read large and clunky at 68px | §4 |
| **P13** | **The mic's inert popover is confirmed as such** and is built properly in Session B as the voice sheet | §8 |

Three further rulings arrived with the same review, on questions earlier rounds left open:

| # | Ruling |
|---|---|
| **P14** | **The experiment marker has one definition** — §2.1. X5 is closed |
| **P15** | ~~`swapFormat` has no surface, permanently~~ — **superseded by P2 in the same review.** Recorded, not silently dropped: see §4.1 |
| **P16** | **The axe colour-contrast ignore is scoped to the recorded deviation's own controls**, never blanket — the eight selectors DESIGN.md names, and nothing else |

## 1. The state machine

### 1.1 The surface decision — unchanged

Which surface a client lands on is already one pure, server-side derivation
(`app/src/lib/surface-state.ts`), and neither round touches it:

```
resolveSurfaceKind({hasSession, committedPostCount, draftBeatCount, planRedesign})
  → 'gated' | 'draft' | 'committed-redesign' | 'committed-legacy'
```

The rule that file states — *new states join the union, they do not become new forks in the
page* — holds here. This redesign **adds no member to `SurfaceKind`**.

### 1.2 The states inside a surface

Round 4 settles the navigation. The header carries **where you are**; the floating bottom nav
carries **what you can do**.

```
  ┌──────────────────────────────────────────────┐
  │  Sprigly                                     │  wordmark, LEFT
  │                                              │
  │  ‹  October 2026  ›          [ Ready to go ] │  title row + approval (draft only)
  │                                        Today │
  │  M   T   W   T   F   S   S                   │  week strip   ── OR ──
  │ 28  29  30  (1)  2   3   4                   │  the month grid
  │ ──────────────────────────────────────────── │
  │                                              │
  │  Thursday 1 October          2 posts         │  the selected day, ALONE
  │  ┌────────────────────────────────────────┐  │
  │  │ ▣  Home & Space                  6:00  │  │
  │  └────────────────────────────────────────┘  │
  │                                              │
  │   ╭──────────────────────────╮      ╭────╮   │
  │   │  Day  ·  Month  ·  Tasks │      │ 🎤 │   │  floating nav + separate mic
  │   ╰──────────────────────────╯      ╰────╯   │
  └──────────────────────────────────────────────┘
```

```
   SURFACE = draft | committed        (server decides — §1.1)
      │
      ├── VIEW = day | month | tasks     ← the floating nav pill
      │      │
      │      └── selectedDay             (day view)
      │
      └── OVERLAY ∈ { none, detail, move, shape, voice, approve }
```

Four rules the round-4 shell adds:

1. **The nav is always there, and it floats.** A pill and a circle over a blurred material, clear
   of the content rather than welded to the bottom edge. It closes the viewport — most of what
   separates an app from a page that ran out of content — without claiming a fixed 56px band.
   Sheets slide **over** it.
2. **One place to change view, one place to talk.** Round 3 had a Week|Month switcher in the header
   *and* a Plan|Tasks bar at the bottom: two navigation systems for one small surface. The pill
   absorbs both, so `Day`, `Month` and `Tasks` are siblings — which is what they always were.
3. **Month is a peer, not a modal.** No ✕, no dismiss; you leave it the way you entered it.
4. **The microphone is a separate control, and it is never inert.** It is the microphone on
   **both** month states — the gesture is always *talk to your plan* — but the two mics do
   different things, and the surface has to say which:

   | Month state | What the mic does | Path |
   |---|---|---|
   | **Draft** (pre-cutoff) | **Reshapes the month directly.** One sentence adds, moves or replaces planned posts, and returns a receipt | `POST /api/plan/draft/apply` |
   | **Committed** (post-cutoff) | **Raises proposals the client then approves.** The agent applies nothing itself | `POST /api/plan/agent` → `runPlanAgentTurn` |

   Same icon, same gesture, different consequence. The committed sheet must not imply the month
   changed when what actually happened is that a proposal is waiting — the existing agent surface
   already has the approve/apply queue for this, and the mic feeds it.

   **Copy is not the FAB.** The critique proposed *copy the next caption* for the committed FAB, on
   the grounds that copying happens ten times a month and approval once. The observation is right
   and the placement is not: copying is a **per-post** action and belongs on the post, which is
   where the copy control now sits (mockup 1). The FAB carries the one action that is about the
   **month**.

   **On a read-only month the FAB is absent, not disabled.** `data.ask` is gated on `readOnly`, so a
   client browsing a cycle that is not their session's home cycle has no agent to talk to; offering
   a mic that refuses is worse than offering none.

Transient state alongside, none of it navigational:

| State | Lifetime | Already exists |
|---|---|---|
| `receipt` — the summary chip and its panel | until dismissed, or replaced by the next application; persisted receipts reload | yes (`DraftReceipt`, `loadReceipts`) |
| `changedIds` — the “New” marks | in memory, gone on reload — deliberate. **Round 2: independent of the chip** | yes |
| `undo` — one slot, not a stack. **Round 2: renders at the top** | until the next mutation | yes |
| the CTA block's assumption nudge | until answered or the month is reloaded | display-only today; §5.5 gap 5 |

### 1.3 Where every existing surface state lands

**Draft surface** (`DraftPlan` → `DraftPlanView`, today one standalone vertical list of every beat
in the month):

| Today | Lands in |
|---|---|
| Header: “Draft / Not sent yet” + “We’ve drafted *month* for *client*” | A `Draft` badge and one line — *“This is your draft October”* — at the top of the panel. The rest of the framing moved into the voice sheet (§2) |
| `draft-month-nav` month pills | **Retired** → the ‹ › arrows |
| “What we assumed” section (display only) | **The CTA block** — one assumption, re-voiced as a nudge (§2) |
| “Anything we should know?” textarea + “Tell Sprigly” | The CTA block's mic (primary) and typed fallback |
| Receipt panel — single receipt | The fixed-height summary chip (§3) |
| Receipt panel — rollup mode (`receipt.items`) | The panel the chip expands into. **Same component, same keying** |
| “Add to this month” rescue tap | Unchanged, on the panel's idea lines |
| Per-beat inline `<input type=date>`, `<select>` format, Remove | The detail sheet and the move sheet. **Format loses its control entirely** — see §4.1 |
| `+ Add something` (collapsed, bottom of list) | The per-day add slot, pre-filled with that day's date |
| Two-step approval section | The **labelled “Ready to go” pill** in the header region → the consequence sheet |
| Undo toast (fixed, bottom) | **Top of the screen** (§4) |
| Past-cutoff read-only (`editable: false`) | Unchanged: every control disappears, the month stays fully readable |

**Committed surface** (`PlanRoot` → `PlanMobile`):

| Today | Lands in |
|---|---|
| Week strip + `prev-week` / `next-week` steppers | Strip kept and restyled. **The steppers go** — the strip becomes horizontally swipeable, and the month grid covers longer jumps |
| Day sections + scroll-spy (`data-day`, `updateActiveDay`, `scrollToDay`, `spyLock`) | **Removed.** §1.4 |
| `add-on-day` dashed button | The add slot — now the only add affordance |
| `brief-month-btn` (“Add to your plan” / “Brief this month”) | **Removed.** Briefing is the CTA block; adding is the per-day slot |
| Month label + `prev-month` / `next-month` + `MonthWheelPicker` | The month control → month overview. The wheel picker is retired |
| `today-btn` | The month overview (today is ringed in the grid) + the week strip's today ring |
| `SwipeCard` swipe → Move | Kept |
| `CardMenu` (⋯ → Edit / Move / Delete) | **Removed** — all three lead to the detail sheet, which the card tap already opens |
| Editor sheet (`PostEditor`, 85%) | The committed variant of the detail sheet, restructured (§4) |
| Move sheet (`CalendarPicker`) | Kept, extended with posting time (§5.5 gap 1) |
| `BeatMarker` rows (`structured_brief` beats) | Kept, read-only, under the day's posts |
| “Outside this month” strip | Kept, at the end of the panel |
| Account avatar chip | **Removed** (G5) |
| Plan / Tasks segmented control | **The floating nav pill** — `Day · Month · Tasks` (N1). Round 3 restored it as a bottom tab bar; round 4 replaced that with the pill |
| `voice-fab` and its “arrives later” overlay | **Replaced** by the mic FAB and the voice sheet (§8) |

**One structural consequence, unchanged from round 1 and now larger.** `PlanRoot` returns
`DraftPlan` *before* the desktop/mobile fork is reached, so the draft surface has no responsive
shell at all today. Round 2 makes draft and committed share more, not less — the same month
control, the same strip, the same day panel, the same detail sheet — so reconciling those two
shells remains the single largest piece of work this design implies.

### 1.4 The reversal: no week feed

Round 1 kept `PlanMobile`'s week feed and scroll-spy, on the argument that it already *was* the
day-focused pattern. The phone review disagreed, and the review is right: a feed that scrolls
through seven days is a list view with a strip on top, and the strip's selection state is then
fighting the scroll position for authority — which is exactly what `spyLock`, the 140ms and 700ms
timers, and the StrictMode mount guard in `PlanMobile` exist to referee.

Round 2: **the strip selects, the panel renders the selected day, and nothing else.** Stated
plainly because it deletes working code — `updateActiveDay`, `onFeedScroll`, `scrollToDay`,
`spyLock`, `rafTick` and the `anchoredCycle` mount guard all become unnecessary. That is a
simplification, not a loss; but it is a decision, and it reverses one recorded eight days ago.

The cost: moving between weeks needs a gesture. The strip is a CSS grid today, not a scroller, so
horizontal swipe is genuinely new UI (no API). The month overview covers any jump longer than a
week.

---

### 1.5 Month view: the grid stays the view

**Round 6 (P6) supersedes N3.** Tapping a day in the month grid used to flip to Day view and carry
the date with it. On the device that read as the calendar throwing you out: a client scanning the
month to see *where things are* lost the month the moment they touched it, and getting back cost
a second tap on a nav control they had not been thinking about.

**So the grid stays.** A tap selects the day, and a **brief summary appears beneath the grid** —
one compact row per post, format icon + title, in the day's own order. Tapping a row opens that
post's detail sheet. Day view is reached through the nav pill, and only through it.

Concretely: `selectedDay` is set from the tapped cell, `view` does **not** change, and the summary
region renders `postsOn(selectedDay)`. Nothing is fetched — the month's posts are already loaded
for the grid that was just drawn. The selection is shared with Day view, so switching to Day
afterwards lands on the day you were reading, which is the useful half of N3 kept without its cost.

Today, on the month view, selects today's date in place rather than leaving the grid.

---

### 1.6 The Tasks view: a completed task goes somewhere (round 6, P8)

The scope note holds — the checklist is carried forward, not redesigned. Round 6 adds one
behaviour to it.

Ticking a task removed it from the list. `groupTasks` filters `done`, so the row simply stopped
existing, which on a phone is indistinguishable from a bug — and it takes with it the one thing a
checklist is for, which is the sight of what you have already done.

**A tick now moves the row to a Completed section**: collapsed by default, below the outstanding
work, carrying its own count. The tick fills and the label strikes through, so the row's new state
is legible in the moment before it moves, and a completed task can be un-ticked from there.
Nothing about `planTasks` or the late rule changes — the Completed list is the same steps,
filtered the other way.

---

## 2. The draft framing

Round 2 replaced the “What we assumed” panel with a call-to-action card. Round 3 shrinks that card
to **one line**, because a 200px block asking the client to say something sat above the fold,
before the month they came to read — which inverts the product's own first principle.

What is left at the top of the panel:

```
  [Draft]  This is your draft October
```

The badge carries *provisional*; the line carries *which month*. “Not sent yet” is gone from here
as redundant with the badge. Everything else — the framing sentence, the invitation, the example
prompts — moved into the **voice sheet** (§8), which is where the client is already being asked to
speak.

**The one assumption worth surfacing goes with it.** The assembler attaches the same list to every
planned post; the surface shows the one a client can *act on* and drops the rest. For Earl of East
that means keeping “nothing's launching this month” and dropping “no pillar weights are on
record” — the second is true, but it is a fact about our data, not a question for them.

**Built, with one correction the uat walkthrough forced.** Earl of East's live October carries
exactly those two, and *both* pass an act-on-it test: `assumptionPrompt` turns the pillar one into
“We've split the month evenly across your pillars — want to weight it differently?”, which is a
real question with a real transform behind it. So the ruling above is about **priority**, not
eligibility, and `firstAnswerable` ranks rather than filtering: a launch is a fact only the client
has and it reshapes the month; a weighting is a preference they may not have considered, and
asking it first spends the one slot on the smaller question. The only assumption that is genuinely
*not* answerable is the format-mix one — that one asks them to fix our bookkeeping.

**Never a caveat.** Round 1 headed this an amber “What we assumed” warning box. The same
information phrased as an invitation reads as confidence; phrased as a warning it reads as an
excuse.

On a thin month the same one-liner carries the acknowledgement (§9.2).

### 2.1 The experiment marker — one definition (round 6, P14)

X5 recorded that this marker was described three different ways: §0 **DR2** said the banner pill
carried the whole meaning, §7 said a bare lightbulb with a tap explanation, and mockup 02 frame C
rendered a 30px corner bulb with neither — in the slot where every other card states its time.
Session A could not start it without a ruling. **This is the ruling, and it is the round-5 one:**

> **A banner-style pill on the card: a lightbulb glyph and the words “Something new”.** No tooltip
> element, no tap target of its own, nothing to explain it in place. **The full reason lives behind
> the detail sheet's insights icon**, exactly where every other post's reasoning lives.

Three consequences, all of them the point:

- **It is a banner, not a corner bulb.** It sits inline with the card's meta row, so it does not
  occupy the time slot — round 5.1's finding that the experiment post was the only card in the set
  stating no time is fixed by the shape, not by moving the time.
- **It is not interactive.** X4's rule holds in both directions: a thing that looks tappable must
  be tappable, and a thing that isn't must not look it. The pill is a `<span>` with no border
  capsule of the suggestion-chip kind, and the card around it is the tap target it always was.
- **“A new idea we're trying this month” survives as the sheet's sentence**, not as a tooltip.
  `slotLabel()` already returns `'Something new'` for `slotType: 'experiment'`; the pill renders
  that, and the sheet's insights panel carries the sentence.

## 3. The what-changed summary chip

A fixed 48px bar between the month row and the week strip:

```
┌──────────────────────────────────────────────┐
│  3 added · 3 replaced            [ ⌃ ]  [ ✕ ] │
└──────────────────────────────────────────────┘
```

- **It never grows.** A one-line change and a fourteen-item brief cost the same vertical space.
  Round 1's panel put the whole diff above the day, which on a paste like Sally's pushed the day
  off screen entirely.
- **Expand slides up a panel** carrying the itemised rollup — one line per segment, applied lines
  expandable to their diff, idea lines carrying the rescue tap.
- **It is one control.** Round 3 put an expand button and a ✕ on a 48px bar; round 4 makes the
  whole chip the button. Tap anywhere to toggle, and the chevron is a **state indicator** — `›`
  collapsed, `⌄` expanded — not a second target. The ✕ was the one a client would hit by accident.
- **Clearing lives in two places, neither of them a ✕.** A quiet *“Clear this summary”* text
  action at the foot of the expanded panel, and **the chip clears itself on the next visit** —
  driven by the same in-memory seen-state boolean that already retires the “New” marks, so no new
  persistence is needed.
- **The highlights are independent.** Clearing the chip never un-marks what changed; “New” is
  driven by `changedIds`.
- **The verbs are the receipt's verbs: added, moved, replaced.** The round-2 brief suggested
  “changed” for the third. *Replaced* is kept deliberately: the difference between “this post was
  edited” and “this post was removed and another took its slot” is the thing a client most needs
  to see, and it is exactly what went wrong in ivy-t's rehearsal — a launch arc that consumed
  three pillar posts to place three of its own.

---

## 4. The detail sheet

```
┌─ grabber ────────────────────────────────────┐
│ [fmt]  Wilderness candle relaunch — Launch  ⓘ│   header: title, date, format ICON,
│        Thursday 1 October · 6:00 · Home…     │   insights toggle
├──────────────────────────────────────────────┤
│  [ Caption ]  [ Hook ]  [ Script ]           │   tabs — caption first, default
├──────────────────────────────────────────────┤
│  CAPTION                            [⧉ Copy] │   per-tab copy
│  Wilderness is back. …                       │
├──────────────────────────────────────────────┤
│  ┌ 1 OCT ┐   ┌───────┐   ┌────────┐          │   three equal buttons
│  │  📅   │   │   ✦   │   │   🗑   │          │   icon, label BELOW
│  │  Move │   │ Shape │   │ Delete │          │   date ABOVE on Move
│   1 OCT · 6:00                               │
└──────────────────────────────────────────────┘
```

- **Copy is a first-class control, per tab, and it lives *only* here.** Round 3 also put a copy
  button on the committed card; round 4 takes it back off. Copy belongs beside the words it copies,
  on the tab that names the field — a card is a thing you read, not a thing you operate.
- **The reasoning lives behind the insights icon.** One tap reveals it above the tabs, with its
  sample sizes. It is not in the way of the words the client came for, and it is one tap from
  every post rather than a paragraph on every card.
- **Per-post assumptions are gone.** Assumptions are a property of the month; they belong in the
  CTA block, once, not repeated on ten sheets.
- **“Shape” opens a prompt field, never a blind regenerate.** Renamed from “write again” in round
  4: the endpoint has always been `POST /api/plan/shape` and has always required an `instruction`,
  so the client-facing word now matches what happens. See §5.4.
- **The action row is three equal-width buttons filling the row**: icon with the **label below**,
  and a real pressed state so they read as buttons. This is round 3's icon-only row reversed —
  round 3 recorded labels as *“the designated cheap reversal”* and named the trigger; round 4
  pulled it forward rather than waiting for the demo, and it cost what it was predicted to cost.
- **Round 5 takes the date off the Move button.** The sheet header states it one line above, so
  the button was saying it twice.
- **Delete is a solid `danger` fill with a white icon and label** (5.94:1). A destructive action
  should not have to be inferred from the colour of its text.
- **Shape mode replaces the footer wholesale** — a primary submit filling most of the row, and a
  **quiet neutral cancel** beside it: the word *Cancel*, on `surface` with a hairline, in `muted`.
  The row is *replaced*, not relabelled: a button must never change meaning mid-flow, which is what
  round 4's “Cancel” sitting in the Shape slot did.
  **Round 5.1 (operator, carry-in R4a): the cancel is NOT red.** Rounds 4 and 5 made it a small
  `danger` button “kin to Delete”, and the critique's finding is right — one screen earlier a red
  button of the same family *destroys the post*. A cancel is the opposite of a delete: it is the
  safe way out. **`danger` is Delete's monopoly on this surface.** The wordless full-width arrow
  primaries (this submit, and the typed-mode submit in the voice sheet) **stand** — the iMessage
  send precedent, recorded rather than re-argued.
- **“Move” opens a picker over the full month grid**, with free month navigation, editing date
  *and* time. Round 4 clipped that grid to roughly half a month, which made a picker look like a
  fragment.
- **Undo renders at the top of the screen.** In round 1 it was bottom-anchored, which put it
  directly over the action row it was undoing.
- **The planned-post variant has no tabs** — there is nothing written yet, so
  the sheet says so rather than showing three empty tabs.
- **The grabber is a control** (round 6, P7). Drag it down to dismiss, or simply tap it. The scrim
  keeps working. Every sheet in the set gets this from one shared chrome component, so a sheet
  cannot ship without it.
- **A post's tasks render in the sheet** (round 6, P9) — a Tasks section under the words, with the
  same tick as the Tasks view. They exist on the post and were invisible everywhere except a view
  that groups them by due date across the whole month.
- **The action row is smaller** (round 6, P12). The three buttons keep their structure, their
  labels and Delete's `danger` fill; the row drops from 68px to 56px with a 19px glyph, which is
  iOS weight rather than the slab the phone showed.
- **A shape in flight shows its work** (round 6, P11). While `shapingIds` holds this post, the
  text it is rewriting carries an animated skeleton in place of the words, cleared when the new
  ones land. `prefers-reduced-motion` holds it static rather than pulsing.
- **Feedback has one home, and it is the top** (round 6, P10). Undo, confirmations and saves all
  render in the shell's top slot. The bottom toast — a second, competing channel that landed over
  the nav pill — is removed from this surface entirely.

### 4.1a Where the format control lives — RULED (round 7, P17)

**Third placement, and this one is the ruling.** Round 2 removed it; round 6 put it back under
the sheet header; the Session B phone check moved it **inside Shape mode**, beside the prompt
field.

**The rationale, recorded so this stops moving.** A format change is a **shaping decision with
consequences**: it can strand a hook and a script (§4.1), and it changes what the checklist is
for. Sitting always-visible under the header it read as a *display toggle* — three segments, one
tap, on a sheet a client had opened to read their caption. Inside Shape it is in the deliberate
flow: the client is already there saying what they want different, and the consequence note has
room to be read before anything is sent.

**What it costs, stated rather than discovered later.** Shape is offered only where there are
words to rewrite, so a post with no caption yet has no format control. In practice that is the
window between adding a post and its caption landing — minutes — and the format was chosen in the
add sheet moments earlier. The cases that stay uncovered are a post whose generation failed
permanently, and a pre-approval slot on a committed month. **If that turns out to bite, the fix
is to offer Shape on an empty field as "write it" rather than to move this control a fourth
time.**

**The draft sheet keeps its always-visible control**, and that is not an exception to the ruling
but a consequence of it. The ruling's own reason is *consequences*, and a draft beat has none —
§4.1's table says so: there is no caption, hook or script to strand. A draft beat also has no
Shape mode at all (nothing is written yet), so following the letter here would delete the only
way to change a planned post's format.

### 4.1 Format has a control again — RESOLVED (round 6, P2)

Round 2 removed the format control from the sheet, which left **`swapFormat` with no surface**: a
shipped, tested Build B mutation (`POST /api/plan/draft {op:'format'}`, vocab-checked against
reel / carousel / single) that no screen would call. Rounds 2–5 flagged the consequence and ranked
three options without choosing one.

**The operator's phone check of Session A chose, and chose the opposite of the removal: the format
control is reinstated.** A compact segmented `Single post / Carousel / Reel` control in the
detail sheet's header region, wired to the mutation that already exists — `data.changeFormat` on a
committed post, `{op:'format'}` on a draft beat.

**A conflicting ruling arrived in the same review and is superseded, not dropped.** One line of
the phone-check notes said `swapFormat` should have no surface *by design, permanently*, and that
format changes should happen by telling the agent or by drop-and-re-add. That is recorded as
**P15** and is **overridden by P2**, which is the more specific instruction (it names the control,
its shape and its wiring) and which reads explicitly as a reversal of the round-4 removal. The
build follows P2. If P15 was the intent, this is the one paragraph to reverse.

**The consequence is stated honestly rather than prevented.** A format change can invalidate a
hook or a script — a reel's script does not describe a single image. What the shipped machinery
does today, and therefore what the copy says:

| Surface | What a format change does to hook / script |
|---|---|
| **Committed post** (`PATCH /api/posts/:id {format}`) | **Nothing is cleared.** The hook and script rows stay exactly as they were, so a reel-turned-single keeps a script that no longer applies. The sheet says so, and the tab offers to write it again (§4.3) |
| **Draft beat** (`{op:'format'}`) | Nothing to invalidate — a draft beat has no caption, hook or script. Approval generates against whatever format the beat holds at that moment |

The checklist is the one thing that *does* follow the format: `regenerateChecklist` replaces a
post's steps with its new format's template, and the sheet offers it as part of the same change
rather than doing it silently.

### 4.2 The add slot opens a shaping sheet (round 6, P1)

The per-day add slot used to create an empty post and leave the client looking at it. On the phone
that reads as a bug: you tapped *Plan a post for this day* and got a blank card called “Untitled”.

**It now opens a sheet before anything is written.** Two fields, both of them decisions the client
already has in mind when they tap:

1. **Format** — the same segmented control as §4.1, with the terminology table's own words.
2. **What is it?** — one line, free text. Optional, and labelled as optional.

Submit creates the post *shaped*:

| Surface | What submit does |
|---|---|
| **Draft month** | `{op:'add', date, format, pillar}` — then, when a subject was given, that subject is stored as the beat's title so the card is not called after its pillar |
| **Committed month** | `POST /api/posts {date, cycleId}` for the slot, then the instructed-generation path (`startPostGeneration`) with the subject as the instruction. The post occupies its slot immediately and reads **On its way** while the caption is written |

With no subject the committed path creates the slot and writes nothing — which is the old
behaviour, now reached deliberately rather than by default.

### 4.3 Hook and script on demand (round 6, P3)

A carousel with no hook, or a reel with no hook or script, is not broken — it is a post that took
the classic path, or whose generation failed, or whose format changed after generation. The tab
for a missing field currently disables itself, which says *nothing here* and stops.

**An empty tab explains and offers the action.** One sentence naming why the field can be empty,
and a **Write the hook** / **Write the script** button on the existing per-post generation path
(`POST /api/plan/hooks`, `POST /api/plan/script` — `data.generateHooks`, `data.generateScript`).
Hooks return three candidates to choose from, which is what that endpoint already does; a script
is written straight onto the post.

The action is absent where the endpoint would refuse: hooks are reels and carousels only, and a
script needs a hook and a caption first. An offer that 422s is worse than no offer.

---

## 5. Wiring — every interaction to an API

“Exists” means the endpoint and its behaviour ship today. Nothing here is a proposed endpoint
unless the Exists column says **no**.

### 5.1 Navigation

| Interaction | Wiring | Exists |
|---|---|---|
| Tap a day in the week strip | local `selectedDay` — **round 2: no scroll-to-day, the panel re-renders** | yes |
| Swipe the week strip | local. New gesture; the strip is a grid today | UI only |
| Nav pill `Day \| Month \| Tasks` | local view state, no request. Tasks renders the existing checklist (`planTasks`, `PostStepView`) | yes (new UI, no API) |
| Tapping a day in the month grid | sets `selectedDay` and renders the summary beneath the grid. **The view does not change** (round 6, P6). **No fetch** — the month's posts are already loaded for the grid just drawn | yes |
| Tapping a row in that summary | opens the detail sheet for that post | yes |
| The **Ready to go** pill | local; opens the approval sheet. Right-aligned on the title row, rendered only when the surface is `draft` and `editable` | yes |
| Insights segment | — | **no** — the insight layer does not exist. The pill is laid out to take a fourth |
| ‹ › arrows (either view) | `data.switchCycle(cycleId)` over the sorted cycle list → `GET /api/plan?cycleId=` ; on a draft answer, `GET /api/plan/draft?cycleId=` for planned posts + pillars + editable + receipts | yes |
| Dot density for the **viewed** month | already-loaded `calendarPosts` / `draft.beats` | yes |
| Dot density for a **non-viewed** month | — | **no** (gap 3) |
| “Draft” dot on the month control | — | **no** (gap 2) |
| Today | `data.todayCycleId` + the landing rule; today ringed in the strip and grid | yes |

### 5.2 Draft month — structural edits (Build B)

All via `POST /api/plan/draft`, which re-derives `clientId` from the session, re-checks the
`status='draft'` and pre-cutoff guards **in the write itself**, and returns the authoritative
list. Nothing in this route can write `status` — approval is a separate door.

| Interaction | Body | Exists |
|---|---|---|
| Move (date) | `{op:'move', postId, date}` | yes |
| Move (time) | — | **no** (gap 1) |
| Swap format | `{op:'format', postId, format}` | yes — **and round 6 gives it back its control** (§4.1) |
| Delete a planned post | `{op:'drop', postId}` → returns `dropped` (the whole row) | yes |
| Undo a deletion | `{op:'restore', beat}` — verbatim, not a husk | yes |
| Reorder within a day | `{op:'reorder', date, postIds}` | yes — implemented, still unused by any surface |
| Per-day add slot | `{op:'add', date, format, pillar}` — pillar checked against the client's configured vocabulary; the slot hides when `pillars` is empty | yes |
| Read-only past cutoff | `editable` from `GET /api/plan/draft` (`cycleIsPreCutoff`) | yes |

Refusals map to distinct statuses the surface must distinguish: `not_found` 404, `not_a_draft` 409,
`cutoff_passed` 409, `read_only_date` 422, `invalid_format` 422, `invalid_pillar` 422.

### 5.3 Draft month — reshape, receipts and approval

| Interaction | Wiring | Exists |
|---|---|---|
| Voice sheet → spoken input | `useSpeechInput.ts` (Web Speech, browser-side) → `POST /api/plan/draft/apply {op:'text', text}` | **yes, both halves** — §8 |
| Voice sheet → typed input | the same route, same payload. One sheet, two modes | yes |
| The waveform | Web Audio `AnalyserNode` + `getByteFrequencyData` on the mic stream | no API; new UI |
| Typed input (CTA block or voice sheet) | the same call | yes |
| Marking input as voice-sourced | — | **no** (gap 8) |
| Answering the CTA block's assumption nudge | the same call; the answer is ordinary text | yes |
| Paste a brief | the same call. `isDocumentShaped` routes it to the decomposer automatically — 2+ line breaks, 240+ chars, or 4+ date signals | yes |
| Summary chip counts | derived from the returned `DraftApplication` — `lines[]` classified by verb | yes |
| Expanded panel | the same record with `items: BriefItem[]` and `segmentCount` | yes |
| “New” marks | `changedIds`, in memory | yes |
| Receipts surviving a reload | `GET /api/plan/draft/apply` → `{receipts}`, also folded into the draft surface context. Capped at `MAX_RECEIPTS` (10) | yes |
| “Add to this month” on an idea line | `POST /api/plan/draft/apply {op:'add_to_month', planInputId, date}` | yes — **but** it returns a single receipt that replaces the panel (gap 6b) |
| “Ready to go” pill → sheet | local | yes |
| Sheet counts (10 / 3 / 1) | **derived client-side from the planned posts already in memory** (`draft.beats`, loaded by `GET /api/plan/draft` before the sheet can open). No pre-approval summary endpoint is needed, and adding one would create a second source for a number the client is already holding | yes |
| Generate it | `POST /api/plan/draft/approve` — no body, no options, no partial approval → `{approved, captionsQueued, hooksQueued, failed}` | yes |
| Double-approve | rejected (`already_approved` 409), not a quiet no-op — approval spends money | yes |
| Post-approval landing | navigate to `/?cycle=<cycleId>` — explicit intent outranks the date heuristic | yes |

### 5.4 Committed month

| Interaction | Wiring | Exists |
|---|---|---|
| Open the detail sheet | already-loaded `PlanPost` (`caption`, `hook`, `script`, `scriptLengthSeconds`, `status`, `steps`) | yes |
| Caption / Hook / Script tabs | the same object; a tab with no content is disabled | yes |
| Copy | `navigator.clipboard.writeText` — no API, which is the point | yes |
| Move (date), same month | `PATCH /api/posts/:id {date}` (`data.reschedule`), gated by `isEditableDate` | yes |
| Move (date), **across months** | the same call — the route gates on date, not on month, and a post carries its own `cycleId` | yes, **with consequences** — see below |
| Move (time) | — | **no** (gap 1, widened this round to read *and* write) |
| Edit the caption | `PATCH /api/posts/:id {caption}` + autosave | yes |
| Delete | `DELETE /api/posts/:id` (soft) | yes |
| Per-day add slot | `POST /api/posts {date, cycleId}` — refuses past dates (`canAddPost`) | yes |
| **“Shape” (guided rewrite)** | **`POST /api/plan/shape {targetPostId, instruction}` — confirmed.** `app/src/app/api/plan/shape/route.ts` 400s without an `instruction`, gates on the post's date via `gatePostEdit`, resolves the post's real cycle, and enqueues a `shape` job returning `{mode:'pending', jobId}`. **There is no blind-regenerate endpoint** — the round-1 button was the thing that didn't match the API, not this design | yes |
| The rewrite meter | same route: `getUsageForCycle` + `isRewriteBlocked` can return `mode:'blocked'` with a summary | yes — **but it has nowhere to render** (gap 9) |
| A post still being written | `status: 'generating'` on the post | yes |
| Hooks / scripts | `POST /api/plan/hooks`, `POST /api/plan/script` | yes |
| **The mic FAB — “talk to your plan”** | `POST /api/plan/agent {instruction, source, sessionId?, conversationId?}` → `runPlanAgentTurn` (`data.ask`). Every message goes through the LLM task parser: move / delete / rewrite / add become **pending proposals**, `add_note` writes straight to `plan_inputs`, `query` answers inline, `clarify` is surfaced. Returns `{conversationId, message, proposals[], changeSetId}` | yes |
| Voice-sourced input on the **committed** month | the same route — it **already accepts `source:'voice'` + `sessionId`** | yes. Gap 8 is the *draft* route only |
| The mic on a read-only (non-home) cycle | `data.ask` returns null when `readOnly` — the FAB is not rendered | yes |
| Approving what the mic proposed | the existing `agent_proposals` queue and its approve/apply surface | yes |

**Cross-month move — what the picker now allows.** Round 3 lets the date picker navigate months
freely rather than clamping to the current one. The write works: `PATCH /api/posts/:id` accepts any
editable date and does not check that the date falls inside the post's own cycle. What follows is
not a bug but is not nothing either:

- the post keeps its original `cycleId`, so it still belongs to the month that planned it;
- `loadCrossMonthPosts` surfaces it **by date** in the destination month's feed, so it appears
  where the client put it;
- the origin month's counts drop by one, and the destination's rise, without either cycle changing;
- if no cycle plans the destination month, the post lands in the **“Outside this month”** strip
  rather than on a day.

So the mechanism exists and behaves sanely. What is missing is that **the surface never says where
the post went** — a client who moves a 31 October post to 3 November gets no confirmation naming
November. That is a copy and toast decision, not an API one, and it should land with the picker.

### 5.5 The gap list

Round 1's six, updated in place. Three are new to round 2; two were widened by it.

| # | Shown | What is missing | Nearest existing thing | Round 2 |
|---|---|---|---|---|
| 1 | **Posting time** — on cards, in the sheet header, and now **editable in the move picker** | `PlanPost` has no time field; `toPlanPost` doesn't read one; nothing writes one | The value exists in two places: `source_meta.postingTime` on posts written by the planning path, and `client_planning_config.posting_times` (a named-slot map: launch / morning / evening / wsg / sundayStyle). Neither is surfaced | **Widened: read → read *and* write.** The move picker edits it |
| 2 | **A draft dot on the month control** | `CycleSummary` carries no draft flag | `loadCycleList` already calls `cyclesWithReviewableDraft()` — it uses exactly this fact to decide whether a draft-only cycle qualifies for the menu. One boolean needs to reach the client | **More load-bearing:** with the pills gone, this control is the only place a draft month announces itself |
| 3 | **Dot density for a month you have not opened** | No per-month, per-day count read | `GET /api/plan` serves the viewed cycle's posts; `GET /api/plan/draft` serves one cycle's | Unchanged. Honest fallback: paint on arrival — the arrow already triggers a `switchCycle` fetch, so there's no empty-grid flash |
| 4 | **A rationale on a `client_input` post** | `rationaleFor()` switches on `client_added`, `emphasis_reweight`, `template` and `observed`. There is no `client_input` branch, so it falls through to `''` | Every post a launch / event / series / beat_spec transform creates carries `{basis:'client_input', reason: sourceText}`. Today those — the ones that came from the client's own words — show **no reason at all**, while a hand-added post says “You added this one.” The evidence is stored; only the sentence is missing | **CLOSED in Session B.** `rationaleFor()` gains a `client_input` branch: *“From what you told us: ‘…’”*, quoting the client's own trimmed sentence |
| 5 | **An assumption that stays answered** | Nothing records that an assumption was answered or dismissed | The answer routes fine (§5.3); the list is recomputed from `assumptions[]` on every load | **Moved, not closed:** it now surfaces as the CTA block's nudge, so a stale nudge is more prominent than a stale panel row |
| 6 | **“Undo this”** on an applied intent | Undo is one in-memory slot over a single structural mutation. There is no inverse of an *applied intent* | — | Unchanged. **6b:** rescuing one rollup item still replaces the panel with a single receipt (`brief-decomposer.md`, unfixed §2) |
| **7** | **“On its way” instead of a retry** | **A sweep for stuck generations, and an operator surface for one that outlives it** | **Bounded retry exists**: `GENERATION_JOB_OPTIONS` is `{attempts: 3, backoff: exponential 5s}`, and `generation_failed` is stamped only once BullMQ has nothing left to retry (`consumer.ts`, `isFinalAttempt`). **A daily tick exists**: `scheduler-tick`, 05:00 Europe/London, already carrying one sweep (`sweepUnsentPlanReady`) — so a failed-generation sweep is a sibling of something real. **But `generation_failed` is explicitly terminal** — “nothing retries it, the post is client-visible with its error” (`plan-ready.ts`) — and it appears nowhere in `admin/src` | **NEW, and blocking.** G4 removes the client's only recovery path. Shipping it without both halves strands the post |
| **8** | **Voice-sourced input on the draft surface** | `POST /api/plan/draft/apply` takes `{op:'text', text}` and nothing else | `POST /api/plan/intake` and `POST /api/plan/agent` both accept `source:'voice'` + `sessionId`. One field, for parity | **CLOSED in Session B**, alongside the voice sheet. The route takes `source: 'web' \| 'voice'` and the ledger records which |
| **10** | **A draft flag the month view can badge** | — | Same as gap 2; round 3 moves the badge from the month control to the month view, where it is labelled rather than a bare dot | **Reframed, not new** |
| **11** | **“Where did it go?” after a cross-month move** | No confirmation naming the destination month | `PATCH /api/posts/:id` already does the move; `loadCrossMonthPosts` already surfaces it | **NEW.** Copy + toast, no API |
| **12** | **The Insights segment** | Nothing behind it | The nav pill's children are `flex: 1`, so a fourth segment drops in without layout change | **Deliberately empty and deliberately not drawn** — round 3 sketched a greyed slot; a control that does nothing is worse than an absent one |
| **9** | **The rewrite meter's refusal** | Nowhere in the sheet renders `mode:'blocked'` | The route already returns the message (“You’ve used all N AI changes this month. Resets on the 1st. Editing directly stays free.”) | **NEW.** Round 1 listed this as a constraint; round 2 makes it a first-class action, so it is a gap. It belongs in the prompt field |

---

## 6. Typography — a reviewed decision

**Round 1 specified Inter for all UI and body text, matching `app/tailwind.config.ts`'s
`font-sans: var(--font-inter)`. The operator's phone review overrides that.**

| Role | Round 1 | Round 2 | **Round 3** |
|---|---|---|---|
| UI, body, cards, sheets, buttons, labels | Inter | Native stack | **Native stack** |
| Day numeral, day names, sheet and approval headings | Fraunces | Native stack | **Native stack** |
| The Sprigly wordmark | Plus Jakarta Sans 800 | Fraunces | **Plus Jakarta Sans 800** — back to the app's own `font-logo` token |
| The month title | Fraunces | Fraunces | **Native stack** |
| Anything else | Fraunces | — | — |

**Fraunces is now absent from the client app surface entirely.** It remains available to marketing
and the website.

**Why.** On the device the native stack resolves to SF Pro Text, the typeface every other app on
the phone uses. Matching it is most of what makes an interface read as *an app* rather than *a
website in a browser*; a webfont for UI is the single loudest signal in the other direction, and it
costs a load. Fraunces earns its place on the two elements that are unambiguously brand — the
wordmark and the month title — where it is read once and carries identity, not the twenty places
where it was competing with legibility at 12px.

**Why round 3 finished the job.** Round 2's compromise did not survive contact with a renderer.
Fraunces was declared but never loaded — there is no `@font-face` and no font link in any mockup,
and none in the app for the client surface either — so both “brand moments” fell through to
**Georgia**: the most document-like face available, on the one surface whose governing commitment
is that it must not read as a document. A serif month title with flanking chevrons was, in the
critique's words, the strongest website tell on the screen.

The wordmark now falls back through `--logo: 'Plus Jakarta Sans', var(--sans)`, so an unloaded
Plus Jakarta Sans degrades to the native stack rather than to a serif. That single fallback chain
is the fix; the round-2 version had no such floor.

**The detector's `single-font` rule is ignored project-wide**, with the reason *“single native
family is the reviewed platform-feel decision, three rounds.”* It fires by design on a one-family
interface and would otherwise sit in the channel forever; a warning nobody will ever act on trains
people to stop reading warnings. The exception lives in `.impeccable/config.json`
(`detector.ignoreRules`) — note that array carries **no reason field**, unlike `ignoreValues`, so
the reason is recorded here and in `round-3-notes.md` §3.

**What does not change.** Coral is never used for small text; coral text and coral icons appear
only on coral-100 (coral-800, 4.70:1). White on coral-600 appears on exactly two elements — the
16px/600 day numeral and the 15px/600 buttons — and nowhere else. (Earlier rounds justified this
with a “14px+/500 floor”; no such threshold exists in WCAG. The restriction stands as a house rule,
not as a standard.) Touch targets stay ≥40px, primaries 48–50px.

---

## 6b. Theme tokens, and the ramp

**Colour is not owned by this design.** The platform has an admin-managed Themes system: one
global active theme, tokens injected as CSS custom properties at the layout root by
`app/src/lib/theme.ts`, activation AA-gated in admin on tint/text pairs. The mockups consume
`--t-*` and never write a hex.

### Round 5: the ramp comes from the mark

Rounds 3 and 4 demonstrated the ramp in **Teal v1** — a generic Tailwind teal with no relationship
to the identity. Round 5 rebuilds it from the logo.

**The mark is `#4DB0A0`** — H170.3°, S39.1%, L49.6%. Its apparent *two-tone* is not two colours:
`sprigly-mark.svg` carries `opacity="0.78"` on the second leaf, which renders `#74C1B5` over white.
**One identity tone, and an opacity.** Every tier below is that hue and saturation at a different
lightness, so the ramp and the mark cannot drift apart.

| Tier | Value | Job |
|---|---|---|
| `accent-100` | `#E3F3F0` | tint |
| `accent-500` | `#74C1B5` | the mark's lighter leaf — light fills, non-text vivid |
| `accent-600` | **`#4DB0A0`** | **the logo tone.** Identity fills |
| `accent-700` | `#327267` | fills that must carry white |
| `accent-800` | `#285C54` | accent text |

### The ink rule, re-derived

> **Tiers 100–600 take `chrome-deep` ink. Tiers 700–800 take white. No tier takes both.**

The crossover is sharp enough that no judgement call is needed: `chrome-deep` goes **5.60 → 2.60**
across the 600/700 boundary while white goes **2.61 → 5.62**.

Round 4 had banned dark ink on 600 after it read muddy. That verdict was correct *about the colour
it was made against* — `#14B8A6`, a heavily saturated mid-tone at S≈80%, where dark ink sat heavy.
On this softer mint (S 39%) it reads crisp. Checked on screen, not only in the ratio, because the
round-4 finding was precisely the kind a ratio cannot catch.

| Pair | Ratio | Verdict |
|---|---|---|
| **white on `accent-650`** | **3.40** | ⚠️ **filled controls only** — the ink rule, §6b |
| `chrome-deep` on `accent-100` | 12.78 | ✅ |
| `chrome-deep` on `accent-500` | **6.99** | ✅ light fills |
| `chrome-deep` on `accent-600` | 5.60 | ⊘ arithmetically fine, but **no longer used** — round 5.1 took ink off `accent-600` entirely |
| `accent-800` on `accent-100` | 6.67 | ✅ accent text on tint — **the admin activation gate's one check** |
| `accent-800` on `surface` | 7.64 | ✅ accent text on white |
| `accent-700` on `surface` | 5.62 | ✅ |
| white on `accent-700` | **5.62** | ✅ dense-text surfaces |
| white on `accent-800` | 7.64 | ✅ |
| white on `accent-600` | 2.61 | ❌ never |
| `chrome-deep` on `accent-700` | 2.60 | ❌ never |
| `accent-600` on `surface` / `canvas` | 2.61 / 2.35 | ❌ never as text or a meaningful glyph |
| white on `danger` | 5.94 | ✅ the Delete button |
| `border` on `surface` | 3.13 | ✅ hairlines only |

**Non-text uses** (nothing on top of them): day pips and month dots, the changed-card wash and
edge, the glow under the mic, waveform bars, focus rings, the completed-task tick.

**The selected-day pip stays accent and is never white.** It sits *below* the numeral, on canvas
rather than on the fill, so round 4's white pip simply vanished when a day was selected.

### One thing this could not verify

**No mint-teal logo asset exists in this repo.** Every file in `studio/svg_logos/`, plus
`app/src/app/icon.svg` and `site/public/favicon.svg`, is still coral `#E87766` with ink `#2A1F1C`.
So the tones were not sampled from an asset — they are the operator's quoted values, cross-checked
against the mark's geometry: `#4DB0A0` at the SVG's own `0.78` opacity renders `#74C1B5`, which
matches the quoted lighter tone to within one point on green and zero on blue. That agreement is
what makes the single-tone reading safe to build on. **If the mint mark exists outside the repo,
the ramp should be re-sampled from it before this ships.**

---

## 6c. Icons

Format is an icon everywhere; the word survives only as `title` and screen-reader text.

| Format | Icon | Note |
|---|---|---|
| reel | clapperboard | A **filled** slate with negative slashes cut out of it |
| carousel | stacked squares | Front sheet with a second peeking behind |
| single | framed image | Frame, sun, one horizon line |

**All three were screenshot-tested at their real rendered size (17px in a 28px tile) before
adoption, and the clapperboard took three attempts.** An outlined slate with hairline diagonals
read as browser chrome; a rotated slate read as noise. Only the filled slate is unmistakable at
17px. Its negative slashes are filled `var(--t-accent-100)` — the tile's own colour — so the icon
is correct wherever the tile goes, which is the one constraint on reusing it elsewhere.

The canonical sprite is `docs/design/mockups/_sprite.txt`. Every page inlines a copy because
cross-file `<use href="sprite.svg#id">` is blocked under `file://`.

---

## 7. Terminology

The word **“beat” never appears on a client-facing surface.** It is a good internal word — it
names a slot with evidence attached and no content yet — and a bad client word, because a client
has never heard it and the thing it names looks to them exactly like a post.

| Internal | Client-facing | Notes |
|---|---|---|
| beat (`DraftBeatView`, `draftBeatCount`, `loadDraftBeats`) | **planned post** | Plural: “2 planned posts”. In a committed month they are simply **posts** |
| draft beat / unapproved beat | **planned post**, inside a month framed as **Draft · Not sent yet** | The framing carries the provisional meaning; the noun doesn't have to |
| slotType `experiment` | **Something new**, beside a lightbulb | A banner-style pill on the card, not a tooltip and not a corner bulb — §2.1 is the one definition. The full reason lives behind the sheet's insights icon |
| slotType `proven` | *(nothing)* | The default needs no label |
| pillar | **pillar** | Kept — it is the client's own vocabulary from onboarding |
| format (`reel` / `carousel` / `single`) | *(icon)* | Words survive as `title` and screen-reader label: “Reel”, “Carousel”, “Single post” |
| rationale / `rationaleEvidence` | **why this one is here** | Behind the insights icon |
| instructed rewrite (`POST /api/plan/shape`) | **Shape** | Round 4. The endpoint was always `shape` and always required an instruction; “write again” implied a blind redo |
| assumption | *(re-voiced as a nudge)* | Never “assumption”, never “we assumed” as a heading |
| `generation_failed` / retry | **on its way** | Client-facing. The real status stays for the operator |
| receipt / `DraftApplication` | **what changed** | The chip has no heading at all — just the counts |
| cycle | **month** | Already true in the copy; recorded so it stays true |
| approve / approval | **Generate** (the pill) · **Ready to go?** (the sheet) | “Approve” is our word for a state transition, not theirs. Round 5 shortens the pill to the single action word; the sheet's copy is unchanged |

---

## 8. Voice — live from day one

**Round 3 removes the phasing.** Round 2 shipped the sheet with a disabled mic and an “arrives
later” line, which put a large grey dead circle at the optical centre of the one screen whose
promise is *talk to your plan*. The client reads the broken thing before the explanation.

That framing was also stricter than the facts. A browser-side capture path **already exists and is
already wired**: `app/src/components/plan/useSpeechInput.ts` drives the Web Speech API — no
backend, final transcript chunks appended into an editable field — and `IntakeCapture.tsx` uses it
today. It degrades correctly: `unsupported` hides the mic, `no-permission` reports itself. Moving
it onto the draft surface is a move, not a build.

So voice is live, and there is no “later” copy anywhere in the set.

**One sheet, two modes.** A keyboard toggle swaps the mic and waveform for a text field. Same
framing copy, same example prompts, same submit, same route. The inline say-something box that sat
on the draft page in round 2 is gone: there is now exactly one place to tell us something, and it
works whether you talk or type. That also fixes the round-2 duplication where the page and the
sheet were two different interfaces for one job.

**The waveform.** A live `AnalyserNode` over the mic stream, `getByteFrequencyData` into ~25 bars
on `requestAnimationFrame`. It **flatlines when silent and peaks while speaking**, which is the
whole job: it lets the client tell *“not listening”* from *“listening, you haven't said anything
yet”*. Both states are mocked. `prefers-reduced-motion` holds the bars at a static mid height.

**What a later workstream still buys**, and why it is no longer blocking: server-side
transcription is more accurate, works where the Web Speech API doesn't, and can keep the audio
rather than only its transcript. None of that is needed to ship the sheet.

**Gap 8 should land with this**, so the ledger can tell spoken from typed from the first day
rather than retrofitting the distinction. **It did** — `POST /api/plan/draft/apply` takes
`source: 'web' | 'voice'`, and it reaches the receipt and every `plan_inputs` row the application
files. Anything that arrived through the microphone counts as voice even when the client tidied
it by hand afterwards, because that is what happened.

### 8.1 The example prompts became STARTERS (X4, built)

X4 ruled that the three prompts must seed the field or stop looking tappable, and chose seeding.
Building it exposed the reason they could not simply be wired up: **they were questions.** Round
3 wrote *“What's happening in October?”*, *“Anything launching?”*, *“Anything you want more of?”*
— and inserting *“Anything launching?”* into the field as the client's own words is nonsense. It
would then be quoted back on a card under *“From what you told us”*.

So they are **openers the client finishes**, phrased to lead into an intent the classifier routes:

| Starter | Intent it leads to |
|---|---|
| “We're launching …” | `launch` |
| “There's an event on …” | `event` |
| “Can we do more …” | `emphasis` |

A tap switches to typed mode, appends the opener to whatever is already there, and puts the caret
after it. The questions survive as the sheet's own framing sentence, which is where a question
belongs — asked by us, not put in the client's mouth.

### 8.2 The three states (X6, built)

Round 5.1 found silent and speaking differing only by the bars and the heading. Three channels
now, and the mic is one of them:

| State | The mic | The copy |
|---|---|---|
| **idle** | outline, `accent-600` ring | “Tap the mic and talk” / “One sentence is enough.” |
| **listening, silent** | filled `accent-650` | “Go ahead” / “We can't hear anything yet.” |
| **listening, speaking** | filled **and haloed** | “Listening…” / “Tap the mic again when you're done.” |

The halo fires on the meter's own level detection, debounced so a gap between words is not a
state change.

### 8.3 `useSpeechInput` moved ONTO the draft surface — it did not leave `IntakeCapture`

The brief allows either. **`IntakeCapture` keeps its microphone**, because it is a different
surface with a different job: the guided/freeform brief reached from the Ask email's `?intake=1`
link, before a plan exists. Retiring a working capability there would be scope this session did
not earn, and the two now share one hook, which is the point.

What *did* go is `DraftPlanView`'s inline **“Anything we should know?”** textarea — not by
deletion but with the whole component, which is no longer reachable on a phone. There is exactly
one place to tell us something on the mobile draft surface, and it works whether you talk or type.

**The meter and the transcript are independent consumers of the microphone.** `useSpeechInput`
holds the Web Speech API's; `Waveform` opens its own `getUserMedia` stream for the analyser. A
browser without `AudioContext` gets flat bars and a working transcript — the meter is the part
that may fail, and it fails to *nothing* rather than to a claim that the microphone is broken.

## 9. Day-view density, and thin months

### 9.1 Density

390px minus the 20px gutters leaves 350px. A full card is 120–150px tall.

| Posts on the day | Rendering |
|---|---|
| **0** | Day header (“Nothing planned” / “Nothing drafted”) + one add slot |
| **1–2** | Full cards: format icon, pillar, posting time, title, and either a caption excerpt (committed) or a one-line reason (draft). Add slot below |
| **3–4** | One grouped list of **compact rows**: time · title (single line, ellipsised) · chevron. Add slot below |
| **5+** | The same rows, first four shown, then **“＋N more”** expanding in place |

**Compact rows deliberately drop the format icon and the pillar** — they move to the detail sheet.
A row carrying time + icon + pillar + title leaves roughly 150px for the title, which truncates
every real title to uselessness; ivy-t's include 200-character input echoes (rehearsal report, F2).
Time and title answer *what is happening, and when*; everything else is a tap away.

**Ordering within a day** is `(scheduled_date, position)` — the order `loadDraftBeats` already
returns. `position` is the tiebreak `reorderWithinDay` writes, and this is the first surface that
makes it visible.

The three-plus case is real: Earl of East's October holds two posts on 1 October; ivy-t's August
holds three on 3 August and three on 1 August.

### 9.2 Thin months

Not an error state and not dressed as one. Two causes: **thin history** (fewer than
`DRAFT_MIN_POSTS` = 15 posts on record, so the assembler switches to a neutral template skeleton
and declares it — template posts carry **no** `formatEngagement` and **no** `pillarShare` at all)
and **a genuinely small month**.

- **The day view is invariant to month size.** It shows one day at a time whether the month holds
  two posts or thirty. This is the strongest structural argument for the day-first pattern — and
  round 2 strengthens it, because with the week feed gone there is no long scroll to run out of.
- **The month overview shows two dots and says so** — “2 posts planned across November”. No ghost
  cells, no placeholder slots.
- **The rationale names the gap**: *“We don’t have enough of your posting history yet, so this is a
  starting shape rather than a pattern we’ve seen work.”*
- **The acknowledgement sits at the foot of the day** — “Two posts so far. Tell us what's coming
  up and we'll build it out, or say you're ready and we'll write these two.” It goes *after* the
  client has read what there is, not before. Round 1 gave thin months their own approval card with
  a second button; there is no need, because the mic and the Ready-to-go pill are both already on
  screen.
- **The tick stays exactly where it is.** A thin month is still a month you may approve, and the
  sheet counts what is actually there — omitting the zero rows rather than printing “0 hooks”.
- **Never pad.**

---

## 10. Desktop adaptation

Desktop keeps the fuller calendar and this brief does not replace it: at ≥1080px `PlanDesktop`
renders a month grid, and a month grid is the right tool on a screen that can show one. What
crosses over is everything width-agnostic — the detail sheet (a right-hand panel or centred modal
rather than a bottom sheet), the summary chip and its expanded panel, the CTA block, and the
approval sheet — all of which should be built once and placed differently, not built twice. The day
view has no desktop counterpart; a desktop day is a column in the grid. The **one** piece desktop
must inherit is the **month control and its arrows**, because “October doesn’t show” was a desktop
report: `PlanDesktop` navigates by prev/next arrows by index with no visible month name, which put
October two blind taps away. Round 2's control names the month and its state on the button itself,
which closes that class on both form factors and is the smaller half of the work. The round-2
typography decision (§6) applies to desktop too — a Mac resolves the native stack to SF Pro Text
just as an iPhone does.

---

## 11. Data provenance

Every figure in the mockups is a reported one. Nothing was invented to make a screen look full.

| Content | Source |
|---|---|
| Earl of East's October posts — dates, formats, pillars, caption lengths, statuses | `docs/reports/build-d-approval-phase2.md` §1 — the dogfood run, 0/10 structure drift |
| The generated reel's caption, hook and script, and the carousel's caption (verbatim, including the corrupted `#ritualovertoutine`) | same report |
| Engagement: carousels 69.9 over n=8, single posts 38.2 over n=23, pillar share 0.2 on the `equal` basis, cadence 2.24 posts/week over 4 months, 31 posts of history | `docs/reports/build-a-draft-assembly.md` §10, cross-validated against the Phase 0 SQL |
| The two month assumptions, and the question form of each | Build A §10 + `draft-rationale.ts` `assumptionPrompt()` |
| The Wilderness intake sentence and its live classification | Build D §1 |
| ivy-t: 21 planned posts / 0 committed, the 3 August titles (clipping included), the launch-arc receipt's Added/Replaced lines, the operator hand-move | `docs/reports/ivy-t-rehearsal-failures.md` |
| ivy-t's seven configured pillars | `docs/calibration/ivy-t-2026-07/DIFF-SUMMARY.md` |
| Sally's 14-segment brief, its kinds and outcomes | `docs/reports/brief-decomposer.md` §COMMIT 4 |
| The experiment post (“A room that breathes”) | Build B §4's own rendered draft |
| Posting times | the `PostingTimes` contract's documented example values (`packages/engine/src/types.ts`) — **not** a stored client config |
| Retry attempts, the daily tick, the terminality of `generation_failed` | `app/src/lib/queue.ts`, `engine/src/content-cycles/consumer.ts`, `engine/src/content-cycles/plan-ready.ts` |
| Browser-side speech capture | `app/src/components/plan/useSpeechInput.ts`, used by `IntakeCapture.tsx` |

Six things are **reconstructions**, labelled on the pages that show them:

1. Two October titles the reports elide are shown in the assembler's deterministic fallback form
   (`Pillar — Format`) rather than invented.
2. The 1 October single post's caption text is not recorded — only its length — so its card states
   the length rather than showing invented copy.
3. The Wilderness application's receipt `lines[]` are not recorded, so the chip counts only the one
   delta that *is* established (“1 added”) and claims no replacement.
4. The rollup's per-item diff lines are phrased from the fixture's recorded post counts and dates;
   the rendered strings are not stored.
5. The `client_input` reason sentence is the intended copy, not what ships (gap 4).
6. The thin-month frame illustrates the template path; no live client has a recorded thin draft.
   The voice sheet's example prompts are likewise written, not sourced — no client-facing prompt
   copy exists in the repo.

One discrepancy, unchanged from round 1: the brief says “We found 13 things”; the failure report
describes ~13 distinct intents and the decomposer's acceptance fixture splits Sally's brief into
**14**. The surface renders `receipt.segmentCount`, so the mockup says 14.

---

## 12. Build order, if this proceeds

Not a commitment — the shape of the work, so the sequencing is reviewable alongside the design.

1. **Gap 7 first, before any of the UI.** Removing the client's retry affordance removes their only
   recovery path for a stuck generation. Bounded retry exists (`attempts: 3`, exponential backoff);
   the daily `scheduler-tick` exists and already carries a sibling sweep. What is missing is a
   failed-generation sweep and an operator surface — `generation_failed` appears nowhere in
   `admin/src`. Both are prerequisites for shipping “on its way”, not follow-ups.
2. **The shell: the floating nav, title row, Today.** A segmented pill carrying
   `Day · Month · Tasks` with a **separate** circular mic beside it, floating over the content on a
   blurred material — **not** a bottom tab bar, and **not** a Week|Month switcher in the header.
   Both of those were round-3 shapes that round 4 replaced; §1.2 is the contract. It is the
   cheapest change with the largest effect on whether this reads as an app, it retires four
   controls (month pills, wheel picker, chevrons-by-index, the header switcher), and it closes the
   “October doesn't show” class on both form factors. Needs gap 2 for the draft badge.
3. **Theme tokens on the client surface.** Mechanical, and it unblocks any future theme work.
   Decide the `accent-500` proposal here or explicitly defer it.
4. **The day view reskin, committed.** Chrome shrinks, the global add button goes, the week feed
   and its scroll-spy come out, the density rule lands. Net deletion of code.
5. **The detail sheet, both variants.** Needs the §4.1 decision on format and gap 9 for the meter.
6. **The voice sheet**, with `useSpeechInput` moved across and gap 8 landing alongside it.
7. **The draft surface onto the same skeleton** — the largest piece, reconciling `DraftPlan` with
   `PlanRoot`'s fork.
8. **The remaining gaps**, of which 4 (a `client_input` reason) is still the cheapest and the one
   with the most direct effect on whether a client trusts the month.

---

## 12b. Rollout — theme and brand assets

Two constraints on shipping the round-5 ramp, recorded here because they gate the build rather
than the design.

**The ramp needs a theme before any client sees it.** Shipping it means creating a **“Sprigly
Mint”** theme in admin → Themes and activating it **on uat first**. The live app stays on **Teal
v1** until reviewed.

| Token | Sprigly Mint |
|---|---|
| `accent100` | `#E3F3F0` |
| `accent600` | `#4DB0A0` |
| **`accent650`** | **`#43998B`** |
| `accent700` | `#327267` |
| `accent800` | `#285C54` |
| `chrome` / `chromeDeep` | `#334155` / `#1E293B` |
| `muted` / `line` / `lineSoft` | `#5C6470` / `#8F9296` / `#F4F5F6` |
| `canvas` / `surface` | `#F2F3F5` / `#FFFFFF` |
| `danger` | `#B23A2E` |

### The gate check — answered

I read the gate rather than assuming it. `activateTheme`
(`admin/src/app/admin/themes/actions.ts`) calls `themeActivatable`
(`packages/engine/src/contrast.ts`), and that function **blocks on exactly one pair**:

> `accent-800` on `accent-100` ≥ 4.5:1 — *“a theme whose tint/text pairing fails AA is BLOCKED and
> never activated.”*

**Sprigly Mint: `#285C54` on `#E3F3F0` = 6.67:1. The gate passes. The theme is activatable, and
`accent-650` does not need the gate's list amended** — the gate never looks at it.

`computeThemeContrast` also *reports* six further rows (white on 600, white on 700, 600 on surface,
border on surface, white on chrome, chrome-soft on chrome). Those are surfaced in admin for the
operator to read; none of them blocks. So white-on-650 at 3.40 cannot prevent activation.

**Two things it does mean for the build**, neither of them blocking:

1. **`accent-650` cannot be stored yet.** `ThemeTokens` and `THEME_TOKEN_KEYS` in `contrast.ts` are
   a fixed list of fourteen keys with no `accent650`, and `theme.ts`'s `VAR` map has no entry for
   it. Until both are extended plus the admin editor column, `--t-accent-650` would never be
   injected and the client surface would fall back. **This is the one code change the ramp
   actually requires.** The same is true of `accent-500`.
2. **Admin's reported table will not mention 650**, so an operator reading it sees no row for the
   deviation. Worth adding to `computeThemeContrast`'s rows when the token lands, so the 3.40 is
   visible where the decision is made rather than only here.

**Repo brand assets stay coral, deliberately.** Everything in `studio/svg_logos/`, plus
`app/src/app/icon.svg` and `site/public/favicon.svg`, is `#E87766` and **must not be changed in
this build**. They are held pending the brand-reconciliation gate, which is the same decision that
owns whether the mint mark replaces the coral one at all. Until that gate clears, the plan surface
can be mint while the favicon is coral — an inconsistency that is visible, temporary, and
preferable to a half-migrated identity.

That gate also owns the open question in §6b: **no mint asset exists in this repo**, so the ramp
is derived from the operator's quoted tones cross-checked against the mark's geometry, not sampled
from a file. Re-sample when the asset lands.

---

## 13. Open, and deliberately not decided here

Three questions the critique raised that the round-3 brief did not settle. Recorded so they are
decided rather than defaulted.

1. ~~**The committed month has no FAB.**~~ **Decided 2026-07-28.** The FAB is the microphone on
   both month states and is never inert; on a committed month it means *talk to your plan* and runs
   the existing post-cutoff agent path, which raises proposals rather than applying changes. Copy
   stays a per-post control on the card. See §1.2 and §5.4.
2. **Peak-end has no end.** There is no post-approval state anywhere in the set. The last emotional
   beat of the product — *the month is written, here is what happens next* — is unrendered, and
   generation takes minutes. **Still open after Session B**, and now the largest one: approval
   navigates to `/?cycle=` and the client arrives at a month of *On its way* cards with no
   sentence saying the writing has started. The cards are honest; the arrival is not staged.
3. ~~**Format still has no control**~~ — **Decided 2026-07-29 (P2).** The control is reinstated in
   the detail sheet and `swapFormat` has a surface again. See §4.1, including the conflicting
   ruling in the same review and why P2 governs.
