/**
 * detail-machinery.spec.ts — hooks, scripts, format and shape, through the detail view.
 *
 * ── Where these claims used to live ──────────────────────────────────────────────────
 *
 * In `hooks.spec.ts`, `scripts.spec.ts`, `format.spec.ts` and `refine.spec.ts`, driving
 * `PostEditor` in the desktop drawer. The desktop redesign retired that editor: both shells now
 * open `DetailSheet` — a sheet on the phone, a panel in the day column on desktop — so the
 * machinery has one surface rather than two, and these tests follow it here.
 *
 * They run on the MOBILE project. The components are shared, so the choice is only about which
 * frame pays the running cost, and the phone is the surface the product is for.
 *
 * ── What changed in the claims themselves, and why ───────────────────────────────────
 *
 * Two of the old files were pinned to behaviour that has legitimately moved, and the new tests
 * assert the CURRENT rule rather than the old one:
 *
 *   A REEL'S HOOK AND SCRIPT ARE ONE ACT (C4). `scripts.spec.ts` gated the script on a
 *   pre-existing hook and typed one in to unlock it. There is no such gate: the pair is written
 *   together from the caption, and the gate that remains is the CAPTION.
 *
 *   FORMAT LIVES INSIDE SHAPE (round 7, P17). `format.spec.ts` drove an always-visible dropdown
 *   under the editor header. The control is in Shape mode now, beside the prompt field, where a
 *   change with consequences belongs.
 */
import { test, expect } from '@playwright/test';
import { SEED, activityFor, expectActivity, reseed, openPostOn, closeDetail } from './helpers';

/** The seed's editable posts — every date here is today-onward against PLAN_TODAY 2026-07-08. */
const REEL = { id: SEED.post(3), date: '2026-07-08' };        // caption, no hook, no script
const CAROUSEL = { id: SEED.post(8), date: '2026-07-20' };    // caption, no hook
const SINGLE = { id: SEED.post(7), date: '2026-07-16' };      // caption only
const EMPTY_SINGLE = { id: SEED.post(4), date: '2026-07-09' }; // no caption at all

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-shell')).toBeVisible();
});

/* ── which tabs exist at all ─────────────────────────────────────────────────────── */

test('the tabs a format can never have are ABSENT, and one field means no tab row at all', async ({ page }) => {
  await openPostOn(page, SINGLE.date, SINGLE.id);
  // A single image has a caption and nothing else — ever. A greyed hook tab would say
  // "broken", and a tab ROW of one would be a control with no choice in it.
  await expect(page.getByTestId('field-body')).toBeVisible();
  await expect(page.getByTestId('tab-caption')).toHaveCount(0);
  await expect(page.getByTestId('tab-hook')).toHaveCount(0);
  await expect(page.getByTestId('tab-script')).toHaveCount(0);
  await closeDetail(page);

  await openPostOn(page, REEL.date, REEL.id);
  await expect(page.getByTestId('tab-caption')).toBeVisible();
  await expect(page.getByTestId('tab-hook')).toBeVisible();
  await expect(page.getByTestId('tab-script')).toBeVisible();
});

/* ── hooks ───────────────────────────────────────────────────────────────────────── */

test('carousel: the empty hook tab offers to write it, returns three, and picking one saves it', async ({ page }) => {
  await openPostOn(page, CAROUSEL.date, CAROUSEL.id);
  await page.getByTestId('tab-hook').click();
  await expect(page.getByTestId('empty-field')).toBeVisible();

  await page.getByTestId('generate-hook').click();
  await expect(page.getByTestId('hook-candidate')).toHaveCount(3, { timeout: 15_000 });

  const picked = (await page.getByTestId('hook-candidate').first().textContent())!.trim();
  await page.getByTestId('hook-candidate').first().click();

  // The pick IS the save — there is no second control to press.
  await expect(page.getByTestId('field-body')).toContainText(picked);
  await expect(page.getByTestId('hook-candidate')).toHaveCount(0);
  await expectActivity(page, CAROUSEL.id, (r) => r.action === 'hook_saved', 'hook_saved on pick');
  await expect
    .poll(async () => (await activityFor(page, CAROUSEL.id)).filter((r) => r.action === 'hook_saved').length)
    .toBe(1);

  // …and it survives a reload.
  await page.reload();
  await expect(page.getByTestId('plan-shell')).toBeVisible();
  await openPostOn(page, CAROUSEL.date, CAROUSEL.id);
  await page.getByTestId('tab-hook').click();
  await expect(page.getByTestId('field-body')).toContainText(picked);
});

test('reel: the hook and the script are ONE act, offered from either tab (C4)', async ({ page }) => {
  test.setTimeout(90_000);
  await openPostOn(page, REEL.date, REEL.id);
  await page.getByTestId('tab-hook').click();
  await expect(page.getByTestId('empty-field')).toContainText('written together');
  // The length belongs to the pair, so it is offered on the HOOK tab of a reel too.
  await expect(page.getByTestId('script-length')).toBeVisible();

  await page.getByTestId('length-60').click();
  await page.getByTestId('generate-hook').click();

  // One act, both fields. The pair is one model call, so it settles slower than a single field.
  await expect(page.getByTestId('empty-field')).toHaveCount(0, { timeout: 40_000 });
  await expect(page.getByTestId('field-body')).toBeVisible();
  await page.getByTestId('tab-script').click();
  await expect(page.getByTestId('field-body')).toContainText(/HOOK:/, { timeout: 40_000 });
});

/* ── the caption gate — NOT covered here, and why ────────────────────────────────
 *
 * "no caption → the hook and script are refused in words, with no button that would 422" is a
 * real rule (EmptyField's `needsCaption` branch) and it is not asserted through this surface.
 * Reaching it needs a REEL with no caption, and the seed has none: blanking one through the API
 * gives a post the sheet renders as "nothing written yet" rather than as a reel with empty
 * fields, so the assertion would be about a different state than the one it names. Recorded in
 * docs/reports/desktop-build.md rather than left as a test that looks like coverage.
 */

/* ── shape ───────────────────────────────────────────────────────────────────────── */

test('shape rewrites the open tab in place, and the footer is replaced rather than relabelled', async ({ page }) => {
  await openPostOn(page, SINGLE.date, SINGLE.id);
  const before = (await page.getByTestId('field-body').textContent())!.trim();

  await page.getByTestId('act-shape').click();
  await expect(page.getByTestId('shape-input')).toBeVisible();
  // The action row is GONE while shaping — a button never changes meaning mid-flow.
  await expect(page.getByTestId('act-delete')).toHaveCount(0);
  await expect(page.getByTestId('shape-submit')).toBeVisible();
  await expect(page.getByTestId('shape-cancel')).toBeVisible();

  await page.getByTestId('shape-input').fill('make it warmer');
  await page.getByTestId('shape-submit').click();

  await expect(page.getByTestId('field-body')).not.toHaveText(before, { timeout: 30_000 });
});

test('cancelling shape restores the action row and changes nothing', async ({ page }) => {
  await openPostOn(page, SINGLE.date, SINGLE.id);
  const before = (await page.getByTestId('field-body').textContent())!.trim();

  await page.getByTestId('act-shape').click();
  await page.getByTestId('shape-input').fill('something I thought better of');
  await page.getByTestId('shape-cancel').click();

  await expect(page.getByTestId('shape-input')).toHaveCount(0);
  await expect(page.getByTestId('act-delete')).toBeVisible();
  await expect(page.getByTestId('field-body')).toHaveText(before);
});

/* ── format, which now lives inside shape (round 7, P17) ─────────────────────────── */

test('the format control is inside SHAPE, not on the reading surface', async ({ page }) => {
  await openPostOn(page, SINGLE.date, SINGLE.id);
  // Not a display toggle one tap from a client who opened the sheet to read their caption.
  await expect(page.getByTestId('format-control')).toHaveCount(0);

  await page.getByTestId('act-shape').click();
  await expect(page.getByTestId('format-control')).toBeVisible();
  await expect(page.getByTestId('format-single')).toHaveAttribute('data-on', 'true');
});

const REEL_WITH_PAIR = { id: SEED.post(6), date: '2026-07-13' };   // seeded WITH hook + script

test('changing format says what it strands rather than clearing it', async ({ page }) => {
  await openPostOn(page, REEL_WITH_PAIR.date, REEL_WITH_PAIR.id);
  await page.getByTestId('act-shape').click();
  await page.getByTestId('format-single').click();

  // Never "we removed" — we did not. The words are still there and still theirs.
  await expect(page.getByTestId('format-note')).toContainText('still saved');
  await expectActivity(page, REEL_WITH_PAIR.id, (r) => r.action === 'format_changed', 'format_changed ledgered');
});

/* ── editing by hand, which is free ──────────────────────────────────────────────── */

test('a caption edits in place, autosaves once, and persists', async ({ page }) => {
  await openPostOn(page, SINGLE.date, SINGLE.id);
  await page.getByTestId('edit-field').click();
  await page.getByTestId('edit-input').fill('A brand new caption for the e2e test.');
  await page.getByTestId('edit-save').click();

  await expect(page.getByTestId('field-body')).toContainText('A brand new caption for the e2e test.');
  await expect
    .poll(async () => (await activityFor(page, SINGLE.id)).filter((r) => r.action === 'caption_saved').length, { timeout: 8000 })
    .toBe(1);

  await page.reload();
  await expect(page.getByTestId('plan-shell')).toBeVisible();
  await openPostOn(page, SINGLE.date, SINGLE.id);
  await expect(page.getByTestId('field-body')).toContainText('A brand new caption for the e2e test.');
});

/* ── the per-post date policy ────────────────────────────────────────────────────── */

test('a PAST post opens read-only — the gate is per post, by date', async ({ page }) => {
  // P1 is 2 July, before the frozen today of 8 July. This is the rule ten of the old desktop
  // fixtures were pinned against, asserted directly rather than tripped over.
  await openPostOn(page, '2026-07-02', SEED.post(1));
  await expect(page.getByTestId('field-body')).toBeVisible();
  await expect(page.getByTestId('act-delete')).toHaveCount(0);
  await expect(page.getByTestId('act-shape')).toHaveCount(0);
  await expect(page.getByTestId('edit-field')).toHaveCount(0);
});
