import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('hook: generate → pick → save → ledger, persists on reload', async ({ page }) => {
  const id = SEED.post(3); // a reel
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('hook-section')).toBeVisible();

  // Generate → pending → three candidates.
  await page.getByTestId('generate-hooks').click();
  await expect(page.getByTestId('hook-candidate')).toHaveCount(3, { timeout: 12_000 });

  // Pick the first — fills the field (unsaved), candidates clear.
  const first = page.getByTestId('hook-candidate').first();
  const text = (await first.textContent())!.trim();
  await first.click();
  await expect(page.getByTestId('editor-hook')).toHaveValue(text);
  await expect(page.getByTestId('hook-candidate')).toHaveCount(0);

  // Save → hook_saved ledger row.
  await page.getByTestId('hook-save').click();
  await expectActivity(page, id, (r) => r.action === 'hook_saved', 'hook_saved ledger row');

  // Persists across reload.
  await page.reload();
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('editor-hook')).toHaveValue(text);
});

test('hook: the reel editor with hook UI has no serious axe violations', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(3)}"]`).click();
  await expect(page.getByTestId('hook-section')).toBeVisible();
  await page.getByTestId('generate-hooks').click();
  await expect(page.getByTestId('hook-candidate')).toHaveCount(3, { timeout: 12_000 });
  await page.getByTestId('hook-candidate').first().click();
  await expect(page.getByTestId('hook-save')).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious, 'reel editor hook UI').toEqual([]);
});

test('hook: single-image posts have no hook section', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click(); // single image
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('hook-section')).toHaveCount(0);
});
