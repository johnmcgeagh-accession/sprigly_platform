/**
 * brief-decompose.test.ts — the detector, the coverage contract, and the application order.
 *
 * The decomposer's ONE model call is not exercised here (that is the classify-check harness and
 * the acceptance fixture); these pin the pure pieces around it: what counts as a document, what
 * a valid split must satisfy, and the order intents apply in.
 */
import { describe, it, expect } from 'vitest';
import { isDocumentShaped, validateDecomposition, orderIndices, tierOf } from './brief.js';
import type { IntakeRouting } from './intake-classify.js';

// ── The detector ────────────────────────────────────────────────────────────────

describe('isDocumentShaped', () => {
  it('a single instruction is NOT a document (bypasses the decomposer)', () => {
    expect(isDocumentShaped('the Navy Edit launches on 28th August at 7pm')).toBe(false);
    expect(isDocumentShaped('move the Friday reel to Saturday')).toBe(false);
    expect(isDocumentShaped('we want 7 posts a week')).toBe(false);
    expect(isDocumentShaped('add a reel on the 22nd called What I am most proud of')).toBe(false);
  });

  it('2+ line breaks → a document', () => {
    expect(isDocumentShaped('the navy edit drops on the 28th\nalso a restock\nand more reels')).toBe(true);
  });

  it('240+ characters → a document', () => {
    expect(isDocumentShaped('x'.repeat(240))).toBe(true);
    expect(isDocumentShaped('x'.repeat(239))).toBe(false);
  });

  it('4+ date signals → a document (a schedule, not a sentence)', () => {
    expect(isDocumentShaped('7th, 14th, 21st and 28th August')).toBe(true);   // 4 ordinals + Aug
  });

  it('empty is not a document', () => {
    expect(isDocumentShaped('   ')).toBe(false);
  });
});

// ── The coverage contract ─────────────────────────────────────────────────────────

describe('validateDecomposition — verbatim, ordered, gap-only', () => {
  const SRC = 'Hi Sprigly! The Navy Edit launches on the 28th. Also post daily. Thanks so much';

  it('accepts a clean split: verbatim spans, whitespace-only gaps, full coverage', () => {
    const parsed = { parts: [
      { text: 'Hi Sprigly!', keep: false },
      { text: 'The Navy Edit launches on the 28th.', keep: true },
      { text: 'Also post daily.', keep: true },
      { text: 'Thanks so much', keep: false },
    ] };
    const d = validateDecomposition(parsed, SRC);
    expect(d).not.toBeNull();
    expect(d!.segments).toEqual(['The Navy Edit launches on the 28th.', 'Also post daily.']);
    expect(d!.discarded).toEqual(['Hi Sprigly!', 'Thanks so much']);
  });

  it('rejects a paraphrased (non-verbatim) span', () => {
    const parsed = { parts: [{ text: 'The Navy Edit drops on the 28th.', keep: true }] };  // "drops" ≠ "launches"
    expect(validateDecomposition(parsed, SRC)).toBeNull();
  });

  it('rejects out-of-order spans (would overlap or skip)', () => {
    const parsed = { parts: [
      { text: 'Also post daily.', keep: true },
      { text: 'The Navy Edit launches on the 28th.', keep: true },
    ] };
    expect(validateDecomposition(parsed, SRC)).toBeNull();
  });

  it('rejects a NON-whitespace gap (uncovered instruction text)', () => {
    // skips "Also post daily." entirely — that text is neither kept nor discarded
    const parsed = { parts: [
      { text: 'Hi Sprigly!', keep: false },
      { text: 'The Navy Edit launches on the 28th.', keep: true },
      { text: 'Thanks so much', keep: false },
    ] };
    expect(validateDecomposition(parsed, SRC)).toBeNull();
  });

  it('rejects when nothing is kept', () => {
    const parsed = { parts: [{ text: SRC, keep: false }] };
    expect(validateDecomposition(parsed, SRC)).toBeNull();
  });

  it('tolerates the model dropping inter-part whitespace', () => {
    // no explicit whitespace parts — the gaps between sentences are whitespace-only, allowed
    const parsed = { parts: [
      { text: 'The Navy Edit launches on the 28th.', keep: true },
      { text: 'Also post daily.', keep: true },
    ] };
    const d = validateDecomposition({ parts: parsed.parts }, 'The Navy Edit launches on the 28th. Also post daily.');
    expect(d!.segments).toHaveLength(2);
  });
});

// ── The application order ───────────────────────────────────────────────────────

describe('orderIndices — launch → series → event/beat_spec → correction → emphasis → cadence, evergreen last', () => {
  const ms = (kind: string): IntakeRouting =>
    ({ scope: 'month_scoped', sourceText: kind, intent: { kind, subject: kind, sourceText: kind } as never });
  const eg: IntakeRouting = { scope: 'evergreen', sourceText: 'idea', reason: 'classified_evergreen' };

  it('sorts by tier, document order as the stable tiebreak', () => {
    const routings = [ms('cadence'), eg, ms('correction'), ms('launch'), ms('event'), ms('series'), ms('emphasis'), ms('beat_spec')];
    const order = orderIndices(routings);
    const kinds = order.map((i) => (routings[i]!.scope === 'evergreen' ? 'evergreen' : routings[i]!.intent.kind));
    expect(kinds).toEqual(['launch', 'series', 'event', 'beat_spec', 'correction', 'emphasis', 'cadence', 'evergreen']);
  });

  it('cadence is always last among month-scoped intents (top-up sees the finished month)', () => {
    const routings = [ms('cadence'), ms('event')];
    expect(orderIndices(routings)).toEqual([1, 0]);
  });

  it('event and beat_spec share a tier — original order preserved between them', () => {
    const routings = [ms('beat_spec'), ms('event')];
    expect(orderIndices(routings)).toEqual([0, 1]);   // stable, not reordered
  });

  it('tierOf places corrections after placement and evergreen at the end', () => {
    expect(tierOf(ms('launch'))).toBeLessThan(tierOf(ms('correction')));
    expect(tierOf(ms('correction'))).toBeLessThan(tierOf(ms('cadence')));
    expect(tierOf(eg)).toBeGreaterThan(tierOf(ms('cadence')));
  });
});
