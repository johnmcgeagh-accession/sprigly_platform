import { test, expect } from '@playwright/test';
import { SEED, reseed } from './helpers';

// Prod-mode (fakes off). Real Bedrock/Redis are NOT exercised — only fake-free flows.
test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('boot + magic-link session lands on the plan', async ({ page }) => {
  await expect(page.getByTestId('post-chip').first()).toBeVisible();
});

test('month renders with post count and a correct ring', async ({ page }) => {
  await expect(page.getByTestId('post-chip')).toHaveCount(SEED.postCount);
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();
  await expect(page.getByText('2/2 done')).toBeVisible();
});

test('caption save flips to EDITED', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();
  await page.getByTestId('editor-caption').fill('Prod-mode edit for the smoke test.');
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('post-editor').getByText('EDITED', { exact: true })).toBeVisible();
});

test('checklist tick updates the ring', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(3)}"]`).click(); // reel, seeded 1/4 done
  await expect(page.getByText('1/4 done')).toBeVisible();
  await page.getByTestId('checklist-item').nth(1).getByTestId('step-toggle').click();
  await expect(page.getByText('2/4 done')).toBeVisible();
});

test('the e2e-only routes are inert in production (404)', async ({ page }) => {
  expect((await page.request.get('/api/e2e/activity')).status()).toBe(404);
});
