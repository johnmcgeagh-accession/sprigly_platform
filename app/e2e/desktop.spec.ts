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
  await expect(page.getByTestId('extraction-row')).toHaveCount(1);          // one move proposal
  await expect(page.getByTestId('extraction-approve').first()).toBeVisible(); // inline actions, not "→ Approvals"
  await expect(page.getByTestId('extraction-summary')).not.toContainText('•'); // clean prose, no orphan bullet

  await page.getByTestId('dialog-close').click();
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
  // July is the landed (today = 2026-07-08) cycle and the earliest — prev disabled, next available.
  await expect(page.getByText('July 2026')).toBeVisible();
  await expect(page.getByTestId('prev-month')).toBeDisabled();
  await expect(page.getByTestId('next-month')).toBeEnabled();

  // Forward to August: a sibling cycle with its own posts. Editability is date-based, not
  // whole-cycle — every August day is future (>= today), so the month is fully editable and
  // its empty days offer the add affordance (regardless of which cycle the token was minted for).
  await page.getByTestId('next-month').click();
  await expect(page.getByText('August 2026')).toBeVisible();
  await expect(page.getByTestId('post-chip')).toHaveCount(3);
  await expect(page.getByTestId('add-on-day').first()).toBeVisible();
  // August is the far boundary — next disabled, prev available.
  await expect(page.getByTestId('next-month')).toBeDisabled();
  await expect(page.getByTestId('prev-month')).toBeEnabled();

  // Back to July (today-onward posts editable; the two pre-8th posts are read-only).
  await page.getByTestId('prev-month').click();
  await expect(page.getByText('July 2026')).toBeVisible();
  await expect(page.getByTestId('post-chip')).toHaveCount(12);
  await expect(page.getByTestId('add-on-day').first()).toBeVisible();
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

test('regression: typing in the agent input keeps focus and accumulates (no focus-steal)', async ({ page }) => {
  await page.getByTestId('agent-fab').click();
  const input = page.getByTestId('agent-input');
  await input.click();
  // REAL key events — this class of bug (focus jumps to ✕ per keystroke) is invisible to fill().
  await page.keyboard.type('move the tuesday post to friday please', { delay: 12 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('move the tuesday post to friday please');
});

test('regression: typing a caption keeps focus through the autosave re-render (no focus-steal)', async ({ page }) => {
  await page.locator(`[data-post-id="${SEED.post(1)}"]`).click();
  const cap = page.getByTestId('editor-caption');
  await cap.click();
  await cap.press('End');
  await page.keyboard.type('ABCDE', { delay: 12 });
  await page.waitForTimeout(1800); // past the ~1.5s autosave debounce, which re-renders the drawer
  await page.keyboard.type('FGHIJ', { delay: 12 });
  await expect(cap).toBeFocused();
  await expect(cap).toHaveValue(/ABCDEFGHIJ$/);
});

test('regression: editing mid-caption keeps the caret across an autosave (no jump-to-end) + saved hint', async ({ page }) => {
  const id = SEED.post(7);   // 2026-07-16 single — editable (today-onward), caption-only
  await page.locator(`[data-post-id="${id}"]`).click();
  const cap = page.getByTestId('editor-caption');
  const hint = page.getByTestId('caption-save-hint');

  // Known content with a clear middle. Settle a baseline save first so the edit under test is
  // the one whose autosave must NOT disturb the caret; the quiet hint confirms it landed.
  await cap.click();
  await cap.fill('HEADMIDTAIL');
  await cap.blur();
  await expect(hint).toHaveText('Saved');

  // Put the caret right after "HEAD" (index 4), type — cross the ~1.5s debounce so an autosave
  // fires and re-renders the drawer mid-edit — then type again. The second key must land at the
  // caret, not at the end: proof the save no longer re-seeds the field under the cursor.
  await cap.focus();
  await cap.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 4));
  await page.keyboard.type('X', { delay: 10 });   // HEADXMIDTAIL, caret after the X
  await page.waitForTimeout(1800);                 // autosave settles while the field is focused
  await page.keyboard.type('Y', { delay: 10 });    // inserts at the caret (→ ...XY...), not the end

  await expect(cap).toBeFocused();
  await expect(cap).toHaveValue('HEADXYMIDTAIL');  // caret held its mid-field position across the save
  await expect(hint).toHaveText('Saved');
});

test('regression: an external caption rewrite never clobbers an in-progress edit', async ({ page }) => {
  const id = SEED.post(7);   // 2026-07-16 single — editable, shapeable (caption target)
  await page.locator(`[data-post-id="${id}"]`).click();
  const cap = page.getByTestId('editor-caption');

  // Kick off an async Shape that rewrites the caption server-side; it lands (poll → refresh) a
  // second or so later, pushing a fresh `post.caption` into the still-open editor.
  await page.getByTestId('shape-input').fill('make it warmer');
  await page.getByTestId('shape-go').click();
  await expect(page.getByTestId('shape-note')).toContainText('rewriting');

  // Meanwhile the client keeps editing the caption (focused, unsaved edits).
  await cap.click();
  await cap.fill('MY OWN WORDS, MID-EDIT');

  // Let the shape job complete and refresh the plan (the external "quietly working" caption
  // arrives while the field is focused + dirty).
  await page.waitForTimeout(4000);

  // The client's in-progress edit wins — the guard refuses to adopt an external value into a
  // focused/dirty field, so the shaped text never replaces what they were typing.
  await expect(cap).toBeFocused();
  await expect(cap).toHaveValue('MY OWN WORDS, MID-EDIT');
  await expect(cap).not.toHaveValue(/quietly working/i);
});

test('checklist: add a step then rename it — autosaves on blur, ledgers step_renamed, persists', async ({ page }) => {
  const id = SEED.post(3); // reel with steps
  await page.locator(`[data-post-id="${id}"]`).click();
  const before = await page.getByTestId('step-label').count();
  await page.getByTestId('editor-add-step').click();
  await expect(page.getByTestId('step-label')).toHaveCount(before + 1);

  const last = page.getByTestId('step-label').last();
  await last.click();
  await last.fill('Book the studio');
  await last.blur();
  await expectActivity(page, id, (r) => r.action === 'step_renamed' && r.origin === 'user', 'step_renamed ledgered');

  await page.reload();
  await expect(page.getByTestId('plan-desktop')).toBeVisible();
  await page.locator(`[data-post-id="${id}"]`).click();
  await expect(page.getByTestId('step-label').last()).toHaveValue('Book the studio');
});

test('agent compound ask → two independently-approvable rows; inline approve mutates + ledgers + updates counts', async ({ page }) => {
  await page.getByTestId('agent-fab').click();
  await page.getByTestId('agent-input').fill('move the tuesday post to friday and make it a carousel');
  await page.getByTestId('agent-send').click();

  await expect(page.getByTestId('extraction-summary')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('agent-thinking')).toHaveCount(0);         // indicator resolved
  await expect(page.getByTestId('extraction-row')).toHaveCount(2);         // move + change_format
  await expect(page.getByTestId('nav-approvals')).toContainText('3');      // 2 new + 1 seeded

  const rows = page.getByTestId('extraction-row');
  const formatRow = rows.filter({ hasText: 'carousel' });
  const moveRow = rows.filter({ hasText: 'Move' });

  // Inline-approve the format row → Applied; the move row stays independently approvable.
  await formatRow.getByTestId('extraction-approve').click();
  await expect(formatRow.getByTestId('extraction-applied')).toBeVisible({ timeout: 12_000 });
  await expect(moveRow.getByTestId('extraction-approve')).toBeVisible();
  await expect(page.getByTestId('nav-approvals')).toContainText('2');      // one applied → count drops

  // Same ledger/mutation as the Approvals view: format_changed, origin agent, on the reel post.
  await expectActivity(page, SEED.post(3), (r) => r.action === 'format_changed' && r.origin === 'agent', 'agent format_changed ledgered');
  await page.getByTestId('dialog-close').click();
  await page.locator(`[data-post-id="${SEED.post(3)}"]`).click();
  await expect(page.getByTestId('format-select')).toContainText('Carousel');
});
