import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

/** Open the styled format dropdown and pick an option. */
async function pickFormat(page: Page, value: 'reel' | 'carousel' | 'single') {
  await page.getByTestId('format-select').click();
  await expect(page.getByTestId('format-menu')).toBeVisible();
  await page.getByTestId(`format-option-${value}`).click();
}

test('format: no-progress change silently regenerates from the new template', async ({ page }) => {
  const id = SEED.post(2); // single image, 2 steps, 0 done
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2); // single template

  await pickFormat(page, 'carousel');
  await expect(page.getByTestId('format-confirm')).toHaveCount(0);            // no dialog — nothing to lose
  await expect(page.getByTestId('checklist-item')).toHaveCount(3);            // carousel template
  await expectActivity(page, id, (r) => r.action === 'format_changed', 'format_changed ledger row');
});

test('format: change with progress asks, then KEEP leaves the checklist; axe clean', async ({ page }) => {
  const id = SEED.post(7); // single image, 2 steps, 1 already done (inherent progress)
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2);

  await pickFormat(page, 'reel');
  await expect(page.getByTestId('format-confirm')).toBeVisible();          // progress → asks
  // The format change fires a status toast; wait for it to reach full opacity so axe
  // measures its resting colour (white on slate #334155, 10.35:1) not a mid-fade blend.
  await expect(page.getByTestId('toast')).toHaveCSS('opacity', '1');
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

  await pickFormat(page, 'reel');
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

  // Give it a hook + a generated script (typed hook autosaves on blur).
  await page.getByTestId('editor-hook').fill('A hook to keep across formats.');
  await page.getByTestId('editor-hook').blur();
  await page.getByTestId('length-30').click();
  await page.getByTestId('generate-script').click();
  await expect(page.getByTestId('editor-script')).toBeVisible({ timeout: 12_000 });
  const scriptVal = await page.getByTestId('editor-script').inputValue();
  expect(scriptVal).toMatch(/HOOK:/);

  // reel → single: no progress → silent; hook + script sections gone, retained note shown.
  await pickFormat(page, 'single');
  await expect(page.getByTestId('format-confirm')).toHaveCount(0);
  await expect(page.getByTestId('script-section')).toHaveCount(0);
  await expect(page.getByTestId('hook-section')).toHaveCount(0);
  await expect(page.getByTestId('hidden-fields-note')).toBeVisible();

  // single → reel: sections return with the retained values.
  await pickFormat(page, 'reel');
  await expect(page.getByTestId('script-section')).toBeVisible();
  await expect(page.getByTestId('editor-script')).toHaveValue(scriptVal);
  await expect(page.getByTestId('editor-hook')).toHaveValue('A hook to keep across formats.');
});

test('format: menu excludes Email; an existing email post renders its chip and can only switch away', async ({ page }) => {
  // A real (non-email) post: the menu offers the three real formats, never Email.
  await page.locator(`[data-post-id="${SEED.post(3)}"]`).click(); // reel
  await page.getByTestId('format-select').click();
  await expect(page.getByTestId('format-menu')).toBeVisible();
  await expect(page.getByTestId('format-option-reel')).toBeVisible();
  await expect(page.getByTestId('format-option-carousel')).toBeVisible();
  await expect(page.getByTestId('format-option-single')).toBeVisible();
  await expect(page.getByTestId('format-option-email')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('drawer-close').click();

  // The seeded Email post still renders and shows its Email chip; its menu excludes Email
  // (switching away is allowed, switching back is not offered).
  await page.locator(`[data-post-id="${SEED.post(5)}"]`).click(); // email
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('format-select')).toContainText('Email');
  await page.getByTestId('format-select').click();
  await expect(page.getByTestId('format-option-email')).toHaveCount(0);
  await expect(page.getByTestId('format-option-single')).toBeVisible();
});
