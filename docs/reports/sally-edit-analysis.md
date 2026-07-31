# Sally's edits — ivy-t, July & August plans

**Date:** 2026-07-27 · **PROD**, read-only (`default_transaction_read_only=on`, verified `on`).
**Fingerprint:** `SELECT slug FROM clients` → `ivy-t`, `sprigly`. **earl-of-east absent** → proceeded.
**Client:** ivy-t (`c79cf1c5-b51d-4a9b-aedc-48577df43e8f`), instagram.
**Cycles:** `2026-06` (July plan, `scheduled`) · `2026-07` (August plan, `workbook_built`).
No writes.

## What the data is (and isn't)

`post_edits` is the **instructed caption-shape log**: one row per "shape this" action, with the
client's `instruction`, `caption_before`, `caption_after`, `passed`. It captures caption edits
only. **Structural edits** (time, format) are not here — they live in `plan_activity`
(`rescheduled`, `format_changed`) and are folded into §2 and §4.

A large share of `post_edits` rows are **not edits of Sprigly-generated copy** — they are Sally
**drafting from a seed** (title "New idea", `caption_before` ≈ 33–150 chars). Those are the tool
working, not corrections. Split, per `caption_before` length:

| cycle | seed-generation (<150) | true edit of a caption (≥150) | plan-scope |
|---|---|---|---|
| July (2026-06) | 7 | 18 | 1 |
| Aug (2026-07) | 2 | 3 | 0 |

§1–§3 focus on the **21 true edits** — the ones that tell us what generation got wrong.

---

## 1. Edit inventory (true edits, before→after on the changed region)

### July plan (2026-06) — 18 true edits across 12 posts

| date | post (date · format) | instruction | field(s) | before → after (changed region) |
|---|---|---|---|---|
| 07-01 | July opener · single | suggest some hashtags | +hashtags | (no tags) → 5 tags appended at end |
| 07-01 | Emma Dark Olive · single | get rid of the fruit pastille analogy | caption/analogy | "less than a single **fruit pastille**" → "Less than the cost of a single **text message** used to be" |
| 07-01 | Emma Dark Olive · single | Not text messages - always tie it to a piece of fruit | caption/analogy | "single **text message**" → "single **grape**" |
| 07-06 | 08-06 · single | Make it shorter | length | 1225 → 997 chars |
| 07-08 | Connie Sweatshirt · reel | add more about why the polyester content makes the bobbles | +explanation, time | "Because of the polyester content." → +full mechanism ("plastic fibre… break down… migrate to the surface… tangle into bobbles"); **"6pm" → "7pm"**; dropped "hormone disrupting" |
| 07-09 | 07-28 · single | Warmer tone | register | her raw draft (en-dashes, run-ons) → clean Ivy voice (short sentences, 🤍, "seam that digs in", 🫶) |
| 07-09 | 07-19 · single | re write the caption | length | 3557 → 1221 chars |
| 07-17 | 07-21 · single | can you re-write the caption | rewrite, em-dash | 232 → 511; **1 em dash → 0** |
| 07-17 | 07-21 · single | make it more sustainable focussed | register/theme | 498 → 525 |
| 07-18 | Organic Cotton reel | re-write this sentence - Using 91% less water and 62% less energy | factual/claim | one sentence reworked, length ≈ flat |
| 07-18 | 07-27 · reel | draft a caption based on the hook | (seed-ish) | 33 → 521 |
| 07-19 | 07-28 · single | add more possible clothing irritations to this paragraph | +addition | 881 → 979 |
| 07-19 | Customer Quotes: Connie · carousel | change this post to quote this customer talking about how well our garments last | factual/content | 884 → 777, quote swapped |
| 07-19 | Customer Quotes: Connie · carousel | add a second version of this post on August 25th | +duplicate/structural | new dated variant created |
| 07-22 | WSG: Maggie Almond · carousel | make the caption more focussed on a great outfit for a day out with kids | register/focus | 953 → 1052 |
| 07-22 | WSG: Maggie Almond · carousel | re write this section - Practical without looking like I've tried to be practical | rewrite | 965 → 904 |
| 07-22 | WSG: Sally Grey Marl · carousel | re-write this to be about our green/navy block stripe Sally. dont put colour names with a capital letter | **factual (wrong product)** + style | "Sally Sweatshirt in **Grey Marl** 🩶 … grey marl" → "Sally Sweatshirt in **navy/green stripe** 💚 … green and navy combination" |
| 07-27 | 07-30 · reel | re-work this to say its the darkest shade of navy but as versatile as black | register/positioning | "Midnight … works harder than you'd expect" → "Midnight is the **darkest shade of navy** … Not quite black, not quite navy, but honestly better than both" |

### August plan (2026-07) — 3 true edits across 3 posts

| date | post | instruction | field(s) | note |
|---|---|---|---|---|
| 07-21 | Anti-Polyester Education · carousel | Reframe as a summer holiday post | register/reframe | 1218 → 1051 |
| 07-22 | WSG — Maggie Grey Marl · carousel | make this about grey marl Maggie. Also talk about how adding a necklace elevates… | factual (product) + addition (styling) | 847 → 998 |
| 07-27 | 08-01 · single | shape the post | rewrite/polish | 509 → 716 |

**Structural edits (`plan_activity`, not caption):** July — **8 posts rescheduled** (14 move actions),
**4 format changes**. August — 2 rescheduled, 1 format change.

---

## 2. Pattern analysis (grounded), frequency

Classifying the 21 true caption edits + structural moves:

| category | July | Aug | what it looks like |
|---|---|---|---|
| **Register / tone / focus rewording** | 6 | 2 | "warmer tone", "more sustainable focussed", "focussed on a day out with kids", "reframe as a summer holiday post", section rewrites |
| **Factual correction** (product / colour / date / claim) | 5 | 1 | fruit-pastille→fruit (×2), wrong colourway (Grey Marl→navy/green stripe), 6pm→7pm, customer-quote swap, water/energy sentence |
| **Addition** (what generation omits) | 4 | 1 | hashtags on a launch post, the polyester→bobble **mechanism**, more clothing irritations, styling tips (necklace), a duplicate dated variant |
| **Structural** (length / time / format) | 2 caption + 8 resched + 4 fmt | 1 caption + 2 resched + 1 fmt | "make it shorter", drastic shortenings; reschedules; format swaps |
| **Deletion** (things she strips) | ~1 | 0 | dropped "hormone disrupting" from the polyester claim; trims inside rewrites |

The dominant true-edit categories are **register rewording** and **factual correction**, roughly
tied. Pure **deletions are rare** — she adds and re-frames far more than she strips.

**Iteration:** 7 July posts needed **more than one** edit (e.g. Emma Dark Olive took two passes to
land the fruit rule; WSG Maggie took two). Multi-pass edits are the strongest calibration signal.

---

## 3. Voice-profile cross-check

Live profile = the current `voice_snapshots` row generation reads (`is_current`, 2026-06-29,
17.3 KB). A newer on-disk `clients/ivy-t/memory/voice.md` (2026-07-15) exists but post-dates the
snapshot generation used during these edits.

### Rules PRESENT and being FOLLOWED (no edits — the profile is working)

- **Em dashes** — profile: *"Do not use them in captions"* (§Em dashes). Across 22 edited captions,
  only **one** carried an em dash into `before`, and she stripped it (07-17). Generation has
  internalised this. ✅
- **Sign-offs** — profile: *"The majority of posts do NOT use a sign-off… treating 'Love, Sally x'
  as the default closer… strips the warmth"* (§Closing sign-offs). Sign-offs appear on exactly the
  3 posts where they belong (WSG/personal) and she **kept** them (1→1); generation is not
  over-applying them. ✅
- **Hashtags** — profile: *"Default: no hashtags unless specifically promoting a product launch."*
  Generation omitted them; Sally added 5 once, on a launch post — i.e. she invoked the exception,
  not corrected an error. ✅
- **Short-sentence Ivy register** — the "warmer tone" output nails the profile's concrete-friction
  anchors (*"the seam that digs in"*) and rhythm. When asked, generation applies the voice well. ✅

### Rules PRESENT but IGNORED / mis-executed → generation-prompt problems

| pattern | profile rule (present) | what generation did |
|---|---|---|
| **Cost-per-wear anchor** | §Replication: *"Ground abstractions in concrete, relatable anchors. '20 pence a day' → '(about the same as 1 banana)'"* | Obeyed the *rule* (used an anchor) but picked **"a single fruit pastille"** — a sweet, not a piece of fruit. Two edits to fix. |
| **Polyester / pilling claim** | §Replication: *"Never leave a claim unexplained… Pilling gets tied to polyester content."* | Gave the *link* ("Because of the polyester content") but not the **mechanism**; Sally added the full physical why. Rule half-satisfied. |
| **Restock time** | (catalogue fact, not voice) | Generated **6pm**, corrected to **7pm** — a factual grounding miss the profile can't prevent. |
| **Correct colourway** | §Replication: *"Always state the colourway on first mention… Always use the garment's proper name."* | Wrote the **wrong product** — "Sally in Grey Marl" when the slot was the navy/green stripe Sally. A catalogue/brief grounding failure, not a voice gap. |

### Rules ABSENT → profile gaps (calibration-merge candidates)

1. **The value anchor must be a piece of fruit.** The profile has the *concrete-anchor* rule and a
   "1 banana" example, but not the binding rule Sally enforced twice: cost-per-wear comparisons are
   **always a single piece of fruit** (grape, banana) — never a sweet ("fruit pastille") and never
   an abstract cost ("a text message"). *Candidate rule to add.*
2. **Depth for the flagship polyester/pilling argument.** "Tie pilling to polyester" exists; the
   *expected depth* does not. For this signature claim Sally wants the physical mechanism —
   *plastic fibres break down under wash heat/friction, migrate to the knit surface, tangle into
   bobbles* — not a one-line "because of polyester". *Candidate: a worked template for the claim.*
3. **Descriptive colour combos are lowercase.** Profile capitalises product names and established
   colourways (Midnight, Grey Marl) and says "state the colourway", but is silent on *descriptive*
   combinations. Sally's rule: *"dont put colour names with a capital letter"* → "navy/green
   stripe", not "Navy/Green Stripe". *Candidate: a capitalisation carve-out.*

---

## 4. Volume + trend + the silent successes

| | July (2026-06) | Aug (2026-07, so far) |
|---|---|---|
| live posts | 24 | 29 |
| posts with a caption edit | 10 | 5 |
| posts rescheduled / format-changed | 8 / 4 | 2 / 1 |
| **posts untouched entirely (generated, left as-is)** | **10 / 24 (42%)** | **23 / 29 (79%)** |
| total instructed shapes (incl. seed-generation) | 26 | 5 |
| true caption edits | 18 | 3 |
| true edits per live post | 0.75 | 0.10 |
| posts needing >1 edit | 7 | 0 |

**The trust numerator — untouched, generated posts — rose from 10/24 (42%) to 23/29 (79%).** Read
with two caveats: (a) August is `workbook_built` and still in-flight, so its edit count is a
floor, not a final; (b) July's volume is inflated by Sally using the shaper to **draft** 7 posts
from seeds, which is adoption, not correction. Even so, the direction is clear: fewer passes, more
posts accepted clean, and the remaining edits concentrate on **factual grounding** (colourway,
time) and **claim depth** rather than voice — the voice mechanics (em dash, sign-off, hashtags,
register) are largely solved.

---

## What to act on

- **Two profile gaps to merge** (voice team): the *fruit-only value anchor* and the *lowercase
  descriptive colour combo* — both pinned by repeated, explicit edits.
- **One template to add**: the polyester/pilling mechanism, so the flagship claim generates at the
  depth Sally rewrites it to.
- **Two grounding fixes** (not voice — generation inputs): the generator wrote the **wrong
  colourway** and a **wrong restock time**. These are catalogue/brief grounding, and no voice rule
  will catch them; they need the correct product + schedule facts in the generation context.
</content>
