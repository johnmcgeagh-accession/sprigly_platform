# Mobile plan surface — design spec

**Date:** 2026-07-27 · branch `dev` · **spec and mockups only, no production code**
**Revision:** round 3, after an `/impeccable` critique and the operator's third review.
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
| **R2** | **The vivid pass.** accent-600 fills carry **chrome-deep ink**, not white | §6b. White on accent-600 is 2.49:1; flipping the ink gets 5.88:1 and keeps the brightest tier on the biggest surfaces |
| **R3** | **No serif anywhere on the client surface.** Fraunces is out entirely | §6. It was never loaded, so round 2's wordmark and month title rendered as Georgia |
| **R4** | **A persistent bottom tab bar** — Plan \| Tasks, laid out for 3–4 — with the FAB floating over it | §1.2. Insights joins as a third tab when the insight layer ships |
| **R5** | **Week \| Month is a peer switcher**, not an overlay. No ✕, no legend, no month pills | §1.2, §1.5 |
| **R6** | **Plan \| Tasks and Today restored**, matching the live app | §1.2 |
| **R7** | **The mic is the FAB; approval is a labelled “Ready to go” pill** | §1.3. Round 2 put an unlabelled tick on the one action that spends money |
| **R8** | **The draft framing shrinks to one line**; the full copy moves into the voice sheet | §2 |
| **R9** | **Voice is live from day one**, with a live waveform, and typed input uses the same sheet | §8 |
| **R10** | **Action rows are icon-only**; the date picker crosses months; write-again happens in place | §4 |
| **R11** | **Icons v2** — clapperboard, stacked squares, framed image — screenshot-tested at 17px | §6c |

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

Round 3 gives the surface a real iOS shell. The tab bar is persistent; **Week and Month are peer
views** inside the Plan tab, switched by a segmented control on the title row.

```
  ┌──────────────────────────────────────────────┐
  │  Sprigly                                     │  wordmark, LEFT
  │                                              │
  │  ‹  October 2026  ›            [Week][Month] │  title row + peer switcher
  │                                              │
  │  [Draft] Not sent yet ...      Ready to go   │  ← draft only: state + approval
  │                                        Today │
  │  M   T   W   T   F   S   S                   │  week strip   ── OR ──
  │ 28  29  30  (1)  2   3   4                   │  the month grid
  │ ──────────────────────────────────────────── │
  │                                              │
  │  Thursday 1 October          2 posts         │  the selected day, ALONE
  │  ┌────────────────────────────────────────┐  │
  │  │ ▣  Home & Space                  6:00  │  │
  │  └────────────────────────────────────────┘  │
  │                                       ( 🎤 ) │  FAB — mic on a draft month
  │  ┌──────────────────┬───────────────────┐   │
  │  │      Plan        │      Tasks        │   │  tab bar, sized for 3–4
  └──────────────────────────────────────────────┘
```

```
   SURFACE = draft | committed        (server decides — §1.1)
      │
      ├── TAB    = plan | tasks          ← persistent bottom bar
      │      │
      │      └── VIEW = week | month     ← peer switcher, title row
      │             │
      │             └── selectedDay
      │
      └── OVERLAY ∈ { none, detail, move, write-again, voice, approve }
```

Three rules the round-3 shell adds:

1. **The tab bar is always there.** It closes the viewport, which is most of what separates an app
   from a page that ran out of content — round 2 left 300–500px of unanchored canvas under short
   days.
2. **Month is a peer, not a modal.** It has no ✕ and no dismiss; you leave it the way you entered
   it. That also removes the round-2 ✕ sitting beside the wordmark, where a founder reads it as
   *close the app*.
3. **The FAB is the primary verb of the surface.** On a draft month that is the microphone. On a
   committed month there is no FAB today — see the open question in §12.

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
| Plan / Tasks segmented control | **Restored as the bottom tab bar** (R6) |
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
planned post; the sheet shows the one a client can *act on* and drops the rest. For Earl of East
that means keeping “nothing's launching this month” and dropping “no pillar weights are on
record” — the second is true, but it is a fact about our data, not a question for them.

**Never a caveat.** Round 1 headed this an amber “What we assumed” warning box. The same
information phrased as an invitation reads as confidence; phrased as a warning it reads as an
excuse.

On a thin month the same one-liner carries the acknowledgement (§9.2).

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
- **Dismiss removes the chip and nothing else.** The “New” marks on changed posts are driven by
  `changedIds` and are independent of it.
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
│  [📅 Move]   [✦ Write again]   [🗑 Delete]    │   icons + short labels
│   1 OCT · 6:00                               │
└──────────────────────────────────────────────┘
```

- **Copy is a first-class control, per tab.** Getting the words out of Sprigly and into Instagram
  is the actual job; copying the whole sheet is not the same thing as copying the caption.
- **The reasoning lives behind the insights icon.** One tap reveals it above the tabs, with its
  sample sizes. It is not in the way of the words the client came for, and it is one tap from
  every post rather than a paragraph on every card.
- **Per-post assumptions are gone.** Assumptions are a property of the month; they belong in the
  CTA block, once, not repeated on ten sheets.
- **“Write again” opens a prompt field, never a blind regenerate.** This matches the API exactly —
  see §5.4.
- **“Move” carries the current date on its icon**, so the action row states where the post is
  before you open anything, and the picker edits date *and* time.
- **Undo renders at the top of the screen.** In round 1 it was bottom-anchored, which put it
  directly over the action row it was undoing.
- **The planned-post variant has no tabs and no “Write again”** — there is nothing written yet, so
  the sheet says so rather than showing three empty tabs.

### 4.1 One consequence to decide: format has no control

Removing the format control from the sheet leaves **`swapFormat` with no surface**. It is a
shipped, tested Build B mutation (`POST /api/plan/draft {op:'format'}`, vocab-checked against
reel / carousel / single) that no screen would call.

Three options, in the order I'd rank them:

1. **Put it in the add sheet only** — you choose a format when you create a planned post, and
   changing it afterwards means deleting and re-adding. Simplest, and honest about how rarely a
   client changes format deliberately.
2. **Long-press the format icon** — discoverable by nobody, but costs nothing and keeps the
   mutation reachable.
3. **Leave it operator-only.** The mutation stays; the client surface drops it.

Flagged rather than decided: it is a product call about whether format is the client's choice or
ours, and the round-2 brief removed the control without saying which.

---

## 5. Wiring — every interaction to an API

“Exists” means the endpoint and its behaviour ship today. Nothing here is a proposed endpoint
unless the Exists column says **no**.

### 5.1 Navigation

| Interaction | Wiring | Exists |
|---|---|---|
| Tap a day in the week strip | local `selectedDay` — **round 2: no scroll-to-day, the panel re-renders** | yes |
| Swipe the week strip | local. New gesture; the strip is a grid today | UI only |
| Week \| Month switcher | local view state, no request | yes (new UI, no API) |
| Plan \| Tasks tab bar | local; Tasks renders the existing checklist (`planTasks`, `PostStepView`) | yes |
| Insights tab | — | **no** — the insight layer does not exist. The bar is laid out to take it |
| Tap a day in the month grid | local `selectedDay`, view → day | yes |
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
| Swap format | `{op:'format', postId, format}` | yes — **but round 2 removes its control** (§4.1) |
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
| **“Write again” (guided rewrite)** | **`POST /api/plan/shape {targetPostId, instruction}` — confirmed.** `app/src/app/api/plan/shape/route.ts` 400s without an `instruction`, gates on the post's date via `gatePostEdit`, resolves the post's real cycle, and enqueues a `shape` job returning `{mode:'pending', jobId}`. **There is no blind-regenerate endpoint** — the round-1 button was the thing that didn't match the API, not this design | yes |
| The rewrite meter | same route: `getUsageForCycle` + `isRewriteBlocked` can return `mode:'blocked'` with a summary | yes — **but it has nowhere to render** (gap 9) |
| A post still being written | `status: 'generating'` on the post | yes |
| Hooks / scripts | `POST /api/plan/hooks`, `POST /api/plan/script` | yes |

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
| 4 | **A rationale on a `client_input` post** | `rationaleFor()` switches on `client_added`, `emphasis_reweight`, `template` and `observed`. There is no `client_input` branch, so it falls through to `''` | Every post a launch / event / series / beat_spec transform creates carries `{basis:'client_input', reason: sourceText}`. Today those — the ones that came from the client's own words — show **no reason at all**, while a hand-added post says “You added this one.” The evidence is stored; only the sentence is missing | Unchanged, and still the cheapest fix with the largest effect on trust |
| 5 | **An assumption that stays answered** | Nothing records that an assumption was answered or dismissed | The answer routes fine (§5.3); the list is recomputed from `assumptions[]` on every load | **Moved, not closed:** it now surfaces as the CTA block's nudge, so a stale nudge is more prominent than a stale panel row |
| 6 | **“Undo this”** on an applied intent | Undo is one in-memory slot over a single structural mutation. There is no inverse of an *applied intent* | — | Unchanged. **6b:** rescuing one rollup item still replaces the panel with a single receipt (`brief-decomposer.md`, unfixed §2) |
| **7** | **“On its way” instead of a retry** | **A sweep for stuck generations, and an operator surface for one that outlives it** | **Bounded retry exists**: `GENERATION_JOB_OPTIONS` is `{attempts: 3, backoff: exponential 5s}`, and `generation_failed` is stamped only once BullMQ has nothing left to retry (`consumer.ts`, `isFinalAttempt`). **A daily tick exists**: `scheduler-tick`, 05:00 Europe/London, already carrying one sweep (`sweepUnsentPlanReady`) — so a failed-generation sweep is a sibling of something real. **But `generation_failed` is explicitly terminal** — “nothing retries it, the post is client-visible with its error” (`plan-ready.ts`) — and it appears nowhere in `admin/src` | **NEW, and blocking.** G4 removes the client's only recovery path. Shipping it without both halves strands the post |
| **8** | **Voice-sourced input on the draft surface** | `POST /api/plan/draft/apply` takes `{op:'text', text}` and nothing else | `POST /api/plan/intake` and `POST /api/plan/agent` both accept `source:'voice'` + `sessionId`. One field, for parity | **Round 3: now blocking on the voice sheet**, which ships live. It should land in the same change |
| **10** | **A draft flag the month view can badge** | — | Same as gap 2; round 3 moves the badge from the month control to the month view, where it is labelled rather than a bare dot | **Reframed, not new** |
| **11** | **“Where did it go?” after a cross-month move** | No confirmation naming the destination month | `PATCH /api/posts/:id` already does the move; `loadCrossMonthPosts` already surfaces it | **NEW.** Copy + toast, no API |
| **12** | **The Insights tab** | Nothing behind it | The tab bar is laid out for it | **NEW, and deliberately empty.** Drawn at 32% in mockup 10 to prove the geometry |
| **9** | **The rewrite meter's refusal** | Nowhere in the sheet renders `mode:'blocked'` | The route already returns the message (“You’ve used all N AI changes this month. Resets on the 1st. Editing directly stays free.”) | **NEW.** Round 1 listed this as a constraint; round 2 makes “Write again” a first-class action, so it is a gap. It belongs in the prompt field |

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

**What does not change.** Coral is never used for small text; coral text and coral icons appear
only on coral-100 (coral-800, 4.70:1). White on coral-600 appears only at 14px+/500 — in the
mockups, the 16px/600 day numeral and 15px/600 buttons. Touch targets stay ≥40px, primaries 48–50px.

---

## 6b. Theme tokens, and the vivid pass

**Colour is not owned by this design.** The platform has an admin-managed Themes system: one
global active theme, tokens injected as CSS custom properties at the layout root by
`app/src/lib/theme.ts`, activation AA-gated in admin on tint/text pairs. Round 2's mockups
hard-coded thirteen coral hexes, which meant the files specifying a themeable surface could not
themselves be themed.

**Round 3 moves the mockups onto the tokens.** Same names as the injected properties:

| Token | Teal v1 | Role |
|---|---|---|
| `--t-accent-600` | `#14B8A6` | the vivid fill. **Never carries white ink** |
| `--t-accent-700` | `#0F766E` | fill when it must carry white (5.47:1) |
| `--t-accent-800` | `#0C5F58` | the only accent that may be small text |
| `--t-accent-100` | `#E6F7F5` | tint |
| `--t-chrome` / `--t-chrome-deep` | `#334155` / `#1E293B` | text, dark surfaces — **and the ink on every accent-600 fill** |
| `--t-muted` / `--t-line` / `--t-line-soft` | `#5C6470` / `#8F9296` / `#F4F5F6` | secondary text, hairlines |
| `--t-canvas` / `--t-surface` | `#F2F3F5` / `#FFFFFF` | page, cards |
| `--t-danger` | `#B23A2E` | **operator-facing, plus destructive actions the client chooses** |

The mockups demonstrate the active theme, **Teal v1**. Changing the twelve lines in the
stylesheet's THEME block repaints all ten pages, which is the point of showing it this way.

### The vivid rule

The operator asked for more vivid colour. The obstacle is that `accent-600` — the brightest tier
that can cover a large area — measures **2.49:1 against white**, failing both the AA text floor
(4.5) and the graphic floor (3.0). The instinct is to darken the fill until white text passes,
which is exactly how a surface ends up dull.

> **Flip the ink, not the fill. `chrome-deep` on `accent-600` is 5.88:1.**

That keeps the brightest teal on the biggest surfaces — the selected day, the FAB, loud badges,
the summary chip, primary buttons — and passes AA comfortably. It is the same move a
black-on-bright-green Spotify button makes.

Measured pairs in the active theme:

| Pair | Ratio | Verdict |
|---|---|---|
| `chrome-deep` on `accent-600` | **5.88** | ✅ the vivid rule |
| white on `accent-700` | 5.47 | ✅ when a fill must carry white |
| `accent-800` on `accent-100` | 6.80 | ✅ the only accent small text |
| `accent-500` on `chrome-deep` | **7.86** | ✅ maximum vividness, on dark |
| white on `accent-600` | 2.49 | ❌ never |
| `accent-600` on `surface` / `canvas` | 2.25–2.49 | ❌ never as text or a meaningful glyph |

**Where the accent is allowed to be loud** (non-text, no glyph over it): day pips and month dots,
the changed-card wash and edge, the FAB's offset glow, waveform bars, the summary chip, focus
rings.

### The proposal: an `accent-500` tier

Every theme today ships four accent tiers. A fifth, brighter one — `#2DD4BF` in Teal v1 — would
give the system a sanctioned home for glows, waveform peaks and dark-field accents that are
currently improvised from `accent-600` at alpha.

It needs **no new AA rule**, because it is non-text by definition and its only text-adjacent use
is on `chrome-deep`, where it measures 7.86:1 — the most saturated moment in the product, on the
voice sheet's waveform. Adopting it costs one column in the admin Themes editor and one entry in
`theme.ts`'s `VAR` map. The mockups demonstrate it; the platform does not ship it.

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
| slotType `experiment` | *(no word — a lightbulb icon)* | Tap: “A new idea we’re trying this month.” Round 1's “Something new” badge is retired |
| slotType `proven` | *(nothing)* | The default needs no label |
| pillar | **pillar** | Kept — it is the client's own vocabulary from onboarding |
| format (`reel` / `carousel` / `single`) | *(icon)* | Words survive as `title` and screen-reader label: “Reel”, “Carousel”, “Single post” |
| rationale / `rationaleEvidence` | **why this one is here** | Behind the insights icon |
| assumption | *(re-voiced as a nudge)* | Never “assumption”, never “we assumed” as a heading |
| `generation_failed` / retry | **on its way** | Client-facing. The real status stays for the operator |
| receipt / `DraftApplication` | **what changed** | The chip has no heading at all — just the counts |
| cycle | **month** | Already true in the copy; recorded so it stays true |
| approve / approval | **ready to go** / **generate it** | “Approve” is our word for a state transition, not theirs |

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
rather than retrofitting the distinction.

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
2. **The shell: tab bar, title row, Week | Month, Today.** It is the cheapest change with the
   largest effect on whether this reads as an app, it retires three controls (month pills, wheel
   picker, chevrons-by-index), and it closes the “October doesn't show” class on both form factors.
   Needs gap 2 for the draft badge.
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

## 13. Open, and deliberately not decided here

Three questions the critique raised that the round-3 brief did not settle. Recorded so they are
decided rather than defaulted.

1. **The committed month has no FAB.** On a draft month the FAB is the mic. On a committed month
   there is no persistent action at all — yet that is the surface where the client's real recurring
   job lives: copying a caption into Instagram, ten times a month. Round 3 puts a copy control on
   the card, which helps, but the question of whether the committed FAB should be *copy the next
   caption* is open.
2. **Peak-end has no end.** There is no post-approval state anywhere in the set. The last emotional
   beat of the product — *the month is written, here is what happens next* — is unrendered, and
   generation takes minutes.
3. **Format still has no control** (§4.1), and `swapFormat` still has no surface.
