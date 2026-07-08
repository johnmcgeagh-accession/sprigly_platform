import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reseed } from './helpers';

const TOKEN = readFileSync(join(__dirname, '.auth', 'token.txt'), 'utf8').trim();

/**
 * Regression for the "seeded magic-link token rejected as expired" report. The real
 * root cause was environmental (the dev npm script clobbered DATABASE_URL, so the
 * interactive app read a different DB than the seed) — fixed by pnpm dev:local. This
 * spec guards the token-VALIDATION side: a long-lived local token must keep working on
 * repeated visits with a gap, i.e. it is not single-use, not rotated, not clock-rejected.
 */
test('a long-lived local token succeeds on repeated visits with a gap', async ({ page, context }) => {
  reseed();

  // Fresh magic-link click #1 (no prior cookie).
  await context.clearCookies();
  await page.goto(`/p/${TOKEN}`);
  await expect(page).toHaveURL(/\/$/);                 // not /expired
  await expect(page.getByTestId('plan-desktop')).toBeVisible();

  // Return "later" — a second click after a gap. (The gap is immaterial to the actual
  // fix, but reproduces the symptom class: single-use / expiry / clock regressions.)
  await page.waitForTimeout(2000);
  await context.clearCookies();
  await page.goto(`/p/${TOKEN}`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('plan-desktop')).toBeVisible();

  // …and the resulting session still authorizes an authenticated read.
  const r = await page.request.get('/api/plan');
  expect(r.ok()).toBeTruthy();
});
