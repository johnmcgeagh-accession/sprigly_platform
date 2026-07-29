/**
 * mobile.spec.ts — the committed plan surface, on a phone.
 *
 * Rewritten for the new shell in Session A, where it could not be run — the port its container
 * needs was held by something that was not ours to stop. **It runs now**, and this file is what
 * round 6's rulings look like from outside the app.
 *
 * ── What changed, and why the old assertions could not simply be re-pointed ──────────
 *
 * The redesign deletes the behaviours half of this file was testing, deliberately:
 *
 *   swipe-to-Move          the card is a thing you READ. Move lives in the detail sheet's
 *                          action row, where it sits beside Shape and Delete.
 *   the scroll-spy         the strip selects and the panel renders one day, so there is no
 *                          feed for a spy to follow and nothing for spyLock to referee (§1.4).
 *   prev-week / next-week  the strip is swipeable and the month grid covers longer jumps.
 *   the Plan|Tasks segment the floating nav pill absorbed it, alongside Day and Month.
 *   day sections           there is one day on screen, so a weather badge has one home.
 *
 * Those tests are removed rather than skipped: a skipped test for a deleted feature is a
 * to-do list nobody reads. What replaces them tests the same underlying promises — you can
 * reach any day, you can see what is on it, and a move is ledgered.
 */
import { test, expect } from '@playwright/test';
import { reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-shell')).toBeVisible();
});

test('the day view lands on today, with the week strip around it', async ({ page }) => {
  await expect(page.getByTestId('week-day')).toHaveCount(7);
  await expect(page.locator('[data-testid="week-day"][data-date="2026-07-08"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-08');
});

test('the strip selects, and the panel follows it', async ({ page }) => {
  await page.locator('[data-testid="week-day"][data-date="2026-07-10"]').click();
  await expect(page.locator('[data-testid="week-day"][data-date="2026-07-10"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-10');
  // No spy to bounce it back — the selection is the only authority now.
  await page.waitForTimeout(900);
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-10');
});

test('swiping the strip moves a week; Today comes back', async ({ page }) => {
  const strip = page.getByTestId('week-strip');
  await strip.dispatchEvent('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, isPrimary: true, bubbles: true });
  await strip.dispatchEvent('pointerup', { pointerId: 1, clientX: 180, clientY: 300, bubbles: true });
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-15');

  await page.getByTestId('today-btn').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-08');
});

test('the week pager steps a week and stops at the month edge (round 6, P5)', async ({ page }) => {
  await page.getByTestId('next-week').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-15');
  await page.getByTestId('prev-week').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-08');

  // Walk to the last week of July; the next one is entirely August, whose posts are not loaded.
  await page.getByTestId('next-week').click();
  await page.getByTestId('next-week').click();
  await page.getByTestId('next-week').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-29');
  await expect(page.getByTestId('next-week')).toBeDisabled();
});

test('the month grid is a peer view you STAY in (round 6, P6)', async ({ page }) => {
  await page.getByTestId('nav-month').click();
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('week-strip')).toHaveCount(0);

  await page.locator('[data-testid="grid-cell"][data-date="2026-07-22"]').click();
  // The calendar is still the view; the day appears as a summary beneath it.
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('day-panel')).toHaveCount(0);
  await expect(page.getByTestId('month-summary')).toHaveAttribute('data-date', '2026-07-22');

  // The selection is shared, so Day lands where we were reading, strip re-anchored.
  await page.getByTestId('nav-day').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-22');
  await expect(page.locator('[data-testid="week-day"][data-date="2026-07-22"]')).toHaveCount(1);
});

test('Tasks is a peer view too, and still shows the work-back board', async ({ page }) => {
  await page.getByTestId('nav-tasks').click();
  await expect(page.getByTestId('tasks-panel')).toBeVisible();
  await expect(page.getByTestId('task-row').first()).toBeVisible();
});

test('the add slot is per-day, the only add affordance, and it SHAPES (round 6, P1)', async ({ page }) => {
  await expect(page.getByTestId('add-slot')).toHaveCount(1);
  await expect(page.getByText('Add to your plan')).toHaveCount(0);
  await expect(page.getByText('Brief this month')).toHaveCount(0);

  await page.getByTestId('add-slot').click();
  // A sheet, not a blank card called Untitled.
  await expect(page.getByTestId('add-sheet')).toBeVisible();
  await expect(page.getByTestId('add-format')).toBeVisible();
  await expect(page.getByTestId('add-subject')).toBeVisible();

  // The grabber is a control now (P7): a plain tap on it closes the sheet.
  await page.getByTestId('add-sheet-grabber').click();
  await expect(page.getByTestId('add-sheet')).toHaveCount(0);
});

test('the microphone floats beside the nav pill, labelled for the committed month', async ({ page }) => {
  await expect(page.getByTestId('nav-mic')).toHaveAttribute('aria-label', 'Talk to your plan');
  await expect(page.getByTestId('nav-pill')).toBeVisible();
});

test('weather: the selected day header carries one badge with one accessible label', async ({ page }) => {
  // 2026-07-08 is in the forecast window.
  const badge = page.getByTestId('day-panel').getByTestId('weather-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveAttribute('aria-label', /^Weather: -?\d+° · .+/);
  await expect(badge).toHaveAttribute('data-tone', 'normal');
  await expect(badge.locator('svg[aria-hidden="true"]')).toHaveCount(1);

  // A day before "today" is out of the window → no badge, and no placeholder either.
  await page.locator('[data-testid="week-day"][data-date="2026-07-06"]').click();
  await expect(page.getByTestId('day-panel').getByTestId('weather-badge')).toHaveCount(0);
});
