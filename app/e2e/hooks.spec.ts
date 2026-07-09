import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, activityFor, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('hook: generate → pick autosaves (no Save click) → persists → regenerate → second pick → two ledger rows', async ({ page }) => {
  const id = SEED.post(3); // a reel
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('hook-section')).toBeVisible();

  // Generate → pending → three candidates.
  await page.getByTestId('generate-hooks').click();
  await expect(page.getByTestId('hook-candidate')).toHaveCount(3, { timeout: 12_000 });

  // Pick the first — fills the field, candidates clear, AUTOSAVES (no Save button, no click).
  const firstText = (await page.getByTestId('hook-candidate').first().textContent())!.trim();
  await page.getByTestId('hook-candidate').first().click();
  await expect(page.getByTestId('editor-hook')).toHaveValue(firstText);
  await expect(page.getByTestId('hook-candidate')).toHaveCount(0);
  // No explicit-save affordance after a pick — the pick already saved.
  await expect(page.getByTestId('hook-save')).toHaveCount(0);

  // Auto-ledgered as hook_saved without a save click.
  await expectActivity(page, id, (r) => r.action === 'hook_saved', 'first hook_saved (autosaved on pick)');
  await expect
    .poll(async () => (await activityFor(page, id)).filter((r) => r.action === 'hook_saved').length)
    .toBe(1);

  // Persists across reload.
  await page.reload();
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('editor-hook')).toHaveValue(firstText);

  // Generate stays available (label switched to "Regenerate hooks") — re-roll and re-pick.
  await expect(page.getByTestId('generate-hooks')).toContainText('Regenerate hooks');
  await page.getByTestId('generate-hooks').click();
  await expect(page.getByTestId('hook-candidate')).toHaveCount(3, { timeout: 12_000 });

  // Pick a DIFFERENT candidate (the second) — autosaves the same way.
  const secondText = (await page.getByTestId('hook-candidate').nth(1).textContent())!.trim();
  expect(secondText).not.toBe(firstText);
  await page.getByTestId('hook-candidate').nth(1).click();
  await expect(page.getByTestId('editor-hook')).toHaveValue(secondText);

  // Ledger now shows BOTH saves for this post.
  await expect
    .poll(async () => (await activityFor(page, id)).filter((r) => r.action === 'hook_saved').length, { timeout: 8000 })
    .toBe(2);

  // The re-pick persists.
  await page.reload();
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('editor-hook')).toHaveValue(secondText);
});

test('hook: the reel editor with hook UI has no serious axe violations', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(3)}"]`).click();
  await expect(page.getByTestId('hook-section')).toBeVisible();
  await page.getByTestId('generate-hooks').click();
  await expect(page.getByTestId('hook-candidate')).toHaveCount(3, { timeout: 12_000 });
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious, 'reel editor hook UI').toEqual([]);
});

test('hook: single-image posts have no hook section', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click(); // single image
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('hook-section')).toHaveCount(0);
});
