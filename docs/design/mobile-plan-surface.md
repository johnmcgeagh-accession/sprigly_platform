# Mobile plan surface — design spec

**Date:** 2026-07-27 · branch `dev` · **spec and mockups only, no production code**
**Mockups:** [`docs/design/mockups/index.html`](mockups/index.html) — open any file directly, no build step.

---

## 0. What this is

The client plan surface — draft and committed — redesigned mobile-first around an
iOS-native, day-focused pattern. The reference interaction model is the operator-supplied
competitor screenshots (Stanley): a small-caps month label, a horizontal week strip with the
selected day as a filled pill, the day's content below as cards, and almost no other chrome.

Three things this redesign removes, and what replaces each:

| Removed | Replaced by |
|---|---|
| The global **“Add to your plan” / “Brief this month”** button under the month header | A per-day add slot, on every editable day, under whatever that day already holds |
| The **oversized month header** (`font-serif text-[30px]` + flanking chevrons) | A small-caps month label that opens the month overview |
| The **draft surface's month pills** (`draft-month-nav`) and the **`MonthWheelPicker`** | One month overview: a dot-density grid whose month-name row is the picker |

The brand system is **locked and applied, not replaced**. Every colour in the mockups is a
token from `app/tailwind.config.ts`; Fraunces carries the display moments (the day numeral, the
day name, sheet and approval headings, one italic swash per screen at most) and Inter carries
everything else. This should read as an iOS app wearing Sprigly's identity — not a website, and
not the competitor's purple.

**Scope note.** Two things visible in `PlanMobile` today are deliberately untouched by this
brief and carried forward as-is: the **Plan / Tasks** segmented control with its checklist view,
and the **voice FAB** and its overlay. Both survive the reskin; neither is re-designed here.

---

## 1. The state machine

### 1.1 The surface decision — unchanged

Which surface a client lands on is already one pure, server-side derivation
(`app/src/lib/surface-state.ts`), and this redesign does not touch it:

```
resolveSurfaceKind({hasSession, committedPostCount, draftBeatCount, planRedesign})
  → 'gated' | 'draft' | 'committed-redesign' | 'committed-legacy'
```

The rule that file states — *new states join the union, they do not become new forks in the
page* — holds here. This redesign **adds no member to `SurfaceKind`**. Everything below is
state *within* `'draft'` and `'committed-redesign'`.

### 1.2 The states inside a surface

```
                       ┌──────────────────────────────────────────┐
   (server decides)    │  SURFACE  = draft | committed            │
                       │  CYCLE    = viewedCycleId                │
                       │  EDITABLE = pre-cutoff (draft)           │
                       │             date-by-date (committed)     │
                       └──────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
          VIEW = day  (default)                     VIEW = month
          ─────────────────────                     ─────────────────
          selectedDay: ISO date                     the dot-density grid
          week strip + day feed                     + the month picker row
                    │                                       │
                    │  tap month label ────────────────────►│
                    │◄───────────────────── tap a day ──────┤
                    │                                       │
                    │                  choose another month ┴──► switchCycle
                    ▼
          OVERLAY ∈ { none, detail, move, add, approve }
                    detail  — the bottom sheet (draft beat | committed post)
                    move    — the date picker sheet
                    add     — add-a-beat / add-a-post sheet
                    approve — the consequence sheet
```

Four pieces of transient state sit alongside, none of them navigational:

| State | Lifetime | Already exists |
|---|---|---|
| `receipt` — the “what changed” / rollup strip | until dismissed, or replaced by the next application; persisted receipts reload | yes (`DraftReceipt`, `loadReceipts`) |
| `changedIds` — the “Just changed” markers | in memory, gone on reload — deliberate | yes |
| `undo` — one slot, not a stack | until the next mutation | yes |
| assumption strip | until dismissed | display-only today; see §5 |

### 1.3 Where every existing surface state lands

**Draft surface** (`DraftPlan` → `DraftPlanView`, currently one standalone vertical list of
every beat in the month):

| Today | Lands in |
|---|---|
| Header: “Draft / Not sent yet” + “We’ve drafted *month* for *client*” | The month label area: `Draft` badge + “Not sent yet”, under the small-caps month |
| `draft-month-nav` month pills | **Retired** → the month overview's picker row |
| “What we assumed” section (display only) | The assumption strip above the day, one row per assumption, each answerable in place |
| “Anything we should know?” textarea + “Tell Sprigly” | The persistent say-something input at the foot of the day feed |
| Receipt panel — single receipt | The “what changed” strip above the day |
| Receipt panel — rollup mode (`receipt.items`) | The same strip in rollup mode. **Unchanged component, unchanged keying** |
| “Add to this month” rescue tap | Unchanged, on the rollup's idea / couldn't-apply lines |
| Per-beat inline `<input type=date>`, `<select>` format, Remove | The detail sheet's rows + the move sheet. Cards become tap-targets, not control panels |
| `+ Add something` (collapsed, bottom of list) | The per-day add slot, pre-filled with that day's date |
| Two-step approval section | The approval card at the foot of the month + the consequence sheet |
| Undo toast (fixed, bottom) | Unchanged |
| Past-cutoff read-only (`editable: false`) | Unchanged: every control disappears, the month stays fully readable |

**Committed surface** (`PlanRoot` → `PlanMobile`):

| Today | Lands in |
|---|---|
| Week strip + `prev-week` / `next-week` steppers | Kept. Steppers become swipe; the month overview covers longer jumps |
| Day sections + scroll-spy (`data-day`, `updateActiveDay`) | **Kept as the core mechanic.** It already *is* the day-focused pattern; this brief reduces its chrome rather than replacing it |
| `add-on-day` dashed button | The add slot (same behaviour, restyled, and now the only add affordance) |
| `brief-month-btn` (“Add to your plan” / “Brief this month”) | **Removed.** Briefing is the say-something input; adding is the per-day slot |
| Month label + `prev-month` / `next-month` + `MonthWheelPicker` | The small-caps label → month overview. The wheel picker is retired |
| `today-btn` | The month overview (today is ringed in the grid) + the week strip's today ring |
| `SwipeCard` swipe → Move | Kept |
| `CardMenu` (⋯ → Edit / Move / Delete) | Folds into the detail sheet, which is where all three already lead |
| Editor sheet (`PostEditor`, 85%) | The committed variant of the detail sheet |
| Move sheet (`CalendarPicker`) | Unchanged |
| `BeatMarker` rows (`structured_brief` beats) | Kept, read-only, under the day's posts |
| “Outside this month” strip | Kept, at the end of the feed |
| Plan / Tasks segmented control, voice FAB | Kept, out of scope |

**One structural consequence worth flagging.** `PlanRoot` renders the draft surface *outside*
the desktop/mobile fork — `DraftPlan` is returned before `desktop === null ? … : PlanDesktop |
PlanMobile` is ever reached. So the draft surface has no responsive fork at all today. This
redesign gives draft and committed the same mobile skeleton, which makes that fork the natural
place for both. Reconciling the two shells is a build decision, not a design one, but it is the
single largest piece of work this design implies.

---

## 2. Day-view density rule

A 390px viewport minus the 20px gutters leaves 350px. A full card is 120–150px tall. Three full
cards therefore push the following day entirely off-screen and quietly turn a day view back into
a list view. The rule:

| Posts / beats on the day | Rendering |
|---|---|
| **0** | The day header (“Nothing planned” / “Nothing drafted”) + one add slot |
| **1–2** | Full cards: format chip, pillar, posting time, title, and either a caption excerpt (committed) or a one-line rationale teaser (draft). Add slot below |
| **3–4** | One grouped list of **compact rows**: posting time · title (single line, ellipsised) · chevron. Add slot below |
| **5+** | The same compact rows, first four shown, then **“＋N more”** which expands in place. The day never scrolls past one thumb-length before the next day starts |

**Compact rows deliberately drop the format chip and the pillar.** They move to the detail
sheet. A row carrying time + chip + pillar + title leaves roughly 150px for the title, which
truncates every real title to uselessness — ivy-t's beats include 200-character input echoes
(rehearsal report, F2). Time and title are the two fields that answer *“what is happening, and
when”*; everything else is a tap away. Mockup 2, frame B, is that case rendered.

**Ordering within a day** is `(scheduled_date, position)` — the order `loadDraftBeats` already
returns. `position` is the tiebreak `reorderWithinDay` writes, and this is the first surface
that would make it visible: the assembler never produces same-date beats, but `addBeat` and
every intake transform can.

**The three-plus case is real, not defensive.** Earl of East's October holds two beats on
1 October; ivy-t's August holds three on 3 August and three on 1 August.

---

## 3. Thin months

A thin month is not an error state and must not be dressed as one. Two distinct causes:

1. **Thin history** — the client has fewer than `DRAFT_MIN_POSTS` (15) posts on record, so the
   assembler switches to a neutral template skeleton and declares it. Template beats carry **no**
   `formatEngagement` and **no** `pillarShare` at all.
2. **A genuinely small month** — full history, low cadence, or a client who dropped most of the
   draft.

Behaviour, in both cases:

- **The day view is invariant to month size.** It shows one day at a time whether the month
  holds two beats or thirty. This is the strongest structural argument for the day-first
  pattern: a two-beat month in a 31-cell calendar grid looks broken; a two-beat month in a day
  view looks like a quiet week, which is what it is.
- **The month overview shows two dots and says so** — “2 beats drafted across November”. No
  ghost cells, no placeholder slots, no encouragement to fill the grid.
- **The rationale names the gap.** The template branch renders *“We don’t have enough of your
  posting history yet, so this is a starting shape rather than a pattern we’ve seen work.”* That
  sentence is the point: a client should know when we are working from a starting shape rather
  than from their numbers.
- **The approval card counts what is there and offers the useful action first.** “We’ve drafted
  two beats. That’s a starting shape, not a full month — tell us what’s coming up and we’ll build
  it out, or approve these two and we’ll write them.” The first button is the say-something
  input, promoted; it is not new machinery.
- **Never pad.** No “we suggest 8 posts a month” nudge, no empty slots pre-drawn on days.
  Padding a thin month is how a surface starts lying about how much evidence is behind it.

Mockup 8, frame C. Note that the thin-history path has **no live instance**: the one thin-data
client (`sprigly`) has zero `ig_posts` and has never been assembled, so that frame illustrates
the rule rather than transcribing a month.

---

## 4. Desktop adaptation

Desktop keeps the fuller calendar and this brief does not replace it: at ≥1080px `PlanDesktop`
renders a month grid, and a month grid is the right tool on a screen that can show one. What
crosses over is everything width-agnostic — the detail sheet (a right-hand panel or a centred
modal rather than a bottom sheet), the “what changed” strip and its rollup mode, the assumption
strip, and the approval card and its consequence sheet — all of which should be built once and
placed differently, not built twice. The day view itself has no desktop counterpart; a desktop
day is a column in the grid. The **one** piece desktop must inherit is the **month picker row**,
because “October doesn’t show” was a desktop report: `PlanDesktop` navigates by prev/next arrows
by index with no visible list of months, which put October two blind taps away and turned a
wrong landing into a missing month. Naming every available month on screen closes that class of
bug on both form factors, and it is the smaller half of the work.

---

## 5. Wiring — every interaction to an API

“Exists” means the endpoint and its behaviour ship today. Nothing in this table is a proposed
endpoint unless the Exists column says **no**.

### 5.1 Navigation

| Interaction | Wiring | Exists |
|---|---|---|
| Tap a day in the week strip | local `selectedDay` + scroll-to-day (`pickDay` / `scrollToDay`) | yes |
| Swipe / step the week | local, clamped to the viewed month (`stepWeek`) | yes |
| Tap the month label → month overview | local view state, no request | yes (new UI, no API) |
| Tap a day in the month grid | local `selectedDay`, view → day | yes |
| Choose another month (picker row or chevrons) | `data.switchCycle(cycleId)` → `GET /api/plan?cycleId=` ; on a draft answer, `GET /api/plan/draft?cycleId=` for beats + pillars + editable + receipts | yes |
| Dot density for the **viewed** month | already-loaded `calendarPosts` (committed) or `draft.beats` (draft) | yes |
| Dot density for a **non-viewed** month | — | **no** (§5.5) |
| “Draft” badge on a month pill | — | **no** (§5.5) |
| Today | `data.todayCycleId` + the landing rule; today ringed in the strip and grid | yes |

### 5.2 Draft month — structural edits (Build B)

All via `POST /api/plan/draft`, which re-derives `clientId` from the session, re-checks the
`status='draft'` and pre-cutoff guards **in the write itself**, and returns the authoritative
beat list. Nothing in this route can write `status` — approval is a separate door.

| Interaction | Body | Exists |
|---|---|---|
| Change a beat's date (detail sheet, or move sheet) | `{op:'move', postId, date}` | yes |
| Swap a beat's format | `{op:'format', postId, format}` — vocab-checked | yes |
| Remove a beat | `{op:'drop', postId}` → returns `dropped` (the whole beat) | yes |
| Undo a removal | `{op:'restore', beat}` — the verbatim beat, not a husk | yes |
| Reorder within a day | `{op:'reorder', date, postIds}` | yes — implemented, unused by any surface today |
| Per-day add slot | `{op:'add', date, format, pillar}` — pillar checked against the client's configured vocabulary; the slot is hidden when `pillars` is empty | yes |
| Read-only past cutoff | `editable` from `GET /api/plan/draft` (`cycleIsPreCutoff`) | yes |

Refusals map to distinct statuses the surface must distinguish: `not_found` 404,
`not_a_draft` 409, `cutoff_passed` 409, `read_only_date` 422, `invalid_format` 422,
`invalid_pillar` 422.

### 5.3 Draft month — reshape, receipts and approval

| Interaction | Wiring | Exists |
|---|---|---|
| Say something (the input at the foot of the day) | `POST /api/plan/draft/apply {op:'text', text}` → `{application, beats}` | yes |
| Answer an assumption in place | the same call; the answer is ordinary text | yes |
| Paste a brief | the same call. `isDocumentShaped` routes it to the decomposer automatically — 2+ line breaks, 240+ chars, or 4+ date signals | yes |
| “What changed” strip | the returned `DraftApplication`: `sourceText`, `lines[]`, `changedIds[]`, `note?`, `deferredCount?` | yes |
| Rollup strip (“We found N things”) | the same record with `items: BriefItem[]` and `segmentCount` | yes |
| “Just changed” markers | `changedIds`, in memory | yes |
| Receipts surviving a reload | `GET /api/plan/draft/apply` → `{receipts}`, also folded into the draft surface context. Capped at `MAX_RECEIPTS` (10) on `intake_json.draftApplications` | yes |
| “Add to this month” on a rollup idea | `POST /api/plan/draft/apply {op:'add_to_month', planInputId, date}` | yes — **but** it returns a single receipt that replaces the rollup in the panel (known, §5.5) |
| Dismiss a strip | local | yes |
| Approve | `POST /api/plan/draft/approve` — no body, no options, no partial approval → `{approved, captionsQueued, hooksQueued, failed}` | yes |
| The approval tally (10 / 3 / 1) | computed client-side: captions per beat, hooks per reel+carousel, scripts per reel | yes |
| Post-approval landing | navigate to `/?cycle=<cycleId>` — explicit intent outranks the date heuristic | yes |
| Double-approve | rejected (`already_approved` 409), not a quiet no-op — approval spends money | yes |

### 5.4 Committed month

| Interaction | Wiring | Exists |
|---|---|---|
| Open the detail sheet | already-loaded `PlanPost` (`caption`, `hook`, `script`, `scriptLengthSeconds`, `status`, `steps`) | yes |
| Move a post | `PATCH /api/posts/:id {date}` (`data.reschedule`) — gated by `isEditableDate` | yes |
| Change format | `PATCH /api/posts/:id {format}` (`data.changeFormat`) | yes |
| Edit the caption | `PATCH /api/posts/:id {caption}` + autosave | yes |
| Delete a post | `DELETE /api/posts/:id` (soft) | yes |
| Per-day add slot | `POST /api/posts {date, cycleId}` — refuses past dates (`canAddPost`) | yes |
| “Write it again” (per-post regenerate) | `POST /api/plan/shape {targetPostId, instruction}` → `{mode:'pending', jobId}` | yes — **metered**; can return `mode:'blocked'` with a usage message the sheet has nowhere to put (§5.5) |
| Retry a `generation_failed` post | `data.retryShape` over the preserved `pendingInstruction` | yes |
| Hooks / scripts | `POST /api/plan/hooks`, `POST /api/plan/script` | yes |
| Generation in flight | `status: 'generating'` on the post; `'generation_failed'` on failure with the instruction preserved | yes |

### 5.5 Shown in the mockups, **not** available from any API today

Six items. Each is small; none is speculative.

| # | Shown | What is missing | Nearest existing thing |
|---|---|---|---|
| 1 | **Posting time on a card** (“6:00”, “19:00”) | `PlanPost` has no time field and `toPlanPost` does not read one | The value exists in two places: `source_meta.postingTime` on posts written by the planning path, and `client_planning_config.posting_times` (a named-slot map: launch / morning / evening / wsg / sundayStyle). Neither is surfaced. The mockups use the `PostingTimes` contract's own documented example values |
| 2 | **A “Draft” badge on a month pill** | `CycleSummary` carries no draft flag | `loadCycleList` already calls `cyclesWithReviewableDraft()` — it uses exactly this fact to decide whether a draft-only cycle qualifies for the menu. One boolean needs to reach the client |
| 3 | **Dot density for a month you have not opened** | No per-month, per-day count read | `GET /api/plan` serves the viewed cycle's posts; `GET /api/plan/draft` serves one cycle's beats. Either add a counts endpoint, or accept that only the viewed month is dotted and paint the others on switch |
| 4 | **A rationale on a `client_input` beat** | `rationaleFor()` switches on `client_added`, `emphasis_reweight`, `template` and `observed` — there is no `client_input` branch, so it falls through to `''` | Every beat a launch, event, series or beat_spec transform creates carries `{basis:'client_input', reason: sourceText}`. Today those beats — the ones that came from the client's own words — show **no reason at all**, while a beat the client added by hand says “You added this one.” The evidence is already stored; only the sentence is missing |
| 5 | **Assumptions that stay answered** | Nothing records that an assumption was answered or dismissed | The answer itself routes fine (§5.3), but the assumption list is recomputed from the beats' `assumptions[]` on every load, so an answered prompt reappears |
| 6 | **“Say it again and we’ll undo this one”** | Undo is one in-memory slot over a single structural mutation. There is no inverse of an *applied intent* | The copy in mockup 6 shows the shape of the promise for review. Either build the inverse, or change the copy — it must not ship as written |

Two further constraints the design has to respect, both already true:

- **The metered rewrite.** `POST /api/plan/shape` enforces a monthly AI-change limit and can
  return `mode:'blocked'` with a summary. The committed detail sheet needs somewhere to render
  that; the mockup does not show it.
- **Approval is not instant.** Nine of ten posts came back in the dogfood run and one hit a
  180-second Bedrock timeout with `attempts: 1` behind it. The month after approval is a month
  with posts in `generating` and possibly one in `generation_failed`. Mockups 1 and 3 render that
  honestly (a square danger marker in the grid — a different shape, not just a different colour,
  from a draft dot — and a “Needs a retry” card) rather than assuming a clean finish.

---

## 6. Brand application

| Element | Token / rule |
|---|---|
| Canvas | `#F2F3F5` |
| Cards, sheets, chips-on-white | `#FFFFFF` |
| Hairlines | `--line` `#8F9296` at 30% alpha; 55% where a border is meant to be noticed (dashed draft borders) |
| Primary text | brand slate `#334155`; secondary `#5C6470` (5.98:1 on white) |
| Selected day pill, filled buttons, dots, focus rings | coral-600 `#E8705F` |
| Pressed / strong interactive | coral-700 `#C4523F` |
| Tint fills (chips, badges, the “what changed” strip) | coral-100 `#FADDD6` |
| **Coral text** | coral-800 `#8A3323`, **only on coral-100** (4.70:1). Coral is never used for small text on white — that rule was written after burnt-orange small text read as rust |
| **White on coral-600** | only at 14px+ / 500 weight. In the mockups: the 16px/600 day numeral and 15px/700 buttons |
| Display type | Fraunces — the day numeral, the day name, sheet and approval headings. One italic swash (`.fraunces-soft`, `"SOFT" 100`) per screen at most |
| UI and body type | Inter, everywhere else |
| Draft / provisional | dashed borders + coral accents. A draft that looks finished invites approval by default |
| Dark furniture | `--chrome-deep` `#1E293B` — the undo toast and the sheet scrim only |

Touch targets are ≥40px throughout; the primary actions are 48–50px.

---

## 7. Data provenance

Every figure in the mockups is a reported one. Nothing was invented to make a screen look full.

| Content | Source |
|---|---|
| Earl of East's October beats, dates, formats, pillars, caption lengths, statuses | `docs/reports/build-d-approval-phase2.md` §1 — the dogfood run, 0/10 structure drift |
| The generated reel's caption, hook and script (verbatim, including the corrupted `#ritualovertoutine`) | same report |
| Engagement: carousels 69.9 over n=8, single posts 38.2 over n=23, pillar share 0.2 on the `equal` basis, cadence 2.24 posts/week over 4 months, 31 posts of history | `docs/reports/build-a-draft-assembly.md` §10, cross-validated against the Phase 0 SQL |
| The two month assumptions, and the question form of each | Build A §10 + `draft-rationale.ts` `assumptionPrompt()` |
| The Wilderness intake sentence and its live classification | Build D §1 |
| ivy-t: 21 draft beats / 0 committed, the 3 August titles (clipping included), the launch-arc receipt's Added/Replaced lines, the operator hand-move | `docs/reports/ivy-t-rehearsal-failures.md` |
| ivy-t's seven configured pillars | `docs/calibration/ivy-t-2026-07/DIFF-SUMMARY.md` |
| Sally's 14-segment brief, its kinds and outcomes | `docs/reports/brief-decomposer.md` §COMMIT 4 |
| The experiment badge beat (“A room that breathes”) | Build B §4's own rendered draft |
| Posting times | the `PostingTimes` contract's documented example values (`packages/engine/src/types.ts`) — **not** a stored client config |

Five things are **reconstructions**, labelled as such on the pages that show them:

1. Two October titles the reports elide are shown in the assembler's deterministic fallback form
   (`Pillar — Format`) rather than invented.
2. The Wilderness application's receipt `lines[]` are not recorded anywhere, so mockup 6 shows
   only the one delta that *is* established — the 1 October launch beat — and no “replaced” line.
3. The rollup's per-item diff lines are phrased from the fixture's recorded beat counts and
   dates; the rendered strings are not stored.
4. The `client_input` rationale sentence is the intended copy, not what ships (§5.5 #4).
5. The thin-month frame illustrates the template path; no live client has a recorded thin draft.

One discrepancy worth naming: the design brief says “We found 13 things”; the failure report
describes ~13 distinct intents and the decomposer's own acceptance fixture splits Sally's brief
into **14** segments. The surface renders `receipt.segmentCount`, so the mockup says 14.

---

## 8. Build order, if this proceeds

Not a commitment — the shape of the work, so the sequencing is reviewable alongside the design.

1. **The month overview.** Highest value per unit of work: it closes the “October doesn't show”
   class on both form factors, retires two controls, and needs one new field (§5.5 #2) plus a
   decision on §5.5 #3.
2. **The day view reskin, committed.** `PlanMobile` keeps its mechanics; the chrome shrinks, the
   global add button goes, the density rule lands.
3. **The detail sheet, both variants.** `PostEditor` becomes the committed variant; the draft
   variant is new but wires only to endpoints that exist.
4. **The draft surface onto the same skeleton.** The largest piece — it reconciles `DraftPlan`
   with `PlanRoot`'s fork — and the point at which the assumption strip, the say-something input
   and the approval card take their new positions.
5. **The six gaps in §5.5**, of which #4 (a `client_input` rationale) is the cheapest and the one
   with the most direct effect on whether a client trusts the month.
