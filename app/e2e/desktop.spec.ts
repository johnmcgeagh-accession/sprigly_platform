/**
 * desktop.spec.ts — the desktop SHELL, at 1440×900.
 *
 * ── What this file became, and why ───────────────────────────────────────────────────
 *
 * It used to drive `PlanDesktop`: a right-hand dark rail, a Timeline, a Notes view, an
 * Approvals queue, a "Talk to your plan" FAB that opened a one-shot dialog, and `PostEditor` in
 * a drawer. The desktop redesign retired every one of those, so twenty-two tests were pointed at
 * a surface that no longer exists — which is a different thing from twenty-two failures.
 *
 * What is left here is the half that is genuinely ABOUT DESKTOP: that the four regions are
 * there, that the month and the day are on screen together, that opening a post takes the day
 * column's slot and leaves the conversation standing, that the rings appear beside the sentence
 * that caused them, and that the whole thing holds at the narrow band too.
 *
 * The per-post machinery — hooks, scripts, format changes, shape, the checklist — moved to the
 * MOBILE project (playwright.config.ts). It drives `DetailSheet` and `VoiceSheet`, which both
 * shells now share, so exercising it twice through two frames doubles the maintenance for one
 * signal. Where it runs is a choice about cost, not about coverage.
 */
import { test, expect } from '@playwright/test';
import { SEED, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

/** The seed's editable posts. P1 (2 Jul) and P2 (6 Jul) are BEFORE the frozen today and are
 *  deliberately left alone except where the read-only branch is the subject. */
const EDITABLE_DATE = '2026-07-16';   // P7 — single, caption-bearing, today-onward

/* ── D1 · the four regions ───────────────────────────────────────────────────────── */

test('the shell has four regions and a rail of two', async ({ page }) => {
  await expect(page.getByTestId('plan-rail')).toBeVisible();
  await expect(page.getByTestId('month-col')).toBeVisible();
  await expect(page.getByTestId('day-col')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();

  await expect(page.getByTestId('rail-plan')).toBeVisible();
  await expect(page.getByTestId('rail-tasks')).toBeVisible();
  // Insights is not drawn until there is something behind it.
  await expect(page.getByTestId('rail-insights')).toHaveCount(0);
});

test('the retired controls are gone, and their successors are present', async ({ page }) => {
  for (const gone of ['brief-month-btn', 'agent-fab', 'agent-sheet', 'nav-timeline', 'nav-notes', 'nav-approvals', 'post-editor']) {
    await expect(page.getByTestId(gone), gone).toHaveCount(0);
  }
  await expect(page.getByTestId('add-slot')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();
});

test('the mobile shell is not mounted underneath it', async ({ page }) => {
  await expect(page.getByTestId('plan-shell')).toHaveCount(0);
  await expect(page.getByTestId('nav-pill')).toHaveCount(0);
  await expect(page.getByTestId('week-strip')).toHaveCount(0);
});

/* ── D2 · month and day, side by side ────────────────────────────────────────────── */

test('the month grid and the selected day are on screen together', async ({ page }) => {
  await expect(page.getByTestId('month-col').getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('day-col').getByTestId('day-panel')).toBeVisible();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', SEED.today);
});

test('picking a day moves the day column and leaves the grid standing', async ({ page }) => {
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', EDITABLE_DATE);
  // No switcher, nothing replaced: this is the whole of E2.
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();
});

test('the month arrows round-trip to the adjacent cycle and disable at the edge', async ({ page }) => {
  await expect(page.getByTestId('month-title')).toContainText('July');
  await expect(page.getByTestId('prev-month')).toBeDisabled();

  await page.getByTestId('next-month').click();
  await expect(page.getByTestId('month-title')).toContainText('August');

  // SEPTEMBER IS THE EDGE NOW. The seed grew a third cycle — the draft month the draft specs
  // review — so August stopped being the last one. The test was pinned to a fixture fact
  // ("two cycles") while claiming to test a rule ("the arrow disables at the edge"); it now
  // walks to the actual edge and asserts the rule there.
  await page.getByTestId('next-month').click();
  await expect(page.getByTestId('month-title')).toContainText('September');
  await expect(page.getByTestId('next-month')).toBeDisabled();

  await page.getByTestId('prev-month').click();
  await expect(page.getByTestId('month-title')).toContainText('August');
  await page.getByTestId('prev-month').click();
  await expect(page.getByTestId('month-title')).toContainText('July');
});

/* ── D3 · the detail panel takes the DAY column's slot ───────────────────────────── */

test('opening a post fills the day column, and the month and the conversation do not move', async ({ page }) => {
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await page.getByTestId('post-card').first().click();

  const detail = page.getByTestId('detail-sheet');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-chrome', 'panel');
  await expect(page.getByTestId('day-col').getByTestId('detail-sheet')).toBeVisible();

  // The day list gave up its slot. Nothing else did.
  await expect(page.getByTestId('day-panel')).toHaveCount(0);
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();
  await expect(page.getByTestId('voice-sheet')).toBeVisible();
});

test('the detail panel is a region, not a modal — and the whole sheet is in it', async ({ page }) => {
  // The REEL, because only a format with more than one field renders a tab row at all — a
  // single image has a caption and nothing else, so tabs there would be a control of one.
  await page.getByTestId('post-card').first().click();

  await expect(page.getByTestId('detail-sheet-scrim')).toHaveCount(0);
  await expect(page.getByTestId('detail-sheet-grabber')).toHaveCount(0);

  const detail = page.getByTestId('detail-sheet');
  await expect(detail.getByTestId('tab-caption')).toBeVisible();
  await expect(detail.getByTestId('copy-field')).toBeVisible();
  await expect(detail.getByTestId('act-move')).toBeVisible();
  await expect(detail.getByTestId('act-delete')).toBeVisible();
});

test('the way back names the day, and it returns the day list to its column', async ({ page }) => {
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await page.getByTestId('post-card').first().click();
  await expect(page.getByTestId('detail-back')).toContainText('16 July');

  await page.getByTestId('detail-back').click();
  await expect(page.getByTestId('detail-sheet')).toHaveCount(0);
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', EDITABLE_DATE);
});

/* ── D4 · the docked conversation ────────────────────────────────────────────────── */

test('the conversation is present with no gesture, and has no way to close', async ({ page }) => {
  const dock = page.getByTestId('conversation-dock');
  await expect(dock.getByTestId('voice-sheet')).toBeVisible();
  await expect(dock.getByTestId('voice-input')).toBeVisible();
  await expect(dock.getByTestId('voice-mic')).toBeVisible();
  await expect(page.getByTestId('voice-close')).toHaveCount(0);
  await expect(page.getByTestId('voice-sheet-scrim')).toHaveCount(0);
});

test('it does not steal focus on load — nobody opened it', async ({ page }) => {
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  expect(focused).not.toBe('voice-input');
});

/* ── D5 · the ringed days ────────────────────────────────────────────────────────── */

test('an open turn rings the days it names, and Apply clears them and moves the month', async ({ page }) => {
  // The compound phrasing is the one the fake pins to a known post; a bare UUID is resolved
  // out of the whole templated message, whose first id belongs to another post.
  await page.getByTestId('voice-input').fill(`move the reel ${SEED.post(3)} later and make it a carousel`);
  await page.getByTestId('voice-submit').click();

  await expect(page.getByTestId('interpretation')).toBeVisible({ timeout: 20_000 });
  const ringed = page.locator('[data-testid="grid-cell"][data-ringed="true"]');
  // Both ends of the move: the day losing the post and the day gaining it.
  await expect(ringed).toHaveCount(2);
  await expect(page.locator('[data-testid="grid-cell"][data-date="2026-07-08"]')).toHaveAttribute('data-ringed', 'true');
  await expect(page.locator('[data-testid="grid-cell"][data-date="2026-07-24"]')).toHaveAttribute('data-ringed', 'true');

  await page.getByTestId('interp-apply').click();

  // The turn resolved, so the rings go with it — and the post is where it was asked to be.
  await expect(ringed).toHaveCount(0);
  await expectActivity(page, SEED.post(3), (r) => r.action === 'rescheduled' && r.origin === 'agent', 'agent move ledgered');
});

test('Discard clears the rings and changes nothing', async ({ page }) => {
  await page.getByTestId('voice-input').fill(`move the reel ${SEED.post(3)} later and make it a carousel`);
  await page.getByTestId('voice-submit').click();
  await expect(page.getByTestId('interpretation')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="grid-cell"][data-ringed="true"]')).toHaveCount(2);

  await page.getByTestId('interp-discard').click();
  await expect(page.locator('[data-testid="grid-cell"][data-ringed="true"]')).toHaveCount(0);
  await expect(page.getByTestId('interpretation')).toHaveAttribute('data-status', 'discarded');
});

/* ── the rail ────────────────────────────────────────────────────────────────────── */

test('Tasks replaces the plan region and the conversation stays', async ({ page }) => {
  await page.getByTestId('rail-tasks').click();
  await expect(page.getByTestId('tasks-panel')).toBeVisible();
  await expect(page.getByTestId('task-row').first()).toBeVisible();
  await expect(page.getByTestId('month-grid')).toHaveCount(0);
  await expect(page.getByTestId('conversation-dock')).toBeVisible();

  await page.getByTestId('rail-plan').click();
  await expect(page.getByTestId('month-grid')).toBeVisible();
});

/* ── the narrow band ─────────────────────────────────────────────────────────────── */

/**
 * ── THE WIDTH STRATEGY (spec §2.6) ──────────────────────────────────────────────────
 *
 * The build was laid out at exactly 1440, where 196 + 24 + 512 + 20 + 320 + 24 + 344 fits to
 * the pixel — and nowhere else. Below it the day column was clipped; above it the surplus
 * became one void between the day column and the dock. Four widths now, and the rule at each.
 */
const WIDTHS = [1024, 1440, 1920, 2560] as const;

async function metrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const box = (s: string) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width) };
    };
    return {
      shell: box('[data-testid="plan-desktop"]')!,
      rail: box('[data-testid="plan-rail"]')!,
      month: box('[data-testid="month-col"]')!,
      day: box('[data-testid="day-col"]')!,
      dock: box('[data-testid="conversation-dock"]')!,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: window.innerWidth,
    };
  });
}

test('nothing overflows sideways at any tested width', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('month-grid')).toBeVisible();
    const m = await metrics(page);
    expect(m.overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
});

test('below 1440 the plan region STACKS; at 1440 and up it is side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByTestId('month-grid')).toBeVisible();
  let m = await metrics(page);
  // Stacked: the two columns share an x and a width.
  expect(m.month.x).toBe(m.day.x);
  expect(m.month.w).toBe(m.day.w);
  // The conversation does NOT collapse — the one region whose promise is that it is there.
  await expect(page.getByTestId('voice-input')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('month-grid')).toBeVisible();
  m = await metrics(page);
  expect(m.day.x).toBeGreaterThan(m.month.x + m.month.w - 1);   // day sits after month
  // The reviewed layout, within a rounding pixel or two of 512 / 320 / 344.
  expect(Math.abs(m.month.w - 512)).toBeLessThanOrEqual(4);
  expect(Math.abs(m.day.w - 320)).toBeLessThanOrEqual(4);
});

test('the columns grow to their ceilings and then the shell centres', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect(page.getByTestId('month-grid')).toBeVisible();
  let m = await metrics(page);
  expect(m.month.w).toBe(680);          // the stated ceilings
  expect(m.day.w).toBe(420);
  expect(m.dock.w).toBe(400);
  expect(m.shell.w).toBe(1764);
  // Balanced: the margin on the left equals the margin on the right.
  expect(m.shell.x).toBe(Math.round((m.viewport - m.shell.w) / 2));

  await page.setViewportSize({ width: 2560, height: 900 });
  await expect(page.getByTestId('month-grid')).toBeVisible();
  m = await metrics(page);
  // Past the ceiling nothing grows — the MARGINS do, and they stay equal.
  expect(m.month.w).toBe(680);
  expect(m.day.w).toBe(420);
  expect(m.dock.w).toBe(400);
  expect(m.shell.w).toBe(1764);
  expect(m.shell.x).toBe(Math.round((m.viewport - m.shell.w) / 2));
  // The failure this replaces: columns left-anchored with the whole surplus on the right.
  const rightMargin = m.viewport - (m.shell.x + m.shell.w);
  expect(Math.abs(rightMargin - m.shell.x)).toBeLessThanOrEqual(1);
});

test('the rail collapses to icons below 1280 and carries its labels above', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByTestId('rail-plan')).toBeVisible();
  expect((await metrics(page)).rail.w).toBeLessThan(100);

  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await metrics(page)).rail.w).toBe(196);
});

test('the month grid fills its column rather than leaving canvas under it', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 900 });
  await expect(page.getByTestId('month-grid')).toBeVisible();
  const fill = await page.evaluate(() => {
    const col = document.querySelector('[data-testid="month-col"]')!.getBoundingClientRect();
    const foot = document.querySelector('[data-testid="month-foot"]')!.getBoundingClientRect();
    return (foot.bottom - col.top) / col.height;
  });
  // On a phone the cells are aspect-square and the grid is as tall as it needs to be. On a
  // wide monitor that left the column two-fifths full, which is most of what "doesn't scale
  // up" looked like.
  expect(fill).toBeGreaterThan(0.9);
});

/* ── W2 / W3 / W4 · the chrome at width ──────────────────────────────────────────── */

test('the Generate confirm is a centred modal at content width, not a full-width sheet', async ({ page }) => {
  // A draft month is the only one with something to approve, and the seed's is committed —
  // so this asserts the frame the committed shell can reach: the modal's own geometry is
  // covered in jsdom, and here we prove the desktop shell never renders the sheet form.
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect(page.getByTestId('approval-sheet')).toHaveCount(0);
  // The sheet chrome must not exist anywhere on this surface.
  await expect(page.locator('[data-testid$="-grabber"]')).toHaveCount(0);
});

test('the dock’s agent turn is flush with the dock, not a card inset from it', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  const gaps = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="turn-agent"]');
    const d = document.querySelector('[data-testid="conversation-dock"]');
    if (!t || !d) return null;
    const tr = t.getBoundingClientRect(), dr = d.getBoundingClientRect();
    return { left: tr.left - dr.left, right: dr.right - tr.right, radius: getComputedStyle(t).borderTopLeftRadius };
  });
  expect(gaps, 'the framing turn should be on screen').not.toBeNull();
  // Flush: the band reaches both edges (a pixel or two of border), and carries no card radius.
  expect(gaps!.left).toBeLessThanOrEqual(3);
  expect(gaps!.right).toBeLessThanOrEqual(3);
  expect(gaps!.radius).toBe('0px');
});

test('Tasks uses the whole region and flows into columns', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByTestId('rail-tasks').click();
  await expect(page.getByTestId('tasks-panel')).toBeVisible();

  const m = await page.evaluate(() => {
    const region = document.querySelector('[data-testid="plan-region"]')!.getBoundingClientRect();
    const panel = document.querySelector('[data-testid="tasks-panel"]')!;
    return {
      region: Math.round(region.width),
      panel: Math.round(panel.getBoundingClientRect().width),
      columns: getComputedStyle(panel).columnCount,
    };
  });
  // Not a mobile-width column marooned in a wide region: the panel IS the region.
  expect(m.panel).toBeGreaterThan(1000);
  expect(m.panel).toBeGreaterThanOrEqual(m.region - 60);
  expect(m.columns).toBe('2');
  // And the day column is not sitting empty beside it.
  await expect(page.getByTestId('day-col')).toHaveCount(0);
});

/* ── W6 · Ideas: the client's own sentences, and what became of each ─────────────── */

test('Ideas lists the client’s durable inputs, each in the state the data knows', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByTestId('rail-ideas').click();
  const panel = page.getByTestId('ideas-panel');
  await expect(panel).toBeVisible();

  // Her words, verbatim and quoted. The seed's four durable inputs plus its three notes.
  await expect(panel).toContainText('Shoot the provenance story on film, not phone.');
  await expect(panel).toContainText('Make Fridays feel more personal, more Sally, less product.');

  // The four states, each derived from `status` + `lifecycle` — never stored, never guessed.
  const states = panel.locator('[data-testid="ideas-group"]');
  await expect(states).toHaveCount(4);
  await expect(panel.locator('[data-testid="ideas-group"][data-state="used"]'))
    .toContainText('Used in July 2026');
  await expect(panel.locator('[data-testid="ideas-group"][data-state="deferred"]'))
    .toContainText('Deferred to next month');
  await expect(panel.locator('[data-testid="ideas-group"][data-state="set-aside"]'))
    .toContainText('Set aside');
});

test('the used idea taps through to the post it became, in the day column', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByTestId('rail-ideas').click();

  const link = page.getByTestId('idea-post');
  await expect(link).toHaveText(/Why we make less, more carefully\./);
  await link.click();

  // Opening a post is a PLAN act: Ideas gives the region back and the detail takes the day
  // column's slot, which is where every other route into a post already lands.
  await expect(page.getByTestId('ideas-panel')).toHaveCount(0);
  await expect(page.getByTestId('day-col').getByTestId('detail-sheet')).toBeVisible();
});

test('Ideas is read-only — no add, no edit, no delete anywhere in the view', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByTestId('rail-ideas').click();
  const panel = page.getByTestId('ideas-panel');
  await expect(panel).toBeVisible();

  // The one control in the whole view is the tap-through. Saying an idea "arrives by telling
  // the agent" is only true while there is no second way to do it here.
  const controls = panel.locator('button, input, textarea, [contenteditable="true"]');
  await expect(controls).toHaveCount(1);
  await expect(controls.first()).toHaveAttribute('data-testid', 'idea-post');
});

test('Ideas uses the whole region and flows into columns, like its sibling', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByTestId('rail-ideas').click();
  await expect(page.getByTestId('ideas-panel')).toBeVisible();

  const m = await page.evaluate(() => {
    const region = document.querySelector('[data-testid="plan-region"]')!.getBoundingClientRect();
    const panel = document.querySelector('[data-testid="ideas-panel"]')!;
    return {
      region: Math.round(region.width),
      panel: Math.round(panel.getBoundingClientRect().width),
      columns: getComputedStyle(panel).columnCount,
    };
  });
  expect(m.panel).toBeGreaterThan(1000);
  expect(m.panel).toBeGreaterThanOrEqual(m.region - 60);
  expect(m.columns).toBe('2');
  await expect(page.getByTestId('month-col')).toHaveCount(0);
});

/* ── the per-post date policy, which this suite used to fight ────────────────────── */

test('a PAST post opens read-only; a future one is editable', async ({ page }) => {
  // P1 is 2 Jul, before the frozen today of 8 Jul. The policy is per POST, by date — it is not
  // a whole-cycle flag, and that is what ten of the old fixtures were pinned to.
  await page.locator('[data-testid="grid-cell"][data-date="2026-07-02"]').click();
  await page.getByTestId('post-card').first().click();
  await expect(page.getByTestId('detail-sheet')).toBeVisible();
  await expect(page.getByTestId('act-delete')).toHaveCount(0);

  await page.getByTestId('detail-back').click();
  await page.locator(`[data-testid="grid-cell"][data-date="${EDITABLE_DATE}"]`).click();
  await page.getByTestId('post-card').first().click();
  await expect(page.getByTestId('act-delete')).toBeVisible();
});
