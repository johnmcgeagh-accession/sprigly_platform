# The phone re-check — fixes

Branch `dev`. Two commits, never pushed, never promoted.

| | |
|---|---|
| `1269673` | fix: the agent follows the month you are looking at |
| `ee64746` | fix: the surface reads as one sheet, and the agent has one voice |

---

## PART 0 — the agent's cycle scoping

### The evidence

Two sentences off the operator's phone, one month apart on the same surface:

> **On the August surface**, refusing an edit:
> *"August 5th is in a past workbook… I can only edit posts in the current September 2026 cycle"*

> **On the September surface**, with September's posts on screen:
> *"the plan digest shows posts starting October 1st"*

They look like two bugs. They are one contradiction, seen from either side of it, and the
suspicion in the brief was right: this is the backlogged most-recent-cycle anchoring defect,
surfacing now that the client can browse months the agent was never told about.

### The mechanism, in three parts

**(a) The turn ran against the magic link's cycle, not the viewed one.**

`app/src/app/api/plan/agent/route.ts:33` took `const { clientId, cycleId } = session` and passed
that `cycleId` straight into `runPlanAgentTurn`. The body parsed `instruction`, `conversationId`,
`source` and `sessionId` — never a cycle. But `usePlanData.switchCycle` lets the client walk to
any month they have, and `POST /api/plan/agent` never moved with them. The agent loaded one
month's posts (`loadPlanPosts(clientId, cycleId)`, `turn.ts:106`) and then answered questions
about a month on somebody else's screen.

**(b) A cycle was NAMED by its data month and DIGESTED by its plan month.**

`contentCycles.cycleMonth` is the month a cycle's *data* covers. The month it *plans* is one
later — `plan.ts:250`, `const displayMonth = nextMonth(r.cycleMonth)`. Everything the client
sees is the plan month.

`getClientCycleMonths` printed the raw `cycleMonth`:

```
- ${monthLabel(r.month)} (${r.month})${r.isHome ? ' [current, editable]' : ''} — ${r.status}
```

…directly above `cycleDigest(await loadPlanPosts(clientId, cycleId))`, which lists that same
cycle's posts — dated a month later. So the parser's own prompt said

```
The client's content-plan months:
- September 2026 (2026-09) [current, editable] — workbook_built

PLAN DIGEST (this cycle's posts, by date):
- id=… | Thu 1 Oct | instagram/reel | …
```

**Both screenshot sentences are that block, read back to us.** "I can only edit posts in the
current September 2026 cycle" is the `[current, editable]` marker. "The plan digest shows posts
starting October 1st" is the model reporting the discrepancy it had been handed. Neither was a
hallucination; the prompt was self-contradictory and the model said so.

**(c) The in-month move guard was off by one, so it refused every move.**

`turn.ts:146` (as it was):

```ts
if (cycleMonth && task.toDate.slice(0, 7) !== cycleMonth) {
  replyParts.push(`That would move the post into ${monthName(task.toDate)} — moving posts to a different month isn’t available yet.`);
```

`task.toDate` is a PLAN date. `cycleMonth` came from `getCycleMonth`, which returned the DATA
month. For any real post those can never be equal, so the guard fired on **every** in-month move
and the honest cross-month limitation became a universal refusal.

**What was already right.** The apply-time gate was never the problem:
`proposals.ts:28` `agentPostEditable` → `isEditableDate`, and `:224` "Both ends must be
today-onward". The date rule the brief asks for already existed downstream. The defect was
entirely upstream, in the prompt context and the turn-level guard.

### The fix

**1 · The viewed cycle travels with the message.**

- `usePlanData.ts:598` — `ask` now sends `cycleId: viewedCycleId`.
- `route.ts:57` — the body's cycle is **verified, not trusted**: used only when
  `cycleBelongsToClient(clientId, viewedCycleId)` (`cycle-state.ts:106`), otherwise silently
  scoped back to the session's own cycle. A client can only ever be answered about their own
  months, and an unrecognised id degrades rather than failing the turn.

**2 · Cycles are named by the month they plan.**

- `cycle-state.ts:33` `planMonthOf` — the data month → the plan month, rolling the year.
- `cycle-state.ts:59` `describeCycles` — pure, testable, and it says two things it did not:
  - **No cycle is called "editable".** A cycle is not the unit of editability; a date is. The
    old `[current, editable]` marker taught the parser that one month was the only one it could
    act on, which is the refusal the client got back. The viewed cycle is marked
    `[the month on screen]` — where their attention is, not what they are permitted.
  - **Adjacent months stay listed**, sorted by plan month, so "push it into next month" has
    somewhere to resolve to.
- `task-parser.ts` — the prompt now opens with *"The client is looking at {month}. Resolve bare
  dates in {month} unless they name another month"*, the month list is headed *"every one of
  these is theirs to work on; a post can be changed whenever its own date is today or later,
  whatever the month's status says"*, and the digest is headed with the month it actually holds.

**3 · Editability refuses only what is genuinely past.**

`turn.ts:153,157` replace the month-equality guard as the first gate:

```ts
if (!isEditableDate(post.date, todayNow))   → "5 August has already passed, so that post can’t move any more."
if (!isEditableDate(task.toDate, todayNow)) → "20 July has already passed — I can only move posts to today or later."
```

Cycle status is not consulted anywhere. The cross-month limit at `turn.ts:166` survives, because
it is real and it is not about permission — a post lives in the cycle that plans its month and
nothing yet carries it into another. It now compares two plan-month values, so it fires when it
should and not otherwise.

### The two screenshot cases, as fixtures

`app/src/lib/agent/screenshot-cases.test.ts` — 9 tests, the real `runPlanAgentTurn` against a
pinned today of 2026-07-29 (the day of the re-check), with an August cycle and a September cycle
stored the way the table stores them.

- **an Aug-5 move asked from the August view succeeds** → one `move_post` proposal,
  `{postId: 'p-aug-5', toDate: '2026-08-07'}`, and the reply matches neither
  `/past workbook|can only edit/i` nor `/different month isn’t available/i`.
- **a Sep-4 reference from the September view sees September's posts** → the context's digest
  contains `4 Sep` and `18 Sep` and no `Oct`, and the post resolves to a real proposal.
- **the contradiction, as one assertion** — the month the prompt names is the month the digest
  holds.
- genuinely past dates still refuse, in both directions (source and destination), naming the date.

`app/src/lib/agent/cycle-scoping.test.ts` — 6 tests on the pure labelling.
`agent-route.test.ts` — 3 added: the viewed cycle is used, absence falls back to the session's,
and another client's cycle is ignored.

---

## FIX 3 — seamless chrome

**What the phone showed.** Safari paints two bands the page does not own — the status bar above,
the toolbar below — and both took `#E8705F`. A coral strip, a light plan, a coral strip: three
horizontal blocks where the surface is meant to be one sheet under the client's thumb. A
rubber-band overscroll showed a third mismatch, white behind a `#F2F3F5` canvas.

**The reconciliation, stated.** `design/DECISIONS.md §13` rules that `theme-color` is
`coral-strong`. **The one line that reverses it is `app/src/app/page.tsx`'s `generateViewport`**,
and it is a scoping refinement rather than a reversal:

- That ruling was written for the marketing identity, where a coral chrome band **is** the brand
  announcing itself on arrival. The marketing site still emits it (`site/app/layout.tsx:94`),
  untouched, and so does every flag-off tenant and the expired page — `layout.tsx` keeps
  `viewport = { themeColor: CORAL_THEME_COLOR }` as the default.
- The plan surface is an Operate surface the client lives inside. Chrome that announces anything
  is chrome competing with the plan. The brand does not get quieter; it moves to the wordmark,
  which fix 4 makes the loudest thing in the header.

**What was built.**

- `theme.ts` — `loadActiveCanvasHex()` resolves the canvas from the **active theme**, so an admin
  theme switch carries the bands along with `bg-bg` instead of stranding them on a stale literal.
  Any failure returns `CANVAS_FALLBACK_HEX`, which is what the page paints anyway.
- `page.tsx` `generateViewport` emits light and dark entries. **The dark entry is deliberately
  the same colour**: the surface is `color-scheme: only light` and has no dark rendering, and
  without an explicit entry Safari substitutes its own near-black — the identical seam in the
  other direction.
- `layout.tsx` `CANVAS_CSS` paints `html` and `body` (both, because iOS propagates the body
  background to the viewport canvas only when html has none), scoped with `:has(.plan-redesign)`
  so flag-off tenants on `PlanApp` keep the white they have today. Where `:has()` is
  unsupported the page renders exactly as it does now.
- **No safe-area padding on the body.** Insetting it would letterbox the surface and undo the
  seam. The insets are consumed where content would genuinely collide with the hardware:
  `NavPill.tsx` `bottom-[calc(22px+env(safe-area-inset-bottom,0px))]` and `Sheet.tsx`'s panel
  `pb-[env(safe-area-inset-bottom,0px)]` — padding, so the sheet's background still runs under
  the indicator.

**Verifying it on device — and why the simulator lies.**

The simulator and Chrome device-emulation both draw their own chrome, so neither shows the real
`theme-color` band, and neither produces a rubber-band overscroll. Nothing in this fix can be
confirmed from a screenshot taken on this machine. On the phone, in Safari:

1. Open the plan link. **Scroll up past the top of the month** and hold — the strip revealed
   above the header must be the same grey as the plan, with no white flash.
2. Do the same at the bottom, past the nav pill.
3. Check the **status bar** band above the clock and the **toolbar** band below the address bar:
   both grey, not coral. Add the page to the Home Screen and reopen it — in standalone mode the
   status bar takes `theme-color` at full height, which is where a mismatch is most obvious.
4. Switch the phone to **Dark Appearance** (Settings → Display) and reload. The bands must stay
   the same grey; if they go near-black the dark entry is not being read.
5. On a phone **with a home indicator**, confirm the nav pill and the bottom row of any open
   sheet both clear it, and that the sheet's white still runs underneath it.

---

## FIX 4 — header identity

The wordmark was `text-[17px] … text-chrome` under a `text-[20px]` month title: the same colour
as every other word on the surface and smaller than the thing beneath it. The header said what
month it was and nothing about whose product it was.

Now `text-[22px] font-extrabold … text-coral-700` in `font-logo`, with the month title stepping
down to `text-[17px]`.

**Why `accent-700` and not the logo tone.** `accent-600` **is** the mark's colour, and the
spec's own contrast table rules it out for exactly this use:
`accent-600` on canvas is **2.35:1** — *"never as text or a meaningful glyph"*
(`docs/design/mobile-plan-surface.md`, round 5). `accent-700` is the same hue one step down,
sanctioned as text at **5.62:1** on surface (**5.06:1** measured against the canvas), with room
left for a theme that lands lighter. On the coral fallbacks it is **4.09:1** — still past the
3:1 large-text floor. It is the lightest mint the surface may legibly write in, which is what
"renders in the accent token" is asking for. The **mark** beside it keeps `accent-600`: it is a
fill, not text.

The month remains the `h1`. The scale moved; the structure did not.
`header-identity.interaction.test.tsx` reads the px off the classes and asserts wordmark >
month, `text-coral-700`, never `text-coral-500/600`, `font-logo` on one and not the other, the
`h1` intact, the arrows still working, and Today still on the month row.

The e2e geometry ratchet (`e2e/header.spec.ts`) still passes at 390×844 and 320px.

---

## FIX 5 — voice starts, and the no-start cause

**The cause, cited.** `useSpeechInput` constructed a new `SpeechRecognition` on **every**
`start()`, including while the previous one was still closing. `stop()` nulled `recRef` and set
`idle` synchronously, but WebKit holds the audio session until it fires `onend` — later, and
much later after a backgrounding. Constructing and starting inside that window throws
`InvalidStateError`. The old `start()` caught it into `setState('error')`, **and no caller
rendered anything for `error`**. The sheet sat there looking idle, forever. Reopen the sheet
slowly and it works; reopen it quickly and it does not. That is the whole intermittency.

Two more, compounding:

- **`continuous = true` is not honoured on iOS Safari.** It ends the session by itself after a
  short silence, so a client pausing to think came back to a dead microphone.
- **Permission was only ever requested implicitly by `rec.start()`**, and refusal surfaced only
  through `onerror` — so the gap between the tap and the verdict had no state and read as idle.

**The fix.** `wantRef` records that the client still intends to be heard; `pendingRef` holds a
start requested mid-teardown and `onend` replays it; the instance is no longer dropped before
its own `onend`; a session that ends unasked is restarted; `no-speech` and `aborted` are no
longer treated as errors; `getUserMedia` is asked directly where it exists, which separates
"deciding" from "denied" and warms the grant so the next open is instant; and a new `starting`
state exists so the gap has a name. `error` now renders copy.

`VoiceSheet` starts listening on open (`useEffect` on `[open, mode, startSpeech, stopSpeech]` —
the two stable callbacks, not the `speech` literal, which was a fresh object every render).

`speech-restart.interaction.test.tsx` — 12 tests through a fake recogniser that models WebKit's
one-session-at-a-time constraint and its late `onend`. **Five fail against the previous
implementation**: the restart-inside-teardown pair, the two iOS ends-on-its-own cases, and the
promotion of a session that never fired `onstart`. The other seven held before and are there so
they keep holding.

**The assertion this reverses.** `voice-sheet.interaction.test.tsx` read *"opens listening-ready,
not listening — a sheet must not take the mic on sight"*. That was the right rule for a sheet
that could be opened by accident. It is the wrong rule for this one, which is reached only by
tapping a microphone. It now reads *"OPENS LISTENING — the client tapped a mic to get here"*.

---

## FIX 6 — starters removed

Gone entirely, and `starters` is off the `Framing` type rather than emptied, so nothing can grow
them back quietly. X4 built them because the mockups' inert capsules were worse; the re-check
removed the category. On a sheet that now opens listening and says *one sentence is enough*, a
list of three openers is homework — and tapping one switched the client out of the mode they had
just been put into, to finish our sentence rather than say theirs. The correcting and shaping
verbs survive in the placeholder, which is the one example left.

---

## FIX 7 — one agent voice

The agent had three unrelated looks: a sentence in the same dark slab that reports a save, a
reshape that showed nothing at all while it ran, and a raw transcript in body copy one size off
the framing paragraph above it. Every appearance was the first appearance.

`AgentVoice.tsx` — one file, two exports:

- **`AgentDots`** — three dots on the `dot-pulse` keyframes the surface already uses for a post
  that is on its way, staggered 0/160/320ms. The rhythm is shared on purpose: *something of
  yours is being made* is one idea, caption or reply. Behind `motion-safe:`, `aria-hidden`.
- **`AgentSays`** — the mark, the dots while it is still going, and the words, on an
  `accent-100` field with an `accent-700` left edge and `accent-800` text (**6.67:1**, the
  pairing the spec checks by name).

Deliberately **not** the `chrome-deep` slab: that means *the app did a thing to your plan*, and
the agent is the other party in a conversation, not the app reporting. Two meanings had one
shape, which is what made replies feel like system messages.

Used in all three places:

| where | how |
|---|---|
| voice sheet | the live transcript, `working` while the mic is open |
| shape in progress | `useDraftMonth` gained `shaping` — separate from `busy`, which is also true for a move or a drop, and crediting the agent with the client's own edits would be a lie |
| agent toasts | `usePlanData` gained `agentToast` / `agentFlash` (9s, not `flash`'s 3s — a reply is a sentence somebody has to read); `Feedback` renders it as `AgentSays` |

Ranking in the top slot: **undo > agent > plain message**. Undo is time-limited and destructive
to miss; a reply is the answer to something they just said; a statement is neither.

`agent-voice.interaction.test.tsx` — 14 tests, including that the dark slab is still what a plain
confirmation gets.

---

## Gates

| gate | result |
|---|---|
| `tsc --noEmit` | clean |
| unit / interaction | **816 passed**, 14 skipped |
| tokens fence | 10 passed — no hex, no Tailwind slate, every colour through `--t-*` |
| terminology fence | 4 passed — no "beat", no retry/failed in client copy |
| draft invisibility | 5 passed |
| detector | 0 findings on `AgentVoice`, `VoiceSheet`, `Feedback`, `PlanShell`, `NavPill`, `Sheet`, `layout.tsx` |
| e2e (mobile) | all passed, including the header geometry ratchet at 390 and 320 |

**Fence proof.** `git diff HEAD~2 -- app/src/lib/draft-invisibility.test.ts
app/src/components/plan/surface/tokens.fence.test.ts
app/src/components/plan/terminology.fence.test.ts` is **empty**. No fence was touched to make
anything pass.

### What is failing and was already failing

Two unit files — `src/lib/edit-scope.test.ts` and `src/lib/post-generation.test.ts` — fail on
`DATABASE_URL` being absent. Verified pre-existing: they fail identically on a clean tree.

The **`[desktop]` e2e project** has 16 failures (a11y contrast on the legacy `PlanDesktop`,
`desktop.spec.ts`, `format`, `hooks`, `refine`, `scripts`). Verified pre-existing: ten of them
fail on `HEAD~2` with `app/src` checked out to before this session. Untouched by this work and
not fixed by it.

### Deliberate test changes, and the argument for each

Three existing assertions were changed rather than worked around. Each is the single line that
had to reverse, and each says so in the file:

1. `voice-sheet.interaction.test.tsx` — "opens listening-ready, not listening" → "OPENS
   LISTENING". Fix 5 inverts the rule; see above.
2. `voice-sheet` + `narrow.interaction.test.tsx` — the starter assertions become fences that
   keep the starters gone. Fix 6 removed the category.
3. `task-parser.test.ts` — the fixture context gains `viewedMonth` and drops the
   `[current, editable]` marker, which is the string Part 0 exists to delete.

`agent-route.test.ts` also gained `resetRateLimit()` in `beforeEach`: the route's bucket holds 8
and the file now has more tests than that, so without it later tests 429 and the failure reads
as a scoping bug.

---

## Still open

- **Fix 3 is unverified on hardware.** Everything above is reasoned from the CSS and the meta
  tags; the five on-device steps are the verification, and they have not been run.
- **The mint mark still does not exist in this repo** (carried from round 5). Every logo asset
  is coral, so `SprigMarkV2` renders the accent token against a coral SVG family. The wordmark
  now reads accent-700 whatever the theme says, which is correct either way, but the mark and
  the favicon remain a known inconsistency until the asset lands.
- **The cross-month move limit is still real.** An in-month move now works from any month; a
  move that crosses a month boundary still refuses, honestly, because a post lives in the cycle
  that plans its month. Carrying one across is a separate piece of work.

---

## The audit — changed components

Run against the components this session touched: `AgentVoice`, `VoiceSheet`, `Feedback`,
`PlanShell`, `NavPill`, `Sheet`, `useSpeechInput`, `usePlanData`, `layout.tsx`, `page.tsx`,
`theme.ts`, and the agent modules from Part 0.

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | One real defect, found here and fixed: the transcript was an atomic live region |
| 2 | Performance | 4 | No `will-change`, no layout-property animation, no new filters |
| 3 | Theming | 4 | Every new colour resolves through `--t-*`; the two new literals are theme-layer by necessity |
| 4 | Responsive | 4 | Nothing new is fixed-width; touch targets unchanged or improved |
| 5 | Implementation integrity | 4 | Detector: 0 findings. One component replaced three ad-hoc treatments |
| **Total** | | **19/20** | Excellent |

### Implementation integrity — pass

`AgentVoice.tsx` is the session's structural claim and it holds: three unrelated treatments for
one meaning collapsed into one component with two exports, imported by the three surfaces rather
than re-described in each. The detector returns `[]` on every changed file. The tokens fence
(no hex, no Tailwind slate, every `var()` a `--t-*` with a fallback) passes unchanged.

### The one finding, and it was mine

**[P1] The live transcript was announced atomically.**
`AgentVoice.tsx` · Accessibility · WCAG 4.1.3 (Status Messages)

`AgentSays` set `aria-atomic="true"` unconditionally, and the voice sheet's transcript uses it.
A transcript **appends** — so on every recognised phrase the entire accumulated paragraph was
re-announced. A client dictating three sentences would hear the first one four times, on the one
surface whose whole purpose is dictation. The previous code was a plain `<p>` with no live region
at all: silent, so this was not a regression against what shipped, but it was a defect in what
this session built.

Fixed rather than logged, since it is this session's own code: `AgentSays` takes `grows`, which
selects `aria-atomic="false"`. A **reply** stays atomic — it arrives whole and all of it is news.
A **transcript** is append-only and announces only the addition. Covered by
`agent-voice.interaction.test.tsx` (both branches) and asserted end-to-end in
`voice-sheet.interaction.test.tsx`.

### Verified, not assumed

**Contrast.** Computed against the mint ramp and re-checked against the coral fallbacks, since
a surface with no active theme must pass too:

| pair | mint | coral fallback | needs |
|---|---|---|---|
| wordmark `accent-700` on canvas | 5.06:1 | 4.09:1 | 3:1 (22px extrabold = large text) |
| `accent-800` on `accent-100` (the block's text) | 6.67:1 | 7.64:1 on surface | 4.5:1 |
| dots `accent-700` on `accent-100` | 4.91:1 | — | 3:1 (non-text indicator) |
| `accent-600` on canvas — **rejected for the wordmark** | 2.35:1 | 3.04:1 | — |

**Reduced motion.** The dots are `motion-safe:animate-dot-pulse`, so under `reduce` the class is
never applied and they hold at full opacity — a static three-dot mark that still says "working".
This matters because the surface's global reduced-motion rule is a `.001ms !important` kill
(`globals.css:65`); an animation applied unconditionally would be frozen at whatever its first
keyframe happened to be, which for `dot-pulse` is `opacity: 0.28` — three barely-visible dots.
`motion-safe:` is what avoids that. (The global kill itself is pre-existing and out of scope, but
it is the reason the prefix is load-bearing rather than decorative.)

**Semantics and keyboard.** `AgentSays` is non-interactive and adds no tab stop. The month is
still the `h1` and the wordmark is still a `span` — fix 4 moved the scale, not the ladder. The
dots are `aria-hidden`; the block carries its own name. No new focus target, no new trap.

**Touch targets.** Nothing new is interactive. The nav pill stays 44px and now clears the home
indicator; the sheet's action row keeps its 56px controls and gains the same clearance. The
`Today` button remains 40px — pre-existing and already recorded.

**Responsive.** The agent block is `w-full` inside the sheet and `inset-x-4` in the top slot,
with no fixed width anywhere; asserted at 320px in `narrow.interaction.test.tsx`. The e2e
no-horizontal-overflow check at 320px passes.

**Theming.** The two new hex literals are `CANVAS_FALLBACK_HEX` and `CORAL_THEME_COLOR`, both in
`theme.ts` — the theme layer, and both unavoidable: `theme-color` is resolved by Safari before
any stylesheet and cannot read a CSS variable. `CANVAS_FALLBACK_HEX` is pinned to
`tailwind.config.ts`'s own `--t-canvas` fallback by a test that parses the config, so the two
cannot drift.

### What the audit did not cover

Nothing here measured a pixel or a frame. jsdom has no layout engine, and the simulator draws its
own chrome — so the responsive and chrome findings are structural (fluid units, no fixed widths,
correct `env()` usage), not geometric. The five on-device steps under **FIX 3** remain the only
real verification of the seam, and they have not been run.
