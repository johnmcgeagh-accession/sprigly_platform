import { describe, it, expect } from 'vitest';
import {
  codeGateCheck, selectHistoricExamples, parseCriticVerdict,
  type PlanPostRow, type CodeGateVocab, type HistoricPost,
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
