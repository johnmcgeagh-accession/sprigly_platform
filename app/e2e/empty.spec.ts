import { test, expect } from '@playwright/test';
import { reseed } from './helpers';

// Runs as tenant B (empty cycle, no notes/posts) — closes the Stage 3 gaps.
test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('month with no posts: summary card + dashed adds, zero chips', async ({ page }) => {
  await expect(page.getByTestId('post-chip')).toHaveCount(0);
  await expect(page.getByTestId('month-summary')).toContainText('0 posts planned');
  await expect(page.getByTestId('add-on-day').first()).toBeVisible();
});

test('Notes empty state', async ({ page }) => {
  await page.getByTestId('nav-notes').click();
  await expect(page.getByTestId('notes-empty')).toBeVisible();
});

test('Approvals empty state', async ({ page }) => {
  await page.getByTestId('nav-approvals').click();
  await expect(page.getByTestId('approvals-empty')).toBeVisible();
});
