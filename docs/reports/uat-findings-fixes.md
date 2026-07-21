# UAT findings — consolidated fix session

**Date:** 2026-07-21
**Branch:** `dev`
**Specs:** `docs/reports/wrong-month-generated.md` (Commits 1–2, 6), phone-test findings (3–5)

| commit | contents |
|---|---|
| `54aeada` | hooks persist in the fan-out, and scripts follow them |
| `40dfe41` | undo restores the dropped beat instead of manufacturing a husk |
| `8e98c8a` | corrections change the month, and a failed extraction says so |
| `6b31c0b` | the rescue tap Build C specified — [Add to this month] |
| `fec3715` | the approval dialog stops claiming the month is locked |
| `1c50674` | draft mutations leave a trace |

---

## PART 0 — the reproduction

**Undo does not fail. It succeeds, and silently replaces the beat with a husk.**

### Mechanism, with file:line

`app/src/components/plan/DraftPlanView.tsx:302-306` (before this session) stashed the undo
op for a Remove as:

```tsx
onClick={() => mutate({ op: 'drop', postId: beat.id }, beat.id,
  // Undo re-adds with the same fields — no history system, just
  // the inverse call. The new row is a fresh id, which is honest:
  // it IS a new beat, added by the client.
  { label: 'Beat removed', op: { op: 'add', date: beat.date, format: beat.format, pillar: beat.pillar } })}
```

`{date, format, pillar}` and nothing else. That routes to `addBeat`
(`app/src/lib/draft-mutations.ts`), which by design stamps the provenance of a beat the
*client chose*:

```ts
const beatMeta: BeatMeta = {
  slotType: 'proven',
  rationaleEvidence: { basis: 'client_added' },
  clientTouched: true,   // they placed it; no transform may quietly take the slot back
};
await db.insert(contentCyclePosts).values({
  …
  position:   (maxRow?.position ?? -1) + 1,
  sourceMeta: { title: spec.pillar },        // ← the PILLAR NAME becomes the title
});
```

So the answer to (b) is **yes**: undo manufactures a `client_added` beat titled with the
pillar name, at the end of the position order, with the original title, rationale,
`sourceRef` and assumptions gone.

### Reproduced live

Against a real arc beat (`client_input`, full evidence), drop then undo:

```
=== BEFORE (the arc beat) ===
{ title: 'wilderness candle launch — Tease', position: 11,
  beat_meta: { slotType: 'proven', sourceRef: 'plan-input-abc',
               assumptions: [ 'No launches or restocks are on record for this month.' ],
               rationaleEvidence: { basis: 'client_input', reason: 'The wilderness candle launches on the 31st' } } }

=== DROP result === ok      rows after drop: 0
=== UNDO result === ok

=== AFTER UNDO ===
{ title: 'Brand Story & Culture', position: 0,
  beat_meta: { slotType: 'proven', clientTouched: true,
               rationaleEvidence: { basis: 'client_added' } } }

=== DIFF ===
title      : wilderness candle launch — Tease -> Brand Story & Culture
position   : 11 -> 0
basis      : client_input -> client_added
sourceRef  : plan-input-abc -> undefined
assumptions: 1 -> 0
clientTouched: undefined -> true
```

### The husk hypothesis is confirmed — and it corrects the earlier report

All seven `client_added` rows in cycle `040d6a1a` have **`title == pillar`**:

```
 position |    basis     |                   title                   |         pillar          | title_is_pillar
       10 | client_added | Everyday Ritual                           | Everyday Ritual         | t
       21 | client_added | Everyday Ritual                           | Everyday Ritual         | t
       23 | client_added | Home & Space                              | Home & Space            | t
       24 | client_added | Brand Story & Culture                     | Brand Story & Culture   | t
       25 | client_added | Everyday Ritual                           | Everyday Ritual         | t
       26 | client_added | Product & Fragrance                       | Product & Fragrance     | t
       27 | client_added | Home & Space                              | Home & Space            | t
```

`sourceMeta: { title: spec.pillar }` is the only thing in the codebase that produces that,
and the positions are all at the end — `max+1`, `addBeat`'s signature.

**This overturns the inference in `wrong-month-generated.md` §6** that those seven rows were
deliberate hand-adds. They are what undo produced. The client was not adding blank beats on
purpose; they were removing beats and pressing Undo, and each Undo destroyed the beat it
claimed to restore. That also explains "largely unrelated content" far better than the
earlier reading: seven of eleven approved beats had no subject for the caption prompt to
work from.

---

## COMMIT 1 — hooks persist in the fan-out; scripts follow

**`engine/src/content-cycles/hook.ts`** gains `autoSelect?: boolean` on `HookJob`
(additive; off unless set) and, when set, persists `candidates[0]` and records `hook_saved`.
The return value is unchanged. Context is carried **on the job payload**, not read from
anything ambient — `app/src/lib/phase2.ts:95` and `engine/src/content-cycles/draft-plan.ts:324`
both pass `autoSelect: true`, and the interactive path passes nothing.

**`script.ts` DOES write** (`script.ts:83-84`, plus a `script_saved` ledger row) — verified,
no fix needed. It was simply never reached. `phase2.ts:23` deferred scripts to
`enqueueScriptsForReady`, and **that function was never built** — grep returns only the
comment referencing it. So in the fan-out no script was ever enqueued at all.

**New `engine/src/content-cycles/script-ready.ts`.** A script needs a hook *and* a caption
(`api/plan/script/route.ts:37` refuses without both), and those two jobs are enqueued
together and race — neither can know it was last. The worker checks after each completes.
Idempotent on the deterministic job id, so a second check is a BullMQ no-op, not a second
paid generation.

**Ordering.** In `consumer.ts` the script check runs **before** `settlePlanReady`. Settling
first would declare the month ready in the instant before its last script was queued and
send the email mid-generation. Asserted directly:
`the script-ready check runs BEFORE settlement, or the email beats the last script`.

**Settlement still blocks on queued scripts** — `script_` was already in the pending-job
prefixes, now asserted: `SETTLEMENT does not fire while a script job is queued`.

### The fixture cycle's post-fan-out state

```
  format  | has_hook | has_caption |    hook_text
----------+----------+-------------+-----------------
 carousel | t        | t           | First hook line
 carousel | t        | t           | First hook line
 reel     | t        | t           | First hook line
 reel     | t        | t           | First hook line
 single   | f        | t           | —
```

Every carousel and reel has a hook; `single` correctly has none. Script jobs queued for
exactly the two reels (asserted by job id).

```
✓ INTERACTIVE: returns candidates and writes NOTHING (byte-unchanged behaviour)
✓ FAN-OUT: persists the top candidate and records it
✓ SCRIPT CHAIN: a reel with hook + caption enqueues a script; nothing else does
✓ SCRIPT CHAIN is idempotent — a second check does not queue a second paid job
✓ SETTLEMENT does not fire while a script job is queued
✓ POST-FAN-OUT STATE: every carousel and reel has a hook; every reel has a script queued
```

---

## COMMIT 2 — undo restores the beat, byte-identical

**Implementation chosen: server snapshot, client-held.** `dropBeat` reads the full row
*before* deleting and returns it as `DroppedBeat`; the view stashes that in its existing undo
ref; undo posts `{op:'restore', beat}` to a new `restoreBeat`, which re-inserts verbatim —
title, `beat_meta`, and its original `position`.

**Why this shape:** it survives a refetch between drop and undo, because the snapshot is the
caller's to keep rather than a lookup against a row that no longer exists. Asserted:
`the snapshot survives a refetch between drop and undo`. The alternative — soft-deleting
drafts and clearing `deleted_at` — was rejected: `draft-mutations.ts:190-195` states the hard
delete is deliberate ("leaving tombstoned drafts around would mean every draft reader had to
learn to skip them"), and changing it would touch fence-adjacent readers.

**Trust boundary.** The snapshot comes from the client, so everything deciding ACCESS is
re-derived server-side (client, cycle, channel, draft status) and `addBeat`'s guards are
re-applied. What the snapshot is trusted for is its own content — which the server handed
that client moments earlier. No wider than the existing `add` op, which already lets a client
name a date, format and pillar. Asserted by the two refusal tests.

```
✓ drop → undo restores 'assembler beat (observed)' unchanged
✓ drop → undo restores 'launch-arc beat (client_input) — the case that failed on the phone' unchanged
✓ drop → undo restores 'hand-added beat (client_added)' unchanged
✓ the snapshot survives a refetch between drop and undo
✓ restore still refuses what addBeat refuses — a foreign pillar
✓ restore refuses a past date, like every other draft write
```

Byte-identity is asserted as a whole-row comparison — `scheduled_date, format, pillar,
position, status, beat_meta, source_meta` — not a spot check. The id differs, which is
honest: the row was genuinely deleted.

---

## COMMIT 3 — corrections route to the month; failures are honest

### (a) `kind: 'correction'`

Added to `monthScopedIntentSchema` with `correctionOf` — what is being corrected, in the
client's words. Matching (`resolveBeatSubject`) looks at the beat's **title AND the evidence
`reason`**, which `applyLaunchArc`/`applyEvent` write verbatim from the client's message, so
a correction finds beats the assembler phrased. Every significant word must appear, so
"meadow candle" does not match a wilderness beat.

Deliberately **not** `beat_edit`: that points at one post by day/format/date; a correction
names a subject that may be a whole arc.

`applyCorrection` moves the matched beats and **preserves relative spacing** — fixing one
date and silently breaking the other two would be worse than not applying it. No match on
the plan → no ops → the caller files it evergreen exactly as today.

**Fixture results:**

| fixture | result |
|---|---|
| **"Meadow candle launch is the 10th not the 1st"** (the uat sentence) | month-scoped; moves all 3 arc beats `10-01/03/06 → 10-10/12/15`, offsets `+0/+2/+5` preserved |
| "actually the workshop is the 15th" | moves the one matched beat; no spacing claim |
| "make the launch post a reel" | format change, not a date change |
| a correction naming nothing on the plan | no ops, note "couldn't find…" → evergreen |
| a format correction matching 3 posts | refuses rather than guessing |

### (b) `validation_failed` handling

`classifyIntake` now retries extraction **once**. A second failure routes evergreen with
reason **`couldnt_apply`**, distinct from a genuine `classified_evergreen`. A confident
evergreen is an answer, not a miss, and is **not** retried (asserted).

**Receipt copy — before / after:**

| | copy |
|---|---|
| **before** (all evergreen) | "We've kept this for later rather than changing October. Want it this month? Add it from your ideas." |
| **after** (classified evergreen) | "We've kept this for later rather than changing October. If you meant now, add it to this month." + **[Add to this month]** |
| **after** (`couldnt_apply`) | heading "We couldn't apply this" — "We couldn't apply this to October automatically, so we've saved it to your ideas. If you meant now, add it to this month." + **[Add to this month]** |

```
✓ 17 tests in packages/engine/src/draft-corrections.test.ts
✓ failure then SUCCESS applies normally — one bad sample does not cost the month
✓ failure TWICE files it as couldnt_apply — never the silent demotion
✓ a confident evergreen is an ANSWER — not retried
```

**Live-classifier verification remains a manual step.** These tests pin the taxonomy, the
transform and the retry. Whether the live model actually returns `kind=correction` for
"Meadow candle launch is the 10th not the 1st" is a prompt-behaviour question that only a
real call can answer.

---

## COMMIT 4 — the rescue button

**Claimed vs landed: the SERVER landed, the TAP did not.** The op exists and works —
`app/src/app/api/plan/draft/apply/route.ts:49-61`, `add_to_month` → `addBacklogItemToMonth`
— and the Build C report documents it (line 267: *"`add_to_month` re-routes a backlog idea
through the same transform path as a typed input"*). But grep shows **no client code ever
sends it**: `DraftPlan.tsx:62` posts only `{op:'text'}`. So every evergreen receipt told the
client to "add it from your ideas" on a surface with no ideas control — including both
Meadow corrections.

The receipt now carries `planInputId` (threaded from `saveToBacklog`, which now returns the
inserted id) and renders the tap. Landing date is the first day of the month the client can
still edit — deterministic and visible, movable with the existing date control, rather than
inventing a date deep in the month they would have to hunt for.

```
✓ offers the tap when the receipt filed a backlog row
✓ says plainly when it could not apply, rather than implying a filing was asked for
✓ no tap without a backlog row to act on
✓ no tap on a month_scoped receipt — it already changed the month
```

---

## COMMIT 5 — approval dialog tells the truth

**Before:** *"After this the dates and formats are set for the month, so have a last look if
you want to move anything."*

That is false. Every post stays editable on the calendar by date until its own date passes —
the `isEditableDate` rule the whole surface is built on.

**After:** *"Dates and formats stay yours to change afterwards, right up until each post's
date. What this starts is the writing."*

The first-step copy also went from the vague *"We'll write the captions and get everything
ready. You can still change things afterwards."* to *"We'll write the captions, hooks and
scripts. You can still change dates and formats afterwards."*

Grepped for the claim across `app/src`, `admin/src` and the migrations; **this was the only
instance.** Asserted by two tests that the old strings are absent and the new ones present.

---

## COMMIT 6 — draft mutations leave a trace

Five new `ActivityAction` values — `beat_added`, `beat_dropped`, `beat_restored`,
`beat_moved`, `beat_format_changed`. Payload: title, date, provenance `basis`, plus `from`
on a move and `format` on a format change. Actor is `USER_ACTOR`.

Best-effort and **outside** the mutation's transaction: losing the record of an edit is bad,
losing the edit is worse. Observability only — nothing reads these.

```
✓ add writes exactly one beat_added
✓ drop writes exactly one beat_dropped — WITH the provenance that was lost
✓ the dropped row survives its beat — post_id is SET NULL, the record is not
✓ restore writes exactly one beat_restored
✓ move writes exactly one beat_moved, recording where it came from
✓ format change writes exactly one beat_format_changed
✓ a REFUSED mutation writes nothing — the ledger records what happened, not what was attempted
```

**cycle-reset still clears them** — its never-run diff test passes unchanged (8/8); it
already deletes `plan_activity` by cycle.

---

## Fence proof

```
$ git diff ce5b15b -- app/src/lib/draft-invisibility.test.ts
[no output — unchanged]
$ git diff ce5b15b -- packages/db/src/schema.ts | grep -E "excludeDraftPosts|POST_STATUS_DRAFT"
[no output — unchanged]
$ vitest run src/lib/draft-invisibility.test.ts src/lib/draft-reader.test.ts
      Tests  17 passed (17)
```

No fence, no `excludeDraftPosts`, no settlement claim semantics, no interactive hook picker
UX, no scheduler change. The one queue-payload change (`autoSelect`) is additive and optional.

---

## Suite results

| package | result |
|---|---|
| `@sprigly/engine` | **230 passed**, 13 files |
| `@sprigly/worker` | **412 passed**, 29 files |
| `@sprigly/app` | **420 passed**, 1 failed (pre-existing — below) |

Type-check clean across `db`, `engine`, `worker`, `app`.

---

## Found and left unfixed

1. **A time-bomb test, failing since midnight.**
   `app/src/lib/plan-activity.integration.test.ts:62` expects an approved proposal to be
   `'applied'`; it is `'failed'`. The test moves a post to **2026-07-20** and today is
   **2026-07-21**, so `isEditableDate` refuses and `approveProposal` fails it. It passed
   yesterday. Confirmed unrelated to this session: `proposals.ts`, `usage.ts` and
   `mutations.ts` are untouched (`git diff 6a76be1..HEAD` is empty for all three), and the
   failure reproduces on a clean tree. **The fix is to make its dates relative to `today`
   rather than hardcoded** — but that is a test change I did not want to make silently
   inside a session about something else, and the same pattern may exist in sibling tests.

2. **`applyLaunchArc` can place a tease AFTER its launch.** In cycle `040d6a1a` the receipt
   says "launches on the 31st" and the surviving beats are Tease 10-26, Follow-up 10-31 —
   the tease five days early is right, but the arc gets compressed by `clampToMonth` when the
   anchor sits at a month boundary, and nothing checks that the parts stay in order. Listed
   in the backlog below as the "same-day rule", but note it is an *ordering* bug as well as a
   collapse-rule gap.

3. **`posts_sync_status` is never stamped for approval-arc cycles.** Only the planning path
   writes it, so a cycle generated through approval has no sync provenance at all.

4. **Hook candidates beyond the first are discarded in fan-out mode.** `autoSelect` keeps
   `candidates[0]` and the rest are returned but unstored, so the client cannot browse the
   alternatives the fan-out already paid for. Storing them would need a column or a
   `source_meta` key; out of scope here.

5. **Prod migration debt unchanged.** Prod still lacks 0084, 0086, 0087 and 0089; UAT has all
   four. Promoting `dev` without applying them makes every `content_cycles` /
   `content_cycle_posts` read error.

---

## Backlog — recorded, not built

- **`addBeat` prompts for an optional one-line subject** ("what's this about?"), so genuine
  hand-adds are not subjectless. Generation for a subjectless `client_added` beat should
  state the honest basis rather than inventing one. *(Note: Commit 2 removes the largest
  source of subjectless beats — undo — but a deliberate hand-add is still subjectless.)*
- **Date-change visual confirmation** on the draft surface.
- **Launch-arc same-day rule** when the launch date sits at month start and the tease has
  nowhere to go — define the collapse. See finding 2: also needs an ordering invariant.
- **Draft list-format refinement; month-pill nav design pass** (the nav added in
  `surface-follows-cycle` has had no design pass).
- **Smoke check for future loops: structure-diff of generated posts vs approved beats**, not
  row counts. This morning's lesson — the row count was right and the month was wrong.
