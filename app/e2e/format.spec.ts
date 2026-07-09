import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('format: no-progress change silently regenerates from the new template', async ({ page }) => {
  const id = SEED.post(2); // single image, 2 steps, 0 done
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2); // single template

  await page.getByTestId('format-select').selectOption('carousel');
  await expect(page.getByTestId('format-confirm')).toHaveCount(0);            // no dialog — nothing to lose
  await expect(page.getByTestId('checklist-item')).toHaveCount(3);            // carousel template
  await expectActivity(page, id, (r) => r.action === 'format_changed', 'format_changed ledger row');
});

test('format: change with progress asks, then KEEP leaves the checklist; axe clean', async ({ page }) => {
  const id = SEED.post(7); // single image, 2 steps, 1 already done (inherent progress)
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2);

  await page.getByTestId('format-select').selectOption('reel');
  await expect(page.getByTestId('format-confirm')).toBeVisible();          // progress → asks
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), 'format-confirm dialog').toEqual([]);

  await page.getByTestId('format-keep').click();
  await expect(page.getByTestId('format-confirm')).toHaveCount(0);
  await expect(page.getByTestId('checklist-item')).toHaveCount(2);          // kept
});

test('format: change with progress, then REPLACE rebuilds from the new template', async ({ page }) => {
  const id = SEED.post(7); // single image, 2 steps, 1 already done (inherent progress)
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2);

  await page.getByTestId('format-select').selectOption('reel');
  await expect(page.getByTestId('format-confirm')).toBeVisible();
  await page.getByTestId('format-replace').click();
  await expect(page.getByTestId('format-confirm')).toHaveCount(0);
  await expect(page.getByTestId('checklist-item')).toHaveCount(4);          // reel template
  await expectActivity(page, id, (r) => r.action === 'format_changed', 'format_changed ledger row');
});

test('format: hook/script hidden but retained across reel → single → reel', async ({ page }) => {
  const id = SEED.post(11); // reel, 4 steps, 0 done
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();

  // Give it a hook + a generated script.
  await page.getByTestId('editor-hook').fill('A hook to keep across formats.');
  await page.getByTestId('hook-save').click();
  await page.getByTestId('length-30').click();
  await page.getByTestId('generate-script').click();
  await expect(page.getByTestId('editor-script')).toBeVisible({ timeout: 12_000 });
  const scriptVal = await page.getByTestId('editor-script').inputValue();
  expect(scriptVal).toMatch(/HOOK:/);

  // reel → single: no progress → silent; hook + script sections gone, retained note shown.
  await page.getByTestId('format-select').selectOption('single');
  await expect(page.getByTestId('format-confirm')).toHaveCount(0);
  await expect(page.getByTestId('script-section')).toHaveCount(0);
  await expect(page.getByTestId('hook-section')).toHaveCount(0);
  await expect(page.getByTestId('hidden-fields-note')).toBeVisible();

  // single → reel: sections return with the retained values.
  await page.getByTestId('format-select').selectOption('reel');
  await expect(page.getByTestId('script-section')).toBeVisible();
  await expect(page.getByTestId('editor-script')).toHaveValue(scriptVal);
  await expect(page.getByTestId('editor-hook')).toHaveValue('A hook to keep across formats.');
});
