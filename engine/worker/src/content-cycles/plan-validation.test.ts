import { describe, it, expect } from 'vitest';
import {
  codeGateCheck, selectHistoricExamples, parseCriticVerdict, normaliseDashes, resolveRegister,
  type PlanPostRow, type CodeGateVocab, type HistoricPost, type RegisterMap,
} from './plan-validation.js';

const VOCAB: CodeGateVocab = {
  categories: ['Styling', 'Brand', 'Product launch or offer related', 'No Post/Sally'],
  pillars:    ['Stable Foundations', 'Ethical Without Compromise', 'Personal Relationships'],
};

const base: PlanPostRow = {
  date: '14 May', day: 'Thu', title: 'Test', category: 'Styling',
  pillar: 'Stable Foundations', format: 'Reel', postingTime: '7am', whoPosts: 'Sprigly',
  competitorInsight: 'No competitor data this cycle. Rationale.',
  draftCaption: 'A clean, finished caption with no problems. She layers under everything you own.',
  notes: 'Shoot flat.',
};
const codes = (p: PlanPostRow) => codeGateCheck(p, VOCAB).map((i) => i.code).sort();

describe('resolveRegister — authoritative per-category register lookup', () => {
  // IVY-t's Option 2 map: only register-homogeneous categories mapped; no default.
  const MAP: RegisterMap = {
    WSG: 'I', 'Sunday Style': 'we', Educational: 'we', Testimonials: 'we',
    Styling: 'we', 'Product launch or offer related': 'we', POV: 'I',
  };
  const at = (category: string) => resolveRegister({ ...base, category }, MAP);

  it('resolves the three previously-oscillating categories to a stable register', () => {
    expect(at('Sunday Style')).toEqual({ register: 'we', category: 'Sunday Style' }); // #4
    expect(at('Educational')).toEqual({ register: 'we', category: 'Educational' });   // #7
    expect(at('Testimonials')).toEqual({ register: 'we', category: 'Testimonials' }); // #24
  });

  it('maps WSG and POV to founder "I"', () => {
    expect(at('WSG')?.register).toBe('I');
    expect(at('POV')?.register).toBe('I');
  });

  it('returns null for unmapped categories so the critic falls back to historic (no regression)', () => {
    // "Brand" is register-mixed and deliberately left unmapped → historic inference.
    expect(at('Brand')).toBeNull();
    expect(at('No Post/Sally')).toBeNull();
    expect(at('Regular feature')).toBeNull();
  });

  it('is defensive against missing/empty/invalid maps and categories', () => {
    expect(resolveRegister({ ...base, category: 'WSG' }, {})).toBeNull();
    expect(resolveRegister({ ...base, category: 'WSG' }, null)).toBeNull();
    expect(resolveRegister({ ...base, category: '' }, MAP)).toBeNull();
    expect(resolveRegister({ ...base, category: 'WSG' }, { WSG: 'sideways' } as RegisterMap)).toBeNull();
  });
});

describe('codeGateCheck — universal mechanical gate', () => {
  it('passes a clean valid post', () => {
    expect(codeGateCheck(base, VOCAB)).toEqual([]);
  });

  // ── instruction-leak ──
  it('flags uppercase template placeholders [ITEM], [X], [X/X]', () => {
    expect(codes({ ...base, draftCaption: 'Meet [ITEM], back in stock.' })).toContain('instruction-leak');
    expect(codes({ ...base, draftCaption: 'Wear her [X] ways.' })).toContain('instruction-leak');
    expect(codes({ ...base, draftCaption: 'Size [X/X] available.' })).toContain('instruction-leak');
  });

  it('flags lowercase fill-in placeholders [colour], [date], [name]', () => {
    expect(codes({ ...base, draftCaption: 'Now in [colour].' })).toContain('instruction-leak');
    expect(codes({ ...base, draftCaption: 'Launching [date].' })).toContain('instruction-leak');
  });

  it('flags meta-instruction text', () => {
    expect(codes({ ...base, draftCaption: 'Leave blank — Sally writes this.' })).toContain('instruction-leak');
    expect(codes({ ...base, draftCaption: 'Caption to follow, see notes.' })).toContain('instruction-leak');
  });

  it('does NOT flag legitimate bracketed outfit-credit prose', () => {
    // The exact IVY-t voice.md outfit-credit format — must not false-positive.
    const credit = 'A lovely everyday tee.\n[ I am wearing our organic cotton Mabel in size 12, I am a 12/14 and 5ft8 ]';
    expect(codeGateCheck({ ...base, draftCaption: credit }, VOCAB)).toEqual([]);
  });

  it('does NOT flag brackets with emoji or plain numbers', () => {
    expect(codeGateCheck({ ...base, draftCaption: 'Swatch [🤍] and sizes 12 to 14.' }, VOCAB)).toEqual([]);
  });

  // ── em-dash ──
  it('flags em and en dashes', () => {
    expect(codes({ ...base, draftCaption: 'Soft cotton — built to last.' })).toContain('em-dash');
    expect(codes({ ...base, draftCaption: 'Soft cotton – built to last.' })).toContain('em-dash');
  });

  it('does NOT flag a normal hyphen', () => {
    expect(codeGateCheck({ ...base, draftCaption: 'A size 12-14 friendly fit.' }, VOCAB)).toEqual([]);
  });

  // ── empty (with the legitimately-blank exception) ──
  it('flags an empty / whitespace-only caption that is NOT client-writes-own', () => {
    expect(codes({ ...base, draftCaption: '' })).toContain('empty-caption');
    expect(codes({ ...base, draftCaption: '   \n  ' })).toContain('empty-caption');
  });

  it('does NOT flag a legitimately-blank post (clientWritesOwn=true)', () => {
    // e.g. a voice.md-designated "Sally writes this herself, no Sprigly brief" post.
    expect(codeGateCheck({ ...base, draftCaption: '', clientWritesOwn: true }, VOCAB)).toEqual([]);
    expect(codeGateCheck({ ...base, draftCaption: '   ', clientWritesOwn: true }, VOCAB)).toEqual([]);
  });

  it('still flags a blank caption when clientWritesOwn is false or absent', () => {
    expect(codes({ ...base, draftCaption: '', clientWritesOwn: false })).toContain('empty-caption');
    expect(codes({ ...base, draftCaption: '' })).toContain('empty-caption'); // flag absent
  });

  // ── category / pillar (config-read) ──
  it('flags a category not in THIS client config', () => {
    expect(codes({ ...base, category: 'Community' })).toContain('invalid-category');
  });

  it('flags a pillar not in THIS client config', () => {
    expect(codes({ ...base, pillar: 'Made-up Pillar' })).toContain('invalid-pillar');
  });

  it('accepts valid category and pillar from config', () => {
    expect(codeGateCheck({ ...base, category: 'Brand', pillar: 'Ethical Without Compromise' }, VOCAB)).toEqual([]);
  });

  it('skips category/pillar checks when config vocab is empty (graceful degradation)', () => {
    const empty: CodeGateVocab = { categories: [], pillars: [] };
    expect(codeGateCheck({ ...base, category: 'Anything', pillar: 'Whatever' }, empty)).toEqual([]);
  });

  it('reports multiple independent issues at once', () => {
    expect(codes({ ...base, draftCaption: 'Now in [colour] — coming soon.', category: 'Nope' }))
      .toEqual(['em-dash', 'instruction-leak', 'invalid-category']);
  });
});

describe('selectHistoricExamples — same-pillar preference (client-agnostic)', () => {
  const planConfig = {
    categories: [],
    pillars: [
      { name: 'Ethical Without Compromise', tagline: 'Sustainable doesn\'t mean settling',
        keyMessages: ['GOTS-certified organic cotton', 'Portuguese factory partnership'],
        contentIdeas: ['factory stories', 'sustainability facts', 'organic cotton'] },
      { name: 'Simplify Your Morning', tagline: 'one less decision',
        keyMessages: ['effortless coordination'], contentIdeas: ['capsule wardrobe', 'morning routine'] },
    ] as Array<Record<string, unknown>>,
  };
  const historic: HistoricPost[] = [
    { caption: 'Our organic cotton is GOTS certified and made in our Portuguese factory.', engagement: 30 },
    { caption: 'Three ways to build a capsule wardrobe for an easy morning routine.', engagement: 200 },
    { caption: 'A sustainability fact: organic cotton uses far less water.', engagement: 10 },
    { caption: 'New navy just landed, link in bio.', engagement: 500 },
  ];

  it('prefers same-pillar (topic-matched) posts over higher-engagement off-topic ones', () => {
    const ex = selectHistoricExamples(historic, { pillar: 'Ethical Without Compromise' }, planConfig, 2);
    // Both picks must be the sustainability posts, NOT the high-engagement navy/capsule ones.
    expect(ex.every((e) => e.sameTopic)).toBe(true);
    expect(ex.some((e) => /organic cotton|sustainability/i.test(e.caption))).toBe(true);
    expect(ex.some((e) => /navy just landed/i.test(e.caption))).toBe(false);
  });

  it('fills with general voice reference when too few same-topic posts', () => {
    const ex = selectHistoricExamples(historic, { pillar: 'Ethical Without Compromise' }, planConfig, 4);
    expect(ex.length).toBe(4);
    expect(ex.filter((e) => e.sameTopic).length).toBeGreaterThanOrEqual(2);
    expect(ex.filter((e) => !e.sameTopic).length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty when no historic posts (graceful degradation)', () => {
    expect(selectHistoricExamples([], { pillar: 'Ethical Without Compromise' }, planConfig, 4)).toEqual([]);
  });
});

describe('parseCriticVerdict', () => {
  it('parses a clean verdict', () => {
    expect(parseCriticVerdict('{"pass": false, "issues": ["voice mismatch"], "suggested_fix": "rewrite"}'))
      .toEqual({ pass: false, issues: ['voice mismatch'], suggested_fix: 'rewrite' });
  });
  it('parses a fenced verdict with surrounding prose', () => {
    const v = parseCriticVerdict('Here:\n```json\n{"pass": true, "issues": [], "suggested_fix": ""}\n```');
    expect(v.pass).toBe(true);
  });
  it('degrades to PASS on unparseable output (never blocks the plan)', () => {
    expect(parseCriticVerdict('the model rambled with no json').pass).toBe(true);
  });
  it('coerces non-string issues defensively', () => {
    expect(parseCriticVerdict('{"pass": false, "issues": [1, "x"], "suggested_fix": null}').issues)
      .toEqual(['1', 'x']);
  });
});

describe('normaliseDashes — deterministic em/en dash strip', () => {
  it('is a no-op when there is no em/en dash (returns input unchanged)', () => {
    const s = 'A clean caption, with commas. And a hyphenated co-pilot. Sizes 10-12.';
    expect(normaliseDashes(s)).toBe(s);
  });

  it('replaces a spaced em dash with a comma', () => {
    expect(normaliseDashes("She's here — for everyone")).toBe("She's here, for everyone");
  });

  it('matches what the LLM repair produced on the traced posts', () => {
    // Verified against planning_trace (cycle c702fac2): these are real BEFORE strings
    // whose LLM repair removed the dash. The deterministic strip reproduces the swap.
    expect(normaliseDashes('black, navy and navy stripe — £15 off for two weeks'))
      .toBe('black, navy and navy stripe, £15 off for two weeks');
    expect(normaliseDashes('It takes a few minutes — not half an hour'))
      .toBe('It takes a few minutes, not half an hour');
    expect(normaliseDashes('is GOTS-certified — that means 91% less water'))
      .toBe('is GOTS-certified, that means 91% less water');
    expect(normaliseDashes('found us for the very first time — welcome, I\'m so glad'))
      .toBe('found us for the very first time, welcome, I\'m so glad');
  });

  it('keeps a number range as a HYPHEN, never a comma', () => {
    expect(normaliseDashes('available in sizes 10–12')).toBe('available in sizes 10-12');
    expect(normaliseDashes('sizes 8 – 10 in stock')).toBe('sizes 8-10 in stock');
  });

  it('handles an em dash with no surrounding spaces', () => {
    expect(normaliseDashes('live now—come and see')).toBe('live now, come and see');
  });

  it('does not leave a doubled mark when the dash sat next to punctuation', () => {
    expect(normaliseDashes('the one you live in —. Come see')).toBe('the one you live in. Come see');
  });

  it('strips a leading comma if a dash opened the text', () => {
    expect(normaliseDashes('— welcome back')).toBe('welcome back');
  });

  it('leaves a plain hyphen and the outfit-credit brackets untouched', () => {
    const credit = '[ I am wearing our organic cotton Mabel in size 12 - I am a 12/14 ]';
    expect(normaliseDashes(credit)).toBe(credit);
  });

  it('the gate no longer flags a normalised caption (safety-net check passes)', () => {
    const stripped = normaliseDashes("She's here — for everyone, all week");
    expect(codeGateCheck({ ...base, draftCaption: stripped }, VOCAB)).toEqual([]);
  });
});
