import { test as setup, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH = join(__dirname, '.auth');

/**
 * The DRAFT month's own session.
 *
 * Same tenant as the committed suite, a different cycle — and it has to be a session rather
 * than a `?cycle=` on the existing one, because `POST /api/plan/draft/approve` takes the cycle
 * from the session and accepts no body at all. A committed session steered here by query
 * string would approve the wrong month.
 *
 * Landing needs no navigation either: `resolveLandingCycleId` sends a session whose home cycle
 * holds a reviewable draft straight to it, which is the same rule production follows when the
 * Ask email's link is opened.
 */
setup('authenticate the draft-month session via magic link', async ({ page }) => {
  const token = readFileSync(join(AUTH, 'token-draft.txt'), 'utf8').trim();
  await page.goto(`/p/${token}`);
  await expect(page).toHaveURL(/\/$/);

  // Establish a known month before anything reads it. The container outlives the test process,
  // so a previous run that died between approving and restoring would otherwise leave every
  // subsequent run failing here — and failing with "no draft badge", which points at nothing.
  // This is the first code with a session, so it is the right place to make the state certain.
  const reset = await page.evaluate(async () => (await fetch('/api/e2e/reset-draft', { method: 'POST' })).status);
  expect(reset, 'the e2e reset route must be reachable — is SPRIGLY_E2E_FAKE=1 set?').toBe(200);
  await page.reload();

  // Prove the session actually landed on the draft before saving it — a storageState that
  // silently points at a committed month would fail every draft spec for the wrong reason.
  await expect(page.getByTestId('draft-badge')).toBeVisible();
  await page.context().storageState({ path: join(AUTH, 'state-draft.json') });
});
