/**
 * transcript.spec.ts — the acceptance run, RENDERED. It walks the same loop
 * `conversation.spec.ts` asserts and prints the thread as text, so the report can carry what
 * the client actually saw rather than a description of it.
 *
 * It has no expectations of its own: every step is a `waitFor`, so it fails if the loop stops
 * working and passes silently otherwise. It stays in the suite because a report whose evidence
 * cannot be regenerated is a report that quietly goes stale — this is the command that
 * regenerates it (`bash scripts/e2e.sh test --project=mobile e2e/transcript.spec.ts`).
 */
import { test } from '@playwright/test';
import { reseed, SEED } from './helpers';

const REEL = SEED.post(3);

async function dumpThread(page: import('@playwright/test').Page, label: string) {
  const rows = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('[data-testid="thread"] > *')) {
      const id = el.getAttribute('data-testid');
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (id === 'turn-user') out.push(`CLIENT ▸ ${text}`);
      else if (id === 'interpretation') out.push(`SPRIGLY ▸ [${el.getAttribute('data-status')}] ${text}`);
      else if (id === 'turn-agent') out.push(`SPRIGLY ▸ ${text}`);
    }
    return out;
  });
  console.log(`\n===== ${label} =====\n${rows.join('\n')}\n`);
}

test('TRANSCRIPT: the Emma loop through the conversation sheet', async ({ page }) => {
  reseed();
  await page.goto('/');
  await page.getByTestId('plan-shell').waitFor();

  await page.getByTestId('nav-mic').click();
  await page.getByTestId('voice-sheet').waitFor();
  await page.getByTestId('turn-agent').first().waitFor();
  await dumpThread(page, '1 · the sheet opens a session — the agent speaks first');

  await page.getByTestId('voice-input').fill(`move the reel ${REEL} later and make it a carousel`);
  await page.getByTestId('voice-submit').click();
  await page.getByTestId('interpretation').waitFor();
  await dumpThread(page, '2 · her correction, and what we understood');

  await page.getByTestId('interp-apply').click();
  await page.getByTestId('turn-agent').filter({ hasText: 'Done' }).first().waitFor({ timeout: 15_000 });
  await dumpThread(page, '3 · applied in the thread, confirmed as a turn');

  await page.getByTestId('voice-input').fill('remember the candle relaunch is coming');
  await page.getByTestId('voice-submit').click();
  await page.getByTestId('interp-idea').waitFor();
  await dumpThread(page, '4 · the conversation continues');

  await page.getByTestId('voice-close').click();
  // X5b: no chip, no panel. What the surface shows is the MARK on the card that changed, so
  // that is what the transcript records — and the absence is recorded too, because a deleted
  // surface with nothing watching it can come back by accident.
  const chips = await page.getByTestId('summary-chip').count();
  const marked = await page.locator('[data-testid="post-card"][data-changed="true"]').count();
  console.log(`\n===== 5 · the plan surface, behind the sheet =====\nchip ▸ ${chips === 0 ? '(none — deleted)' : '(!! still rendering)'}\nmarked cards ▸ ${marked}`);

  await page.reload();
  await page.getByTestId('plan-shell').waitFor();
  // The changed-surface is the calendar's own dots now — the header row is gone by ruling —
  // so the transcript records the DAYS that came back marked.
  await page.getByTestId('nav-month').click();
  const markedDays = await page.locator('[data-testid="grid-cell"]:has([data-testid="grid-changed"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-date') ?? ''));
  console.log(`changed days ▸ ${markedDays.join(', ') || '(none)'}\n`);
  await page.getByTestId('nav-day').click();

  await page.getByTestId('nav-mic').click();
  await page.getByTestId('turn-agent').first().waitFor();
  await dumpThread(page, '6 · reopened — a new session, on a clean sheet');
});
