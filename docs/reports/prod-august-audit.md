# ivy-t — August 2026 plan audit (PROD)

**Date:** 2026-07-21 · read-only, no writes
**Cycle:** `efae0950-7e01-4a11-a119-cd29a0d64eeb` — ivy-t / instagram, `cycle_month = 2026-07`
(the run month; the plan month is **August 2026**). Status `workbook_built`, unapproved,
`updated_at 2026-07-21 14:33:47`.

**Fingerprint (the gate):** `SELECT slug FROM clients ORDER BY slug` → `ivy-t`, `sprigly`.
**No `earl-of-east`** — this is prod. Host `yamabiko…:59459`. Every statement ran under
`PGOPTIONS=-c default_transaction_read_only=on`, verified `on` on connect.

**Headline:** every dated commitment in the brief is present, on the right date. The mess the
operator saw is real but sits elsewhere — an untitled preserved-edit row, an unbriefed
Sunday Style series (already deleted), four thematic pile-ups, and one launch-time field that
does not say 7pm.

---

# 1. The plan as it stands

32 rows: **27 live, 5 deleted**. Times are `source_meta.postingTime`.

| date | day | title | format | status | deleted_at | time |
|---|---|---|---|---|---|---|
| 08-01 | Sat | Mini Series Launch — What I Am Most Proud Of #1: Quality & Washability | reel | planned | | 7am |
| 08-02 | Sun | Sunday Style — August Wardrobe Simplicity | carousel | planned | **07-21 14:41** | 8pm |
| 08-03 | Mon | Anti-Polyester Education — Why Natural Fibres Matter | carousel | planned | | 7am |
| 08-04 | Tue | Hard-Working Wardrobe — Organic Cotton Staples | single | planned | | 7pm |
| 08-05 | Wed | Brand Values Moment — The Big Moments and the Small Ones | reel | planned | | 7am |
| 08-06 | Thu | Wardrobe Simplicity — Decision Fatigue and the Easy Fix | carousel | planned | | 7pm |
| **08-07** | **Fri** | **WSG — Maggie T-Shirt Grey Marl** | carousel | planned | | 6pm |
| 08-08 | Sat | Sunday Style — August Basics Done Beautifully | carousel | planned | **07-21 14:45** | 8pm |
| 08-10 | Mon | Testimonial — What Our Customers See | carousel | planned | | 7am |
| 08-11 | Tue | Sweatshirt Superiority — Emily Is Just a Sweatshirt (Or Is It) | reel | planned | | 7pm |
| 08-12 | Wed | Colour Reveal — Who Can Guess the Main Colour of the Next Edit? | reel | planned | | 7am |
| 08-13 | Thu | Hannah Colour Reveal — The Colour You've Been Asking For | reel | planned | | 7pm |
| **08-14** | **Fri** | **WSG — Lily Mocha and Sophie Mocha Co-Ord Set** | carousel | planned | | 6pm |
| **08-14** | **Fri** | **Stock Departure Teaser — The Stock Is Leaving the Factory** | single | planned | | 7am |
| **08-15** | **Sat** | **Factory Spotlight — Portugal Summer Shutdown** | carousel | planned | | 7am |
| 08-16 | Sun | Sunday Style — Navy Edit Preview Styling | carousel | planned | **07-21 14:41** | 8pm |
| 08-17 | Mon | Navy Edit Teaser — The Edit Is Coming: What It Solves | reel | planned | | 7am |
| 08-18 | Tue | Navy Edit Piece Feature — Long Sleeve Ivy T-Shirt Pre-Production Video | reel | planned | | 7pm |
| 08-19 | Wed | Navy Edit Piece Feature — Long Sleeve Hannah, the One You've Been Waiting For | single | planned | | 7am |
| 08-20 | Thu | Navy Edit Piece Feature — Emily Midnight Restock Wardrobe Problem Framing | reel | planned | | 7pm |
| **08-21** | **Fri** | **WSG — Emily Sweatshirt Midnight** | carousel | planned | | 6pm |
| 08-22 | Sat | Mini Series #2 — What I Am Most Proud Of: The Daily Juggle | reel | planned | | 7am |
| 08-23 | Sun | Sunday Style — Navy Edit Launch Week Preview | carousel | planned | **07-21 14:41** | 8pm |
| 08-24 | Mon | Value Post — Cost Per Wear: The Navy Edit Investment Case | carousel | planned | | 7am |
| 08-25 | Tue | Navy Edit Teaser — Long Sleeve Orla Navy/Cinnamon Stripe | single | planned | | 7pm |
| 08-26 | Wed | Hannah Navy — The One You Asked For Is Almost Here | reel | planned | | 7am |
| **08-27** | **Thu** | **_(no title — caption only, 861 chars)_** | reel | **edited** | | **_(none)_** |
| **08-28** | **Fri** | **WSG — Hannah T-Shirt Navy** | carousel | planned | | 6pm |
| **08-28** | **Fri** | **The Navy Edit Launch — Live at 7pm** | reel | planned | | **`launch`** |
| 08-29 | Sat | Ours vs Theirs — Emily Luxe Sweatshirt | reel | planned | | 7am |
| 08-30 | Sun | Sunday Style — The Navy Edit: How to Wear the Full Collection | carousel | planned | **07-21 14:41** | 8pm |
| 08-31 | Mon | Notes from the Founder — August Round-Up | single | planned | | 7pm |

**Bold = a dated commitment from the brief.**

## Posts per week (live only)

| week (Mon) | live posts |
|---|---|
| 07-27 | 1 |
| 08-03 | 5 |
| 08-10 | 7 |
| 08-17 | 6 |
| 08-24 | 7 |
| 08-31 | 1 |

**27 live posts.** Configured cadence on prod is `postsPerMonthMin 28 / Max 31`,
`minPerWeek 7 / maxPerWeek 8`. So after the five deletions the month sits **one below the
configured monthly minimum**, and the 08-03 and 08-17 weeks (5 and 6) are **below the weekly
minimum of 7**. Whether that matters is the operator's call — flagged because the deletions,
not the generator, took it under.

## Two structural oddities

**`08-27` is a preserved edit, not a generated beat.** `status='edited'`,
`review_state='preserved_edit'`, `pillar='New idea'`, `source_meta = {}` (empty, so **no
title and no posting time**), created `2026-07-19 13:53` — before today's regeneration, which
it survived. With no title the surface has only its caption to render. This is the most likely
single source of "messy" in the UI.

**`08-08` holds a *Sunday* Style on a Saturday**, and **`08-09` (the actual Sunday) has no
post at all** — not even a deleted one. Already moot: that row is deleted.

---

# 2. Alignment vs the briefed dates

`structured_brief.schedule` holds **8 dated commitments, all extracted correctly** with the
right dates. Every one has a matching post.

| briefed commitment | status | post |
|---|---|---|
| WSG Fri **7th** — Maggie grey marl | ✅ present, right date | `448b4631`, carousel, 6pm |
| WSG Fri **14th** — Lily tee + Sophie co-ord | ⚠️ **present, colourway invented** | `ca27f5b9` — see below |
| WSG Fri **21st** — Emily sweatshirt Midnight | ✅ present, right date | `4bd7a6ba`, carousel, 6pm |
| WSG Fri **28th** — Hannah Navy | ✅ present, right date | `24b1c5de`, carousel, 6pm |
| **Navy Edit launch 28th, 7pm** | ⚠️ **present, time field wrong** | `d7ea0b92` — see below |
| Navy Edit build-up **from 14th onward** | ⚠️ **starts early** | see below |
| **14th** stock-leaves-factory tease | ✅ present, right date | `58e9285b`, single, 7am |
| **15th** Portugal factory shutdown | ✅ present, right date | `adb9626b`, carousel, 7am |

**Nothing briefed is absent. Nothing briefed is duplicated.** Three qualifications:

### (a) The 14th WSG invented a colourway

Brief: *"Lily tee and Sophie short co-ord set"* — `colourway: null` in the extracted schedule.
Post title: **"WSG — Lily *Mocha* and Sophie *Mocha* Co-Ord Set"**. "Mocha" appears nowhere in
the brief or the schedule entry. Either it is right and came from product knowledge outside
the brief, or it is invented. Worth one look before it ships.

### (b) The launch post's time field says `launch`, not 7pm

`source_meta.postingTime = "launch"` — a **key**, not a time. `client_planning_config.postingTimes`
maps `launch → "6am"`. The brief says 7pm, and the post's own title says "Live at 7pm".

So the human-readable title and the machine-readable time disagree by thirteen hours. I can
only confirm the stored values; whether the surface or the scheduler resolves that key is
beyond a read-only DB check. It is the one item here with a real chance of shipping wrong.

### (c) Navy Edit build-up starts on the 12th, briefed from the 14th

The brief is explicit: *"start talking about The Navy Edit 2 weeks ahead of the launch,
starting from 14th August onward."* Two Navy Edit beats land before that:

- `08-12` Colour Reveal — "the next Edit"
- `08-13` Hannah Colour Reveal

Both come from **undated `content_asks`** (`colour-reveal`, `colour-reveal-hannah`), which the
assembler placed freely — it had no reason to know they were governed by the dated instruction
in `schedule`. Two days early, and the first Navy Edit mention now precedes the briefed start.

---

## Repeated near-identical beats — and where each came from

Four clusters. **The sources matter, because two of them are the client's own brief, not the
generator.**

### Cluster 1 — Hannah "the colour you've been asking for" ×3

| date | title | source |
|---|---|---|
| 08-13 | Hannah Colour Reveal — The Colour You've Been Asking For | `content_asks` → `colour-reveal-hannah` |
| 08-19 | Navy Edit Piece Feature — Long Sleeve Hannah, the One You've Been Waiting For | assembler (Navy Edit build-up) |
| 08-26 | Hannah Navy — The One You Asked For Is Almost Here | assembler |

Plus `08-28` WSG Hannah Navy (briefed). **Four Hannah posts, three with the same "you asked
for this" framing.** Only one is briefed.

### Cluster 2 — Emily sweatshirt ×4

| date | title | source |
|---|---|---|
| 08-11 | Sweatshirt Superiority — Emily Is Just a Sweatshirt (Or Is It) | `content_asks` → `sweatshirt-superiority` |
| 08-20 | Navy Edit Piece Feature — Emily Midnight Restock | assembler |
| 08-21 | WSG — Emily Sweatshirt Midnight | **`schedule` (briefed)** |
| 08-29 | Ours vs Theirs — Emily Luxe Sweatshirt | assembler |

`08-20` and `08-21` are **consecutive days both on Emily Midnight**. `08-11` and `08-29` are
both "why our sweatshirts beat the competition" — the second has no brief origin.

### Cluster 3 — wardrobe simplicity ×3 — *this one is the brief's own doing*

| date | title | source |
|---|---|---|
| 08-04 | Hard-Working Wardrobe — Organic Cotton Staples | `content_asks` → `hard-working-wardrobe` |
| 08-05 | Brand Values Moment — The Big Moments and the Small Ones | `content_asks` → `brand-values-moment` |
| 08-06 | Wardrobe Simplicity — Decision Fatigue and the Easy Fix | `content_asks` → `wardrobe-simplicity` |

Three consecutive days from **three separate client asks that say nearly the same thing**
(items 4, 5 and 6 of the original brief). The generator treated each as distinct because the
client wrote each as distinct. Not a generator fault — but three near-synonyms on consecutive
days is what the operator is seeing.

### Cluster 4 — colour reveal ×2 on consecutive days

`08-12` and `08-13`, both "who can guess the colour" (clusters 1 and 3's pattern again). Both
from `content_asks`.

### And the deleted Sunday Style series

Five Sunday Style posts were generated and the operator deleted all five.
**`client_planning_config.recurringSeries` contains WSG, Notes from the Founder, and What Our
Customers See — Sunday Style is not in it**, and it appears nowhere in the brief. The operator
was right to delete them; the question of why they were generated is a generator question,
recorded here and not chased.

> Also noted: `recurringSeries` has WSG at **`dayOfWeek: Saturday`**, while the brief and the
> plan both use **Friday**. The plan followed the brief, correctly. The stored config is stale.

---

# 3. Voice profile

**Location:** `voice_snapshots`, row `0a71c1bc-7b27-4b09-b4da-d44cbe3608b4`, ivy-t / instagram,
`is_current = true`, `reason = 'operator-seed'`.
**Size:** 17,352 chars / 207 lines. **Last modified:** `2026-06-29 21:32:25` (created and
updated same instant — seeded, never edited since). Seven superseded snapshots exist; the
newest superseded one is 16,098 chars from earlier the same day.

**Not identical** to `docs/calibration/ivy-t-2026-07/real-voice.md` (17,539 bytes) — close, but
the calibration copy is not a byte-for-byte dump of the live row.

## Section headings

| live profile (9) | derived file (8) |
|---|---|
| Instagram — Voice Profile | Instagram — Voice Profile |
| **Brand principles (client-stated)** | — |
| Tone & personality | Tone & personality |
| Sentence & structure | Sentence & structure |
| — | Point of view / register |
| Vocabulary | Vocabulary |
| Formatting conventions | Formatting conventions |
| **CTA style** | — |
| **Signature phrases** | Signature moves |
| **Replication notes** | — |
| — | **Do / Don't** |

**Rule count** (bulleted rules): **live 60**, derived 73.

## Coverage: in the DERIVED file, not in the live profile

Judgement-free, no merging. Four confirmed:

| rule | derived ref |
|---|---|
| **Second-person "you/your" used throughout** — the reader is always directly addressed | `:32` |
| **Gentle humour, self-deprecating** — sparing, never forced | `:12` |
| **Quality by subtraction** — value expressed by what the clothes do *not* have (no logos, no contrast stitching) | `:84` |
| **Cost-per-wear / longevity as a named claim-backing argument** | `:9`, `:98` |

The last is partial: the live profile has the *principle* ("Never leave a claim unexplained")
but not cost-per-wear or longevity as named arguments.

> **Correction to the brief's stated candidate.** The **size-credit-in-brackets convention is
> already in the live profile** — under **"Outfit credits"**, and in more detail than the
> derived file carries it: live specifies the `Item - Brand` format, spaced hyphen not em
> dash, `|` or line-break separation, *and* that size and height are always noted. Derived has
> only the bracket placement. It is not a gap in either direction; live is the stronger of the
> two.

## Coverage: in the LIVE profile, not in the derived file

| rule |
|---|
| **Brand principles (client-stated)** — an entire section with no derived counterpart |
| **Replication notes** — an entire section, incl. "the most common error when replicating Sally's voice" |
| **The Ivy litmus test** (applied to every draft) |
| **Writing against AI patterns** |
| **WSG ≠ Sunday Style — do not conflate them** (opposite registers: WSG = I, Sunday Style = we) |
| **Register beats whoPosts** — a "Sally posting" tag does not make a post first-person |
| **Product naming convention** — proper garment name + full fabric description on first mention |
| **Technical accuracy matters** |
| **Sustainability is embedded, not announced** |
| **Jargon** (what to avoid) |
| **Sally's voice vs. brand voice** |
| **Timing language** |
| **Series formats** |

Derived does cover register in general (`:29`, founder "I" incl. WSG) and garment
personification is in **both** (live `:178`, derived `:33`) — neither is a gap.

**Shape of the difference:** the derived file is observational (what the captions *do*, with
caption-number evidence); the live profile is operational (what a writer *must do*, with
failure modes named). They are not competing versions of the same document.

---

# 4. Hand-tidy checklist

Ordered, minimal. Nothing here is applied — every item is the operator's to judge.

## Fix first — the one that can ship wrong

1. **`08-28` Navy Edit Launch — set the posting time to 7pm.** Stored `postingTime` is the key
   `launch`, which config maps to **6am**; the brief and the post's own title say **7pm**.

## Delete (4)

2. **`08-26` "Hannah Navy — The One You Asked For Is Almost Here"** — third of three
   near-identical Hannah "you asked for it" beats, and it sits two days before the briefed WSG
   Hannah on the 28th. Keep `08-13` (the briefed colour-reveal ask) and `08-19` (the Navy Edit
   piece feature).
3. **`08-29` "Ours vs Theirs — Emily Luxe Sweatshirt"** — duplicates `08-11`'s
   sweatshirt-superiority ask, which is the one the client actually briefed. No brief origin.
4. **`08-05` "Brand Values Moment"** *or* **`08-06` "Wardrobe Simplicity"** — pick one. With
   `08-04` these are three near-synonymous posts on consecutive days. The three client asks
   behind them say nearly the same thing, so this is a judgement about their brief, not a bug.
5. **`08-27` — the untitled preserved edit.** Delete *or* give it a title. It has an 861-char
   caption and no title, format `reel`, pillar "New idea". As it stands it renders as raw
   caption text. If the caption is wanted, retitle it; if it is a leftover from the 19th,
   remove it.

## Move (2)

6. **`08-12` Colour Reveal → 08-17 or later.** The brief says Navy Edit talk starts
   **from the 14th**; this lands on the 12th. Moving it past the 14th also breaks up the
   `08-12`/`08-13` colour-reveal pair.
7. **`08-20` Emily Midnight Navy Edit feature → 08-24 or 08-25.** Currently the day before the
   briefed WSG Emily Midnight on the 21st — two Emily Midnight posts back to back.

## Check, don't assume (1)

8. **`08-14` WSG — confirm "Mocha".** The brief said "Lily tee and Sophie short co-ord set"
   with no colourway; the title says "Lily **Mocha** and Sophie **Mocha**". Correct it or
   confirm it.

## Add (0)

**Nothing briefed is missing.** All eight dated commitments are present on their briefed dates.

## Then re-check cadence

After deletions 2–5 the month sits at **23–24 live posts** against a configured minimum of
**28/month, 7/week**. If that floor is real, 4–5 beats need adding back — the safest sources
are the unused parts of the client's own brief rather than new invention. If the floor is
stale (it was set when the config also said WSG posts on Saturdays), it is worth correcting
the config in the same pass.

---

## Recorded, not acted on

- **Sunday Style is generated but not configured** — not in `recurringSeries`, not in the
  brief. Five were produced; the operator deleted all five. Worth knowing why the generator
  produces it.
- **`recurringSeries` has WSG on Saturday**; brief and plan both say Friday. Config is stale.
  The plan followed the brief, which is the right precedence.
- **The 4 September WSG (Long Sleeve Orla)** was correctly identified by extraction as
  *"falls outside plan month August 2026"* and filed in `content_asks` rather than placed.
  That is the out-of-month case handled properly.
- **`08-09` (Sunday) has no post at all**, and the week's Sunday Style was placed on Saturday
  `08-08`. Moot now — that row is deleted — but the placement was wrong before it was removed.
