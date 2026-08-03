# The month summary

**Date:** 2026-08-03 · **Branch:** `dev`
**Reads from:** [beat-grounding-build.md](./beat-grounding-build.md) · [beat-detail.md](./beat-detail.md)
**Acceptance target:** ivy-t cycle `0b9677e5-d06d-4de5-9207-527cd837333a`, September 2026, UAT.

| commit | piece |
|---|---|
| `74e2b91` | S1 — the month reads itself: one derivation, shared with the beat sheet |
| `3a2ac23` | S2 — the summary heads the day: two lines closed, the evidence behind one tap |
| `889f9d5` | fence — the terminology grep covers the lib that writes the copy, and it found two (§8) |

S3 is not a commit. It is the reason S1 is one function in the module that already writes the
beat sheet's lines rather than a second reading of the same rows — §4.

---

## 1. What it says, on the real month

ivy-t's live September draft, 30 rows, read straight out of `beat_meta` on UAT. Every line below
is the rendered output, not a transcription.

### Closed — what a client sees on landing, with no tap

```
30 planned posts across 5 weeks
This is the shape of September — once you’re happy, we’ll write every post.
```

### Open

```
THE MIX
  15 carousels · 15 reels
  A Supportive Friend, Always By Your Side      5
  Born From Real Need                           5
  Ethical Without Compromise                    4
  Personal Relationships                        4
  Simplify Your Morning                         4
  Stable Foundations                            4
  Understands Real Women                        4

THE ONES THAT ALWAYS RUN
  Sunday Style — 4 Sundays
  WSG (Weekend Style Guide) — 4 Saturdays
  Notes from the Founder — once this month
  What our customers see — once this month

WHAT WE’RE FEATURING, AND WHY
  Bea — never appeared in a caption
  Fiona — never appeared in a caption
  Jane — never appeared in a caption
  Layla — never appeared in a caption
  Heather — last in a caption on 17 December
  Thia — last in a caption on 22 December
  Jules — last in a caption on 3 February
  Jen — last in a caption on 22 February
  Lydia — last in a caption on 22 February
  Maya — last in a caption on 8 March

FROM YOU
  6 ideas you gave us in July

WHAT WE ASSUMED
  No pillar weights are on record, so the month splits evenly across pillars.
```

And, at the foot of the same day, unchanged from before this session:

```
We’ve assumed nothing’s launching this month — anything coming up?
```

**That pairing is §S1f working.** September's beats carry two assumptions, on all thirty rows.
The day already asks about the first, so the panel carries only the second. Neither is stated
twice, and neither is dropped. `firstAnswerable` still decides which one the day gets; the panel
takes the remainder, whatever that is.

**Every number is checkable against the rows in [beat-grounding-build.md §2](./beat-grounding-build.md).**
5+5+4+4+4+4+4 = 30 across seven pillars; 15/15 on format; ten products; all eight weekly series
instances plus both monthlies; the six `lifecycle='candidate'` backlog beats, all six of which
carry `givenAt: 2026-07-21`, which is why the line says July and not June.

### The thin-month variant

The same derivation over the first **two** of those same live rows — 1 September (pillar-only)
and 2 September (a backlog beat). Nothing is mocked; it is a shorter month of her real data.

```
2 planned posts across 1 week
This is the shape of September — once you’re happy, we’ll write every post.

THE MIX
  1 carousel · 1 reel
  A Supportive Friend, Always By Your Side      1
  Born From Real Need                           1

FROM YOU
  1 idea you gave us in July

WHAT WE ASSUMED
  No pillar weights are on record, so the month splits evenly across pillars.
```

**It degrades by saying less.** Three sections instead of five: there are no series and no
products in those two rows, so `THE ONES THAT ALWAYS RUN` and `WHAT WE’RE FEATURING` are not
built — not emptied, not headed with "none". The counts are real counts of two, the week count
is one week because both dates fall in one, and "1 idea" is singular because there is one.
An empty month renders **no panel at all**: a month with nothing in it has no argument to state,
and a panel reading "0 planned posts across 0 weeks" would spend the top of the screen saying
nothing.

---

## 2. Placement and weight — the choice, and why (S2)

**Collapsed by default, two lines, inside the day's scroll region.**

The brief offered "a two-line headline (posts, weeks, 'why these') that expands, or an equivalent
that keeps the day content visible — choose and justify". The choice deviates from that
parenthetical in one respect, deliberately:

> **The stage line is NOT behind the tap.**

The panel exists because a client reads thirty title-only rows as unfinished work. If the
sentence that corrects that reading only appears once they open the panel, it reaches exactly the
clients who did not need it. So the closed state carries both lines: the count (the one thing a
client verifies for themselves) and the stage (what a draft is and what happens next). "Why
these" is the chevron's job, and the chevron is what opens the derivation.

**Two lines is what it costs.** The panel sits at `px-5` inside a 390px viewport, giving a ~292px
measure once its own padding and the chevron are taken out. The headline is 15px/600 — 31
characters, one line. The stage line is 13.5px/400, 74 characters, two lines. Three text lines and
12px of padding above and below. The `min-h-[56px]` on the control is the **tap-target floor**,
not a layout size; it only binds on a non-editable month, where the stage line is absent and the
panel is one line.

**Inside the scroll region, not above it.** It is passed to `DraftDayPanel` as a `summary` slot
and rendered as the first child of the scrolling column. A fixed panel above the scroll would cost
its height on every day of the month, every time the client changes day; this one is read once and
then scrolls off, and the day's own content starts immediately underneath it. That is also why it
is not a sheet: a sheet implies a task to finish, and this is a thing to read.

**What stays on screen at 390 / 375 / 320, closed:** the day's heading, the day's count, and the
first card. Driven and asserted at all three widths. jsdom measures no pixels, so what the tests
prove is the half they can — the panel closed, the day rendered, and nothing in the panel
declaring a width a 320px viewport could not hold. Every fact row is `flex` with `min-w-0
flex-1 break-words`, so a long unbroken product name cannot widen it.

**Draft months only.** It is rendered by `DraftSurface`, which is the draft branch of the shell;
`CommittedSurface` is untouched and asserted to have no such panel. It heads the **day** view —
the month grid already carries its own footer summary and its own day summary, and a third
account of the month on one screen would be two too many.

**On a month that can no longer be worked on**, the stage line is `null`. "Once you're happy,
we'll write every post" is not true of a draft past its cutoff, and it is the one line in a panel
built to be checkable that a client could not check. Everything else still renders. The day's
nudge is also absent there, so on that month *every* assumption falls to the panel — which is the
only place left that can carry them.

---

## 3. What the panel may say

The same rule as `groundingLines`, and stated here because it is the whole basis for showing
these numbers to a client at all:

- **Computed, never narrated.** Every line comes out of `rationaleEvidence` on the beats. There is
  no model call on this path and no stored prose is re-phrased.
- **Absence is a value.** A section with no evidence behind it is not built. A missing `givenAt`
  shortens "6 ideas you gave us in July" to "6 ideas you gave us" rather than guessing a month.
  A malformed date is left out of the week count rather than inventing a week.
- **Counts, not percentages.** The pillar column reads `5`, not `16.7%`. Five of thirty is a
  number a client can check by counting cards; a percentage is arithmetic they have to trust.
- **Deterministic.** Formats and pillars sort by count then name; series by instance count then
  name; products null-first, then oldest date, then name — the same total key the assembler uses
  ([beat-grounding-build.md §6](./beat-grounding-build.md)). Pinned by re-deriving a shuffled and
  reversed month and comparing the serialised output byte for byte.
- **Never "beat".** Pinned twice: over every string the derivation produces, and over the whole
  rendered document with the panel open.

---

## 4. S3 — one derivation, two renderings

The per-beat grounding and the summary read the same rows. They cannot be allowed to state the
same fact two ways, and "we were careful" is not a mechanism. Three things make it structural:

**1. `productCoverageFact` splits the claim from its sample size.** The sheet, studying one beat,
wants the caption count with the date. The panel, listing ten products at once, does not. So the
fact is built once and split:

```
sheet   Lydia — last in a caption on 22 February (8 captions)
panel   Lydia — last in a caption on 22 February
```

The panel's line is a literal **prefix** of the sheet's, and that is what the test asserts —
`onSheet.startsWith(inPanel)`, over every series beat in the fixture. There is no way to change
one date without changing the other, because there is only one date.

**2. `fromClient` is the predicate, not a second reading.** "6 ideas you gave us" counts exactly
the beats whose sheet shows her own words. The test does not hard-code six: it filters the month
for beats whose `groundingLines` include a `backlog` line and asserts the panel's count equals
that. A beat carrying both a backlog idea and a `reason` renders two lines on the sheet and counts
once here — the count is of beats, not of lines.

**3. The series name is the sheet's form, not the title's.** `WSG (Weekend Style Guide) — 4
Saturdays`, matching the grounding line, against the title's `WSG:`. That is the same deliberate
split [beat-detail.md §6](./beat-detail.md) ruled on: a title is a headline and takes her
shorthand; a fact panel is read once, by a client studying the reasoning, and spells the name out.
Pinned by asserting both renderings contain the full form.

**Where they differ, and it is not a disagreement.** The grounding line says when a series *last
ran*; the panel says how many instances *this month holds*. Different facts about the same series,
both from `seriesDue`, neither derivable from the other.

---

## 5. What the acceptance run found

**One defect, mine, fixed before the commit landed.** The first live render of the thin-month
variant read:

```
1 carousels · 1 reels
```

`formatWord` only ever had plural forms, because until now it was only ever used after "carousels
average 32 likes". The summary counts formats, and a month holding one of a kind has to say "1
carousel". `FORMAT_ONE` and `formatCount` fix it; both the singular and the unknown-format
fallback (`1 story post`) are pinned. It is a small thing and it is exactly the kind of seam a
client reads as carelessness, on the one panel built to be checked.

**Three observations, none blocking, none acted on this session:**

1. **The terminology fence did not reach `app/src/lib`** — ***fixed, see §8***. Its `ROOTS` were
   the plan components, and a growing amount of client-facing copy is now generated in the lib.
   The grep would not have caught "beat" typed into `monthSummary`.

2. **`groundingLines` treats a malformed `lastFeatured` as "never appeared".** `rationaleFor`
   distinguishes the two ("hasn't appeared in your captions for a while"); the sheet's list form
   does not. The panel now mirrors the sheet exactly, which was the S3 requirement — so it
   inherits the same conflation. `lastFeatured` is written by the engine as an ISO date or null,
   so this is defensive-path only. Correcting it means correcting the sheet, which is a change to
   T1's rendering and belongs in its own commit.

3. **The pillar block is seven rows on ivy-t.** That is her real pillar count and each row is one
   line at 390px, so it fits — but a client with a dozen pillars would get a dozen rows behind the
   chevron. It is behind the tap, it never affects the closed height, and truncating it would mean
   the panel stated an incomplete distribution while looking like a complete one. Left whole.

---

## 6. Scope — what was not built

**The panel does not answer anything.** The assumptions it carries are statements, in the
assembler's own words; the one question on the screen is still the day's nudge, and it is still
the single answerable one `firstAnswerable` picks. A second tappable question in the panel would
mean two places to answer the same class of thing.

**No new evidence field, and no new query.** Everything the panel says was already on the beats
before this session. Nothing new is read from the database and no route changed.

**`DraftPlanView` (desktop) is untouched.** It remains the desktop draft surface and is
unreachable on a phone, as [DraftSurface.tsx](../../app/src/components/plan/surface/DraftSurface.tsx)
records. Its own redesign is a later session.

---

## 7. Gates

| gate | result |
|---|---|
| `pnpm --filter @sprigly/engine test` | **517 passed** — unchanged, no engine file touched |
| `pnpm --filter @sprigly/worker... build` | **exit 0** — the command Railway runs |
| worker unit (`engine`) | **301 passed**, 38 skipped — unchanged |
| `tsc --noEmit` (app) | clean, after every commit |
| app unit / interaction (**Node 22**) | **1259 passed**, 14 skipped (was 1212) — **+47** (+45 here, +2 from §8) |
| ↳ `draft-rationale.test.ts` | 96 (was 69) — +27 on `monthSummary` and the shared facts |
| ↳ `draft-surface.interaction.test.tsx` | 95 (was 83) — +12 driving the panel |
| ↳ `narrow.interaction.test.tsx` | 28 (was 22) — +6 at 375 and 320 |
| tokens fence | 10 passed |
| terminology fence | 6 passed through `3a2ac23`; **8 passed** after §8 widened it |
| draft invisibility | 5 passed |
| detector (3 changed/added components) | **0 findings, exit 0** |

`git diff` on `*tokens.fence.test.ts` and `*draft-invisibility.test.ts` is **empty**. The
terminology fence is the one that moved, in `889f9d5`, and it moved **outward** — §8.

**The two pre-existing app failures are unchanged:** `edit-scope.test.ts` and
`post-generation.test.ts` fail to *collect* because they import a module that parses
`DATABASE_URL` at import time. Same two files as the session baseline, **0 test failures**. The
worker's 11 failing integration files are the same known baseline (301 passed, 0 failures).

**Node 22 matters.** Under the default Node 20 the app run looks green while silently skipping
every jsdom file — which is every interaction test in this session. All app figures above are
Node 22 (`/opt/homebrew/opt/node@22/bin`).

### Audit of the one new component — `DraftMonthSummary.tsx`

| dimension | finding |
|---|---|
| Accessibility | One control, the whole header, carrying `aria-expanded` and `aria-controls` at the region it opens, plus an `aria-label` that says what opening it gets you. The facts are a real `ul`/`li` under a real `h3`, not styled divs. The count is text in its own cell, so it survives with styling off. |
| Theming | No new colour and no new token. `border-line/30`, `bg-line-soft`, `text-chrome`, `text-muted` — all already on this surface, all resolving through `--t-*`. No hex, no Tailwind slate. |
| Contrast | No coral, so the ink rule's filled-control boundary is not in play. No alpha on any ink utility; the only `/30` is on a border. Verified by the tokens fence rather than by eye. |
| Responsive | Nothing fixed-width. Every fact row is `flex` with `min-w-0 flex-1 break-words` on the text and `flex-none` on the count; the headline and stage line are `break-words`. Driven at 390 / 375 / 320. |
| Integrity | One new component in the surface directory that already owns this shell's pieces, one new prop on `DraftDayPanel`, one new derivation in the lib that already owns evidence-to-words. No new route, no new query, no new evidence field. |

---

## 8. The fence, widened — and the two live violations it found

**Commit `889f9d5`.** Follow-on to §5's first observation, which this supersedes.

`ROOTS` now covers **`src/lib`**, not just the plan components. The reasoning is the same one
that produced the observation: the sentences a client reads are increasingly composed in the lib
and never appear in a component — `draft-rationale.ts` (the beat sheet's grounding lines and
every row of this summary), `draft-mutations.ts` (the messages flashed when a write refuses),
`plan.ts` (the last-resort card heading).

**It found two live violations immediately, and a third the app can never see:**

| site | was | now | how it reached a client |
|---|---|---|---|
| `app/src/lib/draft-mutations.ts` | `We couldn’t find that beat.` | `We couldn’t find that planned post.` | returned as `message` from `/api/plan/draft`, flashed by `useDraftMonth` |
| `app/src/lib/plan.ts` | `Untitled beat` | `Planned post` | the card and sheet heading when a row has no title and no pillar |
| `packages/engine/src/draft-transforms.ts` | `Untitled beat` | `Untitled post` | `deriveTitle('')` writes it into `source_meta.title` — **outside any app-side fence**, which is precisely why the word survived here after it was removed everywhere else |

The engine's pinned test (`draft-title.test.ts`) moves with it. Nothing else asserted any of the
three strings.

**Four files are exempt, each with a justification rather than an exemption** — the shape the
tokens fence's `whitespace-nowrap` list already uses:

- `queue.ts`, `agent/proposals.ts`, `agent/types.ts` — bare `'failed'` is a BullMQ job state and
  a discriminant on a result union. Neither is ever rendered, and renaming them would rename a
  real concept to satisfy a copy rule. They fire only because `BANNED_BARE` deliberately refuses
  to excuse a bare banned word as an identifier — correct for a JSX text node, wrong for a lib.
- `e2e-fake.ts` — hard-gated behind `SPRIGLY_E2E_FAKE=1` **and** non-production, so it cannot
  reach a client at all; and its `"BEAT 1 (0–5s)"` is a video script's own vocabulary — a shot —
  not our word for a slot.

Whole files rather than values, so the list is auditable in one read; a value list would grow
into a way of keeping a banned word by naming it. **A new test fails if any entry stops naming a
file the scan reaches**, so a stale path cannot sit there exempting nothing while reading as
though it does.

**Verified by planting, not by inspection.** A violation was planted in each newly covered file
and the fence caught all three:

```
src/lib/draft-rationale.ts:  "One beat, no evidence."          → caught
src/lib/draft-mutations.ts:  "That beat could not be moved."   → caught
src/lib/plan.ts:             "Generation failed — retry?"      → caught
```

**Gates after the widening:** terminology fence **8 passed** (was 6 — +2: one asserting the lib
files are really in the scan, one asserting every exemption is). App **1259 passed**, 14 skipped.
Engine **517 passed** with the re-pinned title test. Worker unit 301 passed, 38 skipped. Worker
build exit 0. `tsc --noEmit` clean. Tokens fence and draft-invisibility unchanged and passing.

**This is the one fence that moved this session, and it moved outward.** `git diff` on
`*tokens.fence.test.ts` and `*draft-invisibility.test.ts` is still empty; the terminology fence's
diff is additive — a wider root, an exemption list with reasons, and two new tests. No rule was
relaxed, and the three strings it caught are fixed rather than exempted.

---

**No acceptance run wrote to UAT.** Unlike the two previous sessions, nothing here re-assembles a
draft: the summary is a read of rows that already existed. The September rows were read once, as
JSON, and rendered through `monthSummary` locally. Nothing was written; nothing was pushed.
