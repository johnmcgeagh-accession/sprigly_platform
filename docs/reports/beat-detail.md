# Beat titles and detail

**Date:** 2026-08-02 · **Branch:** `dev` · **Reads from:** [beat-grounding-build.md](./beat-grounding-build.md)
**Acceptance target:** ivy-t cycle `0b9677e5-d06d-4de5-9207-527cd837333a`, September 2026, UAT.

| commit | piece |
|---|---|
| `9bb325e` | T2 — titles are headlines: her shorthand, one derivation, no dangling separator |
| `11b4b5a` | T1 — the sheet shows the beat in full: one fact per line, from the evidence |

T3 needed no change and is explained in §5. No caption column was touched anywhere: titles
live in `source_meta`, and `caption` emptiness stays load-bearing for the C4 refusal rule.

---

## 1. T2 — the rule, and ten real titles

**The rule as implemented.** A beat title is a HEADLINE — `[series shorthand: ]subject` — not a
sentence. The subject is the product, the client's own idea, or the pillar, in that order.
**The format is appended only when nothing else distinguishes the beat.**

That last clause is the structural change. `" — Carousel"` was never information: the format is
on the card's tile, on the sheet's tile, and in the month-summary row that leads with it. It
existed to stop two same-pillar beats in one month reading identically. A title naming a product
or quoting her own sentence is already distinct and takes no suffix; a pillar-only or
series-only title keeps it, because four "Sunday Style" beats with nothing else to say would
otherwise be four of the same line.

**The cap stays at 60** (`TITLE_MAX`, `draft-transforms.ts`) and was re-measured rather than
assumed: the draft card clamps its heading to two lines of 16.5px semibold on a ~350px measure,
which is close to sixty characters. Shortening below it would give back card space already paid
for. The problem was the shape, not the length.

Ten real September beats, deterministic derivation, before and after:

| # | before | after |
|---|---|---|
| 4 | `WSG (Weekend Style Guide): Bea — Carousel` | `WSG: Bea` |
| 25 | `WSG (Weekend Style Guide): Lydia — Carousel` | `WSG: Lydia` |
| 5 | `Sunday Style: Fiona — Carousel` | `Sunday Style: Fiona` |
| 22 | `What our customers see: Jen — Carousel` | `What our customers see: Jen` |
| 7 | `Notes from the Founder: Jane — Reel` | `Notes from the Founder: Jane` |
| 8 | `Weekend Style Guide: — Carousel` | `Weekend Style Guide` |
| 13 | `A hard-working wardrobe of incredible organic cotton staple… — Reel` | `A hard-working wardrobe of incredible organic cotton…` |
| 16 | `We bring you simple things that work — from work presentati… — Reel` | `We bring you simple things that work` |
| 28 | `Life is busy — make decision-making easy with a simple set … — Reel` | `Life is busy` |
| 0 | `A Supportive Friend, Always By Your Side — Carousel` | *unchanged* — pillar-only keeps its suffix |

### (a) Her shorthand — `seriesShortName`

Her config names the Weekend Style Guide `"WSG (Weekend Style Guide)"`, carrying both forms in
one string, and titles took the whole thing. Three independent places in her own configuration
say she calls it WSG:

- `client_planning_config.categories` contains `"WSG"`, not the expansion — and that list is
  documented as authoritative;
- `postingTimes` is keyed `wsg`;
- every month she has ever run titles it by the short form — `WSG: Vests` (6 Jun),
  `WSG: Claire Feature` (27 Jun), `WSG: Connie Violet` (17 Jul), `WSG: Maggie Almond` (24 Jul),
  `WSG: Sally Sweatshirt Grey Marl` (31 Jul).

So `WSG (Weekend Style Guide): Lydia` was our reading of her name rather than hers.
`seriesShortName` takes the part before the bracket and rides on `ResolvedSeries`. **The full
name still governs history matching and the phrasing licence** — only titles shorten, so
`seriesMatchTerms` and `validatePhrasing` are untouched.

### (b) One derivation, not two

`experimentTitle` took `content.split('\n')[0]` and hard-sliced at 59 — a second, worse copy of
what `deriveTitle` already did. `deriveTitle` was built for exactly this input (her briefing
prose) and is pinned against the real stored strings in `draft-title.test.ts`: first
**substantive** clause rather than first line, trailing enumerations and separators stripped,
word-boundary cap. `experimentTitle` is now a one-line call to it. All six live backlog ideas
derive to clean headlines, and they are in the tests.

### (c) The bare label

The one malformed case from the last report. Idea `15dd0814`'s first line is `"Weekend Style
Guide:"` — a heading over a dated list on the lines below — so first-line-only produced
`Weekend Style Guide: — Carousel`: a label, a dangling colon, and a separator with nothing after
it. `deriveTitle` splits on `:` and takes the first substantive clause, so it resolves to
`Weekend Style Guide` with no dangle. Pinned with an explicit
`expect(title).not.toMatch(/[:—–-]\s*$/)`.

---

## 2. T1 — where it landed, and what it shows

**It extends the existing insights affordance** (`DraftDetailSheet.tsx`), which is what the
brief asked for and what the design already had: the reason a beat exists lives behind the info
icon on the sheet header. A second place to look for it would have meant neither place was the
answer. What changed inside it is the shape — a `ul`, one fact per `li`, replacing the single
compressed sentence.

**Two readings, one source.** `rationaleFor` (unchanged) still serves the card, where three
clamped lines want a sentence. `groundingLines` is new and serves the sheet, where the client is
studying the thing they are being asked to approve. Both derive from `rationaleEvidence`; neither
adds to it; there is no model prose on this path at all. A shared formatter with a flag would
have served neither shape.

**Order is fixed and meaningful:** the standing commitment, the product gap, her own words, then
the measurements. Strongest and most specific first.

**Absence stays a value.** A field that is not there produces **no line** — not a zero, not "no
data", not a hedge. A beat with nothing to show gets an empty list, and *the insights affordance
itself disappears* rather than opening onto a blank panel. `Fiona — never appeared in a caption`
carries no date and no `(0)`; a malformed date shortens the sentence rather than rendering
`Invalid Date`.

**One new piece of evidence.** `backlogIdea { text, givenAt }`. `sourceRef` is a *pointer* at a
`plan_inputs` row and a client surface cannot go and fetch it, so the sentence travels on the
beat — exactly as `client_input`'s `reason` already does. That needed `created_at`, so
`loadDurableInputs` selects it. The WHERE clause is untouched for the same reason as last
session: the planning gate and the app's intake route share that query so "is there anything
plannable?" cannot come to mean two things, and a predicate there would change it for both.

---

## 3. Acceptance — the thirty titles

Re-assembled on UAT, phrasing succeeded (`"phrasing": "phrased"`, `beatsWritten: 30`):

```
 0  2026-09-01 Tue carousel  Here for you, always
 1  2026-09-02 Wed reel      Why never to wear polyester or synthetics, especially in…
 2  2026-09-03 Thu carousel  Quality and ethics, hand in hand
 3  2026-09-04 Fri reel      The people behind what we make
 4  2026-09-05 Sat carousel  WSG: mornings made easy with Bea
 5  2026-09-06 Sun carousel  Sunday Style: steady with Fiona
 6  2026-09-07 Mon carousel  Dressed for the life you actually live
 7  2026-09-08 Tue reel      Notes from the Founder: meet Jane
 8  2026-09-09 Wed carousel  Weekend Style Guide
 9  2026-09-10 Thu reel      We don't cut corners, ever
10  2026-09-11 Fri carousel  Getting to know the people we dress
11  2026-09-12 Sat carousel  WSG: keep it simple with Layla
12  2026-09-13 Sun carousel  Sunday Style: the quiet strength of Heather
13  2026-09-14 Mon reel      A hard-working wardrobe of incredible organic cotton…
14  2026-09-15 Tue carousel  A friend who knows your wardrobe
15  2026-09-16 Wed reel      How Ivy began
16  2026-09-17 Thu reel      We bring you simple things that work
17  2026-09-18 Fri reel      Real connections, real conversations
18  2026-09-19 Sat carousel  WSG: easy mornings start with Thia
19  2026-09-20 Sun carousel  Sunday Style: Jules, your reliable foundation
20  2026-09-21 Mon reel      Clothes that fit your real life
21  2026-09-22 Tue reel      Someone in your corner, always
22  2026-09-23 Wed carousel  What our customers see: Jen in the real world
23  2026-09-24 Thu reel      It's just a sweatshirt (or is it)'
24  2026-09-25 Fri reel      Built on honest relationships
25  2026-09-26 Sat carousel  WSG: simplify your weekend with Lydia
26  2026-09-27 Sun carousel  Sunday Style: Maya, simply dependable
27  2026-09-28 Mon reel      Made for real women, full stop
28  2026-09-29 Tue reel      Life is busy
29  2026-09-30 Wed reel      Built because we needed it ourselves
```

No `(Weekend Style Guide)` anywhere. Position 8 is the bare-label idea, now clean. Positions 1,
13, 16, 23 and 28 are title-fixed backlog beats, so those five are the deterministic derivation
verbatim — the phrasing pass never touches her words.

## 4. Acceptance — three beats, as the sheet renders them

Real `beat_meta` from those rows, through `groundingLines`:

**Product-grounded** — `WSG: simplify your weekend with Lydia` (Simplify Your Morning)

```
• WSG (Weekend Style Guide) — weekly; last ran 28 August
• Lydia — last in a caption on 22 February (8 captions)
• Carousels average 32 likes and comments across your last 86 posts
• Simplify Your Morning is about 14% of what you post
• You post about 7.48 times a week, measured over 10 months of your feed
```

**Series, no product date** — `Sunday Style: steady with Fiona` (Stable Foundations)

```
• Sunday Style — weekly; last ran 26 July
• Fiona — never appeared in a caption
• Carousels average 32 likes and comments across your last 86 posts
• Stable Foundations is about 14% of what you post
• You post about 7.48 times a week, measured over 10 months of your feed
```

**Backlog** — `Why never to wear polyester or synthetics, especially in…` (Born From Real Need)

```
• From what you told us in July
    “Why never to wear polyester or synthetics, especially in summer.”
• Reels average 42 likes and comments across your last 183 posts
• Born From Real Need is about 14% of what you post
• You post about 7.48 times a week, measured over 10 months of your feed
```

The title is a headline and stops at "especially in…"; the sentence she actually sent is on the
sheet, in her words, with the month she sent it. That is the trade the brief asked for — shorten
at source, because the sheet guarantees the full text — and it is pinned as a test.

**Two things the live data corrected in me.** The brief's example said "in June"; the row's
`created_at` is 21 July, so the line says July. And WSG's `lastPlanned` is 28 August with three
months observed, not 31 July — the August cycle's plan rows are non-draft history and correctly
count.

---

## 5. T3 — nothing to do, so the rule is pinned instead

The brief made T3 conditional on it being cheap. It was already done: the full draft card has
clamped its heading to `line-clamp-2 break-words` since it was written, which is exactly "wrap
to two lines before truncating", and compact rows are untouched at single-line `truncate`.

Rather than change anything, both halves of the density rule are now pinned in
`draft-surface.interaction.test.tsx`: a full card gives the title two lines and is not
`line-clamp-1`; a day at three beats — the count that tips the panel from cards to rows — keeps
every row on one line. A row that wrapped would give back exactly the vertical space the rule
exists to save.

## 6. One deliberate inconsistency

The **title** says `WSG:`; the **grounding line** says `WSG (Weekend Style Guide) — weekly`.
That is on purpose. A title is a headline and takes her shorthand; a grounding line is a fact,
read once, in the one place the client is studying the reasoning — and it is the right place to
spell the name out in full. Making the fact line match the title would need `shortName` on the
`seriesDue` evidence, which is a schema field bought for a cosmetic gain.

Related, and left alone: the phrasing prompt gives the model `seriesDue.name` (the full form),
and the model shortened it to `WSG:` on all four instances unprompted. `validatePhrasing` accepts
either form via `seriesMatchTerms`, and the deterministic fallback is already `WSG: Lydia`, so
both paths land correctly without passing the short form into the prompt.

---

## 7. Gates

| gate | result |
|---|---|
| `pnpm --filter @sprigly/engine test` | **517 passed** (was 503) — +7 `seriesShortName`/title-rule, +7 `experimentTitle` on her real backlog |
| `pnpm --filter @sprigly/worker... build` | **exit 0** — the command Railway runs |
| worker unit (`engine`) | **301 passed**, 38 skipped — unchanged |
| `tsc --noEmit` (app) | clean, after every commit |
| app unit / interaction (**Node 22**) | **1212 passed**, 14 skipped (was 1180) — +19 `groundingLines`, +11 sheet interaction, +2 density |
| tokens fence | 10 passed |
| terminology fence | 6 passed |
| draft invisibility | 5 passed |

`git diff HEAD` on `*terminology.fence.test.ts`, `*tokens.fence.test.ts`,
`*draft-invisibility.test.ts` is **empty**.

**The two pre-existing app failures are unchanged:** `edit-scope.test.ts` and
`post-generation.test.ts` fail to *collect* because they import a module that parses
`DATABASE_URL` at import time. Same two files as the session baseline, 0 test failures. The
worker's 11 failing integration files are the same known baseline.

**Node 22 matters.** Under the default Node 20 the app run reports ~770 passed and looks green
while silently skipping every jsdom file — which is every interaction test in this session. All
app figures above are Node 22.

### Audit of the one changed component — `DraftDetailSheet.tsx`

| dimension | finding |
|---|---|
| Accessibility | The facts are a real `ul`/`li`, not styled divs. The bullet is a decorative `span` with `aria-hidden`. The quote is visually set apart *and* carries typographic quote marks, so the attribution survives with styling off. Toggle keeps its `aria-expanded` and `aria-label`. |
| Theming | No new colour. Every class resolves through existing `coral-*` / `line` tokens; no hex, no Tailwind slate. |
| Contrast | The panel's `text-coral-800` on `bg-coral-100` pair is unchanged. **One finding, mine, fixed before commit:** the quote first shipped as `text-coral-800/85`, and the tokens fence caught it — "ink at partial alpha". Alpha dropped; italic and the quote marks carry the distinction instead. |
| Responsive | Nothing fixed-width. The list is `flex` with `min-w-0 flex-1` on the text, and the quote is `break-words`, so a long unbroken token cannot widen the sheet. Verified at 390 / 375 / 320. |
| Integrity | One new exported function in the lib that already owns this (`draft-rationale.ts`), no new component, no new section on the sheet. |

**Acceptance runs write to UAT.** Each `draft-assemble` replaces only this cycle's
`status='draft'` rows, which is what that path is for. Nothing else was touched; nothing pushed.
