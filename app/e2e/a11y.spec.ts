import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, reseed } from './helpers';

/** Serious/critical axe violations on the current page (empty = pass). No exclusions —
 *  every surface, including the "Add a post" CTA, holds WCAG AA. */
async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
}

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
});

test('no serious/critical axe violations across the primary surfaces', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'desktop';
  await expect(page.getByTestId(desktop ? 'plan-desktop' : 'plan-shell')).toBeVisible();

  // 1. Calendar (desktop) / agenda feed (mobile)
  expect(await seriousViolations(page), 'calendar/feed').toEqual([]);

  // 2. Editor drawer (desktop) / detail sheet (mobile). Different components, same promise.
  if (desktop) {
    await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();
    await expect(page.getByTestId('post-editor')).toBeVisible();
  } else {
    await page.getByTestId('post-card').first().click();
    await expect(page.getByTestId('detail-sheet')).toBeVisible();
  }
  expect(await seriousViolations(page), 'editor').toEqual([]);

  // 2b. Mobile only: the move sheet, which is a second dialog over the first.
  if (!desktop) {
    await page.getByTestId('act-move').click();
    await expect(page.getByTestId('move-sheet')).toBeVisible();
    expect(await seriousViolations(page), 'move sheet').toEqual([]);
    await page.getByTestId('move-close').click();
  }

  // 3. Agent sheet (desktop only — the mobile mic's own sheet is Session B)
  if (desktop) {
    await page.getByTestId('drawer-close').click();
    await page.getByTestId('agent-fab').click();
    await expect(page.getByTestId('agent-sheet')).toBeVisible();
    expect(await seriousViolations(page), 'agent sheet').toEqual([]);
  }
});
