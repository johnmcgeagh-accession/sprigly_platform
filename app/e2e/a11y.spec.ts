import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, reseed } from './helpers';

/** Serious/critical axe violations on the current page (empty = pass). */
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
  await expect(page.getByTestId(desktop ? 'plan-desktop' : 'plan-mobile')).toBeVisible();

  // 1. Calendar (desktop) / agenda feed (mobile)
  expect(await seriousViolations(page), 'calendar/feed').toEqual([]);

  // 2. Editor drawer / sheet
  if (desktop) await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();
  else await page.getByTestId('swipe-card').first().getByTestId('swipe-surface').click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  expect(await seriousViolations(page), 'editor').toEqual([]);

  // 3. Agent sheet (desktop only — mobile's agent is the disabled voice overlay)
  if (desktop) {
    await page.getByTestId('drawer-close').click();
    await page.getByTestId('agent-fab').click();
    await expect(page.getByTestId('agent-sheet')).toBeVisible();
    expect(await seriousViolations(page), 'agent sheet').toEqual([]);
  }
});
