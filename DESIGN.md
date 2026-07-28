---
name: Sprigly — client plan surface
description: An iOS-native, day-focused plan surface for phone review, painted entirely from admin-managed theme tokens.
colors:
  accent-500: "#2DD4BF"
  accent-600: "#14B8A6"
  accent-700: "#0F766E"
  accent-800: "#0C5F58"
  accent-100: "#E6F7F5"
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
    backgroundColor: "{colors.accent-600}"
    textColor: "{colors.chrome-deep}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "50px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.chrome}"
    rounded: "{rounded.md}"
    height: "50px"
  fab:
    backgroundColor: "{colors.accent-600}"
    textColor: "{colors.chrome-deep}"
    rounded: "{rounded.pill}"
    size: "62px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.chrome}"
    rounded: "{rounded.lg}"
    padding: "13px 14px 14px"
  badge:
    backgroundColor: "{colors.accent-600}"
    textColor: "{colors.chrome-deep}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  badge-quiet:
    backgroundColor: "{colors.accent-100}"
    textColor: "{colors.accent-800}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  day-selected:
    backgroundColor: "{colors.accent-600}"
    textColor: "{colors.chrome-deep}"
    rounded: "{rounded.pill}"
    size: "34px"
  tabbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    height: "56px"
---

# Design System: Sprigly — client plan surface

## Overview

The client plan surface is an **Operate** surface: a founder completing a task on a phone,
one-handed, between other things. Scanability, native expectation and consistency outrank
expression. The brand lives in precise details — the vividness of one accent, the shape of a
status marker, the honesty of a sentence — not in decoration.

The governing commitment is that it **reads as an iOS app, not a website**. Two decisions carry
most of that: the native system type stack, and a bottom tab bar with a floating action button
over it.

Colour is **not owned by this file**. The platform has an admin-managed Themes system: one global
active theme, tokens injected as CSS custom properties at the layout root, activation AA-gated on
tint/text pairs. Everything below names tokens. The hexes in the frontmatter are the currently
**active theme, Teal v1**, recorded so the system can be seen — not so it can be hard-coded.

## Colors

**Token contract.** Client surfaces consume `--t-accent-600 / -700 / -800 / -100`, `--t-chrome`,
`--t-chrome-deep`, `--t-muted`, `--t-line`, `--t-line-soft`, `--t-canvas`, `--t-surface`,
`--t-danger` — the same custom properties `app/src/lib/theme.ts` injects. A client surface never
writes a hex.

**The vivid rule — the one that matters.** Accent-600 is the brightest tier that may cover a
large area, and white text on it measures **2.49:1**, which fails both the AA text floor (4.5)
and the graphic floor (3.0). The instinct is to darken the fill. Don't:

> **Flip the ink, not the fill. Accent-600 fills carry `chrome-deep` ink — 5.88:1.**

That keeps the brightest teal on the biggest surfaces (the selected day, the FAB, loud badges,
primary buttons) and passes AA comfortably. It is the same move a black-on-bright-green Spotify
button makes, and it is what lets this surface be vivid without arguing with the gate.

Measured pairs in the active theme:

| Pair | Ratio | Verdict |
|---|---|---|
| `chrome-deep` on `accent-600` | **5.88** | ✅ the vivid rule — fills with ink |
| white on `accent-700` | 5.47 | ✅ when a fill must carry white |
| `accent-800` on `accent-100` | 6.80 | ✅ the only way accent becomes small text |
| `accent-500` on `chrome-deep` | **7.86** | ✅ maximum vividness, on dark |
| `accent-600` on `chrome-deep` | 5.88 | ✅ |
| white on `accent-600` | 2.49 | ❌ never |
| `accent-600` on `surface` / `canvas` | 2.25–2.49 | ❌ never as text or as a meaningful glyph |
| `border` on `surface` | 3.13 | ✅ hairlines only (graphic floor) |
| `chrome` / `muted` on `surface` | 10.35 / 5.98 | ✅ |

**Where accent may be vivid (non-text, no glyph over it):** day pips and month dots, the highlight
wash and edge on a changed card, the reshape glow, progress and waveform bars, focus rings, the
FAB's halo.

**Where accent may never go:** small text on white or canvas, any meaningful icon sitting directly
on accent-600, and status meaning carried by hue alone.

**accent-500 `#2DD4BF` is a proposal, not yet a theme token** — see §Do's and Don'ts. It exists in
this system only on `chrome-deep` fields, where it reaches 7.86:1 and is the most saturated moment
in the product.

**Neutrals.** `canvas` behind everything, `surface` for cards and sheets, `border` at ~30% alpha
for hairlines and ~55% for a border meant to be noticed (dashed draft edges). `danger` is
**operator-facing only** — the client surface has no error red.

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
| `tab` — tab-bar labels | 10.5px | 600 | +0.01em |
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
3. **Title row** — `‹ Month Year ›` with the **Week | Month** segmented switcher
4. **Today**, right-aligned, immediately above the week strip
5. **Week strip** (Week view) or **month grid** (Month view) — peers, not overlay and overlaid
6. **Content panel** — the selected day only; no week feed, no scroll-spy
7. **Bottom tab bar** — Plan | Tasks, persistent, designed to take 3–4 tabs
8. **FAB**, floating bottom-right above the tab bar

**Week and Month are peer views**, reached and left through the switcher. Month is not a modal and
carries no ✕.

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

**Bottom tab bar.** 56px, `surface`, hairline top border, icon over 10.5px label. Active tab uses
`accent-800` for its icon and label; inactive uses `muted`. Sized so a third and fourth tab
(Insights, when the insight layer ships) drop in without layout change.

**FAB.** 62px circle, `accent-600` fill, `chrome-deep` glyph, accent glow + halo. Floats
bottom-right, clearing the tab bar. **On a draft month the FAB is the microphone** — the primary
action is telling us something, not approving.

**Week | Month switcher.** Segmented, on the title row. `aria-pressed` on both segments.

**Day strip.** Seven cells. Selected day = `accent-600` circle with `chrome-deep` numeral. Today
unselected = `accent-600` ring. A day with content carries a pip below: `accent-600` on a draft
month, `chrome` on a committed one.

**Cards.** Committed: `surface`, hairline, card shadow. Draft: dashed `border` at 55%, no shadow.
Changed: solid `accent-600` edge, `accent-100` wash, "New" badge — the one draft card that is not
dashed, because it is the one that changed while you were looking.

**Format icons** replace word chips everywhere: clapperboard (reel), stacked squares (carousel),
framed image with a horizon (single). 17px inside a 28px tile, `accent-800` on `accent-100`. The
word survives as `title` and screen-reader text only.

**Action rows** are **icon-only** — move, write again, delete, copy — with `aria-label`s and 44px
targets. Labels under icons were removed in round 3.

**Detail sheet.** Header (format icon, title, date/time, insights toggle) → Caption / Hook /
Script tabs, caption default, each with copy → icon-only action row. Reasoning lives behind the
insights toggle. Write-again replaces the tab content in place; it does not stack a popover.

**Voice sheet.** ~90% height. One sheet, two input modes: microphone with a live waveform, or a
keyboard toggle that swaps the waveform for a text field. Same framing copy, same submit. This is
the only place the framing copy for the month lives.

**Summary chip.** Fixed 48px. A one-line change and a fourteen-item brief cost the same vertical
space. Expands into a panel; dismiss removes the chip and never the highlights.

## Do's and Don'ts

**Do**

- Paint from tokens. `var(--t-accent-600)`, never `#14B8A6`.
- Flip the ink on vivid fills: `chrome-deep` on `accent-600`.
- Let the accent be loud where it carries no text — pips, glows, washes, waveforms.
- Put the most saturated moment on the darkest field. `accent-500` on `chrome-deep` is 7.86:1 and
  is allowed to be beautiful.
- State status with shape as well as colour. "On its way" is a hollow ring, not a hue swap.
- Use the native stack everywhere, and get hierarchy from weight and size.
- Keep 44px on anything a thumb must hit while walking.

**Don't**

- Don't put white text or a meaningful glyph on `accent-600` (2.49:1).
- Don't use accent for small text on white. Accent text exists only as `accent-800` on
  `accent-100`.
- Don't reintroduce a second typeface on the client surface. Fraunces is out; this was decided
  three times.
- Don't use `danger` on a client screen. Failure is the operator's.
- Don't nest cards in cards, or wrap a list of cards in another card.
- Don't reach for purple, purple gradients, or anything that reads as the competitor.
- Don't let a receipt or a banner push the day's content off the fold.
- Don't use bounce or elastic easing. `cubic-bezier(.22,.61,.36,1)`, 120–280ms.

**Open proposal — the vivid ramp (`accent-500`).** Every theme today ships four accent tiers
(600/700/800/100). Adding a fifth, brighter tier — `#2DD4BF` in Teal v1 — would give the system a
sanctioned home for glows, waveform peaks, highlight washes and dark-field accents that are
currently improvised from `accent-600` at alpha. It needs no new AA rule because it is
**non-text by definition** and its only text-adjacent use is on `chrome-deep`, where it measures
7.86:1. Adopting it means one column in the admin Themes editor and one entry in
`theme.ts`'s `VAR` map. Recorded here as a proposal; the mockups demonstrate it, the platform does
not yet ship it.
