/**
 * brief-quote-salvage.test.ts — a straight double quote in the client's own words.
 *
 * The bytes below are the shape the model actually returned for a real fifteen-item brief
 * (UAT, reproduced read-only): a correct split in which item 15 carries `"What I am most proud
 * of…."`, emitted unescaped because the prompt demands the client's characters untouched.
 *
 * The point of every case here is the VERBATIM guarantee. A recovered segment must be the
 * client's characters exactly, which is checked the way validateDecomposition checks it — by
 * asserting the span is a substring of the source, not by comparing it to a literal we typed.
 */
import { describe, it, expect } from 'vitest';
import { parseDecomposition, scanDecomposition, validateDecomposition } from './brief.js';

/** Round-trip a source through a model response and back, asserting verbatim coverage. */
function decompose(source: string, response: string) {
  const parsed = parseDecomposition(response);
  const out = validateDecomposition(parsed, source);
  return out;
}

/** The model's output for a part, with the text value written RAW (bare quotes and all). */
const part = (raw: string, keep = true) => `{"text":"${raw}","keep":${keep}}`;
const wrap = (...ps: string[]) => `{"parts":[${ps.join(',')}]}`;

describe('a straight double quote in the client’s text', () => {
  const source = 'Ideas to include -\n1) Hook: a customer sent me this\n2) Add a post in the "What I am most proud of…." series';
  // Exactly what the model emits: verbatim spans, so the quote arrives unescaped.
  const response = wrap(
    part('Ideas to include -\\n1) Hook: a customer sent me this'),
    part('\\n2) Add a post in the "What I am most proud of…." series'),
  );

  it('strict JSON.parse cannot read it — this is the live failure', () => {
    expect(() => JSON.parse(response)).toThrow();
  });

  it('is recovered, split correctly, and passes the coverage contract', () => {
    const out = decompose(source, response);
    expect(out).not.toBeNull();
    expect(out!.segments).toHaveLength(2);
  });

  it('the recovered segment is the client’s characters EXACTLY', () => {
    const out = decompose(source, response)!;
    // The verbatim guarantee, asserted the way the contract enforces it.
    for (const seg of out.segments) expect(source).toContain(seg);
    expect(out.segments[1]).toContain('"What I am most proud of…." series');
  });
});

describe('other JSON-hostile characters in a client’s brief', () => {
  const cases: Array<[string, string]> = [
    ['curly quotes and apostrophes', 'We don’t compete — “fast fashion” isn’t us'],
    ['an emoji (surrogate pair)',    'stand behind every one of them 💛'],
    ['a pound sign and an ellipsis', '£50 for a long sleeve t shirt….'],
    ['a straight double quote',      'the "What I am most proud of" series'],
    ['a JSON brace and bracket',     'use the {hero} shot [not the flatlay]'],
    ['a colon-quote-comma run',      'she said: "yes", then left'],
  ];

  it.each(cases)('round-trips %s verbatim', (_label, item) => {
    const source = `1) first item\n2) ${item}`;
    const response = wrap(part('1) first item'), part(`\\n2) ${item}`));
    const out = decompose(source, response);
    expect(out).not.toBeNull();
    expect(out!.segments).toHaveLength(2);
    expect(source).toContain(out!.segments[1]!);
    expect(out!.segments[1]).toBe(`2) ${item}`);
  });

  /** A BACKSLASH is the one hostile character the model must still escape, because an
   *  unescaped one is not a byte we can distinguish from an escape sequence. It arrives
   *  correctly escaped and decodes back to itself. */
  it('a backslash arrives escaped and decodes to itself', () => {
    const source = '1) use the 50\\50 split';
    const response = wrap(part('1) use the 50\\\\50 split'));
    const out = decompose(source, response)!;
    expect(out.segments[0]).toBe('1) use the 50\\50 split');
  });

  /** A newline INSIDE one item — the model escapes it as \n, which decodes normally. */
  it('a newline inside a single item is preserved', () => {
    const source = '1) first\n2) second line one\nstill item two';
    const response = wrap(part('1) first'), part('\\n2) second line one\\nstill item two'));
    const out = decompose(source, response)!;
    expect(out.segments[1]).toBe('2) second line one\nstill item two');
    expect(source).toContain(out.segments[1]!);
  });
});

describe('the scan never guesses', () => {
  it('valid JSON is parsed strictly and never reaches the scan', () => {
    const good = wrap(part('1) plain'), part('\\n2) also plain', false));
    expect(parseDecomposition(good)).toEqual({ parts: [
      { text: '1) plain', keep: true }, { text: '\n2) also plain', keep: false },
    ] });
  });

  it('self-correcting output still takes the LAST object — the earlier fix is intact', () => {
    const src = '1) a\n2) b';
    const first = wrap(part('1) a\\n2) b'));
    const second = wrap(part('1) a'), part('\\n2) b'));
    const out = decompose(src, `${first}\n\nWait, let me re-examine that.\n\n${second}`)!;
    expect(out.segments).toHaveLength(2);
  });

  it('returns null on output with no parts at all', () => {
    expect(scanDecomposition('I am not going to do that.')).toBeNull();
    expect(scanDecomposition('{"parts":[]}')).toBeNull();
  });

  it('returns null when a text value has no keep terminator', () => {
    expect(scanDecomposition('{"parts":[{"text":"dangling')).toBeNull();
  });

  it('rethrows the STRICT error when the scan cannot help', () => {
    // The caller logs this; it must be the real parse failure, not a scan artefact.
    expect(() => parseDecomposition('not json at all')).toThrow();
  });

  it('a recovered span that is NOT in the source is rejected by the contract', () => {
    // The safety net: a bad scan cannot invent text, because coverage still has to hold.
    const response = wrap(part('1) something the client never wrote'));
    expect(validateDecomposition(parseDecomposition(response), '1) what they did write')).toBeNull();
  });
});
