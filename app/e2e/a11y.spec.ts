import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, reseed } from './helpers';

/**
 * ── The one scoped contrast ignore (round 6, P16) ─────────────────────────────────────
 *
 * DESIGN.md records ONE deviation below AA-normal, ruled three times by the operator: short bold
 * labels on filled accent controls carry WHITE, at 3.40:1 on `accent-650`. iOS system buttons
 * ship white-on-green at roughly 2.2:1; this is materially better than the convention it is
 * deliberately imitating, and selection is never carried by colour alone (fill-vs-none, position
 * and `aria-selected` all say it too).
 *
 * Axe reports it, correctly. The ignore below is scoped THREE ways at once, and all three have
 * to hold before a node is excused:
 *
 *   1. the rule must be `color-contrast` — nothing else is ever excused;
 *   2. the node must be one of the eight controls DESIGN.md names, by the built selectors its
 *      own mapping table lists — an enumeration, so a new control is not silently covered;
 *   3. the node must ACTUALLY be the deviation — accent-650 fill, white ink — verified against
 *      the live computed styles, so an entry that stops being white-on-650 stops being excused.
 *
 * It matches NODES, not rules. A `color-contrast` violation with one node inside the set and one
 * outside is reported, because the node outside it is the defect. Never blanket, and never by
 * rule id alone.
 */
const CONTRAST_DEVIATION: { design: string; selector: string }[] = [
  { design: '.navpill button[aria-selected]', selector: '[data-testid="nav-pill"] [role="tab"][aria-selected="true"]' },
  { design: '.navmic',                        selector: '[data-testid="nav-mic"]' },
  { design: '.readypill',                     selector: '[data-testid="ready-pill"]' },
  { design: '.wday .num',                     selector: '[data-testid="week-day"][aria-pressed="true"], [data-testid="grid-cell"][aria-current="true"]' },
  { design: '.badge',                         selector: '[data-testid="draft-badge"], [data-testid="changed-badge"]' },
  { design: '.sumbar',                        selector: '[data-testid="summary-chip"]' },
  { design: '.btn.primary',                   selector: '[data-testid="move-confirm"], [data-testid="add-confirm"], [data-testid="approve-confirm"], [data-testid="checklist-replace"], [data-testid="generate-hook"], [data-testid="generate-script"], [data-testid="voice-submit"], [data-testid="format-control"] [data-on="true"], [data-testid="add-format"] [data-on="true"], [data-testid="time-slot"][aria-pressed="true"], [data-testid^="length-"][aria-pressed="true"], [data-testid="task-check"][aria-checked="true"]' },
  { design: '.shapefoot .submit',             selector: '[data-testid="shape-submit"]' },
];

/** The accent-650 fill, read from the page rather than assumed: Teal v1 injects no `--t-accent-650`
 *  and Tailwind's own fallback applies, so the hex differs by active theme. */
async function accentFill(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'bg-coral-650';
    document.body.appendChild(probe);
    const bg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return bg;
  });
}

/** Is this axe node the recorded deviation — named by DESIGN.md AND actually white-on-650? */
async function isRecordedDeviation(page: Page, target: string, fill: string): Promise<boolean> {
  return page.evaluate(({ target: t, selectors, fill: f }) => {
    const el = document.querySelector(t);
    if (!el) return false;
    const named = selectors.some((s) => el.matches(s) || !!el.closest(s));
    if (!named) return false;
    // Walk up for the fill: the failing node is often the <span> inside the filled button.
    let node: Element | null = el;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundColor === f) return getComputedStyle(el).color === 'rgb(255, 255, 255)';
      node = node.parentElement;
    }
    return false;
  }, { target, selectors: CONTRAST_DEVIATION.map((d) => d.selector), fill });
}

/** Serious/critical axe violations on the current page (empty = pass). The only exclusion is the
 *  recorded white-on-650 deviation, node by node, verified above. */
async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const fill = await accentFill(page);
  const out: { id: string; impact: string | null | undefined; nodes: number; targets: string[]; summary: string | undefined }[] = [];

  for (const v of violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    let nodes = v.nodes;
    if (v.id === 'color-contrast') {
      const kept: typeof nodes = [];
      for (const n of nodes) {
        const target = n.target.join(' ');
        if (!(await isRecordedDeviation(page, target, fill))) kept.push(n);
      }
      nodes = kept;
    }
    if (nodes.length === 0) continue;
    // The TARGET matters as much as the rule id. Reporting only a count told a reader
    // "1 node, somewhere" and left them opening a trace to find out which — so a contrast
    // finding on a surface with one recorded, scoped contrast deviation could not be told
    // apart from an unintended one without manual work.
    out.push({
      id: v.id,
      impact: v.impact,
      nodes: nodes.length,
      targets: nodes.map((n) => n.target.join(' ')),
      summary: nodes[0]?.failureSummary?.split('\n').slice(0, 3).join(' | '),
    });
  }
  return out;
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
