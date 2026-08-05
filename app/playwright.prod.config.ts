import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
// From scripts/test-db.identity — see playwright.config.ts. Never a second literal.
import { CONTAINER_DB } from './e2e/test-db';

/**
 * Prod-mode smoke (Stage 5) — closes the next-dev gap. Runs `next build && next start`
 * (NODE_ENV=production, so every e2e fake is inert) against the container on port 3300.
 * Covers only fake-free flows: boot, magic-link session, month render + rings, caption
 * save, checklist tick, and that /api/e2e/* is 404. No agent/shape (they need the fake).
 */
const STATE = join(__dirname, 'e2e', '.auth', 'state.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3300', trace: 'retain-on-failure', actionTimeout: 10_000 },
  projects: [
    { name: 'setup-prod', testMatch: /auth\.setup\.ts/ },
    {
      name: 'prod',
      testMatch: /prod\.spec\.ts/,
      dependencies: ['setup-prod'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STATE },
    },
  ],
  webServer: {
    command: 'next build && next start --port 3300',
    url: 'http://localhost:3300/expired',
    reuseExistingServer: !process.env['CI'],
    timeout: 300_000,
    env: {
      DATABASE_URL: CONTAINER_DB,
      // NODE_ENV=production is set by `next start`. SPRIGLY_E2E_FAKE / PLAN_TODAY are
      // intentionally UNSET here — the fakes must be inert.
      REDIS_URL: '',
    },
  },
});
