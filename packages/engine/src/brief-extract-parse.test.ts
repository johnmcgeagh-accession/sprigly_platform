/**
 * brief-extract-parse.test.ts — parseBriefResponse, the fourth copy of the salvage.
 *
 * `parseBriefResponse` was the only one of the four tolerant parsers with NO tests of any kind,
 * and it carried the same `if (!raw.startsWith('{'))` blind spot that dropped a correct
 * decomposition on the floor in UAT (the verbatim bytes are pinned in brief-decompose.test.ts).
 *
 * It is also the only one with a repair pass, so these pin BOTH: that the last complete object
 * wins, and that repair still runs — per candidate, newest-first, rather than once on a span
 * that might cover two objects.
 */
import { describe, it, expect } from 'vitest';
import { parseBriefResponse } from './brief-extract.js';

describe('parseBriefResponse', () => {
  it('parses bare, fenced and prose-wrapped JSON alike', () => {
    const body = '{"beats":[{"date":"2026-09-15"}]}';
    const expected = { beats: [{ date: '2026-09-15' }] };
    expect(parseBriefResponse(body)).toEqual(expected);
    expect(parseBriefResponse('```json\n' + body + '\n```')).toEqual(expected);
    expect(parseBriefResponse('Sure! ' + body + ' Hope that helps.')).toEqual(expected);
  });

  it('takes the LAST object when the model self-corrects', () => {
    const raw = '{"beats":[]}\n\nWait, I missed the launch.\n\n{"beats":[{"date":"2026-09-15"}]}';
    expect(() => JSON.parse(raw)).toThrow();                  // what the old parser did
    expect(parseBriefResponse(raw)).toEqual({ beats: [{ date: '2026-09-15' }] });
  });

  it('still repairs a trailing comma — and repairs the CORRECTED object, not the superseded one', () => {
    const raw = '{"beats":[]}\n\nOn reflection:\n\n{"beats":[{"date":"2026-09-15"},],}';
    expect(parseBriefResponse(raw)).toEqual({ beats: [{ date: '2026-09-15' }] });
  });

  it('still repairs stray control characters', () => {
    expect(parseBriefResponse('{"subject":"knitwear drop"}')).toEqual({ subject: 'knitwear drop' });
  });

  it('falls back to the last COMPLETE object when the correction is truncated', () => {
    const raw = '{"beats":[{"date":"2026-09-15"}]}\n\nActually:\n\n{"beats":[{"date":"2026-09-2';
    expect(parseBriefResponse(raw)).toEqual({ beats: [{ date: '2026-09-15' }] });
  });

  it('falls back to an earlier candidate when the last one survives neither parse nor repair', () => {
    const raw = '{"beats":[{"date":"2026-09-15"}]}\n\nOr:\n\n{"beats":[{{{]}';
    expect(parseBriefResponse(raw)).toEqual({ beats: [{ date: '2026-09-15' }] });
  });

  it('a brace inside a string does not split the scan', () => {
    const raw = '{"subject":"the {brand} template"}';
    expect(parseBriefResponse(raw)).toEqual({ subject: 'the {brand} template' });
  });

  it('throws when there is no JSON at all', () => {
    expect(() => parseBriefResponse('no json here at all')).toThrow();
  });
});
