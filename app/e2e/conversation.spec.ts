/**
 * conversation.spec.ts — the Emma loop, through the CONVERSATION SHEET, end to end.
 *
 * The acceptance narrative for the conversation-sheet session, run against the real app, the
 * real routes and the real container database — the model faked deterministically (the same
 * hard-gated e2e fake every spec here uses), so nothing is spent and every assertion is about
 * OUR machinery: the thread persists server-side, the interpretation is derived and applied,
 * the confirmation is a turn, and the what-changed treatment lands on the plan.
 *
 * Emma's committed-month loop, restated for the thread: she opens the mic, the agent speaks
 * first; she asks for a compound correction; she reads the interpretation IN the thread and
 * applies it there; the confirmation arrives as the next turn; the plan surface carries the
 * chip, the highlights and — on her next visit — the changed-day dot and the What-changed row.
 * Closing and reopening the sheet finds the same conversation.
 */
import { test, expect } from '@playwright/test';
import { reseed, expectActivity, SEED } from './helpers';

const REEL = SEED.post(3);   // the seeded reel the fake parser's compound branch pins

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-shell')).toBeVisible();
});

test('the Emma loop: speak → interpretation turn → apply in thread → confirmation → the surface says what changed', async ({ page }) => {
  // ── 1 · The sheet opens a SESSION: the framing speaks, and nothing else is there ─────
  // Per-session (round 2): each open is its own conversation. The seed's prior exchange
  // ("move the sweatshirt post later") is stored and deliberately NOT rendered.
  const theme = () => page.locator('meta[name="theme-color"]').first().getAttribute('content');
  const themeCanvas = await theme();
  await page.getByTestId('nav-mic').click();
  await expect(page.getByTestId('voice-sheet')).toBeVisible();
  await expect(page.getByTestId('turn-agent').first()).toContainText('July is written');
  await expect(page.getByTestId('turn-user')).toHaveCount(0);
  // The browser chrome follows the sheet (F7c): the band adopts the scrim tone while it is up.
  expect(await theme()).not.toBe(themeCanvas);

  // ── 2 · Her compound correction, typed into the one composer ────────────────────────
  await page.getByTestId('voice-input').fill(`move the reel ${REEL} later and make it a carousel`);
  await page.getByTestId('voice-submit').click();

  // Her words are a bubble; the interpretation is a turn with BOTH resolved lines.
  await expect(page.getByTestId('turn-user').last()).toContainText('make it a carousel');
  const interp = page.getByTestId('interpretation');
  await expect(interp).toBeVisible();
  await expect(interp).toHaveAttribute('data-status', 'open');
  await expect(page.getByTestId('interp-change')).toHaveCount(2);
  await expect(interp).toContainText('Move');
  await expect(interp).toContainText('Fri 24 Jul');
  await expect(interp).toContainText('to a carousel');
  await expect(interp).not.toContainText(/approv/i);

  // ── 3 · Apply, IN the thread — the confirmation is the next agent turn ──────────────
  await page.getByTestId('interp-apply').click();
  await expect(page.getByTestId('turn-agent').last()).toContainText('Done — 2 changes are in.', { timeout: 15_000 });
  await expect(interp).toHaveAttribute('data-status', 'resolved');
  // The sheet did not close, and the composer is still there — no dead end.
  await expect(page.getByTestId('voice-input')).toBeVisible();

  // The ledger says what the thread says: origin agent, tied to its proposals.
  await expectActivity(page, REEL, (r) => r.action === 'rescheduled' && r.origin === 'agent' && !!r.refProposalId, 'agent move ledgered');
  await expectActivity(page, REEL, (r) => r.action === 'format_changed' && r.origin === 'agent', 'agent format change ledgered');

  // ── 4 · Close: the plan surface carries the standard treatment ──────────────────────
  await page.getByTestId('voice-close').click();
  expect(await theme()).toBe(themeCanvas);   // the band restored on close
  await expect(page.getByTestId('summary-chip')).toContainText('1 moved · 1 reformatted');
  // 24 Jul is two weeks ahead of the frozen today — page the strip there.
  await page.getByTestId('next-week').click();
  await page.getByTestId('next-week').click();
  await page.locator('[data-testid="week-day"][data-date="2026-07-24"]').click();
  await expect(page.locator('[data-testid="post-card"][data-post-id="' + REEL + '"]')).toHaveAttribute('data-changed', 'true');

  // ── 5 · Reopen: a CLEAN SHEET — the last session is stored, not rendered ────────────
  await page.getByTestId('nav-mic').click();
  await expect(page.getByTestId('turn-agent').first()).toContainText('July is written');
  await expect(page.getByTestId('turn-user')).toHaveCount(0);
  await expect(page.getByTestId('interpretation')).toHaveCount(0);

  // ── 6 · The new session works from its first turn: a note files as an idea ──────────
  await page.getByTestId('voice-input').fill('remember the candle relaunch is coming');
  await page.getByTestId('voice-submit').click();
  await expect(page.getByTestId('interp-idea')).toContainText('Saved to your ideas');
  await page.getByTestId('voice-close').click();
});

test('the next visit says what changed: the second dot, and nothing else', async ({ page }) => {
  // Visit one: apply Emma's correction (stamps this visit; the changes land after it).
  await page.getByTestId('nav-mic').click();
  await page.getByTestId('voice-input').fill(`move the reel ${REEL} later and make it a carousel`);
  await page.getByTestId('voice-submit').click();
  await page.getByTestId('interp-apply').click();
  await expect(page.getByTestId('turn-agent').last()).toContainText('Done', { timeout: 15_000 });
  await page.getByTestId('voice-close').click();

  // Visit two: the reload re-lands, reads the ledger since the stamp, and says so.
  await page.reload();
  await expect(page.getByTestId('plan-shell')).toBeVisible();
  // The header carries NOTHING about it (operator ruling, round 4): the dots are the whole
  // changed-surface, and the pill that used to count them here is gone.
  await expect(page.getByTestId('what-changed-row')).toHaveCount(0);

  // The month grid shows the whole month — the changed day carries the accent second dot.
  await page.getByTestId('nav-month').click();
  await expect(page.locator('[data-testid="grid-cell"][data-date="2026-07-24"] [data-testid="grid-changed"]')).toBeVisible();

  // Selecting that day is what decays the mark — the calendar is where the change is, so the
  // calendar is where it is answered.
  await page.locator('[data-testid="grid-cell"][data-date="2026-07-24"]').click();
  await page.getByTestId('nav-day').click();
  await expect(page.getByTestId('day-panel')).toHaveAttribute('data-date', '2026-07-24');
  await expect(page.locator('[data-testid="day-changed"]')).toHaveCount(0);
});

test('an add-with-hook rides the thread: two changes, sequential apply, honest arrival', async ({ page }) => {
  await page.getByTestId('nav-mic').click();
  await page.getByTestId('voice-input').fill('add a reel about the linen dress with a good hook');
  await page.getByTestId('voice-submit').click();

  const interp = page.getByTestId('interpretation');
  await expect(page.getByTestId('interp-change')).toHaveCount(2);
  await expect(interp).toContainText('Add a reel');
  await expect(interp).toContainText('Generate hooks');

  // Apply runs the pair SEQUENTIALLY (the hook resolves the post its add wrote) — the
  // confirmation turn arrives once both have settled.
  await page.getByTestId('interp-apply').click();
  await expect(page.getByTestId('turn-agent').last()).toContainText('Done — 2 changes are in.', { timeout: 20_000 });
});
