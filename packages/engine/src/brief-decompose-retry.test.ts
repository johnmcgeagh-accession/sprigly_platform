/**
 * brief-decompose-retry.test.ts — which failures earn a second call, and what the ledger says.
 *
 * A retry is a second call at full price. The production incident spent two of them on one
 * answer: 1073 in / 851 out, discarded, then the identical prompt over the identical text,
 * discarded again. Both rows looked exactly like a decomposition that had worked.
 */
import { describe, it, expect, vi } from 'vitest';
import { decomposeInput } from './brief.js';

const SOURCE = '1) first thing\n2) second thing';
const GOOD = JSON.stringify({ parts: [
  { text: '1) first thing', keep: true },
  { text: '\n2) second thing', keep: true },
] });
/** Readable, but the parts do not tile the source — a coverage failure. */
const UNCOVERED = JSON.stringify({ parts: [{ text: 'something else entirely', keep: true }] });
/** Not readable by JSON.parse and not by the shape-aware scan either. */
const UNPARSEABLE = 'I have decided not to answer that.';

function modelReturning(...responses: string[]) {
  const calls: number[] = [];
  const complete = vi.fn(async () => {
    calls.push(1);
    const body = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return { content: body, modelId: 'test-model', inputTokens: 1073, outputTokens: 851 };
  });
  return { model: { complete } as never, complete };
}

const auditor = () => {
  const rows: Array<Record<string, unknown>> = [];
  return { rows, logModelCall: vi.fn(async (r: Record<string, unknown>) => { rows.push(r); }) };
};

describe('which failures earn a retry', () => {
  it('an UNPARSEABLE response is not retried — one call, not two', async () => {
    const { model, complete } = modelReturning(UNPARSEABLE);
    const out = await decomposeInput({ text: SOURCE, model });
    expect(out).toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);        // the incident spent two here
  });

  it('an UNCOVERED response IS retried — a re-split can land differently', async () => {
    const { model, complete } = modelReturning(UNCOVERED);
    expect(await decomposeInput({ text: SOURCE, model })).toBeNull();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('a FAILED CALL is retried — it is about the moment, not the input', async () => {
    let n = 0;
    const complete = vi.fn(async () => {
      if (++n === 1) throw new Error('throttled');
      return { content: GOOD, modelId: 'm', inputTokens: 1, outputTokens: 1 };
    });
    const out = await decomposeInput({ text: SOURCE, model: { complete } as never });
    expect(out!.segments).toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('a retry that succeeds returns the second answer', async () => {
    const { model, complete } = modelReturning(UNCOVERED, GOOD);
    const out = await decomposeInput({ text: SOURCE, model });
    expect(out!.segments).toEqual(['1) first thing', '2) second thing']);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('a first-time success never makes a second call', async () => {
    const { model, complete } = modelReturning(GOOD);
    expect((await decomposeInput({ text: SOURCE, model }))!.segments).toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('the ledger records what the spend bought', () => {
  it('a delivered decomposition is logged with its outcome and segment count', async () => {
    const { model } = modelReturning(GOOD);
    const audit = auditor();
    await decomposeInput({ text: SOURCE, model, audit: audit as never, clientId: 'c1' });
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!['metadata']).toEqual({ attempt: 1, outcome: 'ok', segments: 2 });
  });

  it('a rejected attempt is STILL billed — the tokens were spent — but says so', async () => {
    const { model } = modelReturning(UNPARSEABLE);
    const audit = auditor();
    await decomposeInput({ text: SOURCE, model, audit: audit as never, clientId: 'c1' });
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!['inputTokens']).toBe(1073);          // the bill is real
    expect(audit.rows[0]!['metadata']).toEqual({ attempt: 1, outcome: 'unparseable' });
  });

  it('two attempts are two rows, numbered, so a retry is legible in the ledger', async () => {
    const { model } = modelReturning(UNCOVERED);
    const audit = auditor();
    await decomposeInput({ text: SOURCE, model, audit: audit as never, clientId: 'c1' });
    expect(audit.rows.map((r) => (r['metadata'] as Record<string, unknown>)['attempt'])).toEqual([1, 2]);
    expect(audit.rows.every((r) => (r['metadata'] as Record<string, unknown>)['outcome'] === 'uncovered')).toBe(true);
  });

  it('a call that never came back is not billed — there is nothing to bill', async () => {
    const complete = vi.fn(async () => { throw new Error('timeout'); });
    const audit = auditor();
    await decomposeInput({ text: SOURCE, model: { complete } as never, audit: audit as never, clientId: 'c1' });
    expect(audit.rows).toHaveLength(0);
  });

  it('an auditor that throws never changes the outcome', async () => {
    const { model } = modelReturning(GOOD);
    const bad = { logModelCall: vi.fn(async () => { throw new Error('ledger down'); }) };
    const out = await decomposeInput({ text: SOURCE, model, audit: bad as never, clientId: 'c1' });
    expect(out!.segments).toHaveLength(2);
  });
});
