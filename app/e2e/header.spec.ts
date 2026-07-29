/**
 * header.spec.ts — the header stays compressed.
 *
 * The operator's annotated screenshot marked the dead zones above the day: a wordmark row, a
 * month row, and a Today row that on a committed month held nothing but Today. Round 7 merged
 * Today onto the month row and made the row below it render only when it has something in it.
 *
 * This is a RATCHET, not a measurement. jsdom cannot see geometry and no unit test can, so the
 * one place the compression can regress unnoticed is here — a padding added back, a row that
 * stops collapsing, a control that grows. The numbers below are the measured result at 390×844;
 * the assertions are the ceilings they must stay under.
 */
import { test, expect } from '@playwright/test';
import { reseed } from './helpers';

/**
 * Measured at 390×844, on the seeded day whose title wraps to two lines — the worst case, and
 * the one the operator's screenshot showed.
 *
 *   day panel   200 → 146   (27% higher)
 *   first card  276 → 220   (20% higher)
 *
 * The ceilings sit just above the measured values, so a few pixels of drift are tolerated and a
 * row coming back is not.
 */
const DAY_PANEL_CEILING = 160;
const FIRST_CARD_CEILING = 225;

test('the day begins in the top fifth of the screen at 390px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'a phone-width measurement');
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-shell')).toBeVisible();

  const m = await page.evaluate(() => {
    const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    return {
      dayPanel: top('[data-testid="day-panel"]'),
      firstCard: top('[data-testid="post-card"], [data-testid="row-list"], [data-testid="add-slot"]'),
      today: top('[data-testid="today-btn"]'),
      month: top('[data-testid="month-title"]'),
    };
  });

  expect(m.dayPanel, `day panel at ${m.dayPanel}px`).toBeLessThanOrEqual(DAY_PANEL_CEILING);
  expect(m.firstCard, `first card at ${m.firstCard}px`).toBeLessThanOrEqual(FIRST_CARD_CEILING);
  // Today shares the month row: same band, not a row of its own beneath it.
  expect(Math.abs(m.today - m.month)).toBeLessThan(24);

  // A committed month has no Draft badge and no Generate pill, so that row must not exist.
  await expect(page.getByTestId('draft-badge')).toHaveCount(0);
  await expect(page.getByTestId('ready-pill')).toHaveCount(0);
});
