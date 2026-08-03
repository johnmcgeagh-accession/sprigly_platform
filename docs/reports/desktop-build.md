# The desktop plan surface — the build

**Date:** 2026-08-03 · **Branch:** `dev` · **Contract:** [desktop-plan-surface.md](../design/desktop-plan-surface.md)
**Scope:** a rendering brief. No data model, no generation path, no cycle rule, no agent behaviour.

| commit | piece |
|---|---|
| `cbb20dd` | fix: the test database refused to build — 0090 is two migrations, not one |
| `a41b2ce` | the frame is the only thing that differs — Panel, and the chrome the sheets take |
| `158034a` | the desktop shell — four regions, the month beside the day, the conversation docked |
| `792f6d4` | the desktop e2e project points at the surface that exists |
| `b563685` | delete the surface the redesign retired |

---

## 1. What shipped, per region

### The enabler, first — one inside, two frames (`a41b2ce`)

`DetailSheet` is 586 lines of tabs, copy, insights, shape mode and the format control;
`VoiceSheet` is 589 of thread, composer, speech capture and apply lifecycle. Re-implementing
either for a second form factor is how two surfaces start disagreeing about what a post is. So
the callers keep their whole inside and swap only their frame:

```ts
const Frame = chrome === 'panel' ? Panel : Sheet;
```

`Panel` deliberately does not inherit four things, and the load-bearing one is the **focus trap**:
a docked conversation that trapped focus would make the month beside it unreachable by keyboard,
which is the opposite of why it is docked. Also no scrim, no grabber, no `theme-color` band, and
`role="region"` rather than `dialog` — announcing "dialog" for something that never took focus
and cannot be dismissed is a lie to a screen reader.

`chrome` defaults to `'sheet'`, so every existing call site is unchanged and no existing test was
touched. `panel-chrome.interaction.test.tsx` drives both and pins the five differences plus the
one thing that must **not** differ — the inside.

### D1 · the shell

`DesktopShell.tsx` + `Rail.tsx`. Four regions, and the arithmetic lives in the Tailwind width
scale rather than in the component:

```
rail 196 + 24 + month 512 + 20 + day 320 + 24 + dock 344 = 1440
```

**The widths are named, not written.** The tokens fence refuses a fixed width wider than a 320px
viewport can hold and cannot tell a phone width from an `xl:`-only one — correctly, since it
recurses into subdirectories, so no folder can dodge it. Rather than weaken it, the four
constants moved to `tailwind.config`'s `width` scale. That is the same move the fence's own
philosophy makes for colour: a component **names** a value, it does not declare one. The fence is
unchanged and passes.

**The rail navigates two things.** Day and Month stopped being destinations the moment they could
both be on screen. Insights is not drawn — a control that does nothing is worse than an absent
one, and a vertical list takes a third item with no layout change, which is exactly why it is safe
not to draw a placeholder.

**Retired, with the successor asserted rather than described** (`desktop.spec.ts`): `brief-month-btn`,
the agent FAB and its dialog, Timeline, Notes, the Approvals rail item, the dark rail, the editor
drawer. `b563685` deletes the files.

**The identity is the phone's component.** `Wordmark` is imported from `PlanShell`, so the mark
stays `accent-600` (a fill), the word stays `accent-700` (`accent-600` is 2.35:1 on canvas and is
ruled out for text by name), the face stays `font-logo`, and the triple-tap that arms the
navigation trace comes with it. Re-styling it locally is how the two surfaces drift — which is
exactly what happened once already, when the desktop *mockups* took `chrome` from the phone's
stale mockups rather than its built surface.

### D2 · month and day, side by side

Both surfaces grow a `frame` prop and a second return. Everything above it — the month's state,
the selection rule, the apply path, the receipts, the re-anchor on a month change — is the **same
component**. Nothing about a month is written twice.

The grid keeps its own dot grammar and gains one mark (D5). Picking a day moves the day column and
leaves the grid standing; there is no switcher between them.

### D3 · the detail panel

Opens in the **day column's slot** at the day column's width. The test asserts what matters: after
a post opens, `month-grid` is still mounted and `conversation-dock` is still mounted. The day list
gives up its slot; nothing else does.

### D4 · the docked conversation

Always open, `chrome="panel"`, and a third entry mode — `entry="docked"` — because the two
existing ones both focus the composer, and a region that mounts with the page must not put the
client's first keystroke somewhere they did not choose. No ✕. **Absent** on a read-only month
rather than offering a composer that can only be refused, which is the rule the mobile mic
already follows.

### D5 · the ringed days

`ringed-days.ts` — a pure derivation from the open turn's own resolved dates, seven unit tests.
`VoiceSheet` reports its open items upward (`onOpenChanges`), recomputed from `turns` so it cannot
drift from what is on screen: every path that changes a turn's status flows through `setTurns`, so
there is no second source and nothing to remember to clear.

**Both ends of a move** are ringed — the day losing the post and the day gaining it. Ringing only
the destination would answer *where does it go* while leaving *what leaves the 22nd* to be worked
out from the calendar, which is the arithmetic the ring exists to spare.

The ring is announced as well as drawn: the cell's `aria-label` gains *"in the change you are being
asked about"*. A change awaiting consent must not be carried by colour alone.

### D6 · the thin month

The summary panel starts **expanded on desktop only**, filling the column a thin month leaves
empty with the month's real derivation. On a phone it stays closed — there the panel heads the
day, and starting it open would push the day's content down, which is the exact regression §S2
measured and fixed. An initialiser rather than an effect, so a client who closes it keeps it
closed. Tested at 1440 and 1024.

**One deviation from the spec, and it is a correction.** The spec said the thin-month
acknowledgement would move into the conversation as the agent's opening turn, rewritten into the
first person. It has not: the shipped surface already renders it as a footer note under the day
(`thin-month`), in the client's own register, and moving it would have meant two sentences saying
the same thing on one screen — which is what this surface keeps removing. The footer stays; the
spec's §7 rewrite is not made.

---

## 2. The e2e end state, test by test

### What was actually wrong

The brief inherited a triage of eighteen fixtures. Measured against the new shell **before any
e2e work**: `1 passed` — the auth setup — and everything else red. D1 retired `PlanDesktop`, and
the entire desktop project drove it. That is a project pointed at a surface that no longer exists,
not eighteen broken assertions.

Resolved as agreed: shell specs rewritten here, machinery relocated to the mobile project.

### Desktop project — **20 passed, 0 failed**

| test | |
|---|---|
| auth setup | — |
| the shell has four regions and a rail of two | new |
| the retired controls are gone, and their successors are present | new |
| the mobile shell is not mounted underneath it | new |
| the month grid and the selected day are on screen together | new |
| picking a day moves the day column and leaves the grid standing | new |
| the month arrows round-trip and disable at the edge | from `desktop.spec:147`, retargeted |
| opening a post fills the day column, and the month and the conversation do not move | new |
| the detail panel is a region, not a modal — and the whole sheet is in it | new |
| the way back names the day, and returns the day list to its column | new |
| the conversation is present with no gesture, and has no way to close | new |
| it does not steal focus on load | new |
| an open turn rings the days it names, and Apply clears them and moves the month | new |
| Discard clears the rings and changes nothing | new |
| Tasks replaces the plan region and the conversation stays | from `desktop.spec:88`, retargeted |
| at 1024 the plan region stacks and the conversation does NOT collapse | new |
| nothing overflows sideways at 1440 or 1024 | new |
| a PAST post opens read-only; a future one is editable | **the ten date-policy fixtures, as one direct assertion** |
| a11y: no serious/critical axe violations across the primary surfaces | retargeted |
| session: a long-lived local token survives repeated visits | unchanged, still passes |

### Mobile project — **42 passed, 0 failed** (was 17)

The 17 that were there are untouched and still pass. The 25 that arrived:

| from | to | note |
|---|---|---|
| `hooks.spec` × 3 | `detail-machinery.spec` | the carousel's three candidates and the pick-is-the-save survive verbatim |
| `scripts.spec` × 3 | `detail-machinery.spec` | **claim changed**: the script is gated on the CAPTION, not on a pre-existing hook (C4) |
| `format.spec` × 5 | `detail-machinery.spec` | **claim changed**: the control is inside Shape (P17), not an always-visible dropdown |
| `refine.spec` × 4 | `detail-machinery.spec` | shape in place, footer replaced wholesale, cancel restores |
| `agent.spec` × 11 | `agent.spec`, retargeted at the thread | see below |
| `weather.spec` × 3 | `weather.spec`, retargeted at the day header | see §4 |

### Tenant-B project — **7 passed, 0 failed** (was 5 passed / 3 failed)

`empty.spec`'s "Notes empty state" and "Approvals empty state" went with the views they tested.
Two new ones took their place: an empty month renders the whole shell and offers the add slot, and
its footer says so in words without dressing emptiness as a fault.

### Tests deleted rather than retargeted, each with its reason

| test | why |
|---|---|
| `desktop.spec` drag-reschedule persists across reload | the new grid has no drag — see §4 |
| `desktop.spec` rings: editor shows done/total for a checklist | `PostEditor`'s rings; the detail sheet lists the steps instead, and `TaskList` owns the tick |
| `desktop.spec` approvals empty state | there is no Approvals view |
| `desktop.spec` editor: media section removed, shape pills gone | asserted the absence of controls in a component that is itself gone |
| `desktop.spec` × 4 focus/caret regressions in `PostEditor` | the component is deleted; `DetailSheet`'s edit mode is a different control with its own tests |
| `agent.spec` approving the hook step BEFORE its create step | unreachable from the surface: there is one Apply and the sequence is internal to `applyChanges`. The guard itself is still tested in `partial-apply.interaction.test.tsx`, where the refusal can be arranged directly |
| `empty.spec` Notes / Approvals empty states | as above |

### One claim I could not express, and did not fake

**"No caption → the hook and script are refused in words, with no button that would 422."** It is a
real rule (`EmptyField`'s `needsCaption` branch). Reaching it needs a reel with no caption and the
seed has none; blanking one through the API gives a post the sheet renders as *nothing written yet*
rather than as a reel with empty fields, so the assertion would be about a different state than
the one it names. It is left uncovered and named here rather than written as a test that looks
like coverage.

---

## 3. Four defects this found — three of them in what I had just shipped

| # | defect | fix |
|---|---|---|
| 1 | **No way back.** The detail panel replaced the day column with no control that returned to it. On a sheet the grabber does that job; a panel has none, so opening a post stranded the client with the day's other posts simply gone | `detail-back`, in panel chrome only. It names the **day** rather than saying "Back": a direction tells you which way, a day tells you where you land, and it is the same string the day header carries |
| 2 | **The rail label was not bold.** axe read the selected item at **3.93:1** with a *normal* weight winning, because a base `font-semibold` sat in the same class list as the selected `font-bold`. The recorded white-on-`accent-650` deviation is justified on the label being short **and** bold, so this was not cosmetic | weight set per state, and the rail's selected item added to `a11y.spec`'s `CONTRAST_DEVIATION` **by name** — the ninth entry, so a tenth cannot be covered silently |
| 3 | **The breakpoint disagreed with its own frame.** The spec fixed the mobile/desktop fork at 1080 to avoid moving a tested boundary. Its own narrow-desktop frame is drawn at **1024**, so the one width the design reviewed as "the stacked desktop" fell on the mobile side of its own rule and could never render | moved to 1024. Nothing pinned 1080 — both e2e projects sit at 390 and 1440. This supersedes spec §2.5 |
| 4 | **The e2e fake was stale, and it is cluster B's real root cause.** `enqueueScriptJob`'s fake wrote the script and **not** the hook. A reel's hook and script are one act (C4), so the combined path could not be observed end to end — the hook tab stayed empty after a generate. Three of the eighteen were that, and no amount of fixture editing would have found it | the fake writes the pair. `E2E_PAIR_HOOK` is the script's own opening line, which is what "grounds on the hook verbatim" means |

Defect 4 is the answer to the open question the spec left: *"3 same-root and unverified — check the
e2e fake's `/api/plan/hooks` response shape first."* It was the script route's fake, not the hook
route's, and the shape was right — the *field set* was short.

---

## 4. Three capabilities the redesign drops

Named because each is a real thing that worked and now does not.

**Drag-to-reschedule.** `PlanDesktop` let a post chip be dragged to another day. The new grid has
no drag; move goes through the Move sheet, as on mobile. Accepted on your ruling: the Move sheet
is the one move path on both form factors, which is the translation direction the brief set. It
was never in the spec — it dropped silently, and that is the part worth recording.

**The month-wide weather forecast.** `PlanDesktop` painted an icon and a temperature on every
in-window calendar cell. The redesigned grid is a density map in a 69px cell and has no room for a
third mark that is not about the plan. What remains is the badge on the **selected day's** header,
which both shells have. The machinery — the window's edges, the buckets, the tone bands, the
failure posture — is still exercised, one day at a time instead of fifteen at once.
`WeatherHeaderBadge` gained `data-weather` and `data-glyph`, which it already computed and threw
away, so the bucket is legible on the surface that now carries it.

**The correctable-format hint.** The old dialog rendered each proposal's `summary`, which appends
*"(say "reel" or "carousel" if you'd prefer)"* when the format was **defaulted** rather than
inferred. The interpretation turn builds its lines from the item's resolved fields instead —
deliberately, so the client agrees to the change and not to a sentence about it — and
`InterpretedItem` carries no `formatInferred`, so the hint has nowhere to come from. The
consequence is real: a client can no longer tell a format they asked for from one we defaulted to.
Restoring it is one more resolved field on the item, which is a **data** change and therefore
outside this brief.

---

## 5. Reference hazards — where the mockups and the built surface disagreed

The brief warned about this class. Five found, and the built surface won every time.

| # | the mockups / the spec said | the built surface says |
|---|---|---|
| 1 | Posting times are the `PostingTimes` contract's documented examples (6:00, 7:00), labelled as a reconstruction | `PlanPost.postingTime` is a real field, `reschedule` takes a time, and `knownTimes` is derived from the client's own posts. **Spec gap 1 is closed** and the "does not exist yet" list is stale on it. `CommittedSurface`'s own comment names the mockups' invented times as the thing not to do |
| 2 | Wordmark 17px, month title 20px | Wordmark **22px**, month title 17px — round 8 fix 4 put the identity at the top of the scale and stepped the month down beneath it. The desktop rail imports the component rather than restating either number |
| 3 | The thin-month acknowledgement becomes the agent's opening turn, in the first person | It is a footer note under the day, in the plural register, and already shipped. Not moved — see §1 D6 |
| 4 | The mobile/desktop fork is at 1080 (spec §2.5); the narrow frame is drawn at 1024 (mockups) | Neither was pinned by a test. Moved to 1024 so the reviewed frame can render — §3 defect 3 |
| 5 | The committed month has a what-changed summary chip | Deleted by ruling X5b: the change is **on** the calendar and the calendar is what shows it. The desktop shell carries no chip on a committed month either |

---

## 6. Gates

| gate | result |
|---|---|
| `tsc --noEmit` (app) | clean, after every commit |
| app unit / interaction (**Node 22**) | **1324 passed**, 38 skipped — baseline 1273, so **+51**: 37 `desktop.interaction` at both 1440 and 1024, 7 `ringed-days`, 7 `panel-chrome` |
| e2e — **desktop** | **20 passed** (before this session, measured against the new shell: 1 passed, the rest red) |
| e2e — **mobile** | **42 passed** (was 17; the machinery moved in) |
| e2e — **tenant-b** | **7 passed** (was 5 passed / 3 failed) |
| tokens fence | 10 passed · `git diff` **empty** |
| terminology fence | 8 passed · `git diff` **empty** |
| draft-invisibility | 5 passed · `git diff` **empty** |
| detector | **0 findings** across all 17 changed components |
| `pnpm --filter @sprigly/worker... build` | **exit 0** — the command Railway runs |

**The two pre-existing app failures are unchanged:** `edit-scope.test.ts` and
`post-generation.test.ts` fail to *collect* because they import a module that parses
`DATABASE_URL` at import time. Same two files as the session baseline, **0 test failures**.

**Node 22 matters.** Under the default Node 20 the app run looks green while silently skipping
every jsdom file — which is every interaction test in this session.

**The mobile surface is unchanged, and it is asserted rather than claimed.** Its own suite is
untouched and passes; `desktop.interaction.test.tsx` additionally drives the phone shell to assert
that it still renders its nav pill and week strip, that the detail sheet is still a modal sheet
with a scrim, and that a thin month still opens closed there.

### Audit of the changed surface

| dimension | finding |
|---|---|
| Accessibility | The rail is a real `nav` with `aria-current="page"` on the selected item and an `sr-only` label when collapsed. The dock is a `region` with a name and **no focus trap** — the difference the whole layout depends on, driven in `panel-chrome.interaction.test.tsx` rather than asserted from a class name. The ring is in the cell's `aria-label`, not only in its border. axe is green over the desktop surface, the detail panel, the move sheet, the empty-field state, the add sheet and the conversation |
| Theming | No new colour and no hex. Every value is a `coral-*` / `line` / `chrome` key already on this surface, resolving through `--t-*`. The tokens fence checks it and passes unchanged |
| Contrast | One deviation, and it is the recorded one: white on `accent-650`, now on a ninth control named in the ignore's enumeration. Defect 2 above is the case where the justification had quietly stopped holding |
| Responsive | Driven at **1440 and 1024** in jsdom and in e2e, plus a `scrollWidth` check that asserts no horizontal overflow at either. The column widths live in the theme, so the arithmetic is asserted where it is declared |
| Integrity | Two new components (`DesktopShell`, `Rail`), one new frame (`Panel`), one new derivation (`ringed-days`), one new prop on four panels. No new route, no new query, no new evidence field, and 753 lines of retired surface deleted |

---

## 7. Still open

1. **The correctable-format hint** (§4). It needs `formatInferred` on `InterpretedItem` — a data
   change, so it is not this brief's to make.
2. **The caption-gate e2e claim** (§2). It needs a seeded reel with no caption.
3. **Drag-to-reschedule**, if the ruling is ever revisited.
4. **Peak-end still has no end.** Approval navigates to `/?cycle=` and the client arrives at a
   month of *on its way* cards with no sentence saying the writing has started. Unchanged from the
   phone, and more visible on a larger screen.
5. **`pieces.tsx` and `primitives.tsx` carry exports only the flag-off path uses now.** Worth a
   pass when that path is retired, and not before — deleting them today would break the tenants
   who have no redesign shell to fall back to.
