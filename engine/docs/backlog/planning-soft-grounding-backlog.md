# Planning Backlog — Soft Catalogue Grounding for Multi-Product Outfit Blocks

Deferred from the 2026-06-30 verification run of the register-map / em-dash fixes
(cycle c702fac2). Consciously scoped out: the HARD catalogue net already makes the
output safe; this item is about reducing how many invalid product+colourway
pairings reach that net, because the volume creates manual cleanup for the client.

---

## 1. Supporting-piece colourway invention in multi-product outfit blocks

**What it is**

When the planner drafts a post that styles several garments together (Sunday Style
outfit sets, WSG looks, launch outfit carousels, styling guides), it should give
each *supporting* piece a colourway that actually exists for that piece in the
client's catalogue — or omit the colourway entirely — rather than inventing one or
borrowing the hero piece's colourway. The hero/launch piece is usually grounded
correctly; the supporting pieces are where it guesses.

**Current state — what exists and what doesn't**

Two layers exist today:

- **SOFT grounding (generation):** the generation prompt is fed a `PRODUCTS` block
  (`inp.catalogueGrounding` in `apps/worker/src/content-cycles/planning.ts`) listing
  the client's real products and actual colourways, with the instruction "Use ONLY
  products and colourways from this list. NEVER invent a product name or a colourway."
  This is a single flat list for the whole client, not scoped to the specific
  products being styled in a given post.

- **HARD validation (deterministic, post-critic):** a catalogue pass rewrites any
  product+colourway pairing not in the catalogue to a neutral "[confirm colourway]"
  placeholder plus a Sprigly note (`tracer.catalogue(...)` in `planning.ts`). This is
  the safety net and it works — no invalid pairing reaches the client.

The gap is between them: SOFT grounding is not constraining the model on supporting
pieces. Given a flat catalogue list and a multi-product block, the model frequently
either invents a plausible colourway or cross-applies the hero piece's colourway to
a supporting piece. The HARD net then has to rewrite it.

**Evidence (cycle c702fac2, 2026-06-30 run)**

8 posts triggered catalogue rewrites (~16 invalid pairings), 8 of 22 posts = 36%,
up from 3 in the June baseline. (Different generations, so not a controlled A/B, but
the volume and concentration are clear.) Because the register + em-dash churn is now
gone, total loop steps dropped 152 → 79, so catalogue invention is now the dominant
remaining repair driver. Two failure modes:

- *Invented colourway for a supporting piece:* `mabel in ecru` (#3, #4),
  `anna in grey marl` / `claire in white` (#8), `nicola in dark olive` (#20),
  `mabel in plum` / `rose in rose` (#21).
- *Hero-colourway bleed* (the "Connie in plum" mode): in the Nicola launch posts
  (#15, #17), supporting pieces inherited Nicola's `vintage navy / ecru raglan`
  colourway — `claire in … raglan`, `anna in vintage navy`, `joy in navy`.

Both cluster on multi-product blocks (Sunday Style, WSG, launch carousels, styling
guides); single-product posts are largely clean.

**Cost/risk of not having it**

Low and bounded — the output is SAFE (HARD catches every invalid pairing and flags it
with the real colourways). The cost is manual: multi-product launch Sunday Styles come
out placeholder-heavy ("[confirm colourway]"), which is extra resolution work for the
client (Sally) on exactly the most product-forward, highest-effort posts. It does not
ship anything wrong; it just under-delivers on the draft's completeness.

**Possible approaches** (pick at build time; not decided)

- Scope the grounding: when a post styles specific products, feed the prompt the valid
  colourways for *those* products (per-post product subset), not just the flat list.
- Explicit omit-if-unsure instruction: when the model is not certain a supporting
  piece comes in a colourway, name the piece without a colourway rather than guess.
  (voice.md already allows omitting the colourway on non-hero mentions.)
- Anti-bleed instruction: state that the hero piece's colourway does NOT transfer to
  other named pieces in the same outfit.

**Trigger to build**

When placeholder volume on multi-product posts becomes a recurring client complaint,
or when launch Sunday Styles / outfit carousels become a larger share of the plan. Not
load-bearing while volume is occasional; it is a draft-quality / client-effort
optimisation, not a correctness fix (the HARD net owns correctness).

---

## Related follow-up (separate)

"Brand" category register de-overloading — see migration
`0048_planning_register_map.sql` header. The generator files Ours-vs-Theirs and
founder notes under "Brand" (register-mixed); routing them to dedicated
register-homogeneous categories would let the register map use a safe blanket default.
