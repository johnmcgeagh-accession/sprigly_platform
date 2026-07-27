/**
 * brief-framing.test.ts — the decompose-path framing is added ONLY on the brief path.
 *
 * A span read in isolation loses the frame the whole brief gave it: "On the 14th the stock
 * leaves the factory" reads as a fact, not a post request; "launch" is matching vocabulary, not
 * always a product launching. classifyIntake({context:'brief_segment'}) tells the model the
 * frame the split removed. The direct single-sentence path never sets context, so its prompt is
 * byte-identical to before — asserted here against the exact string.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyIntake, CLASSIFY_SYSTEM, BRIEF_SEGMENT_FRAMING } from './intake-classify.js';
import type { ModelClient } from './types.js';

/** A model that captures the last call and returns a valid (evergreen) classification. */
function capturingModel() {
  const calls: Array<{ system: string; content: string }> = [];
  const model = {
    complete: vi.fn(async (p: { system: string; messages: Array<{ content: string }> }) => {
      calls.push({ system: p.system, content: p.messages[0]!.content });
      return { content: '{"scope":"evergreen"}', modelId: 'stub', inputTokens: 0, outputTokens: 0 };
    }),
  } as unknown as ModelClient;
  return { model, calls };
}

const TEXT = 'the navy edit build-up post on the 25th'; // not a typed row → reaches the model
const MONTH = '2026-08';

describe('the decompose-path framing', () => {
  it('is ABSENT on the direct path — the user message is byte-identical to before', async () => {
    const { model, calls } = capturingModel();
    await classifyIntake({ text: TEXT, planMonth: MONTH, model });
    const expected = [
      `PLAN MONTH: ${MONTH} (resolve any relative date against this month)`,
      '',
      'OWNER’S MESSAGE:',
      TEXT,
      '',
      'Route it now. JSON only.',
    ].join('\n');
    expect(calls[0]!.content).toBe(expected);
    expect(calls[0]!.content).not.toContain('CONTEXT: this is ONE item');
    expect(calls[0]!.system).toBe(CLASSIFY_SYSTEM);   // system prompt unchanged
  });

  it('is PRESENT on the brief path, ahead of the message', async () => {
    const { model, calls } = capturingModel();
    await classifyIntake({ text: TEXT, planMonth: MONTH, model, context: 'brief_segment' });
    expect(calls[0]!.content).toContain(BRIEF_SEGMENT_FRAMING);
    expect(calls[0]!.content.startsWith(BRIEF_SEGMENT_FRAMING)).toBe(true);
    // the launch-vs-event guidance and the request framing are both in it
    expect(calls[0]!.content).toContain('LAUNCH vs EVENT');
    expect(calls[0]!.content).toContain('REQUEST FOR CONTENT');
    // and the message itself still follows
    expect(calls[0]!.content).toContain('OWNER’S MESSAGE:');
    expect(calls[0]!.content).toContain(TEXT);
    expect(calls[0]!.system).toBe(CLASSIFY_SYSTEM);   // system prompt still unchanged
  });

  it('the framing does not leak into CLASSIFY_SYSTEM (the shared system prompt)', () => {
    expect(CLASSIFY_SYSTEM).not.toContain('CONTEXT: this is ONE item');
    expect(CLASSIFY_SYSTEM).not.toContain('LAUNCH vs EVENT');
  });
});
