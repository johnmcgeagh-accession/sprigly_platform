# Catalogue HARD-Validator — False Positives

Surfaced by the colourway-fix verify run (cycle c702fac2, 2026-06-30). Once the SOFT
grounding fix stopped genuine colourway invention, the HARD validator's own false
positives became the *dominant* source of catalogue flags. Per-flag analysis of that
run: **14 of 14 remaining flags were validator artifacts, 0 were genuine invention**
(9 proximity-misattribution, 5 compound-colourway). The captions were correct; the
validator was wrong.

**Why this matters:** the flags exist so the client (Sally) can confirm a real
colourway before posting. False flags on *correct* captions erode trust in the flag
itself — if half the flags are wrong, she stops reading them, and a genuine
fabrication slips through unnoticed. Fixing these makes the flags trustworthy again.

Both items are **precision** fixes — they must reduce false POSITIVES without
weakening detection of the true positive (a real "wrong product + wrong colourway"
fabrication, the original "Elle in dark olive" case). HARD stays the safety net.

---

## 1. Compound (slash) colourways treated atomically

**What it is**

Some catalogue colourways are compound strings, e.g. Nicola's only colourway is
`"Vintage Navy / Ecru Raglan"`. The validator matches the whole string, so a caption
that says "Nicola in Vintage Navy" or "Nicola in Ecru Raglan" — referring correctly
to a *component* of that two-tone colourway — is flagged, because "vintage navy" does
not equal "vintage navy / ecru raglan".

**Evidence (this run)**

5 of the 14 flags: `nicola in vintage navy` (#14, #16), `nicola in ecru` (#16, #18,
#22). All five captions are correct references to Nicola's real two-tone colourway.

**Fix**

When indexing a product's colourways, also register the components of slash-separated
colourways (split on `/`, trim) as valid for that product. "Vintage Navy" and "Ecru
Raglan" both count as valid Nicola colourways. Keep the full string valid too.
Code: `indexCatalogue` / `validateText` in `apps/worker/src/catalogue/validate-catalogue.ts`.

**Risk note**

Low. Components are still bound to their own product, so this does not let one
product's colourway match another — it only stops flagging a correct component
reference.

---

## 2. Proximity misattribution in dense outfit lines

**What it is**

The validator binds a colourway to the nearest product noun within a window, so in
multi-product outfit lines it attaches a colourway to the WRONG adjacent product:

- `"Joy Shorts and white trainers"` → flags `joy in white` (white is the trainers).
- `"Claire Skirt in Navy with the Nicola in Ecru Raglan"` → flags `nicola in navy`
  (navy is Claire's) and `claire in ecru` (ecru is Nicola's).
- `"The Mabel in Navy or Grey Marl. The Hannah Midweight in Ecru or Cornflower. The
  Audrey…"` → cross-attributes every colourway to the wrong neighbouring product
  (all 4 flags on post #8), even though each pairing in the caption is correct.

**Evidence (this run)**

9 of the 14 flags. In every case the caption's actual product+colourway pairing is
valid; the validator paired a colourway with a different nearby product.

**Fix**

Bind a colourway only to the product it is grammatically attached to (e.g. the
"<Product> in <Colourway>" pattern, or "<Product> … in <Colourway>" with no
intervening product/noun), rather than to the nearest product within a character
window. Tighten the proximity heuristic so an unrelated noun ("trainers") or the next
product in the list cannot capture a colourway. Code: `validateText`.

**Risk note**

Medium — tightening proximity must not lose the true-positive case ("This week, Elle
in dark olive is the one") where the product and a wrong colourway ARE grammatically
bound. The existing unit test for that case (`validate-catalogue.test.ts`) must keep
passing; add fixtures for the proximity false-positives above as regression guards.

---

## Trigger to build

Now-ish. With genuine invention ≈ 0 (after the SOFT fix), the remaining flags are
mostly false, so trust erosion is already active. Bundle the two together — both live
in `validate-catalogue.ts` and both need the same regression fixtures.

## Related

SOFT-grounding fix that drove invention to ~0: commit `d468c2e`. The earlier
"Brand de-overloading" register follow-up: `0048_planning_register_map.sql` header
and `docs/backlog/planning-soft-grounding-backlog.md`.
