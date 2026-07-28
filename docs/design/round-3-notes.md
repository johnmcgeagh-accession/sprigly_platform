# Round 3 — impeccable init, critique, and revision

**Date:** 2026-07-28 · branch `dev` · docs only
**Commits:** `3656cb6` *docs: design context for the client plan surface* ·
and the commit carrying this file, *docs: mobile plan surface, round three*.
(A commit cannot contain its own hash; `git log --oneline -2` has both.)

---

## 1. What ran

| Step | Result |
|---|---|
| `/impeccable init` | `PRODUCT.md` written at repo root. Platform recorded as **`web`** per the init rule that mobile web stays `web`; the iOS-native intent is recorded as a brand commitment instead, which is where it belongs |
| `DESIGN.md` | Written in the same pass. **Note:** `init` writes `PRODUCT.md` only — `DESIGN.md` is the `document` route. Both were asked for, so both were produced, and the procedural difference is recorded rather than glossed |
| Detector, before | 14 findings (10 advisory em-dash) |
| `critique` — Assessment A | Ran as an isolated sub-agent. Full report |
| `critique` — Assessment B | **Partial.** Died mid-stream on an API error after completing its detector runs. Its deterministic half is covered by my own runs; its rendered-defect sweep did not finish, and I did that pass myself |
| Detector, after | 90 → **16**, then → **10 advisory + 3** once the review-document chrome was excepted |

**On the degraded half.** `critique.md` requires both assessments and a `⚠️ DEGRADED` banner if
either is run inline. Assessment A ran properly as a sub-agent. Assessment B ran as a sub-agent and
crashed after its detector work but before its visual sweep. Not a failed run under the playbook's
own definition — the detector ran — but stated plainly rather than presented as a clean two-agent
critique.

---

## 2. Critique findings — applied

Assessment A converged hard with the operator's round-3 brief. Five of its priority issues were
already on the list, which is a good sign for both.

| Finding | Status |
|---|---|
| **P1** No bottom tab bar; DESIGN.md names it as a carrier of the iOS commitment, and its absence is why five frames ended in 300–500px of unanchored canvas | Applied (already R4) |
| **P2** Fraunces declared but never loaded, so both “brand moments” rendered as **Georgia** | Applied (already R3). The critique found the mechanism; the operator had independently called the decision |
| **P3** FAB overprints body copy — in `02` it sat **on top of the evidence sentence**, the product's differentiator | Applied. `.panel` bottom padding 30px → 116px |
| **P3b** Unlabelled tick guards the money | Applied (already R7) |
| **P4** White on accent-600 fails; the “14px+/500 floor” cited in round-2 comments **is not a real WCAG threshold** | Applied. That was my invention in round 1 and it propagated for two rounds. The vivid rule replaces it |
| **P5** ✕ on the month view, beside the wordmark where it reads as “close the app”; and a legend | Applied (already M1/M2/R5) |
| `.row .rchev` at ~2.6:1, the only cue a compact row is tappable | Applied — now `--t-muted` |
| `.wday.out` at 45% alpha ≈2.2:1 yet looks tappable | Applied — 72% |
| Everything above the day header centred; iOS uses left-aligned titles | Applied — wordmark and title row both left |
| Zero `--t-*` tokens; palette is coral while the active theme is Teal v1 | Applied (already R1) |
| `08`'s sheet edge slicing the month title mid-word | Applied — sheet 90% → 92%, so the cut lands under the wordmark |
| `05` frame C stacked a second sheet over the first | Applied — write-again replaces the tab content in place |
| No “Today” in any file | Applied (already R6) |
| Copy is two taps deep on the surface where copying is the job | Applied — copy control now on the committed card |
| Type ramp had drifted to nineteen sizes; 12/12.5/13/13.5/14 all in play | Applied — ten named roles, declared in `DESIGN.md` frontmatter |

---

## 3. Critique findings — **ruled on**

Raised by the critique, contradicting a decision already made. All three were put to the operator
and **ruled on 2026-07-28**; the rulings are recorded inline below.

1. **“The action row should keep its text labels.”** Assessment A argued the round-2 labelled row
   was right for a non-technical founder and that DESIGN.md was wrong to remove them. This
   contradicts G5 / R10 (icon-only).

   **RULING: upheld as-is.** Icon-only stands, with `aria-label`s and 44px targets.

   **The designated cheap reversal.** If the **September demo shows hesitation** at the action row —
   a client pausing over the icons, asking what one does, or tapping the wrong one — restoring
   labels is the first thing to try. It is deliberately cheap: `.act` is already a column flex with
   the icon on top, so a label is one `<span>` per button and one line of CSS, with no change to
   the row's geometry, target sizes or `aria-label`s. Nothing else in the sheet moves. Recorded
   here so the reversal is a decision taken in advance rather than a redesign under pressure.

2. **“The FAB should be *copy the next caption*, not approve.”** Approval happens once a month;
   copying happens ten times. On a draft month the brief assigns the FAB to the mic (DR2), so this
   only concerned the **committed** month, which round 3 shipped with no FAB at all.

   **RULING: the copy-next-caption suggestion is rejected — but the FAB is never inert.** On a
   committed month the FAB is **still the microphone**, and it means *talk to your plan*. That is
   the existing post-cutoff agent path (`POST /api/plan/agent` → `runPlanAgentTurn`), which already
   ships.

   The critique's underlying complaint was right — a committed month with no persistent action is a
   dead surface — but copy is a per-post action and belongs on the card, which is where round 3 put
   it. The FAB carries the one thing that is about the *month*.

   **One consequence worth stating plainly:** the two mics do different things. On a draft month the
   mic **reshapes the month directly**. On a committed month it **raises proposals the client then
   approves** — the agent applies nothing itself. Same gesture, same icon, different consequence,
   and the sheet has to say so. Wiring in the spec, §5.4.

3. **`single-font` detector finding** — “only font used is `var(--sans)`; pair a display font with
   a body font.” Contradicts R3, which is the typography decision made three times.

   **RULING: registered as an ignore.** `detector.ignoreRules` now carries `single-font`, project
   wide, with the reason *“single native family is the reviewed platform-feel decision, three
   rounds.”* The principle: **the detector channel stays clean, and deliberate exceptions live in
   config rather than as permanent warnings** — a warning you have decided to ignore forever trains
   you to ignore the channel.

   **One honest limitation.** `detector.ignoreRules` is a plain string array in
   `.impeccable/config.json`; unlike `detector.ignoreValues`, it has **no `reason` field**, so
   `hook-admin.mjs` accepted the `--reason` flag and stored nothing. The reason is recorded here and
   in the spec instead. Worth knowing before someone reads the bare config and wonders why the rule
   is off.

4. **Terminology objections.** A flagged “Not sent yet” as ambiguous (*sent to whom?*), “Hook” and
   “Script” as content-marketing jargon sitting beside “Caption”, and the rollup's
   “1 launch · 2 series · 3 events” as five internal classifier categories handed back to a client
   who wrote prose. The brief says the **terminology table is unchanged**, so none were touched.
   “Not sent yet” is the one I would look at again: it is the state label for a whole month and it
   implies a recipient. (It has in fact left the draft lead line as redundant with the badge — but
   it survives elsewhere.)

5. **Red `Delete`.** A flagged it as contradicting DESIGN.md's “don't use `danger` on a client
   screen”. On inspection **the mockup is right and my DESIGN.md line was too broad**: iOS uses red
   for destructive actions the *user chooses*; the ban is on red for *system failure*. I narrowed
   the rule in the stylesheet comment rather than changing the mockup, and the distinction is now
   explicit.

6. **“No post-approval state — peak-end has no end.”** True and worth building; not in the brief.
   Spec §13, open question 2.

---

## 4. Icons v2 — screenshot check

Required by G3, and the check earned its keep.

| Icon | Result |
|---|---|
| **carousel** — stacked squares | Passed first attempt. Reads at 17px |
| **single** — framed image, sun, horizon | Passed first attempt |
| **reel** — clapperboard | **Failed twice.** Three variants tested at 17px in a 28px tile |

The clapperboard variants:

- **A, angled slate** — charming at 4×, illegible mush at 17px.
- **C, outlined slate with two hairline diagonals** — reads as *browser chrome* or a window. This
  was the first attempt, and at 4× it looks fine, which is exactly the trap.
- **B, filled slate with negative slashes cut out** — **adopted.** Unmistakable at 17px. A solid
  dark bar with two light slashes is the shape people actually recognise.

The slashes are filled `var(--t-accent-100)` — the tile's own colour — so the icon is correct
wherever the tile goes. That is its one constraint on reuse, noted in `_sprite.txt`.

Tab-bar icons (plan / tasks / insights at 22px) and action icons (move, write, delete, copy,
keyboard, info at 20px, bulb at 17px) all passed at their rendered sizes.

---

## 5. The vivid proposal

**The problem.** Teal v1's `accent-600` (`#14B8A6`) measures **2.49:1 against white** — worse than
coral's 2.89 — so white text or a white glyph on it fails both the AA text floor (4.5) and the
graphic floor (3.0). The reflex is to darken the fill until white passes, which is how a surface
ends up dull. Round 1 and 2 dodged this by citing a “14px+/500 white-on-accent floor” that **does
not exist in WCAG**; the critique caught it.

**The answer: flip the ink, not the fill.**

> `chrome-deep` on `accent-600` = **5.88:1**

That keeps the brightest tier on the largest surfaces — selected day, FAB, badges, summary chip,
primary buttons — and passes AA. Same move as a black-on-bright-green Spotify button.

**Where the accent is loudest:** the voice sheet's waveform, `accent-500` on a `chrome-deep`
field at **7.86:1**. The most saturated moment in the product costs nothing, because a dark field
is where a bright accent is *most* compliant, not least.

**The proposal: a fifth tier, `accent-500` = `#2DD4BF`.** Non-text by definition — glows, waveform
peaks, highlight washes, dark-field accents. It needs **no new AA rule** for exactly that reason,
and its only text-adjacent use measures 7.86:1. Cost: one column in the admin Themes editor, one
entry in `theme.ts`'s `VAR` map. Demonstrated in the mockups, **not adopted** in the platform.

Full measured table in the spec, §6b.

---

## 6. Detector

| Run | Findings |
|---|---|
| Before round 3 | 14 (10 advisory em-dash, 2 flat-type, 1 single-font, 1 side-tab) |
| After writing `DESIGN.md`, before the type pass | **90** — the new design-system rules fired on 56 off-ramp font sizes and 19 off-scale radii |
| After consolidating the ramp | **16** |
| After excepting review-document chrome | 13 (10 advisory em-dash, 2 flat-type, 1 single-font) |
| After the `single-font` ruling | **12** — 10 advisory em-dash, 2 `flat-type-hierarchy` |

The 90 was the useful number: it said the system I had *declared* was thinner than the system I had
*built*. The fix was both directions — declare the real ten-role ramp in `DESIGN.md`, and collapse
the genuinely redundant steps in the CSS.

Ignores registered, all narrow and reasoned, in `.impeccable/config.json`:

- `overused-font` × 4 native-stack values — *"native stack chosen deliberately for iOS-native
  platform feel; reviewed by operator across three rounds."*
- `design-system-color #DFE1E5`, `design-system-font-size 30px`, `design-system-font
  Sfmono-Regular` — all review-document chrome, not product UI.

`single-font` is now ignored project-wide (ruling 3, §3).

**Two `flat-type-hierarchy` findings are left firing, and were not ruled on.** One is the rollup
panel (12.5 / 13.5 / 15px, a 1.2 ratio against the rule's 1.25) — three genuinely distinct roles,
and inserting a fourth step to satisfy the ratio would make the panel worse. The other is
`index.html`, which is review-document chrome. Neither is silenced: unlike the single-family
decision, these are judgement calls a future reader should get to re-make.

---

## 7. Remaining gaps

The spec's list is current at **twelve**. New or changed this round:

- **1** widened from read to **read *and* write** — the date picker now edits posting time.
- **8** promoted to blocking: the voice sheet ships live, so `source:'voice'` on
  `/api/plan/draft/apply` should land with it.
- **11 new:** a cross-month move works at the API level but the surface never says where the post
  went. Copy and a toast, no API.
- **12 new:** the Insights tab has nothing behind it. Drawn at 32% to prove the bar's geometry.

**Gap 7 remains the blocking one** and is first in the build order: removing the client's retry
affordance removes their only recovery path. Bounded retry exists; the daily sweep and the operator
surface do not.
