/**
 * mobile.spec.ts — the committed plan surface, on a phone.
 *
 * ⚠️ REWRITTEN FOR THE NEW SHELL AND **NOT YET RUN**. Playwright needs a built app, Postgres,
 * Redis and a seeded fixture, none of which were available in the session that made this
 * change; the surface itself is covered by simulated-interaction tests
 * (`src/components/plan/surface/surface.interaction.test.tsx`, 28 cases, jsdom) which DID run.
 * Treat the first execution of this file as part of the uat check, not as a regression pass.
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

test('the month grid is a peer view, and a picker', async ({ page }) => {
  await page.getByTestId('nav-month').click();
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('week-strip')).toHaveCount(0);

  await page.locator('[data-testid="grid-cell"][data-date="2026-07-22"]').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-22');
  // The strip re-anchored to that week rather than staying on the one we left.
  await expect(page.locator('[data-testid="week-day"][data-date="2026-07-22"]')).toHaveCount(1);
});

test('Tasks is a peer view too, and still shows the work-back board', async ({ page }) => {
  await page.getByTestId('nav-tasks').click();
  await expect(page.getByTestId('tasks-panel')).toBeVisible();
  await expect(page.getByTestId('task-row').first()).toBeVisible();
});

test('the add slot is per-day, and the only add affordance', async ({ page }) => {
  await expect(page.getByTestId('add-slot')).toHaveCount(1);
  await expect(page.getByText('Add to your plan')).toHaveCount(0);
  await expect(page.getByText('Brief this month')).toHaveCount(0);
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
