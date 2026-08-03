/**
 * empty.spec.ts — a month with nothing in it, as tenant B.
 *
 * ── Two of these tests went with their views ─────────────────────────────────────────
 *
 * "Notes empty state" and "Approvals empty state" drove `PlanDesktop`'s Notes and Approvals
 * views, both retired by the desktop redesign: the conversation thread is the record of what a
 * client has said, and a proposal is approved on the turn that raised it. There is no view left
 * to be empty, so the tests go with the views rather than being pointed at something adjacent.
 *
 * What is genuinely still worth asserting is the one thing an empty month must do — offer a way
 * to start — and the one thing it must NOT do, which is dress emptiness as a fault.
 */
import { test, expect } from '@playwright/test';
import { reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('a month with no posts renders the whole shell, and offers the way to start', async ({ page }) => {
  // Nothing planned, and nothing pretending to be.
  await expect(page.getByTestId('post-card')).toHaveCount(0);
  await expect(page.getByTestId('grid-dot')).toHaveCount(0);

  // The four regions are all there — an empty month is a month, not an error state.
  await expect(page.getByTestId('plan-rail')).toBeVisible();
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('day-panel')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();

  // The per-day add slot is the one add affordance, and it is present on an empty day.
  await expect(page.getByTestId('add-slot')).toBeVisible();
});

test('the month footer says the month is empty in words, without dressing it as a fault', async ({ page }) => {
  const foot = page.getByTestId('month-foot');
  await expect(foot).toBeVisible();
  await expect(foot).toContainText(/Nothing planned/i);
  // Stated, not dressed as a fault: no retry offered and nothing asked of the client.
  await expect(page.getByRole('button', { name: /try again|retry/i })).toHaveCount(0);
});
