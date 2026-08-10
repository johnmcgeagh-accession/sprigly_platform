import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
// From scripts/test-db.identity, the file the seed's guard reads to decide what it refuses.
// Not a literal: the app under test and the seeder must name the same database, and the
// way that stops being true is two copies of it.
import { CONTAINER_DB } from './e2e/test-db';

/**
 * E2E config for the plan redesign (Stage 3). Two device projects (desktop 1440×900,
 * mobile 390×844), each depending on a one-time magic-link auth setup whose storageState
 * is reused. The app under test is `next dev` (NODE_ENV=development so the hard-gated e2e
 * fakes activate — see design/DECISIONS.md) pointed at the disposable pg17 container; the
 * container + seed are provisioned by scripts/e2e.sh before Playwright runs.
 */
const STATE = join(__dirname, 'e2e', '.auth', 'state.json');
const STATE_B = join(__dirname, 'e2e', '.auth', 'state-b.json');
const STATE_DRAFT = join(__dirname, 'e2e', '.auth', 'state-draft.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,           // one seeded tenant; serial keeps ledger assertions deterministic
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // One retry absorbs shared-container/dev-server infra flakes (rapid reseed + async
  // interactions against a single seeded tenant); a real defect still fails both attempts.
  retries: 1,
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
    { name: 'setup-draft', testMatch: /auth-draft\.setup\.ts/ },
    {
      name: 'desktop',
      // THE DESKTOP PROJECT IS THE SHELL. The per-post machinery — hooks, scripts, format,
      // shape, the checklist — and the weather forecast moved to `mobile`: they drive
      // DetailSheet and VoiceSheet, which both shells now share, so running them through two
      // frames doubles the maintenance for one signal. See desktop.spec.ts's header.
      testMatch: /(common|desktop|a11y|session)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STATE },
    },
    {
      name: 'mobile',
      testMatch: /(common|mobile|a11y|header|conversation|transcript|detail-machinery|agent|weather)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, storageState: STATE },
    },
    /**
     * THE ENGINE THE CLIENT ACTUALLY USES, at the height it actually gets.
     *
     * Every other project here is Chromium at 390×844 — an iPhone's SCREEN, which is about
     * 185px more than Safari leaves a page once its chrome is drawn. Two layout defects have
     * now been reported from a phone, investigated, and recorded as not reproducing headless;
     * the second one reproduces perfectly in WebKit at a real small-viewport height, and could
     * not have failed in Chromium at any height (frame.ts → `scrollTail`).
     *
     * Deliberately a SHORT list. This is not a second full pass of the suite in a second
     * engine — it is the geometry that only this combination can see, and it stays that size.
     * `intake-heading` is the third report of this class and the second to be traced to the
     * phone's real height rather than its screen.
     */
    {
      name: 'mobile-webkit',
      testMatch: /(pill-clearance|intake-heading)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['iPhone 13'], storageState: STATE },
    },
    {
      name: 'tenant-b',
      testMatch: /(empty|security)\.spec\.ts/,
      dependencies: ['setup-b'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STATE_B },
    },
    /**
     * THE DRAFT MONTH, on both form factors.
     *
     * Its own session (see auth-draft.setup.ts) rather than a `?cycle=` on the committed one,
     * because the approve route takes its cycle from the session and accepts no body.
     *
     * The same spec file runs twice and branches on the frame only where the SHAPE genuinely
     * differs — the Generate confirm is a centred modal on desktop and a sheet on the phone,
     * and that is the one difference worth two runs. Everything else is the same behaviour and
     * is asserted identically, which is what makes running it twice worth the wall-clock.
     *
     * They run LAST, after every committed project, because the Generate test approves the
     * month. It restores it afterwards (POST /api/e2e/reset-draft) so the second of the two
     * still finds a draft — but ordering it last means a restore that ever fails costs the
     * draft specs and nothing else.
     */
    {
      name: 'draft-desktop',
      testMatch: /draft\.spec\.ts/,
      dependencies: ['setup-draft'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STATE_DRAFT },
    },
    {
      name: 'draft-mobile',
      testMatch: /draft\.spec\.ts/,
      dependencies: ['setup-draft'],
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, storageState: STATE_DRAFT },
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
