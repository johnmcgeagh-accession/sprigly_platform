/**
 * agent.spec.ts — the plan agent's vocabulary, format inference and compound decomposition,
 * through the conversation.
 *
 * ── What moved, and what changed shape ───────────────────────────────────────────────
 *
 * These claims used to be driven through `PlanDesktop`'s one-shot dialog and its
 * `ExtractionSummary`: a list of proposals, each with its own Approve button. That surface is
 * retired. The agent's replies are turns in a THREAD now, and the changes it proposes are one
 * interpretation turn with a single Apply and a per-item × to leave one out.
 *
 * Two consequences for what can be asserted, both of them the model changing rather than
 * coverage being dropped:
 *
 *   ORDERING IS NO LONGER THE CLIENT'S PROBLEM. The old suite approved a hook step before its
 *   create step to prove the guard refused gracefully. There is one Apply now and the sequence
 *   is internal to `applyChanges` — a hook proposal resolves the post its add wrote — so the
 *   out-of-order case is unreachable from the surface. The guard itself is still tested, in
 *   `partial-apply.interaction.test.tsx`, where the refusal can be arranged directly.
 *
 *   GUIDANCE IS A TURN, NOT A SUMMARY. A clarify or a product-aware answer arrives as the
 *   agent's own words in the thread, so these tests assert on the thread's text — which is
 *   where the client actually reads it.
 *
 * Runs on the MOBILE project: the conversation is one component on both shells, and the phone
 * is the surface the product is for.
 */
import { test, expect, type Page } from '@playwright/test';
import { SEED, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-shell')).toBeVisible();
});

/** Open the conversation and say one thing. The thread stays open afterwards — that is the model. */
async function say(page: Page, text: string) {
  if (await page.getByTestId('voice-sheet').count() === 0) await page.getByTestId('nav-mic').click();
  await expect(page.getByTestId('voice-input')).toBeVisible();
  await page.getByTestId('voice-input').fill(text);
  await page.getByTestId('voice-submit').click();
  // The client's own words land as a turn immediately; the agent's reply follows.
  await expect(page.getByTestId('turn-user').last()).toContainText(text);
}

const thread = (page: Page) => page.getByTestId('thread');
const changes = (page: Page) => page.getByTestId('interp-change');

/* ── Part 1 — product-aware guidance, never a generic question ───────────────────── */

test('a hook clause on a single-image create gets product-aware guidance, not a generic question', async ({ page }) => {
  await say(page, 'create a post about the summer sale with some hooks');
  await expect(changes(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(changes(page)).toContainText(/single image/i);
  // The hook clause is answered with the product's own vocabulary.
  await expect(thread(page)).toContainText(/reels and carousels/i, { timeout: 20_000 });
  await expect(thread(page)).not.toContainText(/subject line|ad copy/i);
});

test('a script request gets product-aware guidance and proposes nothing invalid', async ({ page }) => {
  await say(page, 'write the script for the friday reel');
  await expect(thread(page)).toContainText(/Generate script/i, { timeout: 20_000 });
  await expect(changes(page)).toHaveCount(0);
  await expect(thread(page)).not.toContainText(/what kind of/i);
});

/* ── Part 2 — format inferred from the ask, and stated on the line ───────────────── */

test('"reel" → a reel create, and the created post really is a reel', async ({ page }) => {
  await say(page, 'add a reel about the heatwave');
  await expect(changes(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(changes(page)).toContainText(/Add a reel/i);

  await page.getByTestId('interp-apply').click();
  await expect(page.getByTestId('interpretation')).toHaveAttribute('data-status', 'resolved', { timeout: 20_000 });

  // Downstream: the format flowed through the agent create path onto the post.
  await page.getByTestId('voice-sheet-grabber').click();
  await page.getByTestId('nav-month').click();
  await page.locator('[data-testid="grid-cell"][data-date="2026-07-15"]').click();
  await page.locator('[data-testid="month-summary"] [data-post-id]').first().click();
  await expect(page.getByTestId('detail-sheet')).toBeVisible();
  await expect(page.getByTestId('tab-script')).toBeVisible();   // only a reel has one
});

test('"carousel" → a carousel create', async ({ page }) => {
  await say(page, 'add a carousel of five styling ideas on saturday');
  await expect(changes(page)).toContainText(/Add a carousel/i, { timeout: 20_000 });
});

test('an explicit "photo" → a single image, with no correctable hint', async ({ page }) => {
  await say(page, 'add a photo of the new jumper');
  await expect(changes(page)).toContainText(/Add a single image/i, { timeout: 20_000 });
  await expect(thread(page)).not.toContainText(/say .reel/i);
});

test('no format signal → the default is still STATED on the line', async ({ page }) => {
  await say(page, 'add a post about the restock');
  // The format is named either way, so a defaulted single image is visible rather than silent.
  await expect(changes(page)).toContainText(/Add a single image/i, { timeout: 20_000 });
});

/**
 * ── ONE THING THIS SURFACE LOST, and it is not asserted because it is not there ──────
 *
 * The old dialog rendered each proposal's SUMMARY (`addSummary`), which appends a visible,
 * correctable hint when the format was defaulted rather than inferred:
 * "…(say “reel” or “carousel” if you'd prefer)". The interpretation turn builds its lines from
 * the item's RESOLVED FIELDS instead — deliberately, so the client agrees to the change and not
 * to a sentence about it — and `InterpretedItem` carries no `formatInferred`, so the hint has
 * nowhere to come from.
 *
 * The consequence is real: a client can no longer tell a format they asked for from a format we
 * defaulted to. Restoring it means one more resolved field on the item, which is a data change
 * rather than a rendering one. Named in docs/reports/desktop-build.md.
 */

/* ── Part 3 — compound decomposition ─────────────────────────────────────────────── */

test('"a reel … with a good hook" decomposes into two lines and Apply runs them in order', async ({ page }) => {
  await say(page, 'create a reel about the heatwave with a good hook');
  await expect(changes(page)).toHaveCount(2, { timeout: 20_000 });
  await expect(changes(page).filter({ hasText: /Add a reel/i })).toHaveCount(1);
  await expect(changes(page).filter({ hasText: /Generate hooks/i })).toHaveCount(1);

  // ONE Apply. The sequence is internal — a hook proposal resolves the post its add wrote —
  // so the client is never asked to get the order right.
  await page.getByTestId('interp-apply').click();
  await expect(page.getByTestId('interpretation')).toHaveAttribute('data-status', 'resolved', { timeout: 25_000 });
  await expect(thread(page)).toContainText(/2 changes are in|your plan is updated/i);
});

test('a line can be left out of the turn before it applies', async ({ page }) => {
  await say(page, 'create a reel about the heatwave with a good hook');
  await expect(changes(page)).toHaveCount(2, { timeout: 20_000 });

  await changes(page).filter({ hasText: /Generate hooks/i }).getByTestId('interp-drop').click();
  await expect(changes(page)).toHaveCount(1);
  await expect(changes(page)).toContainText(/Add a reel/i);
});

test('hooks asked for a single-image post → an answer, and no invalid proposal', async ({ page }) => {
  await say(page, 'generate hooks for the monday photo');
  await expect(thread(page)).toContainText(/reels and carousels/i, { timeout: 20_000 });
  await expect(changes(page)).toHaveCount(0);
});

/* ── §26 Part 2 — agent refine ───────────────────────────────────────────────────── */

test('"make the script punchier" → a refine line → Apply enqueues the job and ledgers it', async ({ page }) => {
  const id = SEED.post(6);   // "The boxes have arrived" reel, seeded WITH a script
  await say(page, 'make the script on the boxes reel punchier');
  await expect(changes(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(changes(page)).toContainText(/Refine the script/i);

  await page.getByTestId('interp-apply').click();
  await expectActivity(page, id, (r) => r.action === 'script_saved' && r.origin === 'agent', 'agent script refine ledgered');
});

test('refining a script that does not exist yet → an answer, and no proposal', async ({ page }) => {
  await say(page, 'make the script on the tuesday reel punchier');
  await expect(thread(page)).toContainText(/no script|Generate script/i, { timeout: 20_000 });
  await expect(changes(page)).toHaveCount(0);
});
