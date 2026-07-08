import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('script: gated on hook, then length → pending → lands → edit → save → ledger', async ({ page }) => {
  const id = SEED.post(3); // a reel
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();

  // No hook yet → script is gated (prompt to add a hook, no generate control).
  await expect(page.getByTestId('script-needs-hook')).toBeVisible();
  await expect(page.getByTestId('generate-script')).toHaveCount(0);

  // Add a hook so the script unlocks.
  await page.getByTestId('editor-hook').fill('The real reason this top sold out twice.');
  await page.getByTestId('hook-save').click();
  await expect(page.getByTestId('script-needs-hook')).toHaveCount(0);

  // Pick 60s and generate → pending → the script lands in an editable textarea.
  await page.getByTestId('length-60').click();
  await page.getByTestId('generate-script').click();
  await expect(page.getByTestId('editor-script')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId('editor-script')).toHaveValue(/HOOK:/);

  // Edit + save → script_saved ledger (origin user).
  await page.getByTestId('editor-script').fill('HOOK: an edited opening line.\nCTA: link in bio.');
  await page.getByTestId('script-save').click();
  await expectActivity(page, id, (r) => r.action === 'script_saved', 'script_saved ledger row');

  // Persists across reload.
  await page.reload();
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('editor-script')).toHaveValue(/edited opening line/);
});

test('script: the reel script editor state has no serious axe violations', async ({ page }) => {
  const id = SEED.post(3);
  await page.locator(`[data-post-id="${id}"]`).click();
  await page.getByTestId('editor-hook').fill('A hook to unlock the script.');
  await page.getByTestId('hook-save').click();
  await page.getByTestId('length-30').click();
  await page.getByTestId('generate-script').click();
  await expect(page.getByTestId('editor-script')).toBeVisible({ timeout: 12_000 });
  await page.getByTestId('editor-script').fill('HOOK: edited.\nCTA: go.'); // reveals Save script
  await expect(page.getByTestId('script-save')).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious, 'reel script editor').toEqual([]);
});

test('script: only reels have a script section', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click(); // single image
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('script-section')).toHaveCount(0);
  await page.getByTestId('drawer-close').click();
  await page.locator(`[data-post-id="${SEED.post(8)}"]`).click(); // carousel
  await expect(page.getByTestId('script-section')).toHaveCount(0);
});
