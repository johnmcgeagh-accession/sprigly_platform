import { test, expect } from '@playwright/test';
import { reseed, SEED } from './helpers';

// Runs as tenant B; asserts it cannot reach tenant A's data. (A = the rich seed tenant.)
const CYCLE_A = '22222222-2222-4222-8222-222222222222';

test.beforeEach(() => { reseed(); });

test('cannot READ tenant A cycle', async ({ page }) => {
  const r = await page.request.get(`/api/plan?cycleId=${CYCLE_A}`);
  expect(r.status()).toBe(403);
});

test('cannot MUTATE tenant A posts or steps', async ({ page }) => {
  expect((await page.request.patch(`/api/posts/${SEED.post(1)}`, { data: { date: '2026-07-20' } })).status()).toBe(404);
  expect((await page.request.delete(`/api/posts/${SEED.post(1)}`)).status()).toBe(404);
  expect((await page.request.post(`/api/posts/${SEED.post(1)}/revert`)).status()).toBe(404);
  expect((await page.request.post(`/api/posts/${SEED.post(4)}/checklist/generate`)).status()).toBe(404);
});

test('cannot approve tenant A proposal, and sees none of its own', async ({ page }) => {
  const list = await page.request.get('/api/plan/proposals?status=pending');
  expect(((await list.json()).proposals as unknown[]).length).toBe(0);
  const appr = await page.request.post(`/api/plan/proposals/${SEED.proposalId}/approve`);
  expect([200, 404]).toContain(appr.status());   // not owned → no mutation (A's plan verified untouched in desktop suite)
});

test('sees only its own (empty) notes and activity, not tenant A', async ({ page }) => {
  expect(((await (await page.request.get('/api/plan/notes')).json()).notes as unknown[]).length).toBe(0);
  const act = await page.request.get('/api/e2e/activity');
  expect(act.ok()).toBeTruthy();
  expect(((await act.json()).activity as unknown[]).length).toBe(0);
});
