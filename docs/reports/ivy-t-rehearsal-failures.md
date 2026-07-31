# ivy-t rehearsal — three failures on real client data

**Date:** 2026-07-21
**Branch:** `dev` · read-only investigation, no writes, no fixes
**Cycle:** `1b925191-bb01-4839-a5fb-0552b14f1e57` — ivy-t, instagram, `cycle_month = 2026-07`
(the run month; the plan month is **August 2026**, `displayMonth = nextMonth(cycle_month)`,
`plan.ts:243`. The July/August split is the convention, not a fault.)
**DB:** uat, every statement under `PGOPTIONS=-c default_transaction_read_only=on`, verified
on connect.

Cycle state now: `status='scheduled'`, `prior_status` NULL, `approved_at` NULL, 21 draft
beats, 0 committed, 0 `post_edits`, 10 receipts, `updated_at 16:36:37.956`.

---

## One thing that shapes all three findings

**The extracted intent is never persisted.** A receipt stores `{at, id, scope, sourceText,
lines, changedIds, reason?, planInputId?}` and nothing else — there is no stored `intent`,
no `kind`, no `dateRange`. So "what intent did the model return" cannot be read back; it
can only be *reconstructed* from the beats the transform produced.

That reconstruction is exact here, because the transforms are deterministic and their date
arithmetic is invertible — but it is inference, and I have marked it as such throughout. It
is also the first thing I would fix: a rehearsal that can't show what the model actually
returned makes every misroute an archaeology exercise.

---

# F1 — the series was classified as a launch

## Why: there is no intent kind that can represent a series

`intake-classify.ts:54`:

```ts
kind: z.enum(['launch', 'event', 'emphasis', 'beat_edit', 'correction'])
```

and `:57`, the only timing field:

```ts
dateRange: dateRangeSchema.nullable().optional()   // { start, end } — one interval, no interval length
```

There is **no `series` / `recurring` kind and no recurrence field anywhere in the contract.**
"One post every 3 weeks" and "every Friday in August" are not expressible. The input has a
time attached, so `CLASSIFY_SYSTEM:102` routes it MONTH_SCOPED, and of the five available
kinds the only one meaning "a multi-post thing that starts on a date" is `launch`.

**The model was not wrong within the contract it was given. The contract cannot say what the
client said.**

## What validation accepted

`routeFromParsed` (`:143-155`) accepted it, and correctly so: `kind='launch'` with a
`subject`, a `sourceText` and a `dateRange` satisfies `monthScopedIntentSchema` completely.
The only rejections available are a malformed intent, a correction naming nothing, or a
beat_edit with no action — none applies. **There is no validation rule that could have
caught this**, because nothing in the schema encodes "this text describes a cadence".

## Which transform ran

`applyIntent` (`draft-transforms.ts:391`) → `case 'launch': return applyLaunchArc(...)`.

## The receipt (`16:32:27.761Z`)

```
Added:    mini-series 'What I am most proud of…' — Tease,     Sat 1 Aug
Added:    mini-series 'What I am most proud of…' — Launch,    Sat 1 Aug
Added:    mini-series 'What I am most proud of…' — Follow-up, Tue 4 Aug
Replaced: No Shortcuts on What Matters,   Thu 20 Aug
Replaced: Mornings Don't Have to Be Hard, Sun 23 Aug
Replaced: Designed Around Real Women,     Tue 25 Aug
```

The client asked for **~3 posts spaced three weeks apart** (1 Aug, 22 Aug, 12 Sep). They got
**3 posts inside four days**, at the cost of three pillar beats. Every part of that is wrong
except the count, and the count is a coincidence — `LAUNCH_ARC` has three parts.

## The Style Guide input

Original briefing (`plan_inputs`, 16:20:37) listed five dated Fridays: 7, 14, 21, 28 Aug and
4 Sep. It was fed three times, with three different outcomes:

| time | scope | outcome |
|---|---|---|
| 16:35:55 | evergreen | `couldnt_apply` — two extraction attempts failed, filed to backlog |
| 16:36:07 | month_scoped | **one** beat, "…, Sat 1 Aug" |
| 16:36:33 | month_scoped | a **second launch arc** — Tease 1 Aug, Launch 4 Aug, Follow-up 7 Aug |

**Why only one beat landed** (16:36:07): the intent came back `kind='event'`, and
`applyEvent` (`:199-213`) emits exactly **one** `remove` + **one** `add`. It is structurally
incapable of placing four Fridays — there is no loop in it. The four dates in the text had
nowhere to go.

**Which date won: `dateRange.start`** — `applyEvent:201`, `const date =
clampToMonth(intent.dateRange.start, month)`. `.end` is read by nothing in this path. The
beat landed on **1 Aug**, not Friday the 7th, which means the model returned
`{start: 2026-08-01, end: 2026-08-31}` — it read "in August" as the window and ignored the
enumerated Fridays. The operator then hand-moved it to 7 Aug (`beat_moved`, 16:36:14).

## A second defect visible in the same receipts

`applyEvent:210` writes `title: intent.subject`, and `subject` is capped at 200 chars
(`:55`) with only prose guidance ("a short noun phrase … Do not embellish"). The model
echoed whole sentences instead. Five beats now carry raw briefing text as their title,
one visibly clipped mid-phrase at the 200-char bound:

```
2026-08-03  14th August — the stock leaves the factory for our next drop. Tease it: can you …
2026-08-03  15th August — our factory in Portugal starts its annual summer shutdown until 7t…
2026-08-03  In the Navy Edit build-up, include colour-reveal content — who can guess the mai…
```

The dropped beat at 16:31:02 was titled `"…grey marl; 14th"` — a title truncated
mid-date. These are not titles; they are input echoes.

---

# F2 — tease and launch on the same day

## The allocation logic

`draft-transforms.ts:153-157` and `:184`:

```ts
const LAUNCH_ARC = [
  { offsetDays: -5, label: 'Tease',     format: 'single'   },
  { offsetDays:  0, label: 'Launch',    format: 'reel'     },
  { offsetDays:  3, label: 'Follow-up', format: 'carousel' },
];
…
date: clampToMonth(iso(parse(anchor) + part.offsetDays * dayMs), month),
```

`clampToMonth` (`:143-148`) pins any out-of-month date to the month's first or last day.
When the anchor is within 5 days of the 1st, the Tease's `-5` offset falls into the previous
month and is **clamped forward onto the boundary**. When the anchor *is* the 1st, the clamped
Tease lands exactly on the Launch.

**There is no de-duplication.** Nothing after the clamp checks whether two parts of the arc
resolved to the same date, and nothing checks that the arc kept its ordering.

## Verified against both arcs in this cycle

| receipt | inferred anchor | Tease | Launch | Follow-up |
|---|---|---|---|---|
| mini-series 16:32:27 | **2026-08-01** | 07-27 → clamp **08-01** | 08-01 | 08-04 |
| style guide 16:36:33 | **2026-08-04** | 07-30 → clamp **08-01** | 08-04 | 08-07 |

Both reproduce the stored receipt lines exactly, which confirms the mechanism and pins each
anchor. The first collides because anchor == month start; the second doesn't, because the
anchor is 3 days later. **The collision condition is precisely `anchor == month-start`** —
and "early August" is the single most likely thing a client says.

Note the second arc also silently loses its 5-day build-up (3 days instead of 5). The clamp
degrades the arc's shape for any anchor in the first five days; it only becomes *visible* as
a same-day collision on the 1st.

---

# F3 — the delete refusal

## `dropBeat`'s complete guard chain

`dropBeat` (`draft-mutations.ts:272`) has no guards of its own. Everything is in
`requireDraftMutable` (`:160-184`), in order:

| # | guard | line | ivy-t's real value | verdict |
|---|---|---|---|---|
| 1 | row exists for `(id, clientId, deleted_at IS NULL)` | `:173-177` | all 21 rows: client `c79cf1c5…`, `deleted_at` NULL | **passes** |
| 2 | `status !== 'draft'` → `not_a_draft` | `:181` | all 21 rows `status='draft'` | **passes** |
| 3 | `!cycleIsPreCutoff(cycleId)` → `cutoff_passed` | `:182` | see below | **passes now** |

`cycleIsPreCutoff` (`:134-148`) is the only status- or schedule-derived gate in the chain:

```ts
if (row.approvedAt) return false;                  // approved_at IS NULL → not this
return PRE_PLANNING_STATUSES.has(row.status);      // 'scheduled' ∈ set → true
```

`PRE_PLANNING_STATUSES` (`packages/db/src/structured-brief-invalidate.ts:28`) =
`{scheduled, requested, reply_received, awaiting_confirmation, intake_confirmed}`.

**There is no `clientTouched` check, no `basis` check, no date check, and no
schedule/`cutoffDay` lookup anywhere in the drop path.** I looked for one specifically; the
`cutoffDay` from `client_channels.schedule` is read only for display copy
(`page.tsx:98` → `PlanRoot.cutoffLabelFor`) and reaches no write gate.

## So against today's stored values, every guard passes — drop is permitted right now

And the ledger proves drops *did* work during the rehearsal. Four succeeded:

```
16:31:02  beat_dropped  "Weekend Style Guide … 14th"          2026-08-03
16:32:44  beat_dropped  "mini-series … — Tease"                2026-08-01
16:36:56  beat_dropped  "weekend style guide — Launch"         2026-08-04
16:37:00  beat_dropped  "weekend style guide — Follow-up"      2026-08-07
```

## The refusing branch, and the layer

The one input that flips guard 3 is the cycle status — and you have told me this cycle
**was `workbook_built`** until it was manually reset. `workbook_built` is **not** in
`PRE_PLANNING_STATUSES`, so while it held:

```
cycleIsPreCutoff → false
```

which fires in **two places at once**:

1. **Client — the affordance disappears entirely.** `loadDraftSurfaceContext`
   (`plan.ts:455`) returns `editable: await cycleIsPreCutoff(cycleId)`, and
   `DraftPlanView.tsx:337` wraps the date input, the format select **and** the Remove button
   in `{editable && (…)}`. Not a disabled button — **the whole control row is not rendered**.
   That matches "cannot drop" better than a rejection would: there is nothing to click.
2. **Server — `requireDraftMutable:182` returns `'cutoff_passed'`**, which
   `draft/route.ts:32` maps to **HTTP 409**. So a request that did get through would also
   have been refused.

**Answer to "which layer": both, from one predicate.** The client hides the control and the
server would reject it — deliberately the same function, so they cannot disagree.

**Caveat, stated plainly.** `prior_status` is NULL and there is no status-change audit, so I
cannot timestamp the reset from the database. What I can show is that the guard chain is
otherwise fully satisfied by today's values, and that `workbook_built` is the only stored
value in this cycle's history that trips it. The successful drops above therefore all sit
*after* the reset. That is a reconstruction, not a logged fact.

## A different, real refusal that will bite next

`isReplaceable` (`draft-transforms.ts:67`) excludes anything with
`basis ∈ {client_added, client_input}` — permanently. Every transform-created beat is
written with `clientInputMeta` → `basis='client_input'` (`:105-112`). **16 of the 21 beats
are now `client_input`; only 5 are `observed`.**

So the replacement pool has collapsed from 21 to 5, and shrinks with every further input.
The next few sentences will hit `applyLaunchArc:171` —

> *"Every beat this month is either yours or already earning its place, so … was added to
> your ideas instead."*

— which the operator will read as a second kind of refusal. It is not the delete bug; it is
this one, and it is arriving.

---

# State snapshot

## Beats — all 21 (`status='draft'`, `deleted_at` NULL, all of them)

| date | title | basis | touched |
|---|---|---|---|
| 08-01 | mini-series 'What I am most proud of…' — **Launch** | client_input | – |
| 08-03 | `14th August — the stock leaves the factory…` | client_input | – |
| 08-03 | `15th August — our factory in Portugal…` | client_input | – |
| 08-03 | `In the Navy Edit build-up, include colour-reveal…` | client_input | – |
| 08-03 | `In the build-up, a post asking who can guess…` | client_input | – |
| 08-03 | `A throwback post using the video of Sally…` | client_input | – |
| 08-07 | `Weekend Style Guide every Friday in August: 7th…` | client_input | **true** |
| 08-09 | Navy Edit — Tease | client_input | – |
| 08-14 | Less Fuss, Better Mornings | observed | – |
| 08-14 | Navy Edit — Launch | client_input | – |
| 08-14 | weekend style guide — Tease | client_input | **true** |
| 08-17 | We See You, Clearly | observed | – |
| 08-17 | Navy Edit — Follow-up | client_input | – |
| 08-19 | Born From a Real Gap | observed | – |
| 08-21 | Getting to Know You Properly | observed | – |
| 08-24 | Strong Foundations, Simply Put | observed | – |
| 08-24 | mini-series 'What I am most proud of…' — **Follow-up** | client_input | **true** |
| 08-26 | Support That Feels Genuine | observed | – |
| 08-27 | It Started With a Real Problem | observed | – |
| 08-28 | Honest About How We Work | observed | – |
| 08-30 | Relationships We Actually Care About | observed | – |

Five beats stacked on **08-03**, three on **08-14**, two on **08-24**. Nothing between
08-09 and 08-14, and the whole 08-01→08-09 span is briefing echoes.

## Receipts — 10, in order

| time | scope | result |
|---|---|---|
| 16:32:12 | month_scoped | 2 lines, 1 replaced — Sally throwback |
| 16:32:27 | month_scoped | **6 lines, 3 replaced — the mini-series launch arc (F1/F2)** |
| 16:33:28 | evergreen | `classified_evergreen` — sweatshirt breakdown |
| 16:33:35 | evergreen | `classified_evergreen` — "life is busy" |
| 16:33:42 | evergreen | `classified_evergreen` — organic cotton staples |
| 16:33:48 | evergreen | `classified_evergreen` — "simple things that work" |
| 16:33:54 | evergreen | `classified_evergreen` — no polyester |
| 16:35:55 | evergreen | **`couldnt_apply`** — Style Guide, extraction failed twice |
| 16:36:07 | month_scoped | 2 lines, 1 replaced — Style Guide → **one** beat, 1 Aug |
| 16:36:33 | month_scoped | **6 lines, 3 replaced — Style Guide as a second launch arc** |

**Applied: 4 inputs → 16 line-items, 8 pillar beats replaced. Saved to backlog: 6.**
Twelve `plan_inputs` rows exist, including the entire briefing pasted whole at 16:20:37.

Five of six evergreen filings are correct — those inputs genuinely had no timing. The
backlog is working.

## Also observed: every move fired twice

```
16:36:47  beat_moved  Tease           2026-08-01 → 2026-08-14   (×2)
16:36:14  beat_moved  Style Guide     2026-08-01 → 2026-08-07   (×2)
16:33:13  beat_moved  Follow-up       2026-08-04 → 2026-08-24
16:33:13  beat_moved  Follow-up       2026-08-24 → 2026-08-24   ← from == to
```

`DraftPlanView.tsx:341-347` binds `<input type="date" onChange>` straight to a `move`
mutation, so every intermediate value the picker emits is a write. The `24 → 24` no-op is
the tell. Harmless today; it is two DB writes and two activity rows per date change, and it
would matter under any optimistic-concurrency or rate limit.

---

# Minimal repair path for THIS cycle's plan

The cycle is `scheduled`, unapproved, no `post_edits`, no committed rows — everything is
still soft. **No code fix is needed to repair it**; all of it is achievable through the
operator surface as it stands today.

1. **Confirm the surface is editable.** `status='scheduled'` and `approved_at IS NULL`, so
   `cycleIsPreCutoff` is true and the Remove/date/format controls render. If they are
   missing, the status has moved — that is the F3 gate, and the fix is the status, not the
   beat.
2. **Drop the 4 spurious arc beats** — mini-series Launch (`510dfdaf`, 08-01) and Follow-up
   (`a9c53fe2`, 08-24); style-guide Tease (`a6740f4a`, 08-14) and the single (`2d198b7e`,
   08-07). Every guard passes for all four.
3. **Drop the 5 echo beats on 08-03** (`15568e62`, `f7e052a2`, `c5a57676`, `9da576ed`,
   `e7aba7d6`) — their titles are briefing text, not posts.
4. **Re-add by hand** what the client actually asked for: 3 mini-series posts at ~3-week
   spacing (1 Aug, 22 Aug — the third falls in September, outside this cycle), and 4 Weekend
   Style Guide posts on 7, 14, 21, 28 Aug. Use `add`, not another sentence — the transforms
   cannot express either pattern, so feeding them again reproduces the failure.
5. **Leave the Navy Edit arc alone.** Tease 09 Aug / Launch 14 Aug / Follow-up 17 Aug is a
   genuine launch, correctly shaped, and the client's own "2 weeks ahead of the 28th" brief
   supports it.
6. **Do not re-feed the full briefing.** It is already in `plan_inputs` (16:20:37) and
   re-applying it will consume the last 5 `observed` beats.

That leaves ~9 pillar beats plus the Navy Edit arc plus hand-placed series posts — a
sound August.

---

# Fix list, ranked for the arc

| # | fix | why here |
|---|---|---|
| **1** | **Add a recurring/series intent kind** — `kind='series'` with an interval (`everyNWeeks` / `weekday`) and a bounded expansion, or an explicit "I can't schedule a repeating series" refusal. | Root cause of F1 and of both Style Guide misfires. Until this exists, every cadence the client states will be mangled into a launch or flattened to one date. Everything else on this list is damage control. |
| **2** | **Fix the launch-arc month boundary** — clamp must not collapse two parts onto one day. Shift the whole arc forward so its shape survives, or drop the Tease and say so. Add a post-allocation assertion that the parts hold distinct, ordered dates. | F2. One-line condition (`anchor == month-start`), high hit rate — "early <month>" is the commonest phrasing there is. Cheap and self-contained. |
| **3** | **Persist the extracted intent on the receipt.** | Everything above took inference to establish. This is the difference between diagnosing the next rehearsal in minutes and reverse-engineering date arithmetic. Cheap, and it compounds. |
| **4** | **Stop writing `subject` as the beat title** — cap it, or have the transform compose a title, or fail the intent when `subject` is a sentence rather than a phrase. | Six beats currently carry raw briefing text, one clipped mid-word. Client-visible and embarrassing, but cosmetic against 1–2. |
| **5** | **Reconsider the permanence of `client_input` in `isReplaceable`.** A beat the *transform* invented is not the same as a beat the *client* placed, yet both are protected forever. | The pool is down to 5 of 21 and shrinking. This turns into "the surface stopped responding" within a couple more inputs. Needs a design call, not just a patch — hence below the mechanical fixes. |
| **6** | **Make the drop refusal legible.** When `editable` is false the controls vanish with no explanation; the operator cannot distinguish "not allowed" from "broken". Render a reason. | F3 was a correct refusal that read as a bug. Costs a rehearsal every time it happens. |
| **7** | **Debounce the date picker** (`DraftPlanView.tsx:341`) — commit on blur/Enter, not on every `onChange`. | Real but currently harmless. |
| **8** | **Add a status-change audit** (or set `prior_status` on manual resets). | The only reason F3 needed reconstructing rather than reading. |

**One-line summary for the ledger:** the transforms behaved exactly as written; the intent
contract has no way to say "series", so a cadence became a launch, and a launch anchored on
the 1st has nowhere to put its tease.
