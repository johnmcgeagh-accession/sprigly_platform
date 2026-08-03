# Desktop plan surface — design spec

**Date:** 2026-08-03 · branch `dev` · **docs only**
**Direction:** translation from the phone, with two deliberate exceptions.
**Design context:** [`PRODUCT.md`](../../PRODUCT.md) · [`DESIGN.md`](../../DESIGN.md) ·
[`mobile-plan-surface.md`](mobile-plan-surface.md) (binding unless this file overrides it) ·
[`round-3-notes.md`](round-3-notes.md) · [`round-5-1-notes.md`](round-5-1-notes.md)
**Mockups:** [`docs/design/desktop-mockups/index.html`](desktop-mockups/index.html) — nine files,
fifteen frames, no build step.

---

## 0. What this is, and what it is not

Desktop today is the **pre-redesign layout wearing the new identity**. `PlanDesktop` inherited the
tokens, the mint ramp, the terminology and the grounded beats; it did not inherit the information
architecture the phone spent six rounds arriving at. It still carries a global *“Add to your
plan”* button, a right-hand dark rail, a Timeline, a Notes view, an Approvals queue, a
`Talk to your plan` FAB that opens a centred one-shot dialog, and a month grid whose cells hold
post chips. This session designs its adaptation.

**It is a rendering brief.** §11 states the full list of what does not change; the short version
is *everything*: the data model, the assembler, the generation path, the cycle model, the agent's
behaviour, the routes and their guards. One thing on any screen in this set is not served by an
API, it needs none, and it is named in §5.3.

**The direction is translation.** Every hard decision was made and reviewed on the phone across
six rounds, and re-opening any of them here would mean the surface disagrees with itself by form
factor. This spec carries the vocabulary, the tokens, the mint ramp, the native type stack, the
grounded beats and their evidence lines, the month summary and its CTA, the draft/committed
distinction and the provisional skin, unchanged. Where it departs, it says so and says why.

---

## 1. The two exceptions

### E1 — the conversation is persistent, not summoned

On the phone the agent lives in a sheet you open. It has to: 390px cannot hold a month and a
conversation at once, so the conversation covers the month, and the client speaks, watches the
sheet close, and then goes looking for what moved.

**On desktop the conversation is a region of the shell.** A 344px dock on the right edge, present
on every state in this set, carrying the same thread model, the same interpretation-consent turns,
the same composer with its Speak control, the same routes.

Three consequences, all of them the point:

1. **The thread is the month's record, and it is always readable.** One conversation per cycle
   already persists (`conversations` + `agent_messages`, resolved by cycle); on the phone you have
   to open a sheet to see it. Here it is simply there, and an interpretation turn raised on a
   previous visit is visible without anyone remembering it exists.
2. **Approvals dies as a rail item.** A proposal is approved on the turn that raised it. That
   closes the gap `mobile-plan-surface.md` §8.2a left open — *“a client can raise a change on a
   phone and cannot act on it there”* — from the other end: the approve/apply surface stops being
   a desktop-only view and becomes a property of the conversation on both form factors. The dock's
   head carries a **“2 waiting”** count when `proposals.length > 0`.
3. **There is no FAB.** `Talk to your plan` was a button that opened a dialog that could not see
   the plan. It is now the heading of a panel that never closes.

**What it costs.** 344px of every screen, permanently, on a surface whose main object is a
calendar. §2 spends that from the month grid rather than from the day column, and §8 is the frame
that shows what the 344px buys.

### E2 — month and day are side by side

The phone's `Day · Month · Tasks` switcher exists because a phone shows one thing at a time. Round
6's **P6** already pushed against it as far as a phone allows: tapping a day in the month grid
*stays* on the grid and shows a brief summary beneath it, one compact row per post.

**On desktop that summary becomes a column.** The month grid and the selected day's posts are on
screen together, and `Day` and `Month` stop being destinations.

So the rail navigates what is left:

| Rail item | What it is | State |
|---|---|---|
| **Plan** | the month grid, the day column, and everything they open | default |
| **Tasks** | the checklist, carried forward (`planTasks`, `TaskRow`, the Completed section) | — |
| ~~Insights~~ | **not drawn.** The phone's ruling holds on both form factors: a control that does nothing is worse than an absent one. A vertical rail takes a third item with no layout change, which is the whole reason it is safe not to draw a placeholder | gap 12 |

**Removed with nothing lost, and each removal has a successor:**

| Removed from `PlanDesktop` | What absorbs it |
|---|---|
| **Timeline** | The month grid answers *where things are*; the day column answers *what they are*. A date-ordered list of the same posts is a third account of one month |
| **Notes** | The conversation thread is the record of what the client has said, and the month summary's **FROM YOU** section counts the ideas that reached the plan. Both are on screen; a separate view is not |
| **Approvals** | The interpretation turn, inline in the dock (E1) |
| **`brief-month-btn`** (“Add to your plan” / “Brief this month”) | Adding is the per-day slot; briefing is the conversation. It is also the surface's one real accessibility defect — see §9, cluster C |
| **The right-hand dark rail** | A left rail on `surface`. See §2 |
| **The agent FAB and its centred dialog** | The dock |

---

## 2. The layout grid

### 2.1 The columns, and the arithmetic

```
┌─────────┬──────────────────────────────┬───────────────┬──────────────────┐
│  RAIL   │  MONTH                       │  DAY / DETAIL │  CONVERSATION    │
│  196    │  512                         │  320          │  344             │
│         │                              │               │                  │
│ Sprigly │  ‹ October 2026 ›   Today    │               │ Talk to your plan│
│ client  │  ┌────────────────────────┐  │ Thursday 1 Oct│ ────────────────  │
│ · month │  │ M T W T F S S          │  │ 2 posts       │  agent turn       │
│         │  │ ruled calendar,        │  │  ┌─────────┐  │  client bubble    │
│ ▣ Plan  │  │ numeral + density pips │  │  │ card    │  │  interpretation   │
│ ☑ Tasks │  │                        │  │  └─────────┘  │   [Discard][Apply]│
│         │  └────────────────────────┘  │  + add slot   │ ────────────────  │
│ foot    │  10 posts across October     │               │ [composer][mic]   │
└─────────┴──────────────────────────────┴───────────────┴──────────────────┘
   196   24            512            20        320       24        344       = 1440
```

`196 + 24 + 512 + 20 + 320 + 24 + 344 = 1440`, and the numbers live in one place
(`sprigly-desktop.css` `:root`) so the spec and the mockups cannot drift.

**Why the day column is 320 and not wider.** It is the phone's own content measure (390 minus its
20px gutters is 350; the desktop column's 320 with 2px of edge gives a card the same ~290px of
text). Every card, every grounding line, every caption in this set was designed and screenshot-
tested against that measure. Widening it would be redesigning the components the brief said to
translate.

**Why the month column is 512 and not more.** 512 gives seven 69px cells. That is enough for a day
numeral and up to three 5px pips and not enough for a post chip — which is the correct answer, not
a compromise: at 69px a chip holds about six characters of title, and the incumbent desktop's
148px-tall cells with chips exist because that surface has no day column to send you to.

### 2.2 The field hierarchy — white, grey, white

`rail: surface` · `plan region: canvas` · `dock: surface`. The working area is the grey one,
flanked by two quiet white edges, and the cards inside it are `surface` — which is exactly the
card-on-canvas relationship the phone already has.

**The pre-redesign dark rail is not inherited, and this is the one visual departure in the set.**
`PlanDesktop`'s rail is `chrome`. A dark rail opposite a white conversation dock puts the two
loudest values at the two outside edges and leaves the month — the thing the client came for — as
the quietest region on the screen. One light field across the whole surface also means the accent
means the same thing everywhere it appears, which is most of what makes the phone read as one
system.

### 2.3 The month grid

One object, not thirty-five: a `surface` card with a hairline rule between cells, radius 20,
filling the column's height. The grammar inside it is the phone's, unchanged:

| Mark | Meaning |
|---|---|
| 5px `chrome` dot | a committed post |
| 5px `accent-600` dot | a planned post on a draft month |
| 5px **ring** in `chrome` | a post still being written — a different *shape*, so it survives greyscale |
| extra `accent-600` dot | changed since the last visit (`GET /api/plan/changes` + the per-cycle visit stamp) |
| `accent-650` filled numeral, white | the selected day |
| `accent-600` 2px ring on the numeral | today |
| `accent-600` 2px inset + tint on the **cell** | a day named by an open interpretation turn (§5.3) |

Clicking a cell sets `selectedDay` and re-renders the day column. Nothing is fetched: the month's
posts are already loaded for the grid that was just drawn.

### 2.4 The detail panel takes the day column's slot — the E1/E2 collision, resolved

The detail panel and the conversation both want the right edge. **They do not share it.** The
detail panel is a drill-down of the *day*, so it occupies the day column's box at the day column's
width; the dock is untouched. Nothing reflows when a post opens, and the way back is a header row
that names the day rather than saying “Back”.

The three alternatives the brief named, and why each fails:

| Option | Why not |
|---|---|
| **Tabs** — Detail \| Conversation on one dock | Opening a post would *close* the conversation. A region that disappears when you use the surface is not persistent, which is the whole of E1 |
| **Stacking** — detail above conversation | It halves the thread to about 300px, which is less than one interpretation turn with three lines and its Apply row, and it moves the composer every time a post opens. A composer that jumps is a composer people stop typing in |
| **Detail over conversation** | It hides the thread at exactly the moment a client is most likely to say *“change this one”* |

**The deciding case is §8.** The reshape moment needs the month, the turn and the change visible
together. Only this arrangement can draw it.

**What it costs, stated rather than discovered later.** The day's other posts are not visible while
one is open — which is exactly what happens on the phone, where a sheet covers the day. And the
caption measure in the panel is ~290px, so a long caption is a tall narrow column. That is the
shape the caption was written and reviewed in.

### 2.5 Breakpoints

| Width | Shell |
|---|---|
| **< 1080px** | **The mobile shell**, unchanged. `PlanShell` / `DraftSurface` / `CommittedSurface` |
| **1080–1279px** | Desktop shell, **plan region stacked** — month grid above, day column (or detail panel) below, scrolling together. Rail collapsed to 68px icons; dock 320px |
| **≥ 1280px** | Desktop shell, **month and day side by side**. Rail 196px with labels; dock 344px |

**The 1080 fork is not moved.** `PlanRoot.tsx` already forks on
`matchMedia('(min-width: 1080px)')`, both e2e projects are pinned either side of it (1440 and
390), and the mobile shell is a reviewed design tested at 375 and 320. A tablet in portrait gets
the phone surface, which is a real design, rather than a squeezed desktop nobody has looked at.
Moving that boundary would be a new breakpoint with no tests and no reviewed frames.

**The dock does not collapse in the middle band, and that is the rule this breakpoint exists to
protect.** The obvious saving — a rail tab that expands the conversation over the plan — puts the
sentence and its consequence back on separate screens, which is the phone's compromise and not a
narrower desktop's. What gives way instead is the *side-by-side*ness of month and day, which is
E2, and E2 degrades gracefully: stacked, the grid gets **more** room per cell (84px at 1024
against 69px at 1440), not less.

The rail's collapse is also a manual control at every width — the existing `rail-toggle`, carried
forward. Above 1280 it is the client's choice; below it, it is the default.

---

## 3. What each region carries

### 3.1 The rail

Wordmark and mark · client name and the month's post count · **Plan** · **Tasks** (with the late
count) · a foot line stating the session's own terms (*“Opened from your link, no password needed.
Edit from today on; past dates are locked.”*). Collapsed it is icons only, and the late count
becomes a dot — the incumbent rail's own carried-forward behaviour.

The selected item is `accent-650` with white ink, which is the same recorded 3.40:1 deviation
DESIGN.md scopes to eight controls. **This adds a ninth**, and it must be added to DESIGN.md's
mapping table and to the axe ignore's enumeration by name, not by pattern. See §10.

### 3.2 The plan header

`‹ Month Year ›`, the `Draft` badge on a draft month, `Today`, and `Generate` on a draft month.

**The `Draft` badge sits on the month title.** Provisional is a fact about the month, and on this
form factor the month has a title row of its own. The phone's second line — *“This is your
September draft”* — is not repeated: the summary panel's opening sentence says the same thing
eight pixels away and says it better.

The month control and its arrows are the **one** thing `mobile-plan-surface.md` §10 said desktop
must inherit, and the reason is a desktop bug report: `PlanDesktop` navigates by prev/next index
with no visible month name, which put October two blind clicks away. This closes it.

### 3.3 The month summary, under the grid

On the phone the panel heads the **day**, because a phone shows one thing at a time and the day is
that thing. Here the grid is the month, so the panel that explains the month sits with it. Nothing
in its derivation changes: the same `monthSummary`, the same counts rather than percentages, the
same sections built only where there is evidence, the same two prompt rows in the same order.

Two changes, both of them about the form factor:

1. **The closed panel says “See why these posts are here”**, where the phone says *“Tap to see
   …”*. There is no tap here, and a verb the client cannot perform is the kind of small dishonesty
   this surface has spent five rounds removing.
2. **“Not right? Tell us what to change” focuses the composer** instead of opening a sheet. Same
   route, same consequence, one fewer thing appearing on screen. The assumption prompt row above it
   does the same, seeding the composer with the question exactly as `setVoiceFor(question)` does
   today.

**On a thin month the panel opens by default.** See §8.

### 3.4 The day column

The phone's density rule is unchanged and applies at the same measure: 0 → an add slot; 1–2 → full
cards; 3–4 → compact rows (time · title · chevron); 5+ → rows with “＋N more”. The day header
**stacks** rather than sitting on one row — *“Wednesday 2 September”* at 22px is 245px of a 316px
measure, and a count beside it wraps the day's own name.

### 3.5 The conversation dock

| | |
|---|---|
| **Head** | the framing title, a one-line consequence that differs by month state, and a *“N waiting”* count when proposals are open |
| **Thread** | agent turns (mark, `accent-100` field, `accent-700` left edge), client bubbles right on `line-soft`, interpretation turns with Apply / Discard and a per-item × |
| **Composer** | a full-width text panel with the controls beneath it: a labelled **Speak** pill and a send control. No meter — the operator ruling that removed it (a live waveform was a third thing to look at and a second audio consumer to referee) holds here |

The consequence line is the one thing that must differ, and it is the shipped distinction:

| | Draft | Committed |
|---|---|---|
| **Head** | *Tell us about September* | *Talk to your plan* |
| **Consequence** | “Anything you say reshapes the month straight away, and I'll show you what changed.” | “October is written. Nothing moves until you say so.” |
| **Submit** | `POST /api/plan/draft/apply` — reshapes, returns a receipt | `POST /api/plan/agent` — raises proposals, **applies nothing** |

A thread grows from the composer upwards, the way every chat does, so a one-turn conversation sits
just above the field rather than at the ceiling of a 650px panel.

---

## 4. The states, and where to see them

| # | State | File |
|---|---|---|
| 1 | Committed month — the shell at rest | [`01-committed.html`](desktop-mockups/01-committed.html) |
| 2 | Draft month — provisional skin, summary closed / open / scrolled | [`02-draft.html`](desktop-mockups/02-draft.html) |
| 3 | Detail panel, committed post — tabs, copy, insights, actions, Shape | [`03-detail-committed.html`](desktop-mockups/03-detail-committed.html) |
| 4 | Detail panel, planned post — grounding, format, move/delete | [`04-detail-draft.html`](desktop-mockups/04-detail-draft.html) |
| 5 | The reshape moment — the turn open, then applied | [`05-reshape.html`](desktop-mockups/05-reshape.html) |
| 6 | Approval — a centred modal | [`06-approval.html`](desktop-mockups/06-approval.html) |
| 7 | Tasks | [`07-tasks.html`](desktop-mockups/07-tasks.html) |
| 8 | Thin month — two posts at 1440 | [`08-thin-month.html`](desktop-mockups/08-thin-month.html) |
| 9 | Narrow desktop — 1024, both layout-sensitive states | [`09-narrow.html`](desktop-mockups/09-narrow.html) |

---

## 5. Wiring — every interaction to an API

“Exists” means the endpoint and its behaviour ship today. Nothing here is a proposed endpoint
unless the Exists column says **no**.

### 5.1 Shell and navigation

| Interaction | Wiring | Exists |
|---|---|---|
| Rail → Plan / Tasks | local view state, no request. Tasks renders `planTasks` over posts already in memory | yes (new UI, no API) |
| Rail collapse | local | yes — `rail-toggle` on `PlanDesktop` |
| Rail → Insights | — | **no** (gap 12). Not drawn |
| `‹ ›` month arrows | `data.switchCycle(cycleId)` over the sorted cycle list → `GET /api/plan?cycleId=`; on a draft answer, `GET /api/plan/draft?cycleId=` for planned posts, pillars, `editable` and receipts | yes |
| Today | `data.todayCycleId` + the landing rule | yes |
| `Draft` badge on the **viewed** month | `surfaceKind` from the server | yes |
| A draft marker on a month you have **not** opened | `CycleSummary` carries no draft flag | **no** (gaps 2 / 10) |
| Click a day in the grid | local `selectedDay`. **No fetch** — the month's posts are already loaded | yes |
| Dot density, viewed month | `calendarPosts` / `draft.beats` | yes |
| Dot density, a month not yet opened | — | **no** (gap 3). Honest fallback: paint on arrival, the arrow already triggers a fetch |
| “Recently changed” dot | `GET /api/plan/changes` (`plan-changes.ts`) + the per-cycle `localStorage` visit stamp | yes |

### 5.2 The day column and the detail panel

| Interaction | Wiring | Exists |
|---|---|---|
| Open the detail panel | already-loaded `PlanPost` (`caption`, `hook`, `script`, `status`, `steps`) or `DraftBeatView` | yes |
| Back to the day | local | yes |
| Caption / Hook / Script tabs | the same object; an empty tab explains and offers to write it | yes |
| Copy | `navigator.clipboard.writeText` — no API, which is the point | yes |
| Insights (committed) | `rationaleFor` over `rationaleEvidence` | yes |
| Grounding lines (draft) | `groundingLines(evidence, pillar)` — one fact per line, absence produces no line | yes |
| A post's Tasks section | `PATCH /api/posts/:id/steps/:stepId` | yes |
| Move (date), committed | `PATCH /api/posts/:id {date}`, gated by `isEditableDate` | yes |
| Move (date), across months | the same call — the route gates on date, not on month | yes, **with consequences**: the surface still never says where the post went (gap 11) |
| Move (date), draft | `POST /api/plan/draft {op:'move', postId, date}` | yes |
| Move (time), either | — | **no** (gap 1, read *and* write) |
| Posting time shown on a card | `source_meta.postingTime` / `client_planning_config.posting_times` — neither is surfaced | **no** (gap 1) |
| Shape | `POST /api/plan/shape {targetPostId, instruction}` → `{mode:'pending', jobId}` | yes |
| The rewrite meter's refusal | the same route returns `mode:'blocked'` with a summary | yes — **but nothing renders it** (gap 9). It belongs under the Shape field |
| Format, committed | `PATCH /api/posts/:id {format}` + `regenerateChecklist` offered, never silent | yes |
| Format, draft | `POST /api/plan/draft {op:'format', postId, format}` | yes |
| Write the hook / script | `POST /api/plan/hooks`, `POST /api/plan/script` — absent where the endpoint would refuse | yes |
| Delete, committed | `DELETE /api/posts/:id` (soft) | yes |
| Delete, draft | `{op:'drop', postId}` → `dropped`; undo is `{op:'restore', beat}` | yes |
| Per-day add slot | draft: `{op:'add', date, format, pillar}`; committed: `POST /api/posts {date, cycleId}` then the instructed-generation path | yes |
| A post still being written | `status: 'generating'` / the client-facing *on its way* marker | yes — **and gap 7 is still its prerequisite** |

### 5.3 The conversation dock

| Interaction | Wiring | Exists |
|---|---|---|
| The thread on load | `GET /api/plan/conversation?cycleId=` → `listTurns`, ownership enforced by the join | yes |
| Send, committed | `POST /api/plan/agent {instruction, source, sessionId?, conversationId?}` → `runPlanAgentTurn` → `{conversationId, message, proposals[], changeSetId}` | yes |
| Send, draft | `POST /api/plan/draft/apply {op:'text', text, source}` → `applyTextToDraft` → the receipt's lines as an agent turn | yes |
| Speak | `useSpeechInput.ts` (Web Speech, browser-side, interims on) | yes |
| Marking input as voice-sourced | `source: 'web' \| 'voice'` on both routes | yes |
| Apply an interpretation turn | the existing `agent_proposals` approve/apply path | yes |
| Discard | reject, all items | yes |
| Per-item × | reject one proposal — cheap, because a change *is* a proposal row | yes |
| A paste | the same call; `isDocumentShaped` routes it to the decomposer automatically | yes |
| “N waiting” in the dock head | `data.proposals.length` | yes |
| **Ringed cells for an open turn's days** | **no API, and none needed** — a client-side read of the open turn's own `items[].date`, the same object the lines are built from | **new UI only** |

### 5.4 The month summary and approval

| Interaction | Wiring | Exists |
|---|---|---|
| Open / close the summary | local | yes |
| Every line in it | `monthSummary(beats)` over `rationaleEvidence`. No model call on this path | yes |
| The assumption prompt row | `setVoiceFor(question)` → the composer, then the ordinary text apply | yes |
| “Not right? Tell us what to change” | focuses the composer. Local; the submit is the same route | yes |
| `Generate` pill | local; opens the modal. Rendered only when the surface is `draft` and `editable` | yes |
| The three counts | `approvalCounts` / `approvalRows` over `draft.beats` already in memory | yes |
| Yes, write them | `POST /api/plan/draft/approve` — no body, no options, no partial approval | yes |
| Double-approve | rejected (`already_approved` 409), not a quiet no-op | yes |
| Post-approval landing | navigate to `/?cycle=<cycleId>` | yes — and **peak-end still has no end** (open question 2, unchanged) |

### 5.5 Everything shown that no API serves

Ten items. Eight are the phone's own open gaps, unchanged and inherited; one is new to this
surface; one needs no API at all.

| # | Shown | What is missing | New here? |
|---|---|---|---|
| 1 | **Posting time** on cards and in the panel header | `PlanPost` has no time field; nothing writes one. The value exists in `source_meta.postingTime` and `client_planning_config.posting_times` | no — gap 1 |
| 2 | **A draft marker on a month you have not opened** | `CycleSummary` carries no draft flag, though `loadCycleList` already computes the fact | no — gaps 2 / 10 |
| 3 | **Dot density for a month not yet opened** | no per-month, per-day count read | no — gap 3 |
| 4 | **The Insights rail item** | nothing behind it. Deliberately not drawn | no — gap 12 |
| 5 | **The rewrite meter's refusal** | the route returns `mode:'blocked'`; nothing renders it | no — gap 9 |
| 6 | **“Where did it go?” after a cross-month move** | no confirmation naming the destination month. Copy and a toast, no API | no — gap 11 |
| 7 | **“Undo this” on an applied intent** | there is no inverse of an applied intent | no — gap 6 |
| 8 | **An assumption that stays answered** | nothing records that an assumption was answered | no — gap 5 |
| 9 | **“On its way” without a retry** | a failed-generation sweep and an operator surface. `generation_failed` is explicitly terminal and appears nowhere in `admin/src` | no — **gap 7, still blocking** |
| 10 | **The ringed cells on an open turn** | nothing. It is a pure client-side derivation from data already on screen | **yes — and it needs no API** |

Nothing in this set proposes an endpoint.

---

## 6. The operator and the client

**John reviews here. Sally may never open it.** The magic link lands on a phone, the review happens
standing up between other things, and the desktop surface is mostly where the operator reads a
month before it goes out — plus the minority of clients who open the link on a laptop.

That has one design consequence and one non-consequence.

**The consequence: desktop's job is the whole month at once.** The phone's job is one day at a
time, and the phone is right to be that. Desktop is where someone asks *is this month right?* —
which is why the grid is a density map rather than a list, why the month summary sits with the
month rather than with the day, and why the reshape frame puts the sentence beside its
consequence. If a control ever has to be dropped for space, drop it here last: this is the surface
on which the month is judged.

**The non-consequence: nothing on this surface is operator-only.** It is the same code path, the
same session, the same magic link; any client who opens the link on a laptop sees exactly this.
Adding an operator-only region would mean the client surface has a part that is never reviewed by
the person it is for — and the admin surface already exists for everything that genuinely belongs
to the operator:

| Operator-facing | Where it lives, and stays |
|---|---|
| `generation_failed`, retries, stuck jobs | admin. The client sees *on its way*, and gap 7 is what makes that honest |
| Cost, model calls, the AI-change ledger | admin |
| The real cycle status and the cutoff machinery | admin |
| Theme activation and its contrast gate | admin → Themes |

**One carried-forward exception, and it is already operator-armed:** the `?nav=trace` and
`?mic=trace` instrument panels render nothing unless the operator arms them for that tab. They are
unchanged and they stay.

---

## 7. Terminology and copy — what changed, and it is two things

The terminology table (`mobile-plan-surface.md` §7) is binding and unchanged. The word **beat**
appears nowhere client-facing; a draft item is a **planned post**; `generation_failed` is **on its
way**; `cycle` is **month**; approval is **Generate** on the pill and **Ready to go?** in the
modal; `POST /api/plan/shape` is **Shape**.

Two strings change, both because a phone verb does not survive the crossing:

| Phone | Desktop | Why |
|---|---|---|
| “Tap to see why these posts are here” | **“See why these posts are here”** | There is no tap. A verb the client cannot perform is a small lie on a surface built to be checkable |
| “Tap one to use it. It saves straight away” (hook candidates) | **“Pick one to use it. It saves straight away”** | Same |

**One line is adapted rather than copied.** The thin-month acknowledgement (§9.2) is written in the
first person plural — *“Two posts so far. Tell us what's coming up and we'll build it out…”* — and
on desktop it is the agent's opening turn, where the register is first person singular. It reads
*“Two posts so far. Tell me what's coming up and I'll build it out — or say you're ready and I'll
write these two.”* The claim is identical; the person matches the speaker. **This is the one place
this spec rewrites a shipped sentence, and it is flagged rather than slipped in.**

---

## 8. The two frames that carry the argument

### 8.1 The reshape moment (mockup 5)

The client says one sentence. The agent resolves it into two changes and applies neither. Beside
the thread, the two days the turn names are **ringed in the grid** — a client-side read of the
turn's own resolved dates, no fetch and no write. Apply is a background write; the turn keeps its
lines and loses its actions; the settled report arrives as the next agent turn; the month moves.

That ring is the strongest argument for a desktop surface existing at all: **the phone can show
you what you agreed to, and only this can show you where it lands.** It is also the only thing in
the set that is not already built, and it is a derivation rather than a feature.

### 8.2 The thin month (mockup 8)

Two planned posts on a screen with room for thirty. Three things carry it, and none is padding:

1. **Two of the four columns are invariant to month size.** The day column and the dock hold 664
   of the 1440, so the visibly empty region is one column of four.
2. **The month summary opens by default on a thin month**, filling that column with the month's
   real derivation — the mix, what came from her, what we assumed, and the two prompts. On a full
   month it opens closed, because thirty posts are their own argument and two are not.
3. **The conversation speaks first**, with the thin-month acknowledgement rather than the standard
   framing. It is the one state where the agent has something specific to say on arrival, and it
   puts the invitation next to the field that answers it.

**What is not done:** no ghost cells, no placeholder slots, no greyed *add a post here* on
twenty-eight empty days, no error styling. A thin month is not a failure, and the grid keeps its
full height — shrinking the calendar to fit two posts would make a thin month look like a *small*
month, and the client would lose the one thing the grid is telling them, which is that
twenty-eight days are free.

---

## 9. The eighteen standing desktop e2e failures — triaged

**They were not measurable at `HEAD` when this session started**, and that is the first thing the
build session inherits.

> `scripts/test-db.sh` refuses to build a database because `0090_plan_activity_post_fk` is in
> neither `NEW` nor `SKIP`. It is a **filename collision** — `0090_actor_attribution` already holds
> that number, and the manifest names only the latter. The guard is behaving exactly as designed;
> what is missing is the entry. **Fix this first: nothing below can be re-measured until it is
> done.** Adding `0090_plan_activity_post_fk` to `NEW` is sufficient; this session did that
> temporarily, ran the suite, and reverted it, because this commit is docs only.

With that one line applied, the suite runs and reports **36 passed / 18 failed** — the same 18 the
last five reports have carried, reproduced test for test. They fall into **three clusters and one
singleton**, and only one cluster is a real defect in the product.

### Cluster A — the per-post date policy (10 tests) · **(b) fixture pinned to changed behaviour**

The whole-cycle `readOnly` flag is gone (`usePlanData.ts`: `const readOnly = false`, with the
comment recording the change). Editability is now **per post, by date**: *“this post is editable
iff its date is today-onward”*. The fixtures pin **P1 (2026-07-02)** and **P2 (2026-07-06)**, both
of which are in the past relative to the frozen `PLAN_TODAY=2026-07-08`, so every editing control
is correctly absent and the caption textarea is correctly `readonly`.

| Test | Post it opens | Symptom |
|---|---|---|
| `desktop.spec.ts:26` drag-reschedule | P1 | not draggable |
| `desktop.spec.ts:43` caption save → EDITED → revert | P1 | `editor-caption` is `readonly` |
| `desktop.spec.ts:88` ticking a task | first **overdue** row → a past post | the write is refused; the row returns and no ledger row is written |
| `desktop.spec.ts:133` shape pending | P1 | no `shape-input` |
| `desktop.spec.ts:184` caption autosave | P1 | `readonly` |
| `desktop.spec.ts:200` delete + confirm | P2 | no `editor-delete` |
| `desktop.spec.ts:224` date picker | P1 | no `editor-date` |
| `desktop.spec.ts:259` focus-steal regression | P1 | `readonly` |
| `format.spec.ts:18` no-progress format change | P2 | no `format-select` |
| `refine.spec.ts:53` caption-only Shape | P1 | no `shape-input` |

**The fix is the fixtures, not the seed.** P1 and P2 are the only past-dated posts in the seed and
they are what exercises the *read-only* branch (`PostEditor`'s `{!editable ? …}`); moving their
dates forward would delete that coverage. Repoint these ten at an editable post — P7 (2026-07-16)
and P8 (2026-07-20) are both caption-bearing and editable — and add one deliberate read-only case
against P1.

**One smaller thing this cluster exposes, worth fixing while in there:** `desktop.spec.ts:88`'s
`toHaveCount(before - 1)` *passes* on the optimistic state and only the ledger assertion fails,
because Playwright's polling matches during the window before the refusal rolls the tick back.
That is a test-timing artefact rather than a product defect — the rollback works — but the
assertion should be made against the settled state.

### Cluster B — hook and script became one act (4 tests) · **(b) fixture pinned to changed behaviour**

C4 (`conversation-sheet-2.md`) ruled that a reel's hook and script are generated together. The
editor followed: there is no `script-needs-hook` gate any more, the empty state is
`script-needs-caption`, and the control reads **“Generate hook & script”**.

| Test | What it asserts | Status |
|---|---|---|
| `scripts.spec.ts:11` | `script-needs-hook` is visible, then types a hook to unlock the script | **Confirmed**: that gate no longer exists. The fixture pins the pre-C4 contract |
| `hooks.spec.ts:11`, `hooks.spec.ts:64` | three `hook-candidate`s after `generateHooks` | **Plausible, not confirmed.** The symptom is 0 candidates on an editable reel (P3, 2026-07-08), so it is not the date policy. C4's combined enqueue is the obvious suspect and I did not verify the e2e fake's response shape for `/api/plan/hooks`. **Check that first** |
| `agent.spec.ts:78` | three `hook-candidate`s after approving a `generate_hook` proposal | Same root as the two above |

### Cluster C — a real contrast defect on `PlanDesktop` (3 tests) · **(a) genuinely broken**

axe reports `color-contrast` at **3.03:1**, foreground `#e8705f` on `#ffffff`, target
`.border-coral\/40` — the **`brief-month-btn`** (“Add to your plan” / “Brief this month”): coral
text on white at 12.5px.

| Test | |
|---|---|
| `a11y.spec.ts:108` | the primary-surfaces walk, on the calendar/feed state |
| `format.spec.ts:30` | axe over the format-confirm dialog + toast |
| `scripts.spec.ts:44` | axe over the reel script editor state |

This is broken by **DESIGN.md's own rule**, not merely by axe: *“Don't use accent for small text on
white. Accent text exists only as `accent-800` on `accent-100`.”* It is not the recorded
white-on-`accent-650` deviation and must not be added to that ignore.

**This design closes it by deletion.** `brief-month-btn` is retired (§1, E2): adding is the per-day
slot and briefing is the conversation. The two remaining axe tests should be re-run after the
rebuild rather than patched; if a finding survives on a different node it is a new finding.

### The singleton — `desktop.spec.ts:99` · **(b) fixture pinned to a tightened fake**

The stubbed ask is *“please move a post to later this month”*. The e2e fake's parser now requires a
**post reference** for a move (`UUID_RE`), so a sentence naming no post correctly falls through to
`clarify` — `extraction-summary` is visible and `extraction-row` is 0. Put a seeded post id in the
message, exactly as `agent.spec.ts` and the mobile conversation specs already do.

### Summary

| Cluster | Tests | Verdict |
|---|---|---|
| A — per-post date policy | 10 | (b) fixture |
| B — hook + script are one act | 4 | (b) fixture — 1 confirmed, 3 same-root and unverified |
| C — `brief-month-btn` contrast | 3 | **(a) genuinely broken**, and this design deletes the control |
| Singleton — tightened fake parser | 1 | (b) fixture |
| | **18** | |

**Fifteen of eighteen are fixtures.** None of them is a defect in the surface this spec replaces,
and none of them blocks the build. The one real defect is the one control the redesign removes.

---

## 10. What the build inherits — an ordered list

1. **The migration manifest** (§9). One line; nothing else can be measured until it lands.
2. **Gap 7, still first and still blocking.** Removing the client's retry affordance removes their
   only recovery path. Bounded retry exists (`attempts: 3`, exponential backoff) and the daily
   `scheduler-tick` already carries a sibling sweep; what is missing is a failed-generation sweep
   and an operator surface. Both are prerequisites for shipping *on its way*, on either form factor.
3. **The shell: rail, plan header, the two columns, the dock.** The cheapest change with the largest
   effect, and it retires six controls (the global add button, Timeline, Notes, the Approvals view,
   the FAB, the dark rail). Needs gap 2 for a draft marker on an unopened month.
4. **The detail panel, both variants**, built as one component placed differently from the phone's
   sheet — the mobile spec's own instruction (§10: *built once and placed differently, not built
   twice*). Needs gap 9 for the meter's refusal.
5. **The dock**, reusing `VoiceSheet`'s thread, `InterpretationTurn`, `AgentSays` and the composer
   unchanged; what changes is the chrome around them.
6. **The month summary under the grid**, reusing `DraftMonthSummary` with the one copy change and
   the thin-month default-open rule.
7. **The eighteen e2e failures**, per §9's triage.
8. **The remaining gaps**, of which 1 (posting time) is now the most visible: it appears on every
   card in every frame of this set.

### Three things this spec asks DESIGN.md to absorb

Recorded here rather than changed, because this commit is docs only and DESIGN.md is the phone's
contract as much as this surface's.

| # | What | Evidence |
|---|---|---|
| **D1** | **A ninth control joins the white-on-`accent-650` deviation** — the rail's selected item, and with it the label and the late-count inside it. Measured: axe reports exactly 3.40:1 on `.railbtn[aria-current="page"]`, its `.lbl` and its `.count`, and nothing else in the set. The `Draft` badge also reports 3.40 and is *already* covered by the table's `.badge` row. DESIGN.md's mapping table and `a11y.spec.ts`'s `CONTRAST_DEVIATION` list are enumerations by design; a new control must be *added* to both, never covered by a pattern | §3.1 |
| **D2** | **The rounded scale has drifted.** The detector reports `12px` (the action-row buttons and the interpretation turn's Apply/Discard) and `6px` (the client bubble's tail) as outside DESIGN.md's `9 / 14 / 16 / 20 / 26 / 44 / 999`. Those values are the **shipped** components' — `rounded-[12px]`, `rounded-br-[6px]` — and this set matches them deliberately. Either the scale gains them or the components move; the drift should not sit unnamed | §12 |
| **D3** | **`side-tab` fires on the agent register.** `border-left: 3px solid var(--t-accent-700)` is `AgentSays`'s and `InterpretationTurn`'s shipped treatment, reviewed as *the* way the agent looks. It wants a scoped `detector.ignoreRules` entry with that reason, the way `single-font` was handled in round 3 — a config change, so it is recommended rather than made here | §12 |

---

## 11. Explicitly: what does NOT change

Stated plainly because a rendering brief that quietly moves a boundary is worse than one that
does not exist.

- **The data model.** No new table, no new column, no new evidence field, no migration.
- **Draft assembly.** Slot count, cadence derivation, temperature semantics, the replacement pool,
  determinism, the phrasing pass and its whole-batch fallback — all untouched. The fences hold.
- **Generation.** Phase 2's fan-out, the hook/script combined act, the checklist templates, the
  bounded retry and the terminality of `generation_failed`.
- **The cycle model.** The cutoff, `resolveSurfaceKind` and its four members, the home-cycle rule,
  the per-post date gate. **This redesign adds no member to `SurfaceKind`.**
- **Agent behaviour.** The task parser, the thread window, `lineFor`'s derivation, proposals and
  their approve/apply path, the AI-change cap and its banked state.
- **The routes and their guards.** Nothing here calls anything that does not already exist, and
  nothing asks an existing route for a shape it does not already return.
- **The terminology table**, save the two device-verb strings in §7.
- **The theme system.** Colour is admin-managed, injected as `--t-*`, AA-gated on tint/text. This
  surface consumes tokens and writes no hex.
- **The mobile surface.** Not one frame of it moves. Where this spec and
  `mobile-plan-surface.md` differ, the difference is desktop-only and named here.

---

## 12. Gates, and findings applied versus deferred

> ⚠️ **DEGRADED: single-context.** The impeccable critique playbook wants two isolated
> sub-agent assessments. This session's operator instruction is that the Agent tool is not to be
> used unless asked for, so the critique and the audit were run in the main context, as round 5.1
> also did. Mechanical checks were run as scripts rather than delegated, which is the more reliable
> half of that trade; the design judgement below carries the usual single-perspective caveat.

| Gate | Result |
|---|---|
| Detector (`detect.mjs` v3.4.0), default scope, over `docs/design/desktop-mockups` | **17 findings** — 10 advisory `em-dash-overuse`, 4 `design-system-radius`, 2 `side-tab`, 1 `flat-type-hierarchy` |
| Detector, `--scope type,layout` | **1** — the same `flat-type-hierarchy` |
| **axe-core over all ten files**, serious + critical only, with the recorded white-on-`accent-650` deviation filtered **node by node against the live computed styles** — the same three-way scoping `a11y.spec.ts` uses | **0 findings.** The only pairs axe reports at all are the deviation itself, every one of them measuring exactly **3.40:1**: the rail's selected item, its label, its count, and the `Draft` badge. Nothing else on any screen is below AA |
| Structural sweep — duplicate `id`s, `<use href="#…">` targets present in that file's own sprite, every icon-only control named, every interactive target ≥ 40px | **clean**, all ten files |
| Overflow probe — `scrollWidth` vs `clientWidth` on every element in every frame, plus a vertical-escape check that ignores real scroll containers | **clean**, 15 frames, one dismissed false positive (below) |
| Screenshot check — every frame rendered headless at real pixels and read | 15 frames, 5 rounds of corrections |
| Desktop e2e (`--project=desktop`, Node 22 path) | 36 passed / **18 failed**, triaged in §9 |
| App unit / interaction, engine, worker | **not run** — no code outside `docs/` was touched, so no suite could move |

### Applied — found by the checks, fixed before the commit

| # | Finding | Fix |
|---|---|---|
| 1 | The month grid rendered as 35 floating numerals with 400px of dead canvas beneath it, on a *full* month | It became one ruled `surface` object filling the column. The emptiness that remained is mockup 8's subject, not a layout accident |
| 2 | The summary panel's headline and sub-line rendered on **one line** — both were inline `<span>`s | `display: block` on each |
| 3 | *“Wednesday 2 September”* at 22px plus a count on one row wrapped the day's own name at 316px | The day header stacks. Measured, not guessed: the name is 245px of a 316px measure |
| 4 | `.fmt.lg` at `11px` and the format control's segments at `11px` were outside DESIGN.md's rounded scale | `14px` and `9px` — both documented tokens |
| 5 | The thread pinned a one-turn conversation to the ceiling of a 650px panel | `margin-top: auto` on the first turn: a thread grows from the composer up, the way every chat does |
| 6 | The interpretation turn's `<li>` overflowed its `<ul>` by 6px | `min-width: 0` on the grid item |
| 7 | The client bubble and the agent turn were set at `14.5px`, which is the **shipped** size and is not one of DESIGN.md's ten roles | Normalised to `15px` (`body`). Recorded as a 0.5px change from the shipped component |
| 8 | Mockup 7 claimed *“Completed 5”* over three rows | The two missing rows added; the count and the rows now agree |
| 9 | The task rows dropped the format tile the phone's `TaskRow` carries | Restored |
| 10 | The narrow-frame caption claimed the ringed days and the turn were not visible together at 1024 | They are. The sentence was corrected to name what the stack *does* cost — the day column falls below the fold |
| 11 | **`role="grid"` on a flat set of buttons** — axe `aria-required-children`, critical, on every month grid in the set. A grid role requires row children | Dropped to `role="group"` with the same `aria-label`, which is what the shipped `MonthGrid` does (it claims no grid role at all) |
| 12 | **Out-of-month day numerals at `muted` 45% alpha ≈ 2.4:1** — a numeral nobody can read. Inherited from the phone stylesheet, which predates the shipped component | Full `muted` (5.98:1), matching `MonthGrid.tsx`'s own `text-muted`. Round 3 made the same correction to `.wday.out` and did not carry it here |
| 13 | **Composer and Shape placeholders at `muted` 72% / 70%** ≈ 3.6:1 | Full `muted`, matching the shipped `placeholder:text-muted` |
| 14 | **The rail's “2 late” count stayed `danger` on the selected item's `accent-650` fill** — red on green | White on the selected item, with the number and the word still carrying the meaning. Folded into D1 |
| 15 | Duplicate `id`s on the summary panel across duplicated frames, and one `aria-controls` pointing at nothing on a **closed** panel | Ids made unique per frame and re-paired; `aria-controls` dropped where the region is not rendered. The built component keeps it, because there the region is always in the DOM |

### Deferred — real, and not this commit's to fix

| # | Finding | Why deferred |
|---|---|---|
| **D1–D3** | The three DESIGN.md items in §10 | Two are DESIGN.md edits and one is a `.impeccable/config.json` ignore. All three are outside `docs/`, and this commit is docs only |
| 11 | **10 × `em-dash-overuse`**, one per file | All are advisory. A meaningful share is **product copy that cannot change** — the summary panel repeats *“— never appeared in a caption”* ten times from `productCoverageFact`, and the agent's framing sentences carry their own. The phone set left its ten standing for the same reason and the operator accepted that; matching the precedent rather than churning prose |
| 12 | **1 × `flat-type-hierarchy`** on `index.html` (11 / 13.5 / 16.5px) | Review-document chrome — that page contains no `.desk` at all. The phone set's identical finding on its own `index.html` was left standing and explicitly not silenced, because it is a judgement a future reader should get to re-make |
| 13 | The task rows' **`danger`-coloured “Late”** | It is the shipped `TaskRow`/`TasksPanel` treatment, and it sits against DESIGN.md's *“`danger` is Delete's monopoly on this surface”*. Translating it faithfully is right; **reversing a shipped, reviewed treatment on the strength of a desktop mockup is not**. Named here so the tension is decided rather than inherited |
| 14 | The detail panel's **~290px caption measure** at 1440 | It is the phone's measure and the deliberate consequence of “nothing reflows” (§2.4). Stated as a cost rather than fixed, because every alternative reflows something |

### Checked and dismissed

- **`UL 260 > 254` in the interpretation turn.** The per-item `×` carries `margin-right: -6px`, the
  phone's own `-mr-1`, which bleeds a 40px hit area into the panel's 12px padding. That is the
  pattern working, not overflowing; it is visually inert and clipped by nothing.
- **A vertical “escape” reported on nine frames.** An artefact of the probe screenshotting each
  frame before measuring, which scrolls the page. Scrolling to the top first cleared it on every
  file; nothing in the markup changed.
- **`.desk` scrollHeight exceeding its clientHeight on mockup 7.** The Tasks list is a real scroll
  container with more rows than fit. Correct behaviour; the probe's check was widened to ignore
  content inside a scroller.

---

## 13. Data provenance

Every figure on every screen is a reported one. Nothing was invented to make a frame look full.

| Content | Source |
|---|---|
| Earl of East's October — ten posts, dates, formats, pillars, statuses, the one `generation_failed` | `docs/reports/build-d-approval-phase2.md` §1, the dogfood run, 0/10 structure drift |
| The Wilderness reel's caption, hook and script, verbatim including the corrupted `#ritualovertoutine` | same report |
| Earl of East's evidence — pillar share 0.2 on the `equal` basis, cadence 2.24 posts/week over 4 months | `docs/reports/build-a-draft-assembly.md` §10 |
| The Wilderness intake sentence and its live classification | Build D §1 |
| ivy-t's September — thirty beats, their dates, formats, slot types, series and product evidence | `docs/reports/beat-grounding-build.md` §2 |
| The thirty phrased titles, and the five grounding lines rendered for the 26 September beat | `docs/reports/beat-detail.md` §3 and §4 |
| Every line of the month summary, full and thin | `docs/reports/month-summary.md` §1 |
| The summary's CTA copy, the two prompt rows and their order | `docs/reports/summary-cta.md` §3–§5 |
| ivy-t's carousel/reel engagement (32 over 86, 42 over 183), pillar share 14%, cadence 7.48/week over 10 months | `beat-detail.md` §4 |
| The approval counts and their labels | `approval-counts.ts` over ivy-t's real 15/15 format split |
| The checklist step labels and lead days | `packages/db/migrations/0067_step_templates.sql` |
| Shape mode's copy, the format control's words, the format-change note | `DetailSheet.tsx`, `format-change.ts` |
| The interpretation turn's structure, its statuses and its labels | `Interpretation.tsx` and `docs/reports/conversation-sheet.md` |
| The composer's shape and the absence of a meter | `VoiceSheet.tsx` (C2, and the operator's F4 ruling) |

**Six things are reconstructions, and each is labelled on the page that shows it:**

1. **Posting times.** `6:00` and `7:00` are the `PostingTimes` contract's own documented example
   values (`packages/engine/src/types.ts`), not a stored client config — the same labelled
   reconstruction the phone set made. The two that **are** real are ivy-t's series times (WSG 6pm,
   Sunday Style 8pm), which the assembler writes.
2. **The 1 October single post's caption text** is not recorded — only its length — so its card
   states the length.
3. **Two October titles the report elides** are shown in the assembler's deterministic fallback
   form (`Pillar — Format`) rather than invented.
4. **The draft card's one-line reason.** `rationaleFor`'s compressed sentence for that beat is not
   recorded, so the card shows the same fact in the form gap 4 shipped: *“From what you told us:
   ‘…’”*, quoting her own sentence.
5. **The client's sentence in mockup 5** is illustrative — no real Earl of East reshape of that
   month exists. Everything it resolves *to* is real: a real post, its real date, a real
   destination inside the month.
6. **Which checklist steps are ticked** is recorded nowhere; mockup 7 shows a plausible early-
   October state, and the rail's count agrees with it.

**One absence is load-bearing and was respected:** Earl of East has **no reported reel
engagement**, so the reel's insights panel carries no format-engagement line. Absence produces no
line — not a zero, not a hedge — which is the rule the whole surface is built on, demonstrated
rather than asserted.

---

## 14. Open, and deliberately not decided here

1. **Peak-end still has no end.** Approval navigates to `/?cycle=` and the client arrives at a
   month of *on its way* cards with no sentence saying the writing has started. Unchanged from the
   phone, and now visible on a larger screen, which makes it worse rather than better.
2. **The `danger`-coloured “Late”** (§12, deferred 13). It is a shipped treatment that contradicts
   a DESIGN.md line. One of the two should move.
3. **Whether the month grid should ever carry more than pips.** At 512px it should not. If a
   future layout gives the month column 700px or more — a client with no conversation open, say —
   a compact chip becomes legible and the question re-opens. Recorded so it is decided rather than
   drifted into.
4. **Cluster B's exact root cause** (§9). Three of the eighteen failures are attributed to C4's
   combined hook-and-script act on strong circumstantial evidence and one confirmed sibling. The
   build session should verify the e2e fake's `/api/plan/hooks` response shape before assuming it.
