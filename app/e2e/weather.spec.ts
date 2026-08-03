/**
 * weather.spec.ts — the forecast decoration, on the surface that still carries it.
 *
 * ── A capability the redesign drops, recorded rather than discovered later ────────────
 *
 * `PlanDesktop` painted the whole 15-day window across its calendar cells: an icon and a temp
 * label on every in-window day. The redesigned month grid is a DENSITY MAP — a day numeral and
 * its pips in a 69px cell — and there is no room for a third mark that is not about the plan.
 * So the month-wide forecast is gone, and what remains is the badge on the SELECTED DAY'S
 * header, which both shells have and which is where the client is actually reading that day.
 *
 * That is a real loss of a real thing, and it is named in docs/reports/desktop-build.md rather
 * than left to be noticed. What is NOT lost is the machinery: the window, the buckets, the tone
 * bands and the failure posture are all still exercised — one day at a time instead of fifteen
 * at once, by stepping the selection.
 *
 * The e2e fake serves a deterministic 15-day forecast anchored to PLAN_TODAY (2026-07-08), so
 * in-window is 2026-07-08 … 2026-07-22 (app/src/lib/e2e-fake.ts).
 *
 * Runs on the MOBILE project: the day header is shared, and the phone is the surface it is for.
 */
import { test, expect, type Page } from '@playwright/test';
import { reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-shell')).toBeVisible();
});

/** Select a day from the month grid, which reaches any day in the month, and read its badge. */
async function badgeOn(page: Page, iso: string) {
  if (await page.getByTestId('month-grid').count() === 0) await page.getByTestId('nav-month').click();
  await page.locator(`[data-testid="grid-cell"][data-date="${iso}"]`).click();
  await page.getByTestId('nav-day').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', iso);
  return page.getByTestId('day-panel').getByTestId('weather-badge');
}

test('the window has edges, and outside them nothing is shown rather than a placeholder', async ({ page }) => {
  test.setTimeout(90_000);
  // First in-window day.
  await expect(await badgeOn(page, '2026-07-08')).toHaveCount(1);
  // Last in-window day.
  await expect(await badgeOn(page, '2026-07-22')).toHaveCount(1);
  // One past the end — and one before the start.
  await expect(await badgeOn(page, '2026-07-23')).toHaveCount(0);
  await expect(await badgeOn(page, '2026-07-06')).toHaveCount(0);
});

test('the badge carries the whole fact in one accessible label, and the glyph is decorative', async ({ page }) => {
  const badge = await badgeOn(page, '2026-07-10');
  await expect(badge).toHaveAttribute('aria-label', /^Weather: -?\d+° · .+/);
  // The info is in the label, not in the shape — the shape is hidden from assistive tech.
  await expect(badge.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  // Quiet by default.
  await expect(badge).toHaveAttribute('data-tone', 'normal');
});

test('the tone bands: scorcher, hot and cold each read differently', async ({ page }) => {
  test.setTimeout(90_000);
  // 33° clear → scorcher, and the glyph changes with the temperature while the BUCKET does not.
  const scorcher = await badgeOn(page, '2026-07-16');
  await expect(scorcher).toHaveAttribute('data-tone', 'scorcher');
  await expect(scorcher).toHaveAttribute('data-glyph', 'hot-sun');
  await expect(scorcher).toHaveAttribute('data-weather', 'sun');

  // 29° clear → the hot band, but the ordinary sun glyph.
  const hot = await badgeOn(page, '2026-07-21');
  await expect(hot).toHaveAttribute('data-tone', 'hot');
  await expect(hot).toHaveAttribute('data-glyph', 'sun');

  // 1° → cold.
  await expect(await badgeOn(page, '2026-07-14')).toHaveAttribute('data-tone', 'cold');
});

test('WMO code 1 ("mainly clear") is a SUN, not a cloud (§22)', async ({ page }) => {
  await expect(await badgeOn(page, '2026-07-20')).toHaveAttribute('data-weather', 'sun');
});

test('a failing forecast surfaces nothing at all — the day renders identically', async ({ page }) => {
  await page.route('**/api/plan/weather', (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));
  await page.reload();
  await expect(page.getByTestId('plan-shell')).toBeVisible();

  // The day still renders, with its posts.
  await expect(page.getByTestId('day-panel')).toBeVisible();
  expect(await page.locator('[data-post-id]').count()).toBeGreaterThan(0);
  // And the decoration is simply absent. A forecast that failed is not the client's problem.
  await expect(page.getByTestId('weather-badge')).toHaveCount(0);
});
