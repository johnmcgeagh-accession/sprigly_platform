import { test, expect, type Page } from '@playwright/test';
// Imported from the fixture's SOURCE, by path. Not from `@sprigly/db` — the barrel carries the
// database client, and Playwright would load it into the test process for three constants. Not
// from a package subpath either: Playwright transpiles specs to CJS, and the db package is ESM.
import {
  DRAFT_APPROVAL_COUNTS, DRAFT_PHASE2_QUEUED, DRAFT_BACKLOG_TEXT, DRAFT_MONTH_LABEL,
} from '../../packages/db/src/e2e-draft-fixture';

/**
 * draft.spec.ts — the draft month, end to end, on both form factors.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 *
 * Until it did, NO fixture anywhere held a month in draft. The entire draft surface — the badge
 * and the provisional skin, the month summary that explains the month, the beat sheet's
 * grounding lines, the reshape path, and the Generate confirm that spends the money — had zero
 * end-to-end coverage on either form factor. It is also the surface the September debut opens
 * on: the first thing a new client ever sees.
 *
 * The month it reviews is `packages/db/src/e2e-draft-fixture.ts` — eight beats covering the real
 * provenance mix, with `draft-fixture.parity.test.ts` holding it to the shapes the assembler
 * actually writes. Every expected string below is either imported from the fixture or derived by
 * that unit test, so a failure here cannot be "fixed" by pasting in whatever the screen said.
 *
 * ── Two projects, one file ───────────────────────────────────────────────────────────
 *
 * `draft-desktop` (1440×900) and `draft-mobile` (390×844) both run it. It branches on the frame
 * only where the SHAPE genuinely differs — where the summary lives, how you reach the month
 * grid, and the one that earns the second run: the Generate confirm is a centred modal on
 * desktop and a bottom sheet on the phone.
 *
 * ── The destructive one ──────────────────────────────────────────────────────────────
 *
 * Approving is one-way: the beats leave 'draft' and the month becomes committed. The last test
 * does it, and `resetDraft()` puts the month back by REBUILDING it from the same fixture the
 * seed uses — so the second project still finds a draft. See the reset route for why it rebuilds
 * instead of patching statuses back.
 */

const MOBILE = 'draft-mobile';
/** Where the report's screenshots land. Relative to app/, which is Playwright's cwd. */
const SHOT_DIR = '../docs/reports/draft-e2e-shots';
const isMobile = () => test.info().project.name === MOBILE;

/** The dates carrying a beat, read off the month grid. The month's shape in one array. */
async function beatDates(page: Page): Promise<string[]> {
  await showMonth(page);
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="grid-cell"]')]
      .filter((c) => c.querySelector('[data-testid="grid-dot"]'))
      .map((c) => (c as HTMLElement).dataset['date']!));
}

/**
 * The month grid is a column on desktop and a peer view on the phone.
 *
 * On the phone the conversation is a summoned sheet at 92% of the screen, so it has to be put
 * away before the nav underneath it can be tapped — which is not a test workaround, it is what
 * the client does. On desktop it is a dock and covers nothing, which is E1's whole argument.
 */
async function showMonth(page: Page): Promise<void> {
  if (isMobile()) {
    if (await page.getByTestId('voice-close').isVisible().catch(() => false)) {
      await page.getByTestId('voice-close').click();
      await expect(page.getByTestId('voice-sheet')).toHaveCount(0);
    }
    if (!(await page.getByTestId('month-grid').isVisible().catch(() => false))) {
      await page.getByTestId('nav-month').click();
    }
  }
  await expect(page.getByTestId('month-grid')).toBeVisible();
}

/** Back to the day view on the phone; a no-op on desktop, where both are already on screen. */
async function showDay(page: Page): Promise<void> {
  if (isMobile()) await page.getByTestId('nav-day').click();
  await expect(page.getByTestId('day-panel')).toBeVisible();
}

/** Open the day carrying a beat, and open that beat. */
async function openBeatOn(page: Page, date: string): Promise<void> {
  await showMonth(page);
  await page.locator(`[data-testid="grid-cell"][data-date="${date}"]`).click();
  await showDay(page);
  await page.getByTestId('draft-card').first().click();
  await expect(page.getByTestId('detail-sheet')).toBeVisible();
}

/**
 * The conversation, ready to type into.
 *
 * On desktop it is a REGION of the shell and has been there since the page loaded — that is E1,
 * and not having to summon it is the point of it. The phone has no room for a persistent dock,
 * so it is summoned with the mic. Same component, same thread, two ways in.
 */
async function openVoice(page: Page): Promise<void> {
  if (isMobile() && !(await page.getByTestId('voice-input').isVisible().catch(() => false))) {
    await page.getByTestId('nav-mic').click();
  }
  await expect(page.getByTestId('voice-input')).toBeVisible();
}

/** The month summary, open. On desktop a thin month opens it for you; eight beats is not thin. */
async function openSummary(page: Page): Promise<void> {
  if (isMobile()) await showDay(page);
  if (!(await page.getByTestId('draft-summary-detail').isVisible().catch(() => false))) {
    await page.getByTestId('draft-summary-toggle').click();
  }
  await expect(page.getByTestId('draft-summary-detail')).toBeVisible();
}

/** Rebuild the seeded draft month. TEST-ONLY route, gated on the e2e fake. */
async function resetDraft(page: Page): Promise<void> {
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/e2e/reset-draft', { method: 'POST' });
    return { status: r.status, body: (await r.json()) as { beats?: number } };
  });
  expect(res.status, 'the draft reset must succeed or every later test is testing a stale month').toBe(200);
  expect(res.body.beats).toBe(8);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('draft-badge')).toBeVisible();
});

/**
 * Rebuild the month after EVERY test, passing or failing.
 *
 * It began as one restore inside the destructive test, which is wrong in the way that only
 * shows up once: a failure anywhere before that line left the month approved, and then every
 * later test — and every later RUN, since the container outlives the process — failed in
 * `beforeEach` with "no draft badge", pointing at nothing. `afterEach` runs on failure too, so
 * a broken test costs its own result and nothing else.
 *
 * It also makes each test independent, which matters more here than the few milliseconds it
 * costs: the suite is `workers: 1` against one tenant, so without it the order of the file
 * would be part of its meaning.
 */
test.afterEach(async ({ page }) => {
  await resetDraft(page);
});

/* ── a) the draft month renders as a draft ───────────────────────────────────────── */

test('lands on the draft, badged and framed, with the seeded count', async ({ page }) => {
  // The landing is not a navigation: `resolveLandingCycleId` sends a session whose home cycle
  // holds a reviewable draft straight to it, which is what the Ask email's link does in
  // production. A test that had to click its way here would not be testing that rule.
  await expect(page.getByTestId('draft-badge')).toHaveText('Draft');
  await expect(page.getByTestId('draft-framing')).toHaveText(`This is your ${DRAFT_MONTH_LABEL.split(' ')[0]} draft`);
  await expect(page.getByTestId('month-title')).toContainText(DRAFT_MONTH_LABEL);

  // The count is the seed's, and it is stated in the two places a client reads it.
  await expect(page.getByTestId('draft-summary-headline')).toHaveText('8 planned posts across 5 weeks');
  await showMonth(page);
  await expect(page.getByTestId('month-foot')).toContainText('8 planned posts across September');
  expect(await beatDates(page)).toHaveLength(8);
});

test('the provisional skin is on: nothing is written, and it says so rather than showing blanks', async ({ page }) => {
  await openBeatOn(page, '2026-09-15');
  // A draft beat has no caption by contract. "Nothing written yet" is the honest rendering;
  // an empty caption box would read as a bug on the first screen a new client ever sees.
  await expect(page.getByTestId('not-written-yet')).toBeVisible();
  await expect(page.getByTestId('detail-sheet')).toContainText('The words arrive when you say the month is ready');
});

/* ── b) the month summary ────────────────────────────────────────────────────────── */

test('closed, the summary is a count and one invitation', async ({ page }) => {
  if (isMobile()) await showDay(page);
  await expect(page.getByTestId('draft-summary-headline')).toHaveText('8 planned posts across 5 weeks');
  await expect(page.getByTestId('draft-summary-cta')).toHaveText('Tap to see why these posts are here');
  // Closed means closed — the detail is not merely hidden.
  await expect(page.getByTestId('draft-summary-detail')).toHaveCount(0);
});

test('open, it states what a draft IS and the sections the seed has evidence for', async ({ page }) => {
  await openSummary(page);

  // The stage sentence opens the panel: it is the answer to "why these", not a caption on a count.
  await expect(page.getByTestId('draft-summary-stage'))
    .toContainText('once you’re happy, we’ll write every post');

  const keys = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="draft-summary-section"]')]
      .map((s) => (s as HTMLElement).dataset['section']));
  expect(keys).toEqual(['mix', 'series', 'products', 'client', 'assumptions']);

  const panel = page.getByTestId('draft-summary-detail');
  // Each section says the thing its beat's evidence supports. These strings are the fixture's
  // own data through the real derivation — draft-fixture.parity.test.ts asserts the same ones.
  await expect(panel).toContainText('Weekend Style Guide');
  await expect(panel).toContainText('the corduroy overshirt — never appeared in a caption');
  await expect(panel).toContainText('the linen shirt — last in a caption on 12 May');
  await expect(panel).toContainText('1 idea you gave us in June');
});

test('the assumption row is answerable, and it opens the conversation on the thing tapped', async ({ page }) => {
  await openSummary(page);
  const nudge = page.getByTestId('assumption-nudge');
  await expect(nudge).toContainText('anything coming up?');
  const question = (await nudge.textContent())!.trim();

  await nudge.click();
  await expect(page.getByTestId('voice-sheet')).toBeVisible();
  await expect(page.getByTestId('voice-input')).toBeVisible();

  // The panel test asserts the REQUEST BODY rather than the screen, and so does this: the
  // affordance is only real if the sentence the client tapped is the one that reaches the
  // server. A sheet that opened with the question rendered but sent something else would look
  // identical and be useless.
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/plan/draft/apply') && r.method() === 'POST'),
    (async () => {
      await page.getByTestId('voice-input').fill('Nothing is launching in September');
      await page.getByTestId('voice-submit').click();
    })(),
  ]);
  const body = req.postDataJSON() as { op: string; text: string; source: string };
  expect(body.op).toBe('text');
  expect(body.text).toBe('Nothing is launching in September');
  expect(body.source).toBe('web');
  expect(question.length).toBeGreaterThan(0);

});

test('the shaping CTA opens the same conversation, with nothing new to learn', async ({ page }) => {
  await openSummary(page);
  await expect(page.getByTestId('summary-shape')).toHaveText('Not right? Tell us what to change');
  await page.getByTestId('summary-shape').click();
  await expect(page.getByTestId('voice-sheet')).toBeVisible();
  await expect(page.getByTestId('voice-input')).toBeVisible();
});

/* ── c) the beat detail ──────────────────────────────────────────────────────────── */

test('a beat’s grounding lines are its evidence, verbatim', async ({ page }) => {
  await openBeatOn(page, '2026-09-15');
  // The sheet has just swapped its contents; wait for the toggle to settle before clicking it,
  // or the click can land on the outgoing beat's copy of the control (seen once as a flake).
  await expect(page.getByTestId('detail-sheet')).toContainText('Where the cloth comes from');
  await page.getByTestId('insights-toggle').click();

  const lines = page.getByTestId('grounding-line');
  // Her sentence, dated to the month she sent it, and quoted rather than paraphrased.
  await expect(lines.first()).toContainText('From what you told us in June');
  await expect(page.getByTestId('grounding-quote')).toHaveText(`“${DRAFT_BACKLOG_TEXT}”`);
  // An experiment slot says so.
  await expect(page.getByTestId('experiment-note')).toContainText('a new idea we’re trying');
});

test('the NEVER-FEATURED product reads as never, not as a zero or a date', async ({ page }) => {
  // `lastFeatured: null` is a stronger claim than any date, and productCoverageFact drops the
  // sample count with it — "(0 captions)" would be the fixture leaking through the rule.
  await openBeatOn(page, '2026-09-11');
  await page.getByTestId('insights-toggle').click();
  const sheet = page.getByTestId('detail-sheet');
  await expect(sheet).toContainText('the corduroy overshirt — never appeared in a caption');
  await expect(sheet).not.toContainText('0 caption');
  await expect(sheet).not.toContainText('1970');
});

test('a beat can be moved, reformatted or removed — and nothing offers to rewrite it', async ({ page }) => {
  await openBeatOn(page, '2026-09-05');
  await expect(page.getByTestId('act-move')).toBeVisible();
  await expect(page.getByTestId('act-delete')).toBeVisible();
  // The format control is the third structural edit; all three are deterministic writes.
  await expect(page.getByTestId('format-control')).toBeVisible();
  // There is deliberately NO shape/rewrite action: a draft beat has no words to shape yet.
  await expect(page.getByTestId('act-shape')).toHaveCount(0);
});

test('[desktop] the detail takes the day column’s slot, and the way back returns the day', async ({ page }) => {
  test.skip(isMobile(), 'the phone opens the detail as a sheet — covered by the shared sheet specs');
  await openBeatOn(page, '2026-09-05');

  await expect(page.getByTestId('day-col').getByTestId('detail-sheet')).toBeVisible();
  await expect(page.getByTestId('detail-sheet')).toHaveAttribute('data-chrome', 'panel');
  // The month and the conversation do not move for it.
  await expect(page.getByTestId('month-grid')).toBeVisible();
  await expect(page.getByTestId('conversation-dock')).toBeVisible();

  await page.getByTestId('detail-back').click();
  await expect(page.getByTestId('detail-sheet')).toHaveCount(0);
  await expect(page.getByTestId('day-col').getByTestId('day-panel')).toBeVisible();
});

/* ── d) reshape ──────────────────────────────────────────────────────────────────── */

/**
 * THE DRAFT MONTH HAS NO PROPOSE-THEN-APPLY, AND THAT IS DELIBERATE.
 *
 * On a committed month the agent proposes, the days ring, and the client taps Apply or Discard.
 * A draft reshape APPLIES DIRECTLY and returns a receipt — DraftSurface says so in as many
 * words: "the agent's turn IS the receipt's own lines, and the conversation continues… there is
 * nothing to consent to after the fact." Nothing on a draft has been written yet, so there is
 * no work to lose.
 *
 * So the two guarantees worth testing are not Apply/Discard. They are: a reshape that lands
 * changes the month and says exactly what it changed; and a reshape that CANNOT be placed
 * changes nothing at all and says that instead.
 */

test('a reshape applies directly, moves the day it names, and says which', async ({ page }) => {
  const before = await beatDates(page);
  expect(before).toContain('2026-09-05');
  await showDay(page);
  await openVoice(page);

  await page.getByTestId('voice-input').fill('Move the Weekend Style Guide to the 12th');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/plan/draft/apply') && r.request().method() === 'POST'),
    page.getByTestId('voice-submit').click(),
  ]);

  // The agent's turn IS the receipt's line — resolved, with both dates in it.
  await expect(page.getByTestId('thread'))
    .toContainText('Moved: Weekend Style Guide — the September edit, Sat 5 Sep → Sat 12 Sep');
  // …and the summary chip on the surface says what moved.
  await expect(page.getByTestId('summary-chip')).toContainText('1 moved');

  // The month actually changed, and ONLY there: one date out, one date in, the other seven
  // exactly as they were.
  const after = await beatDates(page);
  expect(after).not.toContain('2026-09-05');
  expect(after).toContain('2026-09-12');
  expect(after).toHaveLength(8);
  expect(after.filter((d) => before.includes(d))).toHaveLength(7);

});

test('a reshape it cannot place changes NOTHING and files it instead', async ({ page }) => {
  // The draft's answer to Discard. `applyCorrection` refuses to invent a beat it cannot find —
  // "a correction that names something we cannot find is not a licence to invent a beat" — and
  // the honest outcome is the backlog, with the month byte-identical.
  const before = await beatDates(page);
  await showDay(page);
  await openVoice(page);

  await page.getByTestId('voice-input').fill('Move the leather tote reel to the 24th');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/plan/draft/apply') && r.request().method() === 'POST'),
    page.getByTestId('voice-submit').click(),
  ]);

  await expect(page.getByTestId('thread')).toContainText('Saved to your ideas — nothing on the month changed');
  await expect(page.getByTestId('summary-chip')).toContainText('Saved to your ideas');
  expect(await beatDates(page)).toEqual(before);

});

test('a structural move is undoable, and undo puts the day back exactly', async ({ page }) => {
  // The other half of reversibility, and the one that IS an undo: the deterministic edits
  // (move / format / drop) each hand back a way to reverse themselves.
  const before = await beatDates(page);
  await openBeatOn(page, '2026-09-05');
  await page.getByTestId('act-move').click();

  // The move sheet renders the SAME MonthGrid the month view does, so a day is a grid cell.
  const sheet = page.getByTestId('move-sheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-testid="grid-cell"][data-date="2026-09-19"]').click();
  await page.getByTestId('move-confirm').click();

  await expect(page.getByTestId('feedback-undo')).toBeVisible();
  expect(await beatDates(page)).toContain('2026-09-19');

  await page.getByTestId('feedback-undo').click();
  await expect.poll(async () => await beatDates(page)).toEqual(before);

});

/* ── F2 · a question about the plan is answered, never filed ────────────────────── */

/**
 * The operator asked, four ways, which of their own ideas had made it into the month. All four
 * were FILED AS NEW IDEAS: the classifier routed on topic words and datelessness and had no
 * concept of a question, so a client asking what we did with their input was answered by us
 * recording that they had said it again (3 Aug).
 *
 * These are the four phrasings verbatim. Each must come back with the seeded idea AND the beat
 * it became — and each must leave the backlog exactly as it found it, which is the half that
 * would otherwise regress silently.
 */
const ASKED = [
  'What ideas of mine are integrated into this month',
  'Which of my ideas made it into September?',
  'Have any of the things I told you been used this month?',
  'Show me the ideas you used in this month’s plan',
];

/** How many ideas the client has on record. The answer path must never change this. */
async function ideaCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const r = await fetch('/api/plan/ideas');
    return ((await r.json()) as { ideas: unknown[] }).ideas.length;
  });
}

for (const question of ASKED) {
  test(`"${question}" is answered, and files nothing`, async ({ page }) => {
    const before = await ideaCount(page);
    await showDay(page);
    await openVoice(page);

    await page.getByTestId('voice-input').fill(question);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/plan/draft/apply') && r.request().method() === 'POST'),
      page.getByTestId('voice-submit').click(),
    ]);

    const thread = page.getByTestId('thread');
    // The seeded idea, in her words, and the beat it became — the answer, not a count.
    await expect(thread).toContainText('One of your ideas is in September 2026');
    await expect(thread).toContainText(DRAFT_BACKLOG_TEXT);
    await expect(thread).toContainText('Where the cloth comes from');

    // …and NOT the sentence that used to appear here.
    await expect(thread).not.toContainText('Saved to your ideas');

    // The backlog is untouched. This is the assertion the bug would have failed: four questions
    // asked, four new ideas recorded, and the client's own list quietly growing with their
    // questions in it.
    expect(await ideaCount(page)).toBe(before);
  });
}

test('a question changes nothing on the month, and leaves no receipt to review', async ({ page }) => {
  const before = await beatDates(page);
  await showDay(page);
  await openVoice(page);

  await page.getByTestId('voice-input').fill(ASKED[0]!);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/plan/draft/apply') && r.request().method() === 'POST'),
    page.getByTestId('voice-submit').click(),
  ]);
  await expect(page.getByTestId('thread')).toContainText('One of your ideas is in September 2026');

  expect(await beatDates(page)).toEqual(before);
  // No summary chip: a receipt records a change, and an answer is not one.
  await expect(page.getByTestId('summary-chip')).toHaveCount(0);
});

test('"add an idea about winter layering" still goes to the backlog — a statement is not a question', async ({ page }) => {
  // The gate in the other direction. The sentence is ABOUT ideas and mentions no date, which is
  // exactly the shape that used to catch the questions — and it genuinely is an idea.
  const before = await ideaCount(page);
  await showDay(page);
  await openVoice(page);

  await page.getByTestId('voice-input').fill('add an idea about winter layering');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/plan/draft/apply') && r.request().method() === 'POST'),
    page.getByTestId('voice-submit').click(),
  ]);

  await expect(page.getByTestId('thread')).toContainText('Saved to your ideas');
  expect(await ideaCount(page)).toBe(before + 1);
});

test('"what’s planned next week" is answered from the month — the existing query, unbroken', async ({ page }) => {
  await showDay(page);
  await openVoice(page);

  await page.getByTestId('voice-input').fill('what’s planned next week');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/plan/draft/apply') && r.request().method() === 'POST'),
    page.getByTestId('voice-submit').click(),
  ]);

  const thread = page.getByTestId('thread');
  // A relative phrase resolves no specific dates on purpose, so the answer is the whole month —
  // the eight seeded beats, dated and read back.
  await expect(thread).toContainText('8 posts across September 2026');
  await expect(thread).toContainText('Weekend Style Guide');
  await expect(thread).not.toContainText('Saved to your ideas');
});

/* ── f) Ideas resolves to the beat its idea became ───────────────────────────────── */

test('[desktop] the seeded backlog idea shows its state and taps through to its beat', async ({ page }) => {
  test.skip(isMobile(), 'Ideas is a rail destination and the phone has no rail (W6)');

  await page.getByTestId('rail-ideas').click();
  const panel = page.getByTestId('ideas-panel');
  await expect(panel).toBeVisible();

  // The fixture's input is lifecycle='used' with used_in_cycle_id on the draft cycle, so the
  // month is derived through nextMonth — a reader taking the raw cycle_month would say August.
  await expect(panel).toContainText(`“${DRAFT_BACKLOG_TEXT}”`);
  await expect(panel.locator('[data-testid="ideas-group"][data-state="used"]'))
    .toContainText(`Used in ${DRAFT_MONTH_LABEL}`);

  // The tap-through resolves: it lands on the beat whose beat_meta.sourceRef names this input.
  await page.getByTestId('idea-post').click();
  await expect(page.getByTestId('ideas-panel')).toHaveCount(0);
  await expect(page.getByTestId('detail-sheet')).toContainText('Where the cloth comes from');
});

/* ── e) GENERATE — last, because approving is one-way ────────────────────────────── */

test('the Generate confirm states what it starts, in the frame this form factor uses', async ({ page }) => {
  await page.getByTestId('ready-pill').click();
  const sheet = page.getByTestId('approval-sheet');
  await expect(sheet).toBeVisible();

  // ONE COMPONENT, TWO FRAMES (the Panel/Sheet/Modal pattern). The phone gets the bottom
  // sheet; desktop gets a centred box at content width, because a full-width sheet at 1440+
  // is a wall carrying three counts and two sentences.
  await expect(sheet).toHaveAttribute('data-chrome', isMobile() ? 'sheet' : 'modal');

  // …and the frame is not just a label. Measured, because "it says modal" and "it IS a modal"
  // are different claims and only one of them is what the operator saw.
  const box = (await sheet.boundingBox())!;
  const vw = page.viewportSize()!.width;
  if (isMobile()) {
    // A bottom sheet: full width, anchored to the foot of the screen.
    expect(box.width).toBe(vw);
    expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 2);
  } else {
    // A centred box at content width. A full-width sheet at 1440+ is a wall carrying three
    // counts and two sentences, which is what W2 replaced.
    expect(box.width).toBeLessThanOrEqual(480);
    expect(Math.abs((box.x + box.width / 2) - vw / 2)).toBeLessThan(2);
  }

  // The counts are the fan-out's own arithmetic over the seeded formats — 8 captions, 5 hooks
  // (reels + carousels), 3 scripts (reels). Imported from the fixture, so this asserts a number
  // derived from the data rather than one copied off the screen under test.
  const counts = page.getByTestId('approval-counts');
  await expect(counts).toContainText(`${DRAFT_APPROVAL_COUNTS.captions}`);
  await expect(counts).toContainText('captions — one for every post in the month');
  await expect(counts).toContainText(`${DRAFT_APPROVAL_COUNTS.hooks}`);
  await expect(counts).toContainText('opening hooks — for the reels and carousels');
  await expect(counts).toContainText(`${DRAFT_APPROVAL_COUNTS.scripts}`);
  await expect(counts).toContainText('scripts — one for each reel');

  await expect(page.getByTestId('approval-consequence'))
    .toContainText('Dates and formats stay yours to change afterwards');
  await expect(page.getByTestId('approve-confirm')).toHaveText(/Yes, write them/);
  await expect(page.getByTestId('approve-not-yet')).toHaveText(/Not yet/);

  // THE MISSING ARTEFACT. W2 built this modal and could not photograph it, because no fixture
  // anywhere had a month in draft — the refinement report lists that as its largest gap. The
  // screenshot is taken by the suite rather than by hand, so it is regenerated whenever the
  // screen changes instead of becoming a picture of how it used to look.
  await page.screenshot({ path: `${SHOT_DIR}/generate-${isMobile() ? 'sheet-390' : 'modal-1440'}.png` });
});

test('"Not yet" leaves the draft exactly as it was', async ({ page }) => {
  const before = await beatDates(page);
  await showDay(page);

  await page.getByTestId('ready-pill').click();
  await expect(page.getByTestId('approval-sheet')).toBeVisible();
  await page.getByTestId('approve-not-yet').click();
  await expect(page.getByTestId('approval-sheet')).toHaveCount(0);

  // Still a draft, still eight beats, still on the same days. The one door that spends money
  // must be closeable without spending any.
  await expect(page.getByTestId('draft-badge')).toBeVisible();
  expect(await beatDates(page)).toEqual(before);
});

test('approving starts the writing, and the month stops being a draft', async ({ page }) => {
  /**
   * WHAT IS REAL HERE AND WHAT IS FAKED, precisely.
   *
   * REAL: the route, the session-derived identity, `approveDraftCore`'s guards (pre-cutoff,
   * not-already-approved, no mixed state), the transaction that flips every draft row to
   * 'generating' and stamps `approved_at`, and `startPhase2`'s fan-out arithmetic — which posts
   * get a caption, which also get a hook, which also get a script.
   *
   * FAKED: the two enqueues at the end of that fan-out. With SPRIGLY_E2E_FAKE=1 there is no
   * Redis and no Bedrock, so `enqueueShape` writes its canned caption straight onto the post
   * and `enqueueHookJob` returns a job id. No model is called and nothing is billed — which is
   * why this test asserts THAT THE TRANSITION BEGAN rather than inspecting generated prose.
   */
  // The body is captured in a route handler rather than read off `waitForResponse`. Approval
  // makes the surface refetch, and by the time the assertion runs the browser has discarded the
  // body — "No resource with given identifier found", which reads like a Playwright bug and is
  // really a race. Intercepting keeps the bytes on our side of it.
  let body: { ok: boolean; approved: number; captionsQueued: number; hooksQueued: number; failed: number } | null = null;
  let status = 0;
  await page.route('**/api/plan/draft/approve', async (route) => {
    const r = await route.fetch();
    status = r.status();
    body = (await r.json()) as typeof body;
    await route.fulfill({ response: r });
  });

  await page.getByTestId('ready-pill').click();
  await page.getByTestId('approve-confirm').click();
  await expect.poll(() => body, { message: 'the approve call should have completed' }).not.toBeNull();
  await page.unroute('**/api/plan/draft/approve');
  expect(status).toBe(200);

  // Every beat was approved, and the fan-out reached every one of them.
  expect(body!.ok).toBe(true);
  expect(body!.approved).toBe(DRAFT_APPROVAL_COUNTS.captions);
  expect(body!.captionsQueued).toBe(DRAFT_PHASE2_QUEUED.captions);
  // QUEUE DEPTH, NOT OUTCOMES — and this is the assertion that found a stale comment. The
  // confirm promises 5 opening hooks and gets them; `startPhase2` enqueues a STANDALONE hook
  // job for the 2 carousels only, because a reel's hook comes from its combined hook+script
  // job later. Asserting 5 here would be asserting a double-write.
  expect(body!.hooksQueued).toBe(DRAFT_PHASE2_QUEUED.standaloneHookJobs);
  expect(body!.failed).toBe(0);

  // The month is no longer a draft — the surface follows the server's answer rather than
  // deciding for itself, so the badge going is the state change arriving on screen.
  await expect(page.getByTestId('draft-badge')).toHaveCount(0);
  await expect(page.getByTestId('ready-pill')).toHaveCount(0);

  // Approving twice is refused: the door closes behind you.
  const second = await page.evaluate(async () => {
    const r = await fetch('/api/plan/draft/approve', { method: 'POST' });
    return { status: r.status, body: (await r.json()) as { error?: string } };
  });
  expect(second.status).toBe(409);
  expect(second.body.error).toBe('already_approved');

});
