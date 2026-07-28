# Round 5.1 — colour correction + impeccable re-review

> ⚠️ **DEGRADED: single-context.** The critique playbook wants two isolated assessments. Both
> subagents failed on this run — one stalled mid-stream on an API error, the other was interrupted —
> so the critique and the audit were run in the main context instead. Mechanical checks were run as
> scripts rather than delegated, which is the more reliable half of that trade; the design judgement
> below carries the usual single-perspective caveat.

Branch `dev`. Docs only. Two commits.

---

## 1. The colour correction

**Chosen tier: `accent-650` = `#43998B`. White on it measures 3.40:1.**

Selected by screenshot against two neighbours at the same hue and saturation:

| Candidate | White on it | Screenshot verdict |
|---|---|---|
| `#47A394` | 3.03:1 | white rendered thin; no margin over the 3.0 graphic floor |
| `#449C8E` | 3.29:1 | acceptable, but no better than the chosen tone |
| **`#43998B`** | **3.40:1** | **chosen** — white stays crisp at 13.5px/700 |

It lands on the operator's own `#3D9A8B` expectation at the same hue. `accent-600` (`#4DB0A0`, the
logo tone) stays non-text identity only; `accent-700`/`800` are unchanged for dense-text surfaces.

### Screenshot verdicts

Rendered headless at 1400×1450, and the nav band again at 2× device scale for a real-size read.

| Surface | Verdict |
|---|---|
| `Generate` pill | white crisp, no fringing |
| Nav pill selected segment | white crisp at 13.5px/700 |
| Mic circle | white glyph clean on the fill |
| Selected day numeral | clean |
| `DRAFT` badge | clean |
| Summary chip, sheet primaries | clean |

No `chrome-deep`-on-green survives anywhere in the built CSS.

### The gate check — answered

The stop condition was: if the admin activation gate would **block**, stop before committing.

`activateTheme` → `themeActivatable` (`packages/engine/src/contrast.ts`) blocks on exactly one pair:
`accent-800` on `accent-100` ≥ 4.5:1. Sprigly Mint is `#285C54` on `#E3F3F0` = **6.67:1 → PASSES.**

`accent-650` is never gate-checked — it has no slot in `ThemeTokens`. **No block, no stop.** Two
non-blocking build consequences are recorded in spec §12b: there is no `accent650` key in
`THEME_TOKEN_KEYS` or in `app/src/lib/theme.ts`'s `VAR` map, and the admin's reported contrast table
will not show the deviation.

---

## 2. The four pressure tests

**1. Does the three-green system read as one family, or as a mistake?**
**One family.** Hue and saturation are locked across the ramp (H 170.3°, S 39.1%); `600` and `650`
sit ~5% apart in lightness and never meet at a size where comparison is possible. `600` appears only
as 4–6px dots, a glow, and waveform bars; `650` only as fills of 24px and up. The one adjacency that
could expose the seam — a 4px `accent-600` dot ~30px beneath a `650`-filled selected day — is
imperceptible at that size. It reads as intentional.

**2. The icon-only nav pill at real size.**
White on `650` is crisp. The calendar and checklist glyphs communicate. The **rounded square for Day
is the weakest glyph in the set** — selected it is carried by the word beside it, but unselected it
is a bare rounded rect that could read as a checkbox, particularly two segments along from a
checklist that also uses ticks. Labels remain the designated cheap reversal (round-3 ruling 1).
Geometry measured, not eyeballed: three 92px segments, icon centres at 35 / 146 / 241px in a 292px
pill — exactly even.

**3. The voice sheet composition.**
The mic is unambiguously the hero and it breathes. Framing → mic → hints → toggle is a clean
four-beat vertical with the weight where it belongs. Two weaknesses, both listed below: the prompt
list reads as tappable when it is not (B2), and the silent and speaking states differ too little
(B4).

**4. The detail-sheet action row — destructive vs dismissive vs primary.**
Split verdict.
- **Destructive: instant.** Solid `danger` with a white icon and label is the only saturated fill on
  the surface. Unmissable.
- **Dismissive: mis-signalled.** In shape mode the cancel is a small red button. One screen earlier a
  red button of the same family *deletes the post*. The same colour is doing "discard this
  instruction" and "destroy this content" — the notes call the cancel "kin to Delete", but a cancel
  is the opposite of a delete: it is the safe way out.
- **Primary: unlabelled.** The shape submit is a wide green bar carrying a bare arrow — maximum area,
  minimum information — and the same is true of the typed-mode submit in the voice sheet.

---

## 3. Findings — three buckets

### (a) Applied in this commit

Every one is a factual error or a direct self-contradiction. No design decisions were reversed.

| # | Where | What was wrong |
|---|---|---|
| 1 | `sprigly-mobile.css` `.navpill button[aria-selected]` | Comment read "a fill carrying a word is 700-tier with white. 5.47:1" directly above a rule using `accent-650`. Wrong tier, and 5.47 matches no pair in the system |
| 2 | `sprigly-mobile.css` `.wday[aria-pressed] .num` | "THE VIVID RULE: brightest fill, **dark ink**. 5.88:1" above a rule that now sets white |
| 3 | `sprigly-mobile.css` `--t-accent-700` | Described as "fill when it must carry white" — that is `650`'s job now. Ratio 5.62 was correct |
| 4 | `sprigly-mobile.css` `.fmt` | `accent-800` on `accent-100` cited as 6.80:1; it is **6.67:1** |
| 5 | `sprigly-mobile.css` `.wave` | `accent-500` on `chrome-deep` cited as 7.86:1; it is **6.99:1** |
| 6 | `DESIGN.md` Components → nav | "active segment is `accent-600` with `chrome-deep` ink (5.60:1), and so is the mic" — contradicted DESIGN.md's own ink rule 160 lines above |
| 7 | `DESIGN.md` Components → day strip | "`accent-600` circle with `chrome-deep` numeral" — same contradiction |
| 8 | `DESIGN.md` do-list | "Flip the ink on vivid fills: `chrome-deep` on `accent-600`" — a standing instruction to do the thing round 5.1 removed |
| 9 | `DESIGN.md` do-list | 7.86:1 → 6.99:1 (the same doc cited 6.99 correctly 25 lines later; the two disagreed) |
| 10 | spec §0 row **R2** | Struck through and marked superseded by round 5.1; both cited ratios were wrong (2.49 → **2.61**, 5.88 → **5.60**) |
| 11 | spec §6b pairing table | Had **no `accent-650` row at all** and still pointed at `white on accent-700` as "when a fill must carry white". Brought into line with DESIGN.md; `chrome-deep on accent-600` marked no-longer-used; the gate row tagged |
| 12 | spec §11 | Re-asserted the invented "white on coral-600 only at 14px+/500" threshold. No such threshold exists in WCAG. Restated as a house rule over the two elements it actually governs |

Items 6–11 are the substantive ones: the round-5.1 ink ruling had been applied to the stylesheet's
*code* but not to the prose describing it, in either governing document. A build read from DESIGN.md
alone would have shipped the old scheme.

### (b) Vetoed — conflicts with a recorded operator decision

| # | Finding | Decision it conflicts with |
|---|---|---|
| V1 | **Delete out-weights everything on the detail sheet.** A solid saturated red block is the strongest object on a reading surface whose common action is "read the caption, maybe move it". The usual resolution is destructive-but-not-dominant | Round-4 **S1**: "Delete is a solid danger fill with white icon and label: destructive actions should not have to be inferred from a colour of text" |
| V2 | **The shape-mode cancel is red**, overloading danger onto a dismissive action (see pressure test 4) | Round-4/5 S-series: "a submit and a smaller destructive cancel, kin to Delete" |
| V3 | **Two full-width primaries are wordless arrows** (typed-mode submit, shape submit) while every other primary in the set gained a word — `Generate`, `Move`, `Shape`, `Delete`, `Yes, write them` | Round-4 V-item: "a single full-width arrow pinned at the foot of the sheet" |
| V4 | **`i-nav-day`'s rounded square is the weakest glyph in the set** (see pressure test 2) | Icon choices are a protected decision; round-3 ruling 1 upheld icon-only with labels as the designated cheap reversal |
| V5 | **A completed task is a filled circle with no checkmark** — the tick is an empty `<span>` | Icon choices. Not an a11y defect: the label is struck through and muted, so colour is not the only channel |

My recommendation on V2 and V3, since the pressure test was asked for: give the shape cancel a
neutral treatment and put a word on both arrows. V1 I would leave — the argument in S1 is sound.

### (c) Real, but belongs to the build

| # | Finding |
|---|---|
| B1 | **Touch targets under the project's own ≥40px floor**: `.readypill` 34px (this is `Generate`, the primary approval action), `.todaybtn` 34px, `.navbtn` 32px, `.bulb` 30px. `.tab` is 38px. `.navpill button` (44px) and `.navmic` (56px) pass. Hit-area expansion is visually inert and belongs in the build, but the numbers should not be inherited silently |
| B2 | **Non-interactive elements styled as tappable chips.** The three voice-sheet prompts and the two shape suggestions are `<li>`s rendered as bordered full-width capsules — the universal form of a suggestion chip. Two valid resolutions (make them buttons that seed the field, or de-style them into a quiet hint list). Not applied because the choice is the operator's, and it is a behaviour decision |
| B3 | **The experiment marker is described three different ways.** Spec §0 **DR2** says "the banner pill carries the whole meaning"; spec §7 says "*(no word — a lightbulb icon)* · Tap: 'A new idea we're trying this month.'"; mockup 02 frame C renders a bare 30px corner bulb with no label, no tap affordance, and no banner — and its caption still claims "a banner pill and nothing else". Round 4 removed the tooltip on the grounds that a marker needing explanation has failed; the marker as built has no explanation *and* is not self-evident. Separately, it occupies the time slot, so the experiment post is the only card in the set that states no time |
| B4 | **Silent and speaking voice states differ too little.** Only the waveform and the heading change; the mic itself is identical in both. The distinction the waveform exists to draw is carried by the waveform alone |

### Real, left standing — outside the three buckets

The detector's `flat-type-hierarchy` hit on **08-reshape-rollup** is genuine phone UI (all 14
`.item`s are inside the frame), not review chrome: 12.5 / 13.5 / 15px, a 1.2:1 ratio. Left as-is
because the hierarchy there is carried by case, weight and colour — the 12.5px line is uppercase and
letterspaced, a distinct role rather than a smaller version of the same one — and the detector
measures size only. Changing the type scale of a dense itemised receipt is a design decision, not a
correction, so it is flagged rather than applied.

---

## 4. Checked and dismissed

Recorded because each looked like a defect and was not:

- **09-approval "heading skip" (h2 → h4).** The convention across all ten pages is h4 = post card
  title, h2 = sheet heading, h3 = in-sheet section, applied consistently. The skip is an artifact of
  several simulated screens sharing one review document, not a document-structure defect.
- **Nav pill "right-hand dead zone".** My read of the 2× crop was wrong. Measured: three 92px
  segments, icon centres 106px apart, last segment ending 5px from the pill's padding edge. Exactly
  even.
- **Narrow-viewport clipping at 460px.** A screenshot-crop artifact — Chrome headless clamps its
  viewport to a 500px minimum, so a 460px-wide capture of a 500px page cuts the right edge. Probed
  `documentElement.scrollWidth` against `clientWidth` on all 11 pages at 500px and 1400px: **zero
  horizontal overflow anywhere.** The ≤480px breakpoint could not be exercised headlessly and
  remains unverified.

Also verified clean across all 11 pages: no duplicate `id`s, no `<use href="#…">` pointing at a
symbol absent from that file's sprite, balanced `div`/`button`/`nav`/`section` tags, and every
icon-only control carrying an `aria-label`.

---

## 5. Detector

**12 findings, unchanged before and after this commit** — 10 × `em-dash-overuse`,
2 × `flat-type-hierarchy`. Run across the default, `type` and `layout` scopes and deduplicated.

- `em-dash-overuse` — all 10 are in review-document prose, not product UI.
- `flat-type-hierarchy` — `index.html` is review chrome (that page contains no `.phone` at all);
  `08-reshape-rollup.html` is genuine phone UI and is addressed above.

Zero findings inside a `.phone` frame other than the 08 one. The ignore registry is unchanged: 7
`ignoreValues`, `ignoreRules: ["single-font"]`. No new ignores were registered — and as recorded in
DESIGN.md, the detector ships **no static contrast rule**, so there is nothing to suppress for the
white-on-green deviation; contrast is only evaluated on rendered-URL scans.

---

## 6. Commits

| | |
|---|---|
| **Commit 1** | `a1034b2` — *docs: accent-650, and white on green* |
| **Commit 2** | *docs: the ink rule, propagated* — this file, plus the 12 applied corrections above. Referenced by subject, not hash: a commit cannot contain its own hash, and amending to add one only changes it again |
