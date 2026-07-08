import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

/**
 * E2E config for the plan redesign (Stage 3). Two device projects (desktop 1440×900,
 * mobile 390×844), each depending on a one-time magic-link auth setup whose storageState
 * is reused. The app under test is `next dev` (NODE_ENV=development so the hard-gated e2e
 * fakes activate — see design/DECISIONS.md) pointed at the disposable pg17 container; the
 * container + seed are provisioned by scripts/e2e.sh before Playwright runs.
 */
const CONTAINER_DB = 'postgresql://postgres:postgres@127.0.0.1:55432/sprigly_test';
const STATE = join(__dirname, 'e2e', '.auth', 'state.json');
const STATE_B = join(__dirname, 'e2e', '.auth', 'state-b.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,           // one seeded tenant; serial keeps ledger assertions deterministic
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'setup-b', testMatch: /auth-b\.setup\.ts/ },
    {
      name: 'desktop',
      testMatch: /(common|desktop|a11y|session)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STATE },
    },
    {
      name: 'mobile',
      testMatch: /(common|mobile|a11y)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, storageState: STATE },
    },
    {
      name: 'tenant-b',
      testMatch: /(empty|security)\.spec\.ts/,
      dependencies: ['setup-b'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STATE_B },
    },
  ],
  webServer: {
    command: 'next dev --port 3200',
    url: 'http://localhost:3200/expired',   // a lightweight route that needs no session
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: {
      DATABASE_URL: CONTAINER_DB,
      SPRIGLY_E2E_FAKE: '1',
      PLAN_TODAY: '2026-07-08',
      REDIS_URL: '',
    },
  },
});
