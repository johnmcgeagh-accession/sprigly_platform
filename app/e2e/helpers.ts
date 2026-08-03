import { type Page, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');

/** Reset the DB to the deterministic seed. Run in beforeEach so desktop and mobile
 *  projects (which share one container) never see each other's mutations. */
export function reseed(): void {
  execSync('pnpm --filter @sprigly/db exec tsx src/seed-e2e.ts', {
    cwd: REPO_ROOT, stdio: 'ignore', env: process.env,
  });
}

/** Fixed ids/dates from scripts/seed-e2e.ts (frozen today = 2026-07-08). */
export const SEED = {
  today: '2026-07-08',
  post: (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`,
  proposalId: '66666666-6666-4666-8666-666666666666',
  postCount: 12,
};

export interface ActivityRow { id: string; postId: string | null; origin: string; action: string; refProposalId: string | null; createdAt: string }

/** Read the plan_activity ledger via the test-only route (gated by the e2e fake flag). */
export async function activityFor(page: Page, postId?: string): Promise<ActivityRow[]> {
  const url = postId ? `/api/e2e/activity?postId=${postId}` : '/api/e2e/activity';
  const res = await page.request.get(url);
  expect(res.ok(), `activity route ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { activity: ActivityRow[] }).activity;
}

/** Wait until a ledger row matching the predicate exists (writes commit async of the UI). */
export async function expectActivity(page: Page, postId: string, match: (r: ActivityRow) => boolean, msg: string): Promise<ActivityRow> {
  let found: ActivityRow | undefined;
  await expect(async () => {
    const rows = await activityFor(page, postId);
    found = rows.find(match);
    expect(found, msg).toBeTruthy();
  }).toPass({ timeout: 8000 });
  return found!;
}

/** Reload and wait for the plan surface to be interactive again. */
export async function reload(page: Page, layout: 'desktop' | 'mobile') {
  await page.reload();
  await expect(page.getByTestId(layout === 'desktop' ? 'plan-desktop' : 'plan-shell')).toBeVisible();
}

/**
 * Open one post's detail view, on either shell, by the day it sits on.
 *
 * Both shells reach it the same way now — select the day, then the card — but they select the
 * day differently: the desktop grid is beside the day column, and the phone's is a peer view you
 * step into. The route through the month grid works on both and does not depend on the post
 * being in the current week, which the week strip would.
 *
 * The DETAIL VIEW is the same component either way (`detail-sheet`), which is the whole reason
 * these specs can live in one project rather than two.
 */
export async function openPostOn(page: Page, iso: string, postId?: string) {
  const mobile = await page.getByTestId('nav-month').count() > 0;
  if (mobile) {
    await page.getByTestId('nav-month').click();
    await page.locator(`[data-testid="grid-cell"][data-date="${iso}"]`).click();
    const row = postId
      ? page.locator(`[data-testid="month-summary"] [data-post-id="${postId}"]`)
      : page.locator('[data-testid="month-summary"] [data-post-id]').first();
    await row.click();
  } else {
    await page.locator(`[data-testid="grid-cell"][data-date="${iso}"]`).click();
    const card = postId
      ? page.locator(`[data-testid="post-card"][data-post-id="${postId}"]`)
      : page.getByTestId('post-card').first();
    await card.click();
  }
  await expect(page.getByTestId('detail-sheet')).toBeVisible();
}

/** Close the detail view, whichever frame it is in. */
export async function closeDetail(page: Page) {
  const back = page.getByTestId('detail-back');
  if (await back.count()) await back.click();
  else await page.getByTestId('detail-sheet-grabber').click();
  await expect(page.getByTestId('detail-sheet')).toHaveCount(0);
}
