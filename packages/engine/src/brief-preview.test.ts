/**
 * brief-preview.test.ts — the live preview is TOLD which month it is previewing.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────────────
 *
 * Typing "a launch on the 25th" into the intake panel produced a follow-up asking whether the
 * 25th belonged to the OCTOBER launch named in a stored durable — on a panel whose own heading
 * reads "Let's plan September 2026 together".
 *
 * Two paths read a brief and only one of them was given the month. `extractStructuredBrief` has
 * always led its user message with `PLAN MONTH:` and resolves bare ordinals correctly; this pass
 * was given the text and the durables and nothing else, so a bare "25th" was genuinely ambiguous
 * to it and it reached for the months it could see — the ones written into the durables.
 *
 * Measured, Haiku, 3 runs per phrasing, the client's real durables:
 *   WITHOUT a month  "Is the 25th launch the same as the October product on the waitlist?"
 *   WITH a month     "Is the 25th launch the ali product, or something different?"   (what, not when)
 *   out-of-month     "The 3rd of October is next month — a note for October, or a September beat?"
 *
 * The model's wording is not assertable, so these tests assert what it is GIVEN — the one thing
 * that made the difference and the one thing this file controls.
 */
import { describe, it, expect } from 'vitest';
import { previewBrief, PREVIEW_MIN_CHARS } from './brief-preview.js';
import type { ModelClient } from './types.js';

/** Captures the user message and returns a valid empty preview. */
function spyModel() {
  const seen: string[] = [];
  const model: ModelClient = {
    complete: async (p) => {
      seen.push(p.messages[0]?.content ?? '');
      return {
        content: JSON.stringify({ campaigns: [], themes: [], products: [], dates: [], availability: [], ideas: [], followUp: null }),
        modelId: 'haiku', inputTokens: 1, outputTokens: 1,
      } as Awaited<ReturnType<ModelClient['complete']>>;
    },
  };
  return { model, seen };
}

const TEXT = 'a launch on the 25th and a sale the last weekend';

describe('previewBrief — the plan month reaches the model', () => {
  it('leads the user message with the plan month, as the commit-time extraction does', async () => {
    const { model, seen } = spyModel();
    await previewBrief({ text: TEXT, planMonth: 'September 2026', model });
    expect(seen[0]!.startsWith('PLAN MONTH: September 2026')).toBe(true);
  });

  it('puts the month ABOVE the durables, so a month named in a memory cannot read as the subject', async () => {
    const { model, seen } = spyModel();
    await previewBrief({
      text: TEXT, planMonth: 'September 2026', model,
      durables: [{ content: 'waitlist open for the October launch', month: 'August' }],
    });
    const msg = seen[0]!;
    expect(msg.indexOf('PLAN MONTH')).toBeLessThan(msg.indexOf('DURABLES'));
    expect(msg.indexOf('DURABLES')).toBeLessThan(msg.indexOf('BRIEF SO FAR'));
  });

  it('omits the line entirely when no month could be resolved, rather than inventing one', async () => {
    // A stale or foreign cycle id yields no month on the route. Degrading to the previous
    // behaviour is right; guessing a month and telling the model it is settled is not.
    const { model, seen } = spyModel();
    await previewBrief({ text: TEXT, model });
    expect(seen[0]).not.toContain('PLAN MONTH');
    expect(seen[0]!.startsWith('BRIEF SO FAR')).toBe(true);
  });

  it('spends no model call at all below the minimum length', async () => {
    // "the 25th" is 8 characters — under PREVIEW_MIN_CHARS, so the reported phrase on its own
    // never reaches the model. The question only appears once it sits in a longer brief.
    const { model, seen } = spyModel();
    expect('the 25th'.length).toBeLessThan(PREVIEW_MIN_CHARS);
    const p = await previewBrief({ text: 'the 25th', planMonth: 'September 2026', model });
    expect(seen).toHaveLength(0);
    expect(p.followUp).toBeNull();
  });
});

describe('previewBrief — the instructions that settle a bare date', () => {
  // The system prompt is the other half of the fix, and a silent edit to it would put the bug
  // straight back. These pin the two rules that do the work.
  const systemOf = async () => {
    const seen: string[] = [];
    const model: ModelClient = {
      complete: async (p) => {
        seen.push(p.system ?? '');
        return { content: '{}', modelId: 'haiku', inputTokens: 1, outputTokens: 1 } as Awaited<ReturnType<ModelClient['complete']>>;
      },
    };
    await previewBrief({ text: TEXT, planMonth: 'September 2026', model });
    return seen[0]!;
  };

  it('forbids asking which month a bare day belongs to', async () => {
    expect(await systemOf()).toContain('never ask which month it is');
  });

  it('still allows the one timing question worth asking — a date in a DIFFERENT month', async () => {
    expect(await systemOf()).toContain('DIFFERENT month from the plan month');
  });
});
