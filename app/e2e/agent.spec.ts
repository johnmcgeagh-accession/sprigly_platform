import { test, expect, type Page } from '@playwright/test';
import { SEED, expectActivity, reseed } from './helpers';

// Plan-agent vocabulary + format inference + generate_hook (§24). The e2e fake
// (app/src/lib/e2e-fake.ts) maps these asks to deterministic tasks; the route + proposal
// apply are real.

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

async function ask(page: Page, text: string) {
  await page.getByTestId('agent-fab').click();
  await page.getByTestId('agent-input').fill(text);
  await page.getByTestId('agent-send').click();
  await expect(page.getByTestId('extraction-summary')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('agent-thinking')).toHaveCount(0);
}

// ── Part 1 — product-aware guidance, never a generic question ──────────────────
test('agent vocabulary: a hook clause on a single-image create gets product-aware guidance, not a generic question', async ({ page }) => {
  await ask(page, 'create a post about the summer sale with some hooks');
  // The post itself is proposed (one row) …
  await expect(page.getByTestId('extraction-row')).toHaveCount(1);
  await expect(page.getByTestId('extraction-row')).toContainText('single image');
  // … and the hook clause is answered with product-aware guidance (reels/carousels), NOT a
  // generic "what kind of hooks — email subject lines?" question.
  const summary = page.getByTestId('extraction-summary');
  await expect(summary).toContainText(/reels and carousels/i);
  await expect(summary).not.toContainText(/subject line|ad copy/i);
});

test('agent vocabulary: a script request gets product-aware guidance', async ({ page }) => {
  await ask(page, 'write the script for the friday reel');
  await expect(page.getByTestId('extraction-row')).toHaveCount(0);       // no invalid proposal
  await expect(page.getByTestId('extraction-summary')).toContainText(/Generate script/i);
  await expect(page.getByTestId('extraction-summary')).not.toContainText(/what kind of/i);
});

// ── Part 2 — format inferred from the ask and stated on the proposal ───────────
test('agent format inference: "reel" → a reel create-post, and the created post is a reel', async ({ page }) => {
  await ask(page, 'add a reel about the heatwave');
  const row = page.getByTestId('extraction-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/Add a reel/i);

  await row.getByTestId('extraction-approve').click();
  await expect(row.getByTestId('extraction-applied')).toBeVisible({ timeout: 15_000 });

  // Downstream: the created post is a reel (format flows through the agent create path).
  await page.getByTestId('sheet-close').click();
  await page.locator('[data-testid="calendar-cell"][data-date="2026-07-15"] [data-testid="post-chip"]').click();
  await expect(page.getByTestId('format-select')).toContainText('Reel');
});

test('agent format inference: "carousel" → a carousel create-post', async ({ page }) => {
  await ask(page, 'add a carousel of five styling ideas on saturday');
  await expect(page.getByTestId('extraction-row')).toContainText(/Add a carousel/i);
});

test('agent format inference: an explicit "photo" → a single image, no correctable note', async ({ page }) => {
  await ask(page, 'add a photo of the new jumper');
  const row = page.getByTestId('extraction-row');
  await expect(row).toContainText(/Add a single image/i);
  await expect(row).not.toContainText(/say .reel/i);        // explicit → no default hint
});

test('agent format inference: no format signal → single image WITH a visible correctable note', async ({ page }) => {
  await ask(page, 'add a post about the restock');
  const row = page.getByTestId('extraction-row');
  await expect(row).toContainText(/Add a single image/i);
  await expect(row).toContainText(/say .reel. or .carousel/i);   // the default is visible + correctable
});

// ── Part 3 — generate_hook: compound decomposition, ordering, guards ───────────
test('agent generate_hook: "reel … with a good hook" → two rows; approve in order → reel exists + hook candidates surface', async ({ page }) => {
  await ask(page, 'create a reel about the heatwave with a good hook');
  const rows = page.getByTestId('extraction-row');
  await expect(rows).toHaveCount(2);
  const addRow = rows.filter({ hasText: 'Add a reel' });
  const hookRow = rows.filter({ hasText: 'Generate hooks' });
  await expect(addRow).toHaveCount(1);
  await expect(hookRow).toHaveCount(1);

  // Approve the create step first, then the hook step.
  await addRow.getByTestId('extraction-approve').click();
  await expect(addRow.getByTestId('extraction-applied')).toBeVisible({ timeout: 15_000 });
  await hookRow.getByTestId('extraction-approve').click();
  await expect(hookRow.getByTestId('extraction-applied')).toBeVisible({ timeout: 15_000 });

  // Open the created reel — it's a reel and its hook UI shows the candidates (as a manual
  // Generate hooks would).
  await page.getByTestId('sheet-close').click();
  await page.locator('[data-testid="calendar-cell"][data-date="2026-07-15"] [data-testid="post-chip"]').click();
  await expect(page.getByTestId('format-select')).toContainText('Reel');
  await expect(page.getByTestId('hook-candidate')).toHaveCount(3, { timeout: 15_000 });
});

test('agent generate_hook: approving the hook step BEFORE its create step fails gracefully and stays approvable', async ({ page }) => {
  await ask(page, 'create a reel about the heatwave with a good hook');
  const rows = page.getByTestId('extraction-row');
  await expect(rows).toHaveCount(2);
  const addRow = rows.filter({ hasText: 'Add a reel' });
  const hookRow = rows.filter({ hasText: 'Generate hooks' });

  // Approve the hook step out of order → blocked; the row must NOT show Applied and must
  // still be approvable.
  await hookRow.getByTestId('extraction-approve').click();
  await expect(hookRow.getByTestId('extraction-applied')).toHaveCount(0);
  await expect(hookRow.getByTestId('extraction-approve')).toBeVisible();

  // Now do it in order — the create step, then the hook step applies.
  await addRow.getByTestId('extraction-approve').click();
  await expect(addRow.getByTestId('extraction-applied')).toBeVisible({ timeout: 15_000 });
  await hookRow.getByTestId('extraction-approve').click();
  await expect(hookRow.getByTestId('extraction-applied')).toBeVisible({ timeout: 15_000 });
});

test('agent generate_hook: hooks asked for a single-image post → a question, no invalid proposal', async ({ page }) => {
  await ask(page, 'generate hooks for the monday photo');
  await expect(page.getByTestId('extraction-row')).toHaveCount(0);
  await expect(page.getByTestId('extraction-summary')).toContainText(/reels and carousels/i);
});

// ── §26 Part 2 — agent refine ─────────────────────────────────────────────────
test('agent refine: "make the script punchier" → a refine proposal → approve enqueues the job + ledgers', async ({ page }) => {
  const id = SEED.post(6);   // "The boxes have arrived" reel, seeded with a script
  await ask(page, 'make the script on the boxes reel punchier');
  const row = page.getByTestId('extraction-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/Refine the script/i);

  await row.getByTestId('extraction-approve').click();
  await expect(row.getByTestId('extraction-applied')).toBeVisible({ timeout: 15_000 });
  await expectActivity(page, id, (r) => r.action === 'script_saved' && r.origin === 'agent', 'agent script refine ledgered');
});

test('agent refine: refining a script that does not exist yet → a question, no proposal', async ({ page }) => {
  await ask(page, 'make the script on the tuesday reel punchier');   // that reel has no script
  await expect(page.getByTestId('extraction-row')).toHaveCount(0);
  await expect(page.getByTestId('extraction-summary')).toContainText(/no script|Generate script/i);
});
