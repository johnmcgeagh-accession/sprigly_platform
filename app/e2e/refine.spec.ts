import { test, expect } from '@playwright/test';
import { SEED, expectActivity, reseed } from './helpers';

// Target-aware Shape in the editor (§26). P6 ("The boxes have arrived") is a reel seeded
// with a hook + script, so the Caption | Hook | Script target control is exercisable.

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('editor Shape: target control shows Caption|Hook|Script and defaults to caption', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(6)}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  const target = page.getByTestId('shape-target');
  await expect(target).toBeVisible();
  await expect(target.getByTestId('seg-caption')).toHaveAttribute('aria-selected', 'true');
  await expect(target.getByTestId('seg-hook')).toBeVisible();
  await expect(target.getByTestId('seg-script')).toBeVisible();
});

test('editor Shape: refining the SCRIPT lands refined text, autosaves, ledgers script_saved', async ({ page }) => {
  const id = SEED.post(6);
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  const before = await page.getByTestId('editor-script').inputValue();

  await page.getByTestId('shape-target').getByTestId('seg-script').click();
  await page.getByTestId('shape-input').fill('make it punchier');
  await page.getByTestId('shape-go').click();

  // The refined script replaces the field (server value → autosave baseline).
  await expect(page.getByTestId('editor-script')).toHaveValue(/Sold out twice/, { timeout: 15_000 });
  expect(await page.getByTestId('editor-script').inputValue()).not.toBe(before);
  await expectActivity(page, id, (r) => r.action === 'script_saved' && r.origin === 'agent', 'script refine ledgered');
});

test('editor Shape: refining the HOOK stays a single line and ledgers hook_saved', async ({ page }) => {
  const id = SEED.post(6);
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();

  await page.getByTestId('shape-target').getByTestId('seg-hook').click();
  await page.getByTestId('shape-input').fill('punchier');
  await page.getByTestId('shape-go').click();

  await expect(page.getByTestId('editor-hook')).toHaveValue(/Sold out twice/, { timeout: 15_000 });
  expect((await page.getByTestId('editor-hook').inputValue()).includes('\n')).toBeFalsy();   // one line
  await expectActivity(page, id, (r) => r.action === 'hook_saved' && r.origin === 'agent', 'hook refine ledgered');
});

test('editor Shape: a caption-only post has no target control; caption shape is unchanged', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();   // single image → caption only
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('shape-target')).toHaveCount(0);

  await page.getByTestId('shape-input').fill('make it warmer');
  await page.getByTestId('shape-go').click();
  await expect(page.getByTestId('editor-caption')).toHaveValue(/quietly working/i, { timeout: 15_000 });
});
