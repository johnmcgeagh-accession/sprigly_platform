# Caption autosave cursor-jump — fix report

**Date:** 2026-07-20 · **Branch:** `dev` (not pushed)

## Symptom

While a client edited a caption in the plan editor, the autosave fired mid-typing
and the cursor jumped to the end of the field, forcing them to reposition after
each save.

## Root cause (verified)

Two things compounded, once per settled keystroke (~1.5s idle):

1. **`PostEditor.tsx`** re-synced local `caption`/`hook`/`script` state from the
   `post` prop on *every* prop change via an unguarded effect
   (`useEffect(() => { setCaption(post.caption); }, [post.caption])`). Re-seeding a
   focused, controlled `<textarea>` with a freshly-constructed string snaps the caret
   to the end.
2. **`usePlanData.ts`** — after every caption PATCH, `call()` ran
   `await refreshPlan()`, which refetched `/api/plan` and replaced the entire `posts`
   array (`setPosts`). That handed the editor a new `post` object (new `caption`
   identity) on each save, which is exactly what triggered effect (1).

So: keystroke settles → PATCH → `refreshPlan` → `setPosts` → new `post.caption` →
unguarded `setCaption` → caret resets. If the round-trip landed mid-sentence it could
also overwrite in-progress text.

## Changes (three behaviour commits + one test commit)

### 1. `fix: caption edit no longer jumps the caret …` (`222a79d`)
`PostEditor.tsx` + `useAutosave.ts`.

- `useAutosave` now exposes **`dirty`** (`value !== savedRef.current`, computed in
  render so it reflects the baseline *before* the persisted-sync effect advances it).
  The reset guard reuses this baseline rather than re-deriving it.
- The three unguarded sync effects are replaced by **guarded** ones, moved below the
  `useAutosave` calls. A new server value is adopted into a field only when the field
  is **not focused** (tracked in a `focus` ref set by `onFocus`/`onBlur`) **and** not
  **dirty**. Each effect keys on the field's own value only, so it runs when the
  *server* value changes, using the `dirty` snapshot from that render (not on
  focus/keystroke transitions — avoiding a stale-prop adoption on blur).
- The full-reset-on-record-switch effect (keyed on `post.id`) is unchanged.

### 2. `fix: caption/hook/script saves apply in place …` (`c7af6c0`)
`usePlanData.ts`.

- New `applyResultLocally(r)`: splices the changed post(s) from the PATCH response's
  post set into local state **by id**, leaving every other card and the editor's own
  value stable. Returns `false` (→ fall back to `refreshPlan`) if a changed post is
  missing from the response (cross-cycle surprise).
- `call()` gains a `localApply` flag. `saveCaption`/`saveHook`/`saveScript` pass
  `true`: the result is applied in place with **no** `refreshPlan`, and the per-save
  toast is dropped in favour of the field's inline hint (commit 3). Structural writes
  (format, revert, delete, reschedule, add) still `refreshPlan` and keep their toast.
- No schema/API change: `PATCH /api/posts/:id` is unchanged; this only changes how the
  client consumes the existing `applied` response.

### 3. `feat: quiet inline "Saving… / Saved" hint …` (`fc31d50`)
`useAutosave.ts` + `PostEditor.tsx`.

- `useAutosave` tracks a `status` (`idle → saving → saved`) by awaiting the save, and
  returns it. The caption header shows a quiet, `aria-live` hint — "Saving…" in
  flight, "Saved" once settled, nothing before the first save or while a fresh edit is
  unsaved (`status === 'saved' && !dirty`). No Save button (matches
  `IntakeCapture.tsx`'s pattern).
- **StrictMode fix (found during verification):** the `mounted` guard originally only
  set `false` on cleanup. Under React StrictMode (Next dev default) the
  mount→unmount→remount cycle pinned `mounted.current = false`, swallowing every
  `setStatus` so the hint never appeared. The mount effect now **re-arms**
  `mounted.current = true` on (re)mount.

### 4. `test(e2e): caption caret holds mid-field …` (`200939b`)
Two `app/e2e/desktop.spec.ts` regressions on an editable post (post 7, 2026-07-16).

## Verification (against the running app)

Driven through the real UI (Playwright against `next dev` in fake mode). All four
requested checks pass, on an **editable** post:

| Check | Result | Evidence |
|---|---|---|
| Type continuously through a 1.5s idle boundary | **PASS** | caret placed after `HEAD`, typed `X`, waited past the debounce (autosave re-rendered), typed `Y` → value `HEADXYMIDTAIL`, caret at 6, still focused. Text not replaced. |
| Blur mid-edit | **PASS** | blur flushes the save; field ends **unfocused**, text intact, hint reads "Saved". No caret disturbance. |
| External change while unfocused + clean | **PASS** | a Shape rewrite ("…quietly working…") lands in the editor when the field is idle and clean. |
| External change while unsaved edits present | **PASS** | Shape rewrite arriving while the field is focused + dirty leaves the client's `MY OWN WORDS, MID-EDIT` untouched. |
| Saved indicator | **PASS** | hint settles `Saving… → Saved`. |

Both new e2e regressions also pass through the Playwright harness (setup + 2 desktop
tests, all green).

### Item 4 — which side wins, and where it's decided

**The client's in-progress edit wins.** Decided in `PostEditor.tsx` by the per-field
guard `if (!focus.current.<field> && !<auto>.dirty) set<Field>(post.<field>)`: an
external value is adopted only when the field is **both** unfocused **and** clean, so
if the client is mid-edit (focused, and/or dirty) the external value is simply not
adopted — their local state is never overwritten. A mid-edit is the realistic case for
"has unsaved edits", and it is focused, so the guard preserves it. (If the client's own
save later settles, `applyResultLocally` sets `post.caption` to *their* saved value, so
the prop and local state converge on what they typed.)

One deliberate, minor trade-off: if a change arrives while a field is focused **but
clean**, it is not adopted until the next record switch/refetch — chosen so the caret
is never disturbed under the cursor.

## Environment / caveats

- Verified against an **isolated** throwaway Postgres (port 55499) + `next dev`
  (3299), created so as not to disturb the developer's own `restore_check` container
  holding port 55432. The isolated container and a temp Playwright config were removed
  afterwards; the tree is clean.
- The local schema baseline (`.test-db/schema.sql`, dated Jul 9) predates migrations
  0074–0081, so those were applied on top to seed successfully (two prompt/data-seed
  migrations, 0075 and part of 0081, were idempotency conflicts and skipped — the e2e
  seed supplies its own data).
- **Pre-existing, out of scope:** several committed editor tests (`desktop.spec.ts`
  41/131/169/244) target `SEED.post(1)`, which the seed dates `2026-07-02` — **readonly**
  at the frozen today `2026-07-08` (the seed itself notes "the two pre-8th posts are
  read-only"). Those tests fail on this branch independent of this change (the
  cycle-binding refactor appears to have moved the date gate under them). The new
  regressions therefore target an editable post (post 7) and are robust to which month
  the app lands on.
