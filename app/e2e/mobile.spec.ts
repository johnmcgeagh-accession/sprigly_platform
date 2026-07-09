import { test, expect, type Locator } from '@playwright/test';
import { expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-mobile')).toBeVisible();
});

/** Drive the swipe handler with a synthetic pointer sequence (dispatchEvent bypasses
 *  hit-testing, so coordinates are relative deltas the handler reads off clientX/Y). */
async function drag(surf: Locator, from: { x: number; y: number }, deltas: [number, number][]) {
  await surf.dispatchEvent('pointerdown', { pointerId: 1, clientX: from.x, clientY: from.y, button: 0, isPrimary: true, bubbles: true });
  for (const [dx, dy] of deltas) {
    // eslint-disable-next-line no-await-in-loop
    await surf.dispatchEvent('pointermove', { pointerId: 1, clientX: from.x + dx, clientY: from.y + dy, bubbles: true });
  }
  const last = deltas[deltas.length - 1]!;
  await surf.dispatchEvent('pointerup', { pointerId: 1, clientX: from.x + last[0], clientY: from.y + last[1], bubbles: true });
}
const transformOf = (surf: Locator) => surf.evaluate((el) => (el as HTMLElement).style.transform);

test('mobile feed: week strip, today selected, cards with rings', async ({ page }) => {
  await expect(page.getByTestId('week-day')).toHaveCount(7);
  await expect(page.locator('[data-testid="week-day"][data-date="2026-07-08"]')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('swipe-card').first()).toBeVisible();
  await expect(page.getByTestId('progress-ring').first()).toBeVisible();
});

test('swipe axis-lock: a vertical drag does not translate the card', async ({ page }) => {
  const surf = page.getByTestId('swipe-surface').first();
  await drag(surf, { x: 300, y: 400 }, [[2, 8], [3, 30], [4, 70], [4, 130]]);
  const tf = await transformOf(surf);
  expect(tf === '' || tf === 'none' || tf === 'translateX(0px)').toBeTruthy();
});

test('swipe left reveals Edit/Delete; Edit opens the editor sheet', async ({ page }) => {
  const card = page.getByTestId('swipe-card').first();
  const surf = card.getByTestId('swipe-surface');
  await drag(surf, { x: 320, y: 400 }, [[-15, 2], [-50, 3], [-110, 4], [-165, 5]]);
  await expect.poll(() => transformOf(surf)).toContain('translateX(-156');
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('editor-sheet')).toBeVisible();
  await expect(page.getByTestId('editor-caption')).toBeVisible();
});

test('swipe right reveals Move; the date picker round-trips a reschedule', async ({ page }) => {
  const card = page.getByTestId('swipe-card').first();
  const id = (await card.getAttribute('data-post-id'))!;
  const surf = card.getByTestId('swipe-surface');
  await drag(surf, { x: 90, y: 400 }, [[15, 2], [55, 3], [120, 4], [170, 5]]);
  await expect.poll(() => transformOf(surf)).toContain('translateX(156');
  await card.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByTestId('move-sheet')).toBeVisible();
  await expect(page.getByTestId('move-sheet').getByTestId('calendar-picker')).toBeVisible();
  await page.locator('[data-testid="move-sheet"] [data-date="2026-07-25"]').click();
  await expect(page.getByTestId('move-sheet')).not.toBeInViewport();   // closed = translated off-screen
  await expectActivity(page, id, (r) => r.action === 'rescheduled' && r.origin === 'user', 'mobile move ledgered');
});

test('scroll-spy: tapping a strip day selects it (and does not bounce back)', async ({ page }) => {
  await page.locator('[data-testid="week-day"][data-date="2026-07-10"]').click();
  const day = page.locator('[data-testid="week-day"][data-date="2026-07-10"]');
  await expect(day).toHaveAttribute('data-selected', 'true');
  await page.waitForTimeout(900);                 // past the spy-lock release window
  await expect(day).toHaveAttribute('data-selected', 'true');
});

test('scroll-spy: manually scrolling the feed updates the strip selection', async ({ page }) => {
  const initial = await page.locator('[data-testid="week-day"][data-selected="true"]').getAttribute('data-date');
  await page.getByTestId('feed').evaluate((el) => el.scrollBy(0, 700));
  await expect.poll(async () => page.locator('[data-testid="week-day"][data-selected="true"]').getAttribute('data-date'))
    .not.toBe(initial);
});

test('mobile Tasks tab: shows the work-back board', async ({ page }) => {
  await page.getByTestId('seg-tasks').click();
  await expect(page.getByTestId('mobile-tasks')).toBeVisible();
  await expect(page.getByTestId('task-row').first()).toBeVisible();
});

test('mobile editor sheet mirrors the drawer (caption + checklist)', async ({ page }) => {
  await page.getByTestId('swipe-card').first().getByTestId('swipe-surface').click();
  await expect(page.getByTestId('editor-sheet')).toBeVisible();
  await expect(page.getByTestId('editor-caption')).toBeVisible();
  await expect(page.getByTestId('editor-checklist')).toBeVisible();
});

test('mobile weather: in-window day headers show a badge (icon + temp) with one accessible label; out-of-window shows nothing', async ({ page }) => {
  // Today (2026-07-08) is in-window → its day-header carries a weather badge.
  const todayBadge = page.locator('[data-testid="day-section"][data-day="2026-07-08"] [data-testid="weather-badge"]');
  await expect(todayBadge).toHaveCount(1);
  await expect(todayBadge).toHaveAttribute('aria-label', /^Weather: -?\d+° · .+/);
  // The glyph inside the badge is decorative; the label on the badge is the sole a11y name.
  await expect(todayBadge.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await expect(todayBadge).toContainText('°');

  // 2026-07-06 is before "today" → out of the forecast window → no badge, no placeholder.
  await expect(page.locator('[data-testid="day-section"][data-day="2026-07-06"] [data-testid="weather-badge"]')).toHaveCount(0);
});
