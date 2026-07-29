# Surface B — review fixes

**Date:** 2026-07-29 · branch `dev` · **not pushed, not promoted**
**Base:** `1a71bfa` (*docs: surface build B — the report*) · **Last commit:** `870d022`
**Scope:** the two Part 0 investigations, then fixes 1–6.
**Reads:** [`surface-build-b.md`](surface-build-b.md) first, as instructed.

---

## 0. What to look at first

1. **Both Part 0 bugs had a cause nobody would have guessed from the symptom.** The date jump was
   not the pager or the scroll-spy — it was a **ghost click** landing on the month arrow through a
   sheet that had just unmounted (§1). The empty Hook tab was not a stale refresh — it was a
   **placeholder caption** that four different pieces of code read as content, one of which spends
   money (§2).
2. **Two fixes touch rulings the operator has already made once.** Delete's solid `danger` block
   becomes a tint (§7), and the format control moves for the third time (§3). Both are argued and
   both name the one line to reverse.
3. **The mic unification exposed something it does not fix:** a proposal raised on a phone can only
   be approved on a desktop (§4).
4. Everything geometric in here was **measured at 390 and 320**, not estimated, and two of those
   measurements are now ratchets in the e2e suite (§8).

---

## 1. Part 0a — the sheet-close date jump

> Closing a detail sheet (grabber drag) on 13 Aug landed the operator on 2 Sep; from 2 Sep it
> jumped toward Oct.

**Reproduced before fixing**, in `app/src/components/plan/surface/sheet-close.interaction.test.tsx`.
Two mechanisms, and the first explains the dates exactly.

### 1.1 Mechanism A — a ghost click on the month arrow

Not the pager, not the scroll-spy, not restored state. A **compatibility click**.

| Step | Where |
|---|---|
| The sheet dismisses on `pointerup`, and unmounts inside that handler | `Sheet.tsx:137-152` |
| The browser then dispatches the `click` for that same pointer sequence, at the same coordinates, onto whatever is underneath **now** | (platform behaviour) |
| The grabber is `h-[34px] w-full` — a full-width band | `Sheet.tsx:183` |
| …at the top of a sheet pinned `bottom-0 h-[92%]`, so at 390×844 it occupies **y 67.5–101.5 across the whole width** | `Sheet.tsx:168` |
| Underneath that band: the month row's ‹ › arrows and, until fix 4, the Today row | `PlanShell.tsx:93-134` |
| A click on `next-month` calls `switchCycle`; the month changes | `CommittedSurface.tsx` (title-row wiring) |
| The month change re-anchors the selection to the new month's **earliest post** | `CommittedSurface.tsx:66` |

13 August → September's first post → **2 September**. Do it again → toward October. The visible
38px grabber bar is centred at x≈195, which at 390px is exactly where `next-month` sits.

**The re-anchor is not the bug.** It is correct for a deliberate month switch. The switch was not
deliberate.

**The fix** is a guard that swallows exactly one click, scoped three ways so it can never eat a
real tap (`Sheet.tsx:38-79`):

- **by time** — `setTimeout(…, 0)`. A browser sends the compatibility click in the same
  input-dispatch turn as the `pointerup`, so the disarm always runs after it and before the
  client's next tap. The grabber carries `touch-action: none`, so there is no 300ms delay to
  outlast.
- **by place** — within 24px of where the finger lifted, which is where that click will be.
- **by count** — it disarms on the first swallow.

### 1.2 Mechanism B — the focus restore scrolled

`useFocusTrap` returned focus to the opener with a bare `.focus()` (`a11y.ts:48`), which scrolls
it into view. So closing a sheet dragged the day panel to put the card back at the top of a list
the client had already scrolled — the "scroll position" half of the report. Every focus call in
the trap now passes `preventScroll`: **restoration is not navigation.**

*Audit note:* `preventScroll` could in principle leave keyboard focus on an off-screen element.
It cannot here — the opener was on screen when it was activated, and nothing scrolls the panel
while the sheet is over it.

### 1.3 On reproducing a browser behaviour in jsdom

jsdom does not synthesise the click after a pointer sequence, so the tests dispatch it. That is
not a contrivance: **that one behaviour is the subject**, and writing it out is the only way to
pin it where the components live. The file also asserts the geometry that made it reachable, so
the test fails if the sheet stops overlapping the header for a different reason.

**15 cases**: the geometry contract; the bug on tap and on drag; **five days across two months
byte-identical after open → close**; the move-sheet-over-detail-sheet case; and three that prove
the guard cannot eat a real tap (a click elsewhere on the same turn, the second click after a
swallow, and a scrim close arming nothing).

---

## 2. Part 0b — generate on a fresh reel

> Added a post, toggled to reel, Script tab → Generate → hook AND script were created but the
> Hook tab stayed empty and the post has NO caption.

Three findings. The third is the one that matters, and it is worse than the symptom.

### 2.1 What the combined job writes — correct

`engine/src/content-cycles/script.ts:138` updates the post's own `hook` and `script` columns in
one write, and `app/src/lib/plan.ts:114` reads `hook` back. The data and the reader agree, and the
Hook tab does show the hook once the refresh lands — pinned by test. **Nothing is lost between
them.**

### 2.2 The caption was never a caption

A committed add with no subject went through `addDraft`, which writes `DRAFT_PLACEHOLDER_CAPTION`
(`app/src/lib/mutations.ts:155` ← `packages/db/src/schema.ts:1092`):

> *"Draft idea. Tell Sprigly what this post should be about and it'll write the caption."*

That is a column that is not empty and content that does not exist. **The data model already knew
it**: `cardText` has stripped it since it was written (`card-text.ts:32`) and the merge classifier
matches its prefix (`schema.ts:1095`).

### 2.3 The sheet and the route did not know — and one of them spends money

`DetailSheet` asked `!!post.caption`, so a placeholder-only post rendered three tabs with our own
sentence in the first one. Worse, the Script tab's Generate offer was live, because
`!post.caption.trim()` is false for a placeholder — and `api/plan/script/route.ts` agreed,
checking `!post.caption`.

**So a fresh reel could have a hook and a script generated with our scaffolding sentence as their
subject.** That is what happened. The Hook tab did not read empty because the write failed; it
read empty *before* the operator went looking, and what the job produced belonged to no post.

### 2.4 The fix — one predicate and one rule

`hasRealCaption()` lives in `@sprigly/db` (`schema.ts:1108`), which the app and the worker both
already import, so there is one answer rather than one per caller. It guards:

| Surface | Where |
|---|---|
| the route | `app/src/app/api/plan/script/route.ts:45` |
| the worker — the end that spends money | `engine/src/content-cycles/script.ts:81` |
| the sheet — `written`, the caption tab's body, the script tab's `needsCaption` | via `realCaption()`, `card-text.ts:54` |

And the operator's product rule: **caption generation enqueues regardless; an instruction only
steers it.** `POST /api/posts` has one path now (`app/src/app/api/posts/route.ts:94`). Without a
subject the brief is a neutral one derived from the slot the client just picked — this day, this
format (`route.ts:46`) — and the post reads *On its way* until the words land, which is true.
`addDraft` is no longer reachable from that route, so **a post is never left holding a placeholder
for a client to read as content.**

**16 cases**: `fresh-reel.interaction.test.tsx` (11) walks the operator's sequence and asserts the
Hook tab populated, the script populated, and the caption honestly pending;
`placeholder-caption.test.ts` (5) pins the predicate, including that the prefix really is a prefix
of the full sentence so the two can never disagree.

---

## 3. Fix 1 — the format control moves inside Shape

Third placement. Round 2 removed it; round 6 put it under the sheet header; this puts it **beside
the Shape prompt field**. Recorded in spec **§4.1a** so it stops moving.

**The rationale.** A format change is a *shaping decision with consequences* — it can strand a
hook and a script, and it changes what the checklist is for. Always-visible under the header it
read as a display toggle: three segments, one tap, on a sheet a client had opened to read their
caption. Inside Shape it is in the deliberate flow, next to the field where they are already
saying what they want different, with room for the consequence note to be read before anything is
sent. Shape's own copy drops "the format" from what it promises to keep, because that is now the
one thing it can change.

**What it costs, stated rather than discovered.** Shape is offered only where there are words to
rewrite, so a post with no caption yet has no format control. In practice that is the minutes
between adding a post and its caption landing — and the format was chosen in the add sheet moments
before. Two cases stay uncovered: a permanently failed generation, and a pre-approval slot on a
committed month. **If that bites, the fix is to offer Shape on an empty field as "write it", not
to move this control a fourth time.**

**The draft sheet keeps its always-visible control**, which follows from the ruling rather than
excepting it: the reason is *consequences*, and a draft beat has none — §4.1's own table says
there is no caption, hook or script to strand. It also has no Shape mode, so the letter of the
ruling would delete the only way to change a planned post's format.

---

## 4. Fix 2 — one voice sheet, both months

Spec §1.2's rule is that the mic is the microphone on **both** month states, that the gesture is
always *talk to your plan*, and that **the surface has to say which consequence it has**. Session
A wired the committed mic to a line of `flash()` copy and opened nothing; Session B built the
sheet for the draft month only. So the one screen whose whole job was to say which consequence you
were getting existed on one of the two months.

Same microphone, same meter, same keyboard toggle, same submit, same starters-that-are-openers.
Two things differ, and they are the two that should:

| | Draft | Committed |
|---|---|---|
| **Framing** | “This is your October draft. Tell us what's happening and we'll reshape it…” | “October is written. Say what you want different and we'll put the change up for you to approve — **nothing moves until you say so**.” |
| **Starters** | “We're launching …”, “There's an event on …”, “Can we do more …” | “Move the …”, “Take out the …”, “Rewrite the …” |
| **Submit** | `POST /api/plan/draft/apply` — reshapes, returns a receipt | `POST /api/plan/agent` — raises proposals, **applies nothing** |

The committed reply is reported through the one feedback channel in the agent's own sentence plus
the count of proposals raised. **Nothing in that copy may say *moved* or *done*, and a test
asserts it does not** — on this month nothing has been.

`source: 'voice' \| 'web'` now rides the agent route too. It has accepted the field since Build 3
and nothing ever sent it, so gap 8's committed half was open in the *other* direction from the
draft one: the route could tell spoken from typed, and the client never told it.

### 4.1 What this exposes and does not fix

**A proposal raised by the mic is approved from the Approvals surface, which exists on
`PlanDesktop` and not on the mobile shell.** A client can now raise a change on a phone and cannot
act on it there. The copy is honest about the state — the change is up for approval — but the
control is not on this form factor. Recorded in spec §8.2a and in §10 below rather than papered
over.

---

## 5. Fix 3 — optimistic-first for reversible mutations

Format, move, drop and a task tick each change one field of one row and each can be put back
exactly, so the UI changes now and the server confirms behind it. Move was already optimistic; the
other three waited on a round trip, which on a checklist is the difference between a list and a
form.

**Generation-class actions are deliberately excluded** and keep their pending states: shape,
generate, add-with-instruction. Those are not reversible, they cost money, and showing them as
already done while a model is still working is exactly the wrong lie. A test pins that shape marks
the post pending and leaves the caption alone.

### 5.1 The rollback needed a second fix to be honest

`call()` said *"Something went wrong. Please try again."* for every refusal. That cannot be acted
on: it does not tell *"that date has passed"* (do something different) from a network blip (do the
same thing again). After an optimistic update the question the client is actually asking is **"is
my edit still there?"**, and that answered neither. The routes have always returned a code and
nothing read it.

`app/src/lib/refusals.ts` maps those codes to sentences that say what happened to *their change*.
A written `message` from a route wins — the draft routes author theirs beside the guard that
produces them, which is the right home. An unrecognised code gets a neutral sentence that never
blames the client for our outage.

On the draft side the rollback restores the **whole list** rather than un-applying the patch: the
server returns the authoritative beats on success, so the only thing the client should ever hold
is a list it was given. A hand-computed inverse is a second source for the same fact.

**18 cases**: a format change visible before the server answers; three rollbacks (format, delete,
tick) each naming why; the network case; the draft format and drop rollbacks; shape staying
pending; and `refusals.ts`'s own 7.

---

## 6. Fix 4 — header compression, measured

Three rows sat above the day, and on a committed month one held nothing: Today shared a row with
the Draft badge, and a committed month has no badge. **44px of dead zone** between the month and
the strip — the region the operator's screenshot marked.

Today is right-aligned on the **month row** now (`PlanShell.tsx:93-123`) — where the eye already
is, having just read the month — and the row beneath renders only when it has something in it
(`PlanShell.tsx:129`). The Generate pill moved down into that row on draft months, so the month
row is never three controls wide at 390px.

**Measured at 390×844**, on the seeded day whose title wraps to two lines — the worst case and the
one the screenshot showed:

| | Before | After | |
|---|---|---|---|
| day panel top | 200px | **146px** | 27% higher |
| first card top | 276px | **220px** | 20% higher |
| day title top | 212px | **156px** | 26% higher |

The screenshot also showed a defect the arithmetic would not have: **the day's post count wrapped
to two lines** ("1 / post") when a long title squeezed it. It is `flex-none whitespace-nowrap`
now, and the two panels join the fence's allowlist with that reason. With it fixed the first card
sits at **194px** on a single-line day.

---

## 7. Fix 5 — the action row, attempt two

Round 5 stacked a 20px glyph over a 12px label at 68px; round 6 took it to 56 and the phone still
read it as heavy. The reference given was a stock iOS action row, and three things make one: the
glyph and the label sit on a **line** rather than a stack, the glyph is **thin**, and the fill is
**quiet**. So: **44px, a 17px glyph at 1.5 stroke, a 15px label beside it, a `line-soft` fill**
instead of a ring on surface. Screenshot-checked at 390×844.

### 7.1 Delete is a tint now, and that touches a standing ruling

Round-4 **S1** ruled that a destructive action must not have to be inferred from the colour of its
text, and round 5.1 upheld it against **V1** (*"Delete out-weights everything on the detail
sheet"*). Delete is now `danger` on its own 10% tint rather than a solid `danger` block.

**This is a refinement of S1, not a reversal.** The action is still marked by its **fill**, its
**colour** and its **bin** together — three channels, none of them text colour alone, which is
exactly what S1 forbids. What changes is that a saturated block is no longer the loudest object on
a sheet whose common action is *read the caption, maybe move it* — V1's observation, which becomes
right the moment the other two buttons go quiet.

**If the operator wants the block back it is the one `destructive` branch in `ActionBtn`.**

Contrast checked empirically rather than computed: the mobile axe run opens this sheet and passes.

---

## 8. Fix 6 — the On-its-way dots travel

A static staircase of three opacities reads as a decoration; the same three pulsing in sequence
read as *work in progress*, which is the one thing the marker is for.

CSS only, and **opacity only** — no transform, no layout property — so it composites on the GPU
while the page is also polling for the caption. Through Tailwind's `motion-safe:` variant, so
`prefers-reduced-motion` gets the static staircase and loses nothing: the words beside it carry
the state and the dots are `aria-hidden` either way. The keyframe rests at `.28` rather than `0`,
because a dot that vanishes leaves a gap and the ellipsis loses its shape.

A compact row gets **one** dot on the same rhythm — a row has no space for an ellipsis, and two
tempos for one state would be worse than one dot.

---

## 9. The gate

### 9.1 Detector

`detect.mjs` over `app/src/components/plan/surface`, `usePlanData.ts`, `a11y.ts` and
`refusals.ts`, default scope and `type,layout`:

```
[]   exit 0
[]   exit 0   (--scope type,layout)
```

Nothing to fix, nothing to waive. **The ignore registry is unchanged** — 7 `ignoreValues`,
`ignoreRules: ["single-font"]`.

### 9.2 `/impeccable audit` on the changed components

| # | Dimension | Score | Note |
|---|---|---|---|
| 1 | Accessibility | 4 | the guard cannot swallow a keyboard-driven click (it is coordinate- and turn-scoped); `preventScroll` cannot strand focus off-screen here (§1.2); Delete's tint passes the live axe run |
| 2 | Performance | 4 | opacity-only animation; one short-lived listener per dismissal; optimistic writes remove round trips |
| 3 | Theming | 4 | two new utilities (`bg-danger/10`, `bg-line/25`) — both in the themed map, which the fence asserts by reading `tailwind.config.ts` |
| 4 | Responsive | 4 | 390 and 320 both **measured**, not computed (§9.3) |
| 5 | Implementation integrity | 4 | detector `[]`; the two contested rulings are argued in place rather than quietly changed |
| **Total** | | **20/20** | |

Nothing needed fixing during the pass. The three P3s Session A recorded are unchanged in kind, and
`DraftPlanView`'s hard-coded colour object is still the largest remaining tokens-only debt — it is
desktop-only and the desktop redesign owns it.

### 9.3 Geometry is a ratchet now, not a note

`app/e2e/header.spec.ts` is the one place these can regress unnoticed, because jsdom sees no
geometry:

- the day panel starts at **≤160px** and the first card at **≤225px** at 390×844;
- Today shares the month row's band;
- a committed month renders neither the Draft badge nor the Generate pill;
- at **320px** there is no horizontal overflow on the month view **or with the sheet open**, every
  action button clears the 44px thumb floor and sits inside the viewport, and the "Delete" label
  is not clipped by its own button.

That last test exists because the action row's fit at 320px was the only geometric claim in this
session I had computed rather than measured.

### 9.4 Suites

| | |
|---|---|
| `@sprigly/app` | **756 passing** (was 723) · 2 files need `DATABASE_URL`, unchanged |
| `@sprigly/worker` | 278 · 10 files need `DATABASE_URL` / `TEST_*`, unchanged |
| `@sprigly/engine` | 360 |
| `@sprigly/web` (admin) | 60 |
| `@sprigly/db` | **11** (+5) · `jsonb-encoding` needs a live database, verified failing identically before this session |
| **mobile e2e** | **13 passing** (was 10: +1 a11y state, +2 geometry ratchets) |

`tsc --noEmit` clean on all five packages; `next build` clean.

### 9.5 Standing invariants

```
$ git diff 1a71bfa..HEAD -- app/src/lib/draft-invisibility.test.ts | wc -l
0
```

Tokens fence (10 cases), terminology fence (4 cases) and the invisibility fence all unchanged and
passing. Two files joined the `whitespace-nowrap` allowlist with their reason recorded in the test
itself.

`git diff 1a71bfa..HEAD --shortstat` → **36 files changed, 1,722 insertions, 180 deletions.**

---

## 10. Open, and left for the operator

1. **No Approvals surface on mobile** (§4.1). The mic can now raise a proposal on a phone that can
   only be approved on a desktop. This is the largest thing this session created and did not
   close, and it belongs with the Insights segment as a fourth thing the nav pill has room for.
2. **Gap 5 — a stale assumption nudge**, carried from Session B §15.1 and still the cheapest fix
   with a visible effect.
3. **Peak-end still has no end** (spec §13.2): approval lands the client on a month of *On its
   way* cards with no sentence saying the writing has started. The dots move now, which makes the
   absence of that sentence more noticeable rather than less.
4. **Two rulings to confirm or reverse**, each one line:
   - Delete as a tint rather than a solid block (§7.1) — the `destructive` branch in `ActionBtn`.
   - The format control inside Shape (§3) — spec §4.1a, plus `FormatControl`'s two call sites.
5. **A post with no caption has no format control** (§3), by construction. Named here so it is a
   known consequence rather than a later bug report.
6. **17 desktop e2e failures, inherited** — verified failing identically on `14dbc50` in the
   Session B report and untouched since.

---

## 11. Commits

| Hash | Subject |
|---|---|
| `f57f1a3` | fix: a dismissed sheet was switching the month behind itself |
| `4bb23a4` | fix: a placeholder is not a caption |
| `1bdc6c7` | feat: the format control moves inside Shape |
| `d1317de` | feat: one voice sheet, both months |
| `c090aeb` | feat: optimistic-first for the mutations that can be undone |
| `af89f3e` | fix: the header, compressed — measured, not estimated |
| `7a131e2` | fix: the action row, at stock-iOS weight |
| `ef2cf15` | feat: the On-its-way dots travel |
| `870d022` | test: measure the 320px case rather than assert it from arithmetic |
| — | docs: the review fixes — the report (this file) |

**STOP.** Nothing pushed, nothing promoted.
