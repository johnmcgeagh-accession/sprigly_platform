import { describe, it, expect } from 'vitest';
import { parsePlanResponse } from './parse-plan.js';

// A single stray control char (e.g. BEL 0x07) inside a string value — built via
// fromCharCode so no literal control char appears in this source file.
const ctrl = (s: string) => s.replace('<C>', String.fromCharCode(7));

describe('parsePlanResponse — tolerant generation-output parsing', () => {
  it('parses clean { "posts": [...] }', () => {
    const rows = parsePlanResponse('{"posts":[{"title":"WSG","category":"WSG"}]}');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('WSG');
  });

  it('parses a top-level array', () => {
    expect(parsePlanResponse('[{"title":"a"},{"title":"b"}]')).toHaveLength(2);
  });

  it('strips a ```json fence', () => {
    expect(parsePlanResponse('```json\n{"posts":[{"title":"x"}]}\n```')).toHaveLength(1);
  });

  it('slices JSON out of surrounding prose', () => {
    expect(parsePlanResponse('Here is the plan: {"posts":[{"title":"x"}]} — done')).toHaveLength(1);
  });

  // ── the repair cases (the live failure) ──
  it('REPAIRS a trailing comma before } / ]', () => {
    expect(parsePlanResponse('{"posts":[{"title":"x"},]}')).toHaveLength(1);
    expect(parsePlanResponse('{"posts":[{"title":"x","category":"WSG",}]}')).toHaveLength(1);
  });

  it('REPAIRS a stray control character inside a string value', () => {
    // JSON.parse rejects a raw control char in a string; the repair strips it.
    const rows = parsePlanResponse(ctrl('{"posts":[{"title":"Sun<C>day"}]}'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Sunday');
  });

  // ── genuine failures STILL throw (so the cycle fails loudly / re-asks) ──
  it('throws on genuinely unparseable output (so the caller re-asks)', () => {
    expect(() => parsePlanResponse('not json at all {{{')).toThrow();
  });

  it('throws when valid JSON has no posts array', () => {
    expect(() => parsePlanResponse('{"foo":1}')).toThrow(/posts/i);
  });
});
