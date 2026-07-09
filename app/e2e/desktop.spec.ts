import { test, expect } from '@playwright/test';
import { SEED, activityFor, expectActivity, reseed } from './helpers';

test.beforeEach(async ({ page }) => {
  reseed();
  await page.goto('/');
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
});

test('month renders: post count, rail counts, summary card', async ({ page }) => {
  await expect(page.getByTestId('post-chip')).toHaveCount(SEED.postCount);
  await expect(page.getByTestId('nav-calendar')).toContainText('12');
  await expect(page.getByTestId('nav-tasks')).toContainText('late');
  await expect(page.getByTestId('nav-notes')).toContainText('3');
  await expect(page.getByTestId('month-summary')).toContainText('12 posts planned');
});

test('rings: editor shows correct done/total for a fully-done checklist', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByText('2/2 done')).toBeVisible();
});

test('drag-reschedule persists across reload and ledgers origin=user', async ({ page }) => {
  const id = SEED.post(1); // starts on 2026-07-02
  const chip = page.locator(`[data-post-id="${id}"]`).first();
  const target = page.locator('[data-testid="calendar-cell"][data-date="2026-07-15"]');
  await chip.dispatchEvent('dragstart');
  await page.waitForTimeout(120);               // let React commit setDragId
  await target.dispatchEvent('dragover');
  await target.dispatchEvent('drop');

  await expect(target.locator(`[data-post-id="${id}"]`)).toBeVisible();
  await expectActivity(page, id, (r) => r.action === 'rescheduled' && r.origin === 'user', 'reschedule ledgered');

  await page.reload();
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
  await expect(page.locator(`[data-testid="calendar-cell"][data-date="2026-07-15"] [data-post-id="${id}"]`)).toBeVisible();
});

test('caption save → EDITED → revert restores original; both ledgered', async ({ page }) => {
  const id = SEED.post(1);
  await page.locator(`[data-post-id="${id}"]`).click();
  const cap = page.getByTestId('editor-caption');
  await expect(cap).toHaveValue(/original caption/);

  // Autosave on blur (no Save button) → EDITED + one caption_saved ledger row.
  await expect(page.getByTestId('editor-save')).toHaveCount(0);
  await cap.fill('A brand new caption for the e2e test.');
  await cap.blur();
  await expect(page.getByTestId('post-editor').getByText('EDITED', { exact: true })).toBeVisible();
  await expectActivity(page, id, (r) => r.action === 'caption_saved' && r.origin === 'user', 'caption_saved ledgered');
  await expect
    .poll(async () => (await activityFor(page, id)).filter((r) => r.action === 'caption_saved').length)
    .toBe(1);

  // Revert restores the original even from an autosaved state.
  await page.getByTestId('editor-revert').click();
  await expect(cap).toHaveValue(/original caption/);
  await expectActivity(page, id, (r) => r.action === 'post_reverted' && r.origin === 'user', 'post_reverted ledgered');
});

test('checklist: generate empty post, 409 on repeat, tick updates ring + ledgers', async ({ page }) => {
  const id = SEED.post(4); // single, no steps
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('editor-generate')).toBeVisible();
  await page.getByTestId('editor-generate').click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2);
  await expect(page.getByText('0/2 done')).toBeVisible();

  const repeat = await page.request.post(`/api/posts/${id}/checklist/generate`);
  expect(repeat.status()).toBe(409);

  await page.getByTestId('checklist-item').first().getByTestId('step-toggle').click();
  await expect(page.getByText('1/2 done')).toBeVisible();
  await expectActivity(page, id, (r) => r.action === 'step_completed' && r.origin === 'user', 'step tick ledgered');
});

test('checklist: generate is hidden for an email post', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(5)}"]`).click(); // email
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('editor-generate')).toHaveCount(0);
  await expect(page.getByText('No checklist for this format.')).toBeVisible();
});

test('tasks: ticking a task removes it from the board and ledgers', async ({ page }) => {
  await page.getByTestId('nav-tasks').click();
  const rows = page.getByTestId('task-row');
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  await rows.first().getByTestId('task-check').click();
  await expect(rows).toHaveCount(before - 1);
  const acts = await activityFor(page);
  expect(acts.some((r) => r.action === 'step_completed' && r.origin === 'user')).toBeTruthy();
});

test('agent ask (stubbed) → ExtractionSummary → proposal in Approvals → discard', async ({ page }) => {
  await page.getByTestId('agent-fab').click();
  await page.getByTestId('agent-input').fill('please move a post to later this month');
  await page.getByTestId('agent-send').click();
  await expect(page.getByTestId('extraction-summary')).toBeVisible();
  await expect(page.getByTestId('extraction-summary')).toContainText('Approvals');

  await page.getByTestId('sheet-close').click();
  await page.getByTestId('nav-approvals').click();
  await expect(page.getByTestId('proposal-card')).toHaveCount(2); // seeded + new
  await page.getByTestId('proposal-card').first().getByTestId('proposal-discard').click();
  await expect(page.getByTestId('proposal-card')).toHaveCount(1);
});

test('approve a proposal mutates the plan and ledgers origin=agent + ref_proposal_id', async ({ page }) => {
  await page.getByTestId('nav-approvals').click();
  await expect(page.getByTestId('proposal-card')).toHaveCount(1);
  await page.getByTestId('proposal-approve').first().click();
  await expect(page.getByTestId('proposal-card')).toHaveCount(0);

  const id = SEED.post(7); // move P7 → 2026-07-27
  await page.getByTestId('nav-calendar').click();
  await expect(page.locator(`[data-testid="calendar-cell"][data-date="2026-07-27"] [data-post-id="${id}"]`)).toBeVisible();
  await expectActivity(page, id, (r) => r.origin === 'agent' && r.action === 'rescheduled' && r.refProposalId === SEED.proposalId, 'agent move ledgered');
});

test('approvals empty state after clearing the queue', async ({ page }) => {
  await page.getByTestId('nav-approvals').click();
  await page.getByTestId('proposal-discard').first().click();
  await expect(page.getByTestId('approvals-empty')).toBeVisible();
});

test('shape pending → disabled + pending copy → caption swaps on completion', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();
  const cap = page.getByTestId('editor-caption');
  const before = await cap.inputValue();

  await page.getByTestId('shape-input').fill('make it warmer');
  await page.getByTestId('shape-go').click();
  await expect(page.getByTestId('shape-note')).toContainText('rewriting');
  await expect(page.getByTestId('shape-input')).toBeDisabled();

  await expect(cap).not.toHaveValue(before, { timeout: 8000 });
  await expect(cap).toHaveValue(/quietly working/);
});

test('month nav: round-trips to the adjacent August cycle and disables at boundaries', async ({ page }) => {
  // July is the home cycle and the earliest — prev is disabled, next available.
  await expect(page.getByText('July 2026')).toBeVisible();
  await expect(page.getByTestId('prev-month')).toBeDisabled();
  await expect(page.getByTestId('next-month')).toBeEnabled();

  // Forward to August: a read-only sibling with its own posts, no editing controls.
  await page.getByTestId('next-month').click();
  await expect(page.getByText('August 2026')).toBeVisible();
  await expect(page.getByTestId('post-chip')).toHaveCount(3);
  await expect(page.getByTestId('add-post')).toHaveCount(0);
  // August is the far boundary — next disabled, prev available.
  await expect(page.getByTestId('next-month')).toBeDisabled();
  await expect(page.getByTestId('prev-month')).toBeEnabled();

  // Back to July (home, editable again).
  await page.getByTestId('prev-month').click();
  await expect(page.getByText('July 2026')).toBeVisible();
  await expect(page.getByTestId('post-chip')).toHaveCount(12);
  await expect(page.getByTestId('add-post')).toBeVisible();
});

test('caption autosave: rapid typing settles to a single ledger row', async ({ page }) => {
  const id = SEED.post(1);
  await page.locator(`[data-post-id="${id}"]`).click();
  const cap = page.getByTestId('editor-caption');
  await cap.click();
  await cap.fill('');
  // Type character-by-character quickly (under the ~1.5s debounce), then blur to settle.
  await cap.pressSequentially('rapid typing under the debounce window', { delay: 20 });
  await cap.blur();
  await expectActivity(page, id, (r) => r.action === 'caption_saved' && r.origin === 'user', 'one caption_saved');
  // Exactly one row for the single settled edit — never one-per-keystroke.
  await expect
    .poll(async () => (await activityFor(page, id)).filter((r) => r.action === 'caption_saved').length)
    .toBe(1);
});

test('delete: bottom button needs a confirm; cancel keeps the post, confirm removes it', async ({ page }) => {
  const id = SEED.post(2);
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();

  // No mid-panel remove; the delete button is at the bottom.
  await expect(page.getByTestId('editor-remove')).toHaveCount(0);
  await expect(page.getByTestId('editor-delete')).toBeVisible();

  // First tap only asks — nothing is destroyed.
  await page.getByTestId('editor-delete').click();
  await expect(page.getByTestId('delete-confirm')).toBeVisible();
  await page.getByTestId('delete-cancel').click();
  await expect(page.getByTestId('delete-confirm')).toHaveCount(0);
  await expect(page.locator(`[data-post-id="${id}"]`)).toBeVisible();

  // Confirm → post removed (drawer closes, chip gone) + post_deleted ledger.
  await page.getByTestId('editor-delete').click();
  await page.getByTestId('delete-confirm-yes').click();
  await expect(page.getByTestId('post-editor')).toHaveCount(0);
  await expect(page.locator(`[data-post-id="${id}"]`)).toHaveCount(0);
  await expectActivity(page, id, (r) => r.action === 'post_deleted', 'post_deleted ledgered');
});

test('date picker: branded popover reschedules + ledgers; not a native input', async ({ page }) => {
  const id = SEED.post(1); // starts on 2026-07-02
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();

  // The field is a button that opens a branded popover (no OS-native date input).
  await page.getByTestId('editor-date').click();
  await expect(page.getByTestId('date-popover')).toBeVisible();
  await page.locator('[data-testid="date-popover"] [data-date="2026-07-19"]').click();
  await expect(page.getByTestId('date-popover')).toHaveCount(0); // closes on select

  await expectActivity(page, id, (r) => r.action === 'rescheduled' && r.origin === 'user', 'date-picker reschedule ledgered');
  await expect(page.locator(`[data-testid="calendar-cell"][data-date="2026-07-19"] [data-post-id="${id}"]`)).toBeVisible();
});

test('editor: media section removed, shape pills gone (free-text shape stands alone)', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(3)}"]`).click();
  await expect(page.getByTestId('post-editor')).toBeVisible();
  await expect(page.getByTestId('media-placeholder')).toHaveCount(0);
  await expect(page.getByTestId('shape-input')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make it softer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Make it shorter' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Warmer tone' })).toHaveCount(0);
});
