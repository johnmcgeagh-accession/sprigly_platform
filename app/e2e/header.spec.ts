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

test('nothing overflows sideways at 320px, sheet included', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'a phone-width measurement');
  reseed();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('plan-shell')).toBeVisible();

  const overflow = () => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

  expect(await overflow(), 'the month view').toBeLessThanOrEqual(0);

  // The action row is the tightest thing on the surface: three buttons, each a 17px glyph and a
  // 15px label on ONE line (round 7, fix 5). "Delete" is the widest label.
  await page.getByTestId('post-card').first().click();
  await expect(page.getByTestId('detail-sheet')).toBeVisible();
  expect(await overflow(), 'the detail sheet').toBeLessThanOrEqual(0);

  for (const id of ['act-move', 'act-shape', 'act-delete']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    // Still over the 44px thumb floor after the restyle, and inside the viewport.
    expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width, `${id} right edge`).toBeLessThanOrEqual(320);
  }

  // …and the label is not clipped: the button is at least as wide as its own content.
  const label = await page.getByTestId('act-delete').evaluate((el) => {
    const span = el.querySelector('span')!;
    return { scroll: span.scrollWidth, client: span.clientWidth };
  });
  expect(label.scroll, 'Delete label clipped').toBeLessThanOrEqual(label.client + 1);
});
