/**
 * month-context.test.ts — the running free-text brief a draft month accumulates.
 *
 * ── Why this field and not another ───────────────────────────────────────────────────
 *
 * Every `client_input` transform writes the client's sentence to
 * `beat_meta.rationaleEvidence.reason`, and NOTHING downstream of the receipt reads it. The
 * caption generator's per-post brief is `captionInstruction(title, pillar)`; its only
 * cycle-level text is `intake_json.planContent.freeNotes`:
 *
 *   freeNotes → assembleShapeContext (planning.ts:471) → buildPlanningUserMessage
 *             → "FREE NOTES:\n…" (planning.ts:289) → ctx.userMessage
 *             → regeneratePost's fixMessage, its FIRST line (plan-validation.ts:358)
 *
 * read live per shape job, so a sentence written while the month is still a draft is read
 * when its captions are written. Ivy T's September had three live "Molly" beats carrying the
 * client's launch sentence in `beat_meta` and an EMPTY freeNotes — the sentence was stored
 * and unreachable at the same time.
 *
 * The merge rule is what this file pins. The wrapper around it is a read, a write and a
 * brief invalidation, and is covered live.
 */
import { describe, it, expect } from 'vitest';
import { mergeFreeNotes } from './draft-apply';

const A = 'One thing going on in September is the back to school element.';
const B = 'We are photoshooting a new range called Karen.';
const C = 'Lean the weekend posts on the school run.';

describe('mergeFreeNotes — the brief accumulates, it is never replaced', () => {
  it('takes the first sentence as the whole brief', () => {
    expect(mergeFreeNotes('', A)).toBe(A);
  });

  it('APPENDS the second rather than overwriting the first', () => {
    expect(mergeFreeNotes(A, B)).toBe(`${A}\n\n${B}`);
  });

  it('after three briefs, all three are present in the order they were said', () => {
    const after = mergeFreeNotes(mergeFreeNotes(mergeFreeNotes('', A), B), C);
    expect(after).toBe(`${A}\n\n${B}\n\n${C}`);
    expect(after.split('\n\n')).toEqual([A, B, C]);
  });

  it('uses the SAME separator the intake route’s mergeIntake uses', () => {
    // Two writers of one field that disagree about the separator is how a brief comes apart:
    // the intake route joins with a blank line, and so must this.
    expect(mergeFreeNotes(A, B)).toContain('\n\n');
    expect(mergeFreeNotes(A, B).split('\n\n')).toHaveLength(2);
  });

  it('preserves whatever was already there, including text this path did not write', () => {
    const fromTheAskEmail = 'Answers from the Ask email.\n\nMore answers.';
    expect(mergeFreeNotes(fromTheAskEmail, A)).toBe(`${fromTheAskEmail}\n\n${A}`);
  });
});

describe('mergeFreeNotes — idempotent on the exact sentence', () => {
  /**
   * The brief is repeated verbatim into EVERY caption prompt for the month, so a duplicate is
   * not untidy — it is emphasis nobody asked for. A double-tapped send, a retried request and
   * a client who says the same thing twice must all land once.
   */
  it('saying the same thing twice stores it once', () => {
    expect(mergeFreeNotes(A, A)).toBe(A);
  });

  it('…even when it is not the most recent paragraph', () => {
    const three = mergeFreeNotes(mergeFreeNotes(A, B), C);
    expect(mergeFreeNotes(three, A)).toBe(three);
    expect(mergeFreeNotes(three, B)).toBe(three);
  });

  it('matches on the trimmed sentence, so whitespace is not a new brief', () => {
    expect(mergeFreeNotes(A, `  ${A}\n`)).toBe(A);
    expect(mergeFreeNotes(`${A}\n\n${B}`, ` ${B} `)).toBe(`${A}\n\n${B}`);
  });

  it('a sentence that merely CONTAINS an earlier one is still new', () => {
    // Dedupe is exact, not fuzzy. "…back to school element." and "…back to school element,
    // and the Karen range." are different asks and both belong in the brief.
    const longer = `${A} And the Karen range.`;
    expect(mergeFreeNotes(A, longer)).toBe(`${A}\n\n${longer}`);
  });
});

describe('mergeFreeNotes — nothing in, nothing changed', () => {
  it('an empty addition leaves the brief exactly as it was', () => {
    expect(mergeFreeNotes(A, '')).toBe(A);
    expect(mergeFreeNotes(A, '   \n ')).toBe(A);
  });

  it('empty both ways is empty, not whitespace', () => {
    expect(mergeFreeNotes('', '')).toBe('');
    expect(mergeFreeNotes('  ', ' ')).toBe('');
  });

  it('trims a brief that arrived with padding rather than growing it', () => {
    expect(mergeFreeNotes(`\n${A}\n`, '')).toBe(A);
  });
});
