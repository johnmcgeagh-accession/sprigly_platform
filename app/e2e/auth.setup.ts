import { test as setup, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH = join(__dirname, '.auth');

/** Establish the magic-link session once; every test project reuses the storageState. */
setup('authenticate via magic link', async ({ page }) => {
  const token = readFileSync(join(AUTH, 'token.txt'), 'utf8').trim();
  await page.goto(`/p/${token}`);            // verifies token, sets httpOnly cookie, redirects to /
  await expect(page).toHaveURL(/\/$/);       // landed on the plan (not /expired)
  await page.context().storageState({ path: join(AUTH, 'state.json') });
});
