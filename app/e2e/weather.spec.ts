import { test, expect } from '@playwright/test';
import { reseed } from './helpers';

// The e2e fake serves a deterministic 15-day forecast (today + 14) anchored to
// PLAN_TODAY (2026-07-08), so in-window = 2026-07-08 … 2026-07-22. Codes span the
// icon buckets. See app/src/lib/e2e-fake.ts (e2eWeatherForecast).

test.beforeEach(async () => { reseed(); });

test('weather: icons render in-window, nothing out-of-window, tooltip carries the info', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();

  // Exactly the 15 in-window July days carry an icon (2026-07-08 … 2026-07-22).
  await expect(page.getByTestId('weather-icon')).toHaveCount(15);

  // A specific in-window cell has its icon, aria-hidden, with the info in the tooltip.
  const cell = page.locator('[data-testid="calendar-cell"][data-date="2026-07-10"]');
  const icon = cell.getByTestId('weather-icon');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute('title', /^-?\d+° · .+/);
  // The glyph itself is decorative (aria-hidden) — the info lives in the tooltip.
  await expect(cell.locator('[data-testid="weather-icon"] svg[aria-hidden="true"]')).toHaveCount(1);

  // The bucketing produced distinct icons across the window.
  await expect(page.locator('[data-testid="weather-icon"][data-weather="sun"]')).not.toHaveCount(0);
  await expect(page.locator('[data-testid="weather-icon"][data-weather="heavy-rain"]')).not.toHaveCount(0);
  await expect(page.locator('[data-testid="weather-icon"][data-weather="thunder"]')).not.toHaveCount(0);

  // Out-of-window days (before today / beyond today+14) show nothing — no placeholder.
  await expect(page.locator('[data-date="2026-07-05"] [data-testid="weather-icon"]')).toHaveCount(0);
  await expect(page.locator('[data-date="2026-07-25"] [data-testid="weather-icon"]')).toHaveCount(0);
});

test('weather: a failing forecast leaves the calendar identical, nothing surfaced', async ({ page }) => {
  // Force the decoration-only endpoint to fail — the calendar must render the same.
  await page.route('**/api/plan/weather', (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));

  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
  await expect(page.getByTestId('calendar-grid')).toBeVisible();

  // Posts still render as normal.
  expect(await page.locator('[data-post-id]').count()).toBeGreaterThan(0);
  // No weather icons anywhere — the failure surfaces nothing to the user.
  await expect(page.getByTestId('weather-icon')).toHaveCount(0);
});
