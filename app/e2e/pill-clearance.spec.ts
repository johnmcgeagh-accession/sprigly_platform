/**
 * pill-clearance.spec.ts — nothing the floating nav covers may be unreachable.
 *
 * ── WHY THIS IS A WEBKIT PROJECT, AND WHY THAT IS THE POINT ──────────────────────────
 *
 * The defect this guards was reported twice from a phone and pronounced un-reproducible
 * headless both times. It reproduces perfectly headless — in WebKit, at a viewport the size of
 * a real one. Chromium cannot fail it: it honours a scroll container's end padding whether or
 * not the content already overflows, and WebKit does not (see `scrollTail` in frame.ts). Run
 * this file under `mobile` instead of `mobile-webkit` and it passes against the bug.
 *
 * THE HEIGHT IS THE OTHER HALF. The rest of the suite runs at 390×844, which is an iPhone 13's
 * SCREEN — about 185px more than Safari actually gives a page once its chrome is drawn. Both
 * viewport heights below are real small-viewport values, and the surface has ~180px less room
 * than every other spec here gives it. That gap is why a whole class of "only on the device"
 * layout faults has been invisible to this suite.
 *
 * WHAT IT ASSERTS is the promise rather than the mechanism: for every post count, on both
 * heights, the last row of the month view's day summary is either clear of the pill or can be
 * scrolled clear of it. It would hold for any correct fix, and it fails for a reservation that
 * is merely bigger.
 */
import { test, expect } from '@playwright/test';
import { reseed } from './helpers';

/** August 2026 — a SIX-ROW grid, which is the shape that puts a 2-post day in the pill's band. */
const DAYS: [label: string, iso: string, posts: number][] = [
  ['one post', '2026-08-04', 1],
  ['two posts', '2026-08-12', 2],
  ['three posts', '2026-08-21', 3],
];

// Real small viewports: iPhone 13/14 (390×844 screen) and iPhone 15/16 (393×852).
for (const [device, width, height] of [['iPhone 13', 390, 659], ['iPhone 15', 393, 664]] as const) {
  test.describe(`${device} — ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const [label, iso, posts] of DAYS) {
      test(`the month view's day summary clears the nav pill — ${label}`, async ({ page }) => {
        reseed();
        await page.goto('/');
        await expect(page.getByTestId('plan-shell')).toBeVisible();

        await page.getByTestId('nav-month').click();
        await page.getByTestId('next-month').click();
        await expect(page.getByTestId('month-title')).toContainText('August');
        await page.locator(`[data-testid="grid-cell"][data-date="${iso}"]`).click();
        await expect(page.getByTestId('month-summary')).toHaveAttribute('data-date', iso);
        await expect(page.getByTestId('summary-row')).toHaveCount(posts);

        const gap = await page.evaluate(async () => {
          const q = (s: string) => document.querySelector(s) as HTMLElement;
          const panel = q('[data-testid="month-grid"]');
          const rows = document.querySelectorAll('[data-testid="summary-row"]');
          const last = rows[rows.length - 1] as HTMLElement;

          // Scroll as far as the panel will go — "reachable" means reachable after scrolling,
          // not on arrival. A panel that cannot scroll simply stays where it is, which is
          // exactly the state the defect left it in.
          panel.scrollTop = 99999;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          return Math.round(
            q('[data-testid="nav-pill"]').getBoundingClientRect().top - last.getBoundingClientRect().bottom,
          );
        });

        expect(gap, `last summary row is ${-gap}px under the nav pill and cannot be scrolled clear`)
          .toBeGreaterThanOrEqual(0);
      });
    }
  });
}
