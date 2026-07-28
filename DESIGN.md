---
name: Sprigly — client plan surface
description: An iOS-native, day-focused plan surface for phone review, painted entirely from admin-managed theme tokens.
colors:
  accent-500: "#74C1B5"
  accent-600: "#4DB0A0"
  accent-650: "#43998B"
  accent-700: "#327267"
  accent-800: "#285C54"
  accent-100: "#E3F3F0"
  chrome: "#334155"
  chrome-deep: "#1E293B"
  muted: "#5C6470"
  border: "#8F9296"
  line-soft: "#F4F5F6"
  canvas: "#F2F3F5"
  surface: "#FFFFFF"
  danger: "#B23A2E"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  wordmark:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  cardTitle:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  secondary:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.1em"
  tab:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "8.5px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
rounded:
  sm: "9px"
  md: "14px"
  card: "16px"
  lg: "20px"
  sheet: "26px"
  shell: "44px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent-650}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "50px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.chrome}"
    rounded: "{rounded.md}"
    height: "50px"
  nav-mic:
    backgroundColor: "{colors.accent-650}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    size: "56px"
  nav-pill-active:
    backgroundColor: "{colors.accent-650}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.chrome}"
    rounded: "{rounded.lg}"
    padding: "13px 14px 14px"
  badge:
    backgroundColor: "{colors.accent-650}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  badge-quiet:
    backgroundColor: "{colors.accent-100}"
    textColor: "{colors.accent-800}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  day-selected:
    backgroundColor: "{colors.accent-650}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    size: "34px"
  action-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.chrome}"
    rounded: "{rounded.card}"
    height: "68px"
---

# Design System: Sprigly — client plan surface

## Overview

The client plan surface is an **Operate** surface: a founder completing a task on a phone,
one-handed, between other things. Scanability, native expectation and consistency outrank
expression. The brand lives in precise details — the vividness of one accent, the shape of a
status marker, the honesty of a sentence — not in decoration.

The governing commitment is that it **reads as an iOS app, not a website**. Two decisions carry
most of that: the native system type stack, and a floating bottom nav — a segmented pill for the
three views, with a separate circular microphone beside it — sitting over the content on a
blurred material.

Colour is **not owned by this file**. The platform has an admin-managed Themes system: one global
active theme, tokens injected as CSS custom properties at the layout root, activation AA-gated on
tint/text pairs. Everything below names tokens. The hexes in the frontmatter are the currently
**active theme, Teal v1**, recorded so the system can be seen — not so it can be hard-coded.

## Colors

**Token contract.** Client surfaces consume `--t-accent-600 / -700 / -800 / -100`, `--t-chrome`,
`--t-chrome-deep`, `--t-muted`, `--t-line`, `--t-line-soft`, `--t-canvas`, `--t-surface`,
`--t-danger` — the same custom properties `app/src/lib/theme.ts` injects. A client surface never
writes a hex.

**The ramp comes from the logo.** The mark is `#4DB0A0` — H170.3°, S39.1%, L49.6%. Its *second*
leaf is not a second colour: the SVG carries `opacity="0.78"` on it, which renders `#74C1B5` over
white. **One identity tone, not two.** Every tier below is that hue and saturation at a different
lightness, so the ramp and the mark cannot drift apart.

| Tier | Value | Job |
|---|---|---|
| `accent-100` | `#E3F3F0` | tint |
| `accent-500` | `#74C1B5` | the mark's lighter leaf — non-text vivid |
| `accent-600` | **`#4DB0A0`** | **the logo tone.** Non-text identity: dots, glow, waveform |
| `accent-650` | **`#43998B`** | **filled controls + white ink** |
| `accent-700` | `#327267` | dense-text surfaces |
| `accent-800` | `#285C54` | accent text |

### The ink rule

> **Filled controls: `accent-650` + white (3.40:1).** `accent-600` remains non-text identity
> (dots, glow, waveform). `700`/`800` are unchanged, for dense-text surfaces.

**This is an operator-recorded deviation below AA-normal, not an oversight.** Rounds 3, 4 and 5
each tried a different answer to "what ink goes on a green fill" — chrome-deep on 600, then white
on 700, then chrome-deep on 600 again — and the operator has now ruled the same way three times:
**filled green controls carry white.** `accent-650` is the tier that makes that as defensible as
it can be: the lightest value on the logo's hue and saturation that still clears the 3:1 graphic
floor **with margin**. The literal lightest (`#47A394`, 3.03) rendered white visibly thin and left
no headroom at all.

The deviation is scoped and justified on three grounds, all of which have to hold:

1. **The labels are short and bold** — `Day`, `Month`, `Tasks`, `Generate`, `DRAFT`, `NEW`, a day
   numeral. None is reading matter; all are ≥13px at weight 700, and several are 16px.
2. **Platform-feel precedent.** iOS system buttons ship white-on-green at roughly **2.2:1**. At
   3.40 this surface is materially better than the convention it is deliberately imitating.
3. **It is never the only channel.** Selection is also carried by fill-vs-none, position and
   `aria-selected`; the badge's meaning is also carried by the dashed card it sits on.

**Where it does not apply.** Any surface carrying *sentences* — captions, rationales, receipts,
prose of any kind — uses `chrome`/`muted` on `surface`, or `accent-800` on `accent-100` at 6.67.
The deviation buys short labels on fills and nothing else.

**On registering this with the detector:** there is nothing to suppress today. The static detector
ships **no contrast rule** — verified, `detect.mjs` contains zero occurrences of the string — so
contrast is only evaluated on rendered-URL scans, which these file-based mockups never trigger. An
ignore registered now would be against an invented rule id and would read as coverage that does not
exist. **If a contrast finding does appear** (most likely a URL scan of the built app), scope the
ignore to these components only — `.navpill`, `.navmic`, `.readypill`, `.wday .num`, `.badge`,
`.sumbar`, `.btn.primary`, `.shapefoot .submit` — with the reason above. Never blanket.

Measured pairs:

| Pair | Ratio | Verdict |
|---|---|---|
| **white on `accent-650`** | **3.40** | ⚠️ **filled controls only** — scoped deviation above |
| `accent-800` on `accent-100` | **6.67** | ✅ **the admin activation gate's one check** |
| `accent-800` on `surface` | 7.64 | ✅ accent text on white |
| `accent-700` on `surface` | 5.62 | ✅ |
| white on `accent-700` | 5.62 | ✅ dense-text surfaces |
| white on `accent-800` | 7.64 | ✅ |
| `chrome-deep` on `accent-100` | 12.78 | ✅ |
| white on `accent-600` | 2.61 | ❌ — which is why 650 exists |
| white on `accent-500` | 2.09 | ❌ never |
| `accent-600` on `surface` / `canvas` | 2.61 / 2.35 | ❌ never as text or a meaningful glyph |
| white on `danger` | 5.94 | ✅ the Delete button |
| `border` on `surface` | 3.13 | ✅ hairlines only (graphic floor) |
| `chrome` / `muted` on `surface` | 10.35 / 5.98 | ✅ |

**Non-text uses (nothing on top of them):** day pips and month dots, the highlight wash and edge on
a changed card, the glow under the mic, waveform bars, focus rings, the completed-task tick. The
**selected-day pip stays accent and is never white** — it sits below the numeral on canvas, not on
the fill, so white made it vanish.

**Where accent may never go:** small text on white or canvas, any meaningful icon sitting directly
on accent-600, and status meaning carried by hue alone.

**accent-500 `#74C1B5` is a proposal, not yet a platform token.** It is the mark's own lighter leaf,
so adopting it costs nothing conceptually: one column in the admin Themes editor and one entry in
`theme.ts`'s `VAR` map.

**Neutrals.** `canvas` behind everything, `surface` for cards and sheets, `border` at ~30% alpha
for hairlines and ~55% for a border meant to be noticed (dashed draft edges). `danger` is for
**system failure the operator owns** and for **destructive actions the client chooses** (iOS puts
Delete in red). It is never used to report that something broke to a client.

## Typography

**One family: the native system stack.** `-apple-system, BlinkMacSystemFont, 'SF Pro Text',
system-ui`. On the device it resolves to SF Pro Text, which is what every other app on the phone
uses, and matching it is most of what makes an interface read as an app rather than a website. It
also matches the admin surface's sans, so operator and client screens share a voice.

**Fraunces does not appear on the client app surface.** Reviewed across three operator rounds:
round 1 used it for display moments, round 2 narrowed it to the wordmark and month title, round 3
removed it. It stays available to marketing and the website.

The wordmark is the single exception, set in **Plus Jakarta Sans 800** — the app's existing
`font-logo` token.

Hierarchy comes from **weight and size, never from a second family**:

| Role | Size | Weight | Tracking |
|---|---|---|---|
| `display` — month title, day header | 22px | 700 | −0.03em |
| `title` — sheet titles | 20px | 700 | −0.025em |
| `wordmark` | 17px | 800 | −0.02em |
| `cardTitle` | 16.5px | 600 | −0.02em |
| `body` — caption prose, field text, strip numerals | 15px | 400–600 | normal |
| `secondary` — teasers, meta prose, status | 13.5px | 500 | normal |
| `meta` — times, counts, chips, segment labels | 12.5px | 600 | normal |
| `label` — section eyebrows | 11px | 700 | +0.1em, uppercase |
| `tab` — nav-pill labels | 10.5px | 600 | +0.01em |
| `micro` — the date on the Move icon | 8.5px | 700 | +0.02em |

**Ten roles, and no step closer than ~1.1 to its neighbour by accident.** Round 3 collapsed a
ramp that had drifted to nineteen sizes — 12, 12.5, 13, 13.5 and 14 were all in play, doing jobs
that were not five different jobs. If two roles need the same size they are the same role; give
them the same name.

Tabular numerals (`font-variant-numeric: tabular-nums`) on times, counts and tallies.

## Layout

390px is the design width (iPhone logical viewport). 20px gutters leave 350px of usable line.

**The frame, top to bottom:**

1. Status bar
2. **Header** — wordmark left-aligned
3. **Title row** — `‹ Month Year ›`, with the **Ready to go** pill right-aligned on a draft month
4. **Today**, right-aligned, immediately above the week strip
5. **Week strip** (Day view) or **month grid** (Month view)
6. **Content panel** — the selected day only; no week feed, no scroll-spy
7. **Floating bottom nav** — the `Day · Month · Tasks` pill and the microphone, over the content

**Day, Month and Tasks are peer views**, reached through the nav pill. Month is not a modal and
carries no ✕; **tapping any day in the grid returns to Day view with that day selected**.

**One day at a time.** The strip selects; the panel renders that day and nothing else.

**Density rule** for a day holding several posts: 0 → an add slot; 1–2 → full cards; 3–4 → compact
rows (time · title · chevron); 5+ → rows with "＋N more". Compact rows drop the format icon and
pillar to the detail sheet, because a row carrying both leaves ~150px for a title and truncates
every real one to uselessness.

## Elevation & Depth

Three levels, no more:

- **Card:** `0 1px 2px rgb(51 65 85 / .04), 0 6px 18px rgb(51 65 85 / .06)`. Barely there — it
  separates, it does not lift.
- **Sheet:** `0 -18px 50px -12px rgb(51 65 85 / .28)`, over a `rgb(30 41 59 / .34)` scrim.
- **Accent glow:** the FAB and the reshape highlight only —
  `0 10px 26px -6px rgb(var(--t-accent-600) / .55)` plus a `0 0 0 6px` halo at ~18% alpha.

Draft cards have **no shadow at all** — a dashed edge on canvas, deliberately flatter than a
committed card, because provisional things should not look settled.

**Never** a glow behind text, and never a shadow to signal state; state is shape, fill and label.

## Shapes

| Element | Radius |
|---|---|
| Cards, row lists | 20px |
| Sheets (top corners) | 26px |
| Buttons, fields, add slots | 14–16px |
| Format icon tiles | 9–11px |
| Pills, badges, day numerals, FAB | 999px |
| Grid cells | 14px |

Squircle-ish generosity over tight corners; nothing sharp. Dashed 1px edges mean provisional and
nothing else.

## Components

**Floating bottom nav.** A segmented pill carrying **Day · Month · Tasks**, and a **separate**
56px circular microphone beside it. Both float over the content on a blurred material
(`backdrop-filter: blur(20px) saturate(180%)`, `surface` at 78%), iOS-style. The pill's active
segment is `accent-650` with **white** ink (3.40:1) per the ink rule, and so is the mic, which
carries an `accent-600` glow beneath it. Sheets slide **over** the nav. The pill's children are `flex: 1`, so Insights
drops in as a fourth segment without layout change.

This supersedes both the round-3 bottom tab bar and the header Week|Month switcher. One place to
change view, one place to talk.

**The microphone is state-aware and never inert.** On a draft month it reshapes the month
directly; on a committed month it runs the post-cutoff agent, which raises proposals the client
approves. Same gesture, different consequence, and the sheet says which.

**Approval pill.** `Ready to go`, right-aligned on the title row in the space the switcher
vacated. Persistent, secondary weight — hairline `accent-600` border, `accent-800` label on
`surface`. It never competes with the mic for primacy.

**Day strip.** Seven cells. Selected day = `accent-650` circle with a white numeral. Today
unselected = `accent-600` ring. A day with content carries a pip below: `accent-600` on a draft
month, `chrome` on a committed one.

**Cards.** Committed: `surface`, hairline, card shadow. Draft: dashed `border` at 55%, no shadow.
Changed: solid `accent-600` edge, `accent-100` wash, "New" badge — the one draft card that is not
dashed, because it is the one that changed while you were looking.

**Format icons** replace word chips everywhere: clapperboard (reel), stacked squares (carousel),
framed image with a horizon (single). 17px inside a 28px tile, `accent-800` on `accent-100`. The
word survives as `title` and screen-reader text only.

**Action rows** are three equal-width buttons filling the row: icon with the **label below**, and
`Move` carrying its current date **above** the icon. They read as buttons — `surface` fill,
hairline, and a real pressed state. Round 3 shipped these icon-only and round 4 restored the
labels, which is the reversal round 3 recorded in advance as the cheap one to make.

**Detail sheet.** Header (format icon, title, date/time, insights toggle) → Caption / Hook /
Script tabs, caption default, each with a copy control → the action row. Reasoning lives behind
the insights toggle. **Shape** replaces the tab content in place; it does not stack a popover.
Copy exists **only here** — it belongs beside the words it copies, not on the card.

**Voice sheet.** One sheet, two input modes: microphone with a live waveform — clean accent green
on white, no backing panel — or a keyboard toggle that swaps it for **one large field** filling
the sheet body, with a single full-width submit pinned at the foot. Same framing copy, same
submit, same route. This is the only place the framing copy for the month lives.

**Summary chip.** Fixed 48px. A one-line change and a fourteen-item brief cost the same vertical
space. Expands into a panel; dismiss removes the chip and never the highlights.

## Do's and Don'ts

**Do**

- Paint from tokens. `var(--t-accent-600)`, never `#14B8A6`.
- Fill controls with `accent-650` and set them in white. Keep `accent-600` off text entirely.
- Let the accent be loud where it carries no text — pips, glows, washes, waveforms.
- Put the most saturated moment on the darkest field. `accent-500` on `chrome-deep` is 6.99:1 and
  is allowed to be beautiful.
- State status with shape as well as colour. "On its way" is a hollow ring, not a hue swap.
- Use the native stack everywhere, and get hierarchy from weight and size.
- Keep 44px on anything a thumb must hit while walking.

**Don't**

- Don't put white on `accent-600` (2.61:1) or `accent-500` (2.09:1). Filled controls use `650`.
- Don't put `chrome-deep` on any green fill. That answer was tried and ruled against three times.
- Don't extend the 3.40 deviation past short bold labels on filled controls. Sentences never.
- Don't invent a second identity tone. The mark's two tones are one colour and an opacity.
- Don't use accent for small text on white. Accent text exists only as `accent-800` on
  `accent-100`.
- Don't reintroduce a second typeface on the client surface. Fraunces is out; this was decided
  three times.
- Don't use `danger` on a client screen. Failure is the operator's.
- Don't nest cards in cards, or wrap a list of cards in another card.
- Don't reach for purple, purple gradients, or anything that reads as the competitor.
- Don't let a receipt or a banner push the day's content off the fold.
- Don't use bounce or elastic easing. `cubic-bezier(.22,.61,.36,1)`, 120–280ms.

**Open proposal — a fifth tier (`accent-500` `#74C1B5`).** Every theme today ships four accent
tiers (600/700/800/100). The fifth is the mark's own lighter leaf, and it gives the system a
sanctioned home for light fills and non-text vivid work currently improvised from `accent-600` at
alpha. It takes `chrome-deep` ink at 6.99:1, so it needs no new rule. One column in the admin
Themes editor, one entry in `theme.ts`'s `VAR` map. The mockups demonstrate it; the platform does
not yet ship it.

**Note on the active theme.** The ramp above replaces the generic Teal v1 values with the logo's
own. If Teal v1 is to remain the shipped theme it should be re-keyed to these five values, since
the point of the exercise was that the identity tiers match the mark.
