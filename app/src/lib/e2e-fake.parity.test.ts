/**
 * e2e-fake.parity.test.ts — the fake cannot drift from the contract it stands in for.
 *
 * ── The disease this is treating ─────────────────────────────────────────────────────
 *
 * This project has been bitten twice by a fake that had quietly stopped matching the real
 * thing, and both times the symptom appeared somewhere else entirely:
 *
 *   · Prompt caching split the parser's user message into `MessagePart[]`. The fake still did
 *     `.map(m => m.content).join()`, got `[object Object]`, and answered "Which post did you
 *     mean?" to everything. Four conversation specs failed for a reason that had nothing to
 *     do with conversations.
 *   · The faked script job wrote a script and no hook. A reel's hook and script are ONE act
 *     (C4) — so the combined path could not be observed end to end, and three standing e2e
 *     failures were that and nothing else.
 *
 * Both were invisible because nothing ever compared the fake's OUTPUT SHAPE to the real
 * consumer's expectations. A Playwright failure tells you a button did not work; it does not
 * tell you the fake emitted a field under a stale name.
 *
 * ── What this file asserts ───────────────────────────────────────────────────────────
 *
 * Every branch of `fakeClassification` is run through the REAL pair the production path uses
 * on a Bedrock response — `parseClassification` then `routeFromParsed` — and the routing that
 * comes out is asserted. Those two functions carry the whole contract: the zod schema, the
 * "a correction that names nothing cannot be matched" guard, the "unsure lands on evergreen"
 * rule. If the schema gains a required field, or a kind is renamed, or a guard tightens, this
 * file fails HERE, in a unit test that names the fake — not in a Playwright timeout.
 *
 * It deliberately does NOT assert the fake's wording. What the fake says is a fixture's
 * business; what SHAPE it says it in is a contract.
 */
import { describe, it, expect, vi } from 'vitest';

// The engine barrel re-exports `@sprigly/db`, whose client parses DATABASE_URL at import.
// This test needs the engine's PURE functions and no database at all.
vi.mock('@sprigly/db', () => ({ db: {}, sql: {} }));

import { CLASSIFY_SYSTEM, parseClassification, routeFromParsed, type IntakeRouting } from '@sprigly/engine';
import { fakeClassification, E2E_CLASSIFY_MARKER, E2E_PAIR_HOOK, E2E_SCRIPT_TEXT } from './e2e-fake';

/** The prompt the classifier actually builds (intake-classify.ts), so the fake is parsing the
 *  same string in this test as it does in a run. Reproduced from the real construction. */
function classifyPrompt(message: string, planMonth = '2026-09'): string {
  return [
    `PLAN MONTH: ${planMonth} (resolve any relative date against this month)`,
    '',
    'OWNER’S MESSAGE:',
    message,
    '',
    'Route it now. JSON only.',
  ].join('\n');
}

/** Exactly what the route does with a model response: the fake's JSON, through the real
 *  parser and the real validator. Nothing in between. */
function routeIt(message: string, planMonth?: string): IntakeRouting {
  const raw = JSON.stringify(fakeClassification(classifyPrompt(message, planMonth)));
  return routeFromParsed(parseClassification(raw), message);
}

describe('the fake still recognises the prompt it is standing in for', () => {
  it('the marker it matches on is a real substring of CLASSIFY_SYSTEM', () => {
    // `e2e-fake.ts` cannot import the prompt itself without dragging the engine barrel — and
    // `@sprigly/db` with it — into the Next.js runtime, so it holds a copy. This is what makes
    // the copy safe: reword the prompt's opening line and this fails by name, instead of every
    // draft e2e failing by timeout because the classify branch stopped being reached and the
    // fake answered with the task parser's JSON.
    expect(CLASSIFY_SYSTEM).toContain(E2E_CLASSIFY_MARKER);
  });
});

describe('the fake classifier survives the real validator', () => {
  it('a move lands as a month-scoped CORRECTION carrying its new date', () => {
    const r = routeIt('Move the Weekend Style Guide to the 24th');
    expect(r.scope).toBe('month_scoped');
    if (r.scope !== 'month_scoped') return;
    expect(r.intent.kind).toBe('correction');
    // The date is resolved against the PLAN MONTH it was given, not against today — which is
    // the one instruction in the prompt a fake is most likely to quietly ignore.
    expect(r.intent.dateRange).toEqual({ start: '2026-09-24', end: '2026-09-24' });
    // `correctionOf` is THE THING BEING CORRECTED, not the sentence. `applyCorrection` resolves
    // it against the beats' own subjects, so a fake that passes the whole instruction here
    // never matches anything and the e2e silently tests the not-found path instead.
    expect(r.intent.correctionOf).toBe('Weekend Style Guide');
  });

  it('resolves the day against whatever plan month it is handed', () => {
    const r = routeIt('Move the launch to the 3rd', '2026-11');
    expect(r.scope === 'month_scoped' && r.intent.dateRange?.start).toBe('2026-11-03');
  });

  it('a posting target lands as CADENCE with the figure extracted', () => {
    const r = routeIt('We want 4 posts a week');
    expect(r.scope).toBe('month_scoped');
    if (r.scope !== 'month_scoped') return;
    expect(r.intent.kind).toBe('cadence');
    expect(r.intent.postsPerWeek).toBe(4);
    // Cadence carries no date and no title — asserting the ABSENCE, because a fake that
    // invents a dateRange here would apply a change nobody asked for.
    expect(r.intent.dateRange).toBeNull();
  });

  it('a shift of emphasis lands as EMPHASIS with the phrase carried', () => {
    const r = routeIt('More product and less founder this month');
    expect(r.scope).toBe('month_scoped');
    if (r.scope !== 'month_scoped') return;
    expect(r.intent.kind).toBe('emphasis');
    expect(r.intent.emphasis).toBeTruthy();
  });

  it('anything it does not recognise lands on EVERGREEN, never on a guess', () => {
    // The real classifier's own rule: "If you are not sure, choose EVERGREEN. Being filed as
    // an idea is easy to undo; changing a month the owner was happy with is not."
    const r = routeIt('The weather has been glorious lately');
    expect(r.scope).toBe('evergreen');
  });

  it('carries the owner’s message VERBATIM into sourceText', () => {
    const msg = 'Move the Weekend Style Guide to the 24th';
    const r = routeIt(msg);
    expect(r.sourceText).toBe(msg);
  });

  it('every branch produces something the validator accepts — no silent evergreens', () => {
    // A fake whose month-scoped JSON fails the schema does not throw: `routeFromParsed`
    // returns evergreen with reason 'validation_failed'. That is indistinguishable on a
    // screen from "we filed your idea", which is how a broken fake hides. Assert the reason.
    for (const msg of ['Move the Weekend Style Guide to the 24th', 'We want 4 posts a week', 'More product this month']) {
      const r = routeIt(msg);
      expect(r.scope, msg).toBe('month_scoped');
    }
  });
});

describe('the faked generation writes the field-set the real job writes', () => {
  it('a script arrives WITH its hook, and the script opens on it', () => {
    // The C4 rule, pinned: a reel's hook and script are one act, the script grounds on the
    // chosen hook verbatim, and the fake writing only the script is exactly the regression
    // that cost three standing e2e failures.
    expect(E2E_PAIR_HOOK).toBeTruthy();
    expect(E2E_SCRIPT_TEXT.startsWith(`HOOK: ${E2E_PAIR_HOOK}`)).toBe(true);
  });
});
