/**
 * desktop.spec.ts — the desktop SHELL, at 1440×900.
 *
 * ── What this file became, and why ───────────────────────────────────────────────────
 *
 * It used to drive `PlanDesktop`: a right-hand dark rail, a Timeline, a Notes view, an
 * Approvals queue, a "Talk to your plan" FAB that opened a one-shot dialog, and `PostEditor` in
 * a drawer. The desktop redesign retired every one of those, so twenty-two tests were pointed at
 * a surface that no longer exists — which is a different thing from twenty-two failures.
 *
 * What is left here is the half that is genuinely ABOUT DESKTOP: that the four regions are
 * there, that the month and the day are on screen together, that opening a post takes the day
 * column's slot and leaves the conversation standing, that the rings appear beside the sentence
 * that caused them, and that the whole thing holds at the narrow band too.
 *
 * The per-post machinery — hooks, scripts, format changes, shape, the checklist — moved to the
 * MOBILE project (playwright.config.ts). It drives `DetailSheet` and `VoiceSheet`, which both
 * shells now share, so exercising it twice through two frames doubles the maintenance for one
 * signal. Where it runs is a choice about cost, not about coverage.
 */
import { test, expect } from '@playwright/test';
import { SEED, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

/** The seed's editable posts. P1 (2 Jul) and P2 (6 Jul) are BEFORE the frozen today and are
 *  deliberately left alone except where the read-only branch is the subject. */
const EDITABLE_DATE = '2026-07-16';   // P7 — single, caption-bearing, today-onward

/* ── D1 · the four regions ───────────────────────────────────────────────────────── */

test('the shell has four regions and a rail of two', async ({ page }) => {
  await expect(page.getByTestId('plan-rail')).toBeVisible();
  await expect(page.getByTestId('month-col')).toBeVisible();
  await expect(page.getByTestId('day-col')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();

  await expect(page.getByTestId('rail-plan')).toBeVisible();
  await expect(page.getByTestId('rail-tasks')).toBeVisible();
  // Insights is not drawn until there is something behind it.
  await expect(page.getByTestId('rail-insights')).toHaveCount(0);
});

test('the retired controls are gone, and their successors are present', async ({ page }) => {
  for (const gone of ['brief-month-btn', 'agent-fab', 'agent-sheet', 'nav-timeline', 'nav-notes', 'nav-approvals', 'post-editor']) {
    await expect(page.getByTestId(gone), gone).toHaveCount(0);
  }
  await expect(page.getByTestId('add-slot')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();
});

test('the mobile shell is not mounted underneath it', async ({ page }) => {
  await expect(page.getByTestId('plan-shell')).toHaveCount(0);
  await expect(page.getByTestId('nav-pill')).toHaveCount(0);
  await expect(page.getByTestId('week-strip')).toHaveCount(0);
});

/* ── D2 · month and day, side by side ────────────────────────────────────────────── */

test('the month grid and the selected day are on screen together', async ({ page }) => {
  await expect(page.getByTestId('month-col').getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('day-col').getByTestId('day-panel')).toBeVisible();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', SEED.today);
});

test('picking a day moves the day column and leaves the grid standing', async ({ page }) => {
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', EDITABLE_DATE);
  // No switcher, nothing replaced: this is the whole of E2.
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();
});

test('the month arrows round-trip to the adjacent cycle and disable at the edge', async ({ page }) => {
  await expect(page.getByTestId('month-title')).toContainText('July');
  await expect(page.getByTestId('prev-month')).toBeDisabled();

  await page.getByTestId('next-month').click();
  await expect(page.getByTestId('month-title')).toContainText('August');
  await expect(page.getByTestId('next-month')).toBeDisabled();

  await page.getByTestId('prev-month').click();
  await expect(page.getByTestId('month-title')).toContainText('July');
});

/* ── D3 · the detail panel takes the DAY column's slot ───────────────────────────── */

test('opening a post fills the day column, and the month and the conversation do not move', async ({ page }) => {
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await page.getByTestId('post-card').first().click();

  const detail = page.getByTestId('detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-chrome', 'panel');
  await expect(page.getByTestId('day-col').getByTestId('detail-sheet')).toBeVisible();

  // The day list gave up its slot. Nothing else did.
  await expect(page.getByTestId('day-panel')).toHaveCount(0);
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();
  await expect(page.getByTestId('voice-sheet')).toBeVisible();
});

test('the detail panel is a region, not a modal — and the whole sheet is in it', async ({ page }) => {
  // The REEL, because only a format with more than one field renders a tab row at all — a
  // single image has a caption and nothing else, so tabs there would be a control of one.
  await page.getByTestId('post-card').first().click();

  await expect(page.getByTestId('detail-sheet-scrim')).toHaveCount(0);
  await expect(page.getByTestId('detail-sheet-grabber')).toHaveCount(0);

  const detail = page.getByTestId('detail-sheet');
  await expect(detail.getByTestId('tab-caption')).toBeVisible();
  await expect(detail.getByTestId('copy-field')).toBeVisible();
  await expect(detail.getByTestId('act-move')).toBeVisible();
  await expect(detail.getByTestId('act-delete')).toBeVisible();
});

test('the way back names the day, and it returns the day list to its column', async ({ page }) => {
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await page.getByTestId('post-card').first().click();
  await expect(page.getByTestId('detail-back')).toContainText('16 July');

  await page.getByTestId('detail-back').click();
  await expect(page.getByTestId('detail-sheet')).toHaveCount(0);
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', EDITABLE_DATE);
});

/* ── D4 · the docked conversation ────────────────────────────────────────────────── */

test('the conversation is present with no gesture, and has no way to close', async ({ page }) => {
  const dock = page.getByTestId('conversation-dock');
  await expect(dock.getByTestId('voice-sheet')).toBeVisible();
  await expect(dock.getByTestId('voice-input')).toBeVisible();
  await expect(dock.getByTestId('voice-mic')).toBeVisible();
  await expect(page.getByTestId('voice-close')).toHaveCount(0);
  await expect(page.getByTestId('voice-sheet-scrim')).toHaveCount(0);
});

test('it does not steal focus on load — nobody opened it', async ({ page }) => {
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  expect(focused).not.toBe('voice-input');
});

/* ── D5 · the ringed days ────────────────────────────────────────────────────────── */

test('an open turn rings the days it names, and Apply clears them and moves the month', async ({ page }) => {
  // The compound phrasing is the one the fake pins to a known post; a bare UUID is resolved
  // out of the whole templated message, whose first id belongs to another post.
  await page.getByTestId('voice-input').fill(`move the reel ${SEED.post(3)} later and make it a carousel`);
  await page.getByTestId('voice-submit').click();

  await expect(page.getByTestId('interpretation')).toBeVisible({ timeout: 20_000 });
  const ringed = page.locator('[data-testid="grid-cell"][data-ringed="true"]');
  // Both ends of the move: the day losing the post and the day gaining it.
  await expect(ringed).toHaveCount(2);
  await expect(page.locator('[data-testid="grid-cell"][data-date="2026-07-08"]')).toHaveAttribute('data-ringed', 'true');
  await expect(page.locator('[data-testid="grid-cell"][data-date="2026-07-24"]')).toHaveAttribute('data-ringed', 'true');

  await page.getByTestId('interp-apply').click();

  // The turn resolved, so the rings go with it — and the post is where it was asked to be.
  await expect(ringed).toHaveCount(0);
  await expectActivity(page, SEED.post(3), (r) => r.action === 'rescheduled' && r.origin === 'agent', 'agent move ledgered');
});

test('Discard clears the rings and changes nothing', async ({ page }) => {
  await page.getByTestId('voice-input').fill(`move the reel ${SEED.post(3)} later and make it a carousel`);
  await page.getByTestId('voice-submit').click();
  await expect(page.getByTestId('interpretation')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="grid-cell"][data-ringed="true"]')).toHaveCount(2);

  await page.getByTestId('interp-discard').click();
  await expect(page.locator('[data-testid="grid-cell"][data-ringed="true"]')).toHaveCount(0);
  await expect(page.getByTestId('interpretation')).toHaveAttribute('data-status', 'discarded');
});

/* ── the rail ────────────────────────────────────────────────────────────────────── */

test('Tasks replaces the plan region and the conversation stays', async ({ page }) => {
  await page.getByTestId('rail-tasks').click();
  await expect(page.getByTestId('tasks-panel')).toBeVisible();
  await expect(page.getByTestId('task-row').first()).toBeVisible();
  await expect(page.getByTestId('month-grid')).toHaveCount(0);
  await expect(page.getByTestId('conversation-dock')).toBeVisible();

  await page.getByTestId('rail-plan').click();
  await expect(page.getByTestId('month-grid')).toBeVisible();
});

/* ── the narrow band ─────────────────────────────────────────────────────────────── */

test('at 1024 the plan region stacks and the conversation does NOT collapse', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 820 });

  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('day-panel')).toBeVisible();
  // The one region whose promise is that it is always there.
  await expect(page.getByTestId('conversation-dock')).toBeVisible();
  await expect(page.getByTestId('voice-input')).toBeVisible();

  // The rail collapses to icons; the label survives for a screen reader, not on screen.
  await expect(page.getByTestId('rail-plan')).toBeVisible();
  const railWidth = await page.getByTestId('plan-rail').evaluate((el) => el.getBoundingClientRect().width);
  expect(railWidth).toBeLessThan(100);
});

test('nothing overflows sideways at 1440 or 1024', async ({ page }) => {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(page.getByTestId('month-grid')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
});

/* ── the per-post date policy, which this suite used to fight ────────────────────── */

test('a PAST post opens read-only; a future one is editable', async ({ page }) => {
  // P1 is 2 Jul, before the frozen today of 8 Jul. The policy is per POST, by date — it is not
  // a whole-cycle flag, and that is what ten of the old fixtures were pinned to.
  await page.locator('[data-testid="grid-cell"][data-date="2026-07-02"]').click();
  await page.getByTestId('post-card').first().click();
  await expect(page.getByTestId('detail-sheet')).toBeVisible();
  await expect(page.getByTestId('act-delete')).toHaveCount(0);

  await page.getByTestId('detail-back').click();
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await page.getByTestId('post-card').first().click();
  await expect(page.getByTestId('act-delete')).toBeVisible();
});
