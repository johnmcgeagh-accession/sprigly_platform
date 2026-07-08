import { test as setup, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH = join(__dirname, '.auth');

/** Establish tenant B's (empty tenant) magic-link session for the empty-state and
 *  cross-tenant-isolation specs. */
setup('authenticate tenant B via magic link', async ({ page }) => {
  const token = readFileSync(join(AUTH, 'token-b.txt'), 'utf8').trim();
  await page.goto(`/p/${token}`);
  await expect(page).toHaveURL(/\/$/);
  await page.context().storageState({ path: join(AUTH, 'state-b.json') });
});
