/**
 * intake-heading.spec.ts — the intake sheet's heading cannot be scrolled away.
 *
 * ── WHY THE ASSERTION IS "SCROLL IT AND LOOK", NOT "scrollTop IS 0" ──────────────────
 *
 * Reported from iOS Safari: the sheet opens past its own heading, and scrolling up reveals it.
 * The first reading was the composer's `autoFocus` pulling itself into view. That is DISPROVEN
 * and this suite is where it was disproven — WebKit at 390×659, 390×560 and 390×480 all report
 * `scrollTop: 0` with the textarea focused, including the height where the textarea's bottom is
 * 68px past the panel's. So a test asserting `scrollTop === 0` on open would have passed against
 * the bug, which is the trap `pill-clearance.spec.ts` names in its own header.
 *
 * What actually scrolls the panel on the device is the software keyboard: iOS shrinks the visual
 * viewport by ~300px on focus and scrolls the caret back into what is left, through the nearest
 * scrollable ancestor. Playwright has no keyboard, so the CAUSE is not reproducible here at all.
 *
 * So this asserts the PROMISE instead, and drives the scroll by hand to stand in for whatever
 * moves it: with the body scrolled all the way to the bottom, the heading and the close button
 * are still on screen. That holds for any correct fix and fails for the shipped one, where the
 * heading lived inside the scroller and 277px of scroll range took it away.
 */
import { test, expect } from '@playwright/test';

// Real small viewports — the height Safari actually leaves a page, not the phone's screen.
for (const [device, width, height] of [['iPhone 13', 390, 659], ['iPhone 15', 393, 664]] as const) {
  test.describe(`${device} — ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the heading survives the body being scrolled to the bottom', async ({ page }) => {
      await page.goto('/?intake=1');
      const panel = page.getByTestId('intake-panel');
      await expect(panel).toBeVisible();

      const body = page.getByTestId('intake-body');
      // The premise: at this height there IS something to scroll. Without this the test could
      // pass on a sheet that simply fits, and stop guarding anything the day the copy grows.
      const range = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(range, 'the sheet must overflow at a phone height, or this asserts nothing').toBeGreaterThan(100);

      await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(100);

      const heading = page.getByRole('heading', { name: /Let’s plan .* together/ });
      await expect(heading).toBeInViewport();
      // The close button rides in the same region: a sheet whose only exit can scroll away is
      // a trap, and it would have been one on exactly the heights that hid the heading.
      await expect(page.getByTestId('intake-close')).toBeInViewport();

      // …and the heading is fully clear of the viewport's top edge, not merely intersecting it.
      const box = await heading.boundingBox();
      expect(box, 'the heading must be laid out').not.toBeNull();
      expect(box!.y, 'the heading is clipped at the top').toBeGreaterThanOrEqual(0);
    });

    test('the scroller is the body, not the panel — so nothing can carry the heading with it', async ({ page }) => {
      await page.goto('/?intake=1');
      await expect(page.getByTestId('intake-panel')).toBeVisible();

      const heading = page.getByRole('heading', { name: /Let’s plan .* together/ });
      // Structural, and the reason the promise above holds: the heading is not a descendant of
      // any scrollable ancestor inside the sheet.
      const insideScroller = await heading.evaluate((el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          // The PANEL ITSELF IS CHECKED, and this is not a detail: the shipped bug was the panel
          // being the scroller. An earlier draft of this walk returned false on reaching the
          // panel before testing it, and passed against the bug it was written for.
          const oy = getComputedStyle(n).overflowY;
          if (oy === 'auto' || oy === 'scroll') return true;
          if (n.dataset['testid'] === 'intake-panel') return false;   // reached the sheet, clean
        }
        return false;
      });
      expect(insideScroller, 'the heading is inside a scroll container and can be scrolled away').toBe(false);
    });

    test('the sheet is never taller than the visible viewport', async ({ page }) => {
      // `94vh` on iOS is the LARGE viewport, so with the toolbar drawn the sheet asked for more
      // room than the client can see and spent the difference on its own bottom — where "Save
      // brief" is. `svh` is the height chrome can never take back.
      await page.goto('/?intake=1');
      const panel = page.getByTestId('intake-panel');
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(height);
      expect(box!.y + box!.height, 'the sheet extends below the visible area').toBeLessThanOrEqual(height + 1);

      // "Save brief" is legitimately below the fold on open — the sheet scrolls. What must be
      // true is that it can be REACHED, which is exactly what a sheet whose bottom is behind the
      // toolbar cannot promise: there, scrolling the body to its end still leaves the button
      // outside the visible strip, with no further scroll available.
      const body = page.getByTestId('intake-body');
      await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(100);
      await expect(page.getByTestId('intake-create')).toBeInViewport();
    });
  });
}
