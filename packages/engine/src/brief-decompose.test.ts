/**
 * brief-decompose.test.ts — the detector, the coverage contract, and the application order.
 *
 * The decomposer's ONE model call is not exercised here (that is the classify-check harness and
 * the acceptance fixture); these pin the pure pieces around it: what counts as a document, what
 * a valid split must satisfy, and the order intents apply in.
 */
import { describe, it, expect } from 'vitest';
import { isDocumentShaped, validateDecomposition, parseDecomposition, orderIndices, tierOf } from './brief.js';
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
    const kinds = order.map((i) => (routings[i]!.scope === 'month_scoped' ? routings[i]!.intent.kind : 'evergreen'));
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

// ── The parser: the shape that reached production ───────────────────────────────
//
// VERBATIM UAT BYTES. This is the exact response the decomposer got on 2026-08-07 12:15:39
// for ivy-t's September brief, reassembled from the two halves the bedrock client logged
// (contentHead / contentTail). The length assertion below pins it against the logged
// contentLength=1867 — if a future edit disturbs a single character, that test fails.
//
// The model split the brief coarsely, said so, and then split it correctly. parseDecomposition
// took the whole string to JSON.parse, threw at position 843, and a six-item client brief fell
// to couldnt_apply with the CORRECT answer sitting unread in the second half.

const UAT_COARSE = String.raw`{"parts":[{"text":"So I want to lean into Back to School.","keep":true},{"text":" - On the first or maybe second of September, there's also London Fashion Week.","keep":true},{"text":" It'd be great to feature between the 18th and 22nd of September, so a post or two around that would be great.\n- Towards the end of September, around the 23rd or so, it'd be good to talk about the transition into autumn and thinking about jumpers and that type of thing.\n- Something to include would be a launch. We're launching on the 15th of September a knitwear drop, so post something around there.\n- We are also doing a restock of two of our best sellers, Maggie and Hannah, which will be around the 29th of September.\n- We have a waitlist open for the October launch of a product which we're yet to name, so it's a bit of a teaser.","keep":true}]}`;

const UAT_INTERJECTION = '\n\nWait, I need to re-examine this more carefully and split each instruction separately.\n\n';

const UAT_CORRECTED = String.raw`{"parts":[{"text":"So I want to lean into Back to School.","keep":true},{"text":" - On the first or maybe second of September, there's also London Fashion Week.","keep":true},{"text":" It'd be great to feature between the 18th and 22nd of September, so a post or two around that would be great.","keep":true},{"text":"\n- Towards the end of September, around the 23rd or so, it'd be good to talk about the transition into autumn and thinking about jumpers and that type of thing.","keep":true},{"text":"\n- Something to include would be a launch. We're launching on the 15th of September a knitwear drop, so post something around there.","keep":true},{"text":"\n- We are also doing a restock of two of our best sellers, Maggie and Hannah, which will be around the 29th of September.","keep":true},{"text":"\n- We have a waitlist open for the October launch of a product which we're yet to name, so it's a bit of a teaser.","keep":true}]}`;

/** The response as it arrived, byte for byte. */
const UAT_RAW = UAT_COARSE + UAT_INTERJECTION + UAT_CORRECTED;

/** The client's message as stored in agent_messages — what the spans must tile exactly. */
const UAT_SOURCE = "So I want to lean into Back to School. - On the first or maybe second of September, there's also London Fashion Week. It'd be great to feature between the 18th and 22nd of September, so a post or two around that would be great.\n- Towards the end of September, around the 23rd or so, it'd be good to talk about the transition into autumn and thinking about jumpers and that type of thing.\n- Something to include would be a launch. We're launching on the 15th of September a knitwear drop, so post something around there.\n- We are also doing a restock of two of our best sellers, Maggie and Hannah, which will be around the 29th of September.\n- We have a waitlist open for the October launch of a product which we're yet to name, so it's a bit of a teaser.";

describe('parseDecomposition — a self-correction supersedes what it corrects', () => {
  it('the verbatim UAT response is the real double-emission shape', () => {
    expect(UAT_RAW).toHaveLength(1867);          // the logged contentLength
    expect(UAT_RAW.startsWith('{')).toBe(true);  // why the old salvage branch never ran
    expect(() => JSON.parse(UAT_RAW)).toThrow(); // and why the old parse threw
  });

  it('returns the CORRECTED object, not the coarse one it supersedes', () => {
    const parsed = parseDecomposition(UAT_RAW) as { parts: unknown[] };
    expect(parsed.parts).toHaveLength(7);        // the corrected split, not the 3-part one
  });

  it('and that object satisfies the coverage contract against the real brief', () => {
    const v = validateDecomposition(parseDecomposition(UAT_RAW), UAT_SOURCE);
    expect(v).not.toBeNull();
    expect(v!.segments).toHaveLength(7);
    expect(v!.discarded).toHaveLength(0);
    // the six things the client actually said, each now routable on its own
    expect(v!.segments[0]).toContain('Back to School');
    expect(v!.segments[1]).toContain('London Fashion Week');
    expect(v!.segments[4]).toContain('knitwear drop');
    expect(v!.segments[5]).toContain('Maggie and Hannah');
    expect(v!.segments[6]).toContain('October launch');
  });

  it('the three documented shapes are unchanged — widening cannot narrow', () => {
    const body = '{"parts":[{"text":"a","keep":true}]}';
    const expected = { parts: [{ text: 'a', keep: true }] };
    expect(parseDecomposition(body)).toEqual(expected);                              // bare
    expect(parseDecomposition('```json\n' + body + '\n```')).toEqual(expected);      // fenced
    expect(parseDecomposition('Sure! ' + body + ' Hope that helps.')).toEqual(expected); // prose
  });

  it('a TRUNCATED second object falls back to the last COMPLETE one, rather than throwing', () => {
    // maxTokens cutting mid-correction is a real shape — the same family as the emphasis-field
    // overrun in intake-classify.ts. A coarse answer beats a thrown one; the coverage contract
    // still decides whether it is good enough.
    const truncated = UAT_COARSE + UAT_INTERJECTION + UAT_CORRECTED.slice(0, 200);
    const parsed = parseDecomposition(truncated) as { parts: unknown[] };
    expect(parsed.parts).toHaveLength(3);
  });

  it('two FENCED blocks — the second door to the same bug — also take the last', () => {
    // The old fence regex was non-greedy, so it matched the FIRST block and handed back the
    // decomposition the model had just disowned.
    const first  = '{"parts":[{"text":"coarse","keep":true}]}';
    const second = '{"parts":[{"text":"correct","keep":true}]}';
    const out = parseDecomposition('```json\n' + first + '\n```\nOn reflection:\n```json\n' + second + '\n```');
    expect(out).toEqual({ parts: [{ text: 'correct', keep: true }] });
  });

  it('a brace the CLIENT typed does not break the scan', () => {
    // parts[].text is a verbatim span of the client's own message and validateDecomposition
    // requires byte-exactness, so a brace cannot be sanitised out of it. A scanner blind to
    // string literals would anchor mid-span here and slice garbage.
    const source = 'Use the {brand} template for the 3rd.';
    const body = JSON.stringify({ parts: [{ text: source, keep: true }] });
    expect(parseDecomposition(body)).toEqual({ parts: [{ text: source, keep: true }] });
    expect(validateDecomposition(parseDecomposition(body), source)!.segments).toEqual([source]);
  });

  it('still throws when there is no JSON at all (the caller falls back)', () => {
    expect(() => parseDecomposition('no json here at all')).toThrow();
  });
});
