import { describe, it, expect } from 'vitest';
import type { Logger } from 'pino';
import type { ModelClient, ModelCompleteParams } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import {
  codeGateCheck, selectHistoricExamples, parseCriticVerdict, normaliseDashes, resolveRegister,
  extractHashtags, editDistance, checkHashtags,
  regeneratePost, mergeStructuralFields, STRUCTURAL_FIELDS, applyCodeGate, applyCritic,
  type PlanPostRow, type CodeGateVocab, type HistoricPost, type RegisterMap,
  type PlanRepairContext, type CriticContext,
} from './plan-validation.js';

const VOCAB: CodeGateVocab = {
  categories: ['Styling', 'Brand', 'Product launch or offer related', 'No Post/Sally'],
  pillars:    ['Stable Foundations', 'Ethical Without Compromise', 'Personal Relationships'],
  // Real tags from earl-of-east's own ig_posts, which is where the gate sources them.
  knownHashtags: ['ritualoverroutine', 'earlofeast', 'greenhouse', 'homefragrance', 'incense', 'soho'],
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

// ════════════════════════════════════════════════════════════════════════════
// STRUCTURAL MERGE — a regeneration may change CONTENT, never the post's SLOT.
// Before this, structure survived only because the repair prompt asked nicely;
// nothing enforced it and codeGateCheck never checked it.
// ════════════════════════════════════════════════════════════════════════════

const CRITIC_SYS = 'CRITIC-SYSTEM-PROMPT';
const PLAN_SYS   = 'PLAN-SYSTEM-PROMPT';

const LOG = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;
const AUDIT = { logModelCall: async () => {} } as unknown as AuditLogger;

/** A ModelClient whose response is decided by the caller, so a test can make the
 *  model return deliberately mutated structure. `complete` is the only method the
 *  repair/critic paths use. */
function stubModel(reply: (params: ModelCompleteParams) => string): ModelClient {
  return {
    complete: async (params: ModelCompleteParams) => ({
      content: reply(params), inputTokens: 1, outputTokens: 1, modelId: 'stub-model', stopReason: 'end_turn',
    }),
    completeStreaming: async () => { throw new Error('completeStreaming is not used on the repair path'); },
  } as ModelClient;
}

const repairCtx = (model: ModelClient, vocab: CodeGateVocab = VOCAB): PlanRepairContext => ({
  vocab, model, modelName: 'stub', audit: AUDIT,
  systemPrompt: PLAN_SYS, userMessage: 'assembled plan context', clientId: 'client-1',
  logger: LOG, logMeta: {},
});

/** A model that always returns this post, mutating every structural field it can. */
const mutatingReply = (over: Partial<PlanPostRow> = {}) => () => JSON.stringify({
  date: '01 January', day: 'Monday', format: 'Static', pillar: 'Ethical Without Compromise',
  title: 'Rewritten', category: 'Brand', postingTime: '9pm', whoPosts: 'Client',
  draftCaption: 'A freshly rewritten caption that is clean and finished.',
  notes: 'new notes', competitorInsight: 'new insight', ...over,
});

describe('mergeStructuralFields — pure merge semantics', () => {
  it('pins date, day and format from the input over the model output', () => {
    const out = mergeStructuralFields(base, { ...base, date: '01 Jan', day: 'Mon', format: 'Static' }, VOCAB);
    expect(out.date).toBe('14 May');
    expect(out.day).toBe('Thu');
    expect(out.format).toBe('Reel');
  });

  it('leaves content fields entirely to the model output', () => {
    const out = mergeStructuralFields(base, {
      ...base, draftCaption: 'new caption', title: 'new title', notes: 'new notes',
      category: 'Brand', whoPosts: 'Client', competitorInsight: 'new insight',
    }, VOCAB);
    expect(out.draftCaption).toBe('new caption');
    expect(out.title).toBe('new title');
    expect(out.notes).toBe('new notes');
    expect(out.category).toBe('Brand');          // vocab-checked, but NOT structural
    expect(out.whoPosts).toBe('Client');
    expect(out.competitorInsight).toBe('new insight');
  });

  it('pins every declared structural field and no others', () => {
    expect([...STRUCTURAL_FIELDS]).toEqual(['date', 'day', 'format', 'pillar']);
  });

  it('mirrors ABSENCE too — a model may not invent structure the input did not have', () => {
    const { date: _d, format: _f, ...noStructure } = base;
    const out = mergeStructuralFields(noStructure, { ...base, date: '01 Jan', format: 'Static' }, VOCAB);
    expect(out.date).toBeUndefined();
    expect(out.format).toBeUndefined();
    expect('date' in out).toBe(false);
  });

  it('takes the model pillar when the client has no configured pillar vocab', () => {
    const noVocab: CodeGateVocab = { categories: [], pillars: [] };
    // Nothing to violate → an input pillar is still structure worth holding.
    expect(mergeStructuralFields(base, { ...base, pillar: 'Anything' }, noVocab).pillar).toBe('Stable Foundations');
    // …but an absent input pillar has no structure to preserve.
    expect(mergeStructuralFields({ ...base, pillar: '' }, { ...base, pillar: 'Anything' }, noVocab).pillar).toBe('Anything');
  });
});

describe('regeneratePost — structural fields survive regeneration (a)', () => {
  it('restores date and format when the model output mutates them', async () => {
    const out = await regeneratePost(base, 'fix the caption', repairCtx(stubModel(mutatingReply())));

    // Structure: restored from the input, byte-identical.
    expect(out.date).toBe('14 May');
    expect(out.day).toBe('Thu');
    expect(out.format).toBe('Reel');
    expect(out.pillar).toBe('Stable Foundations');
    // Content: the model's rewrite lands.
    expect(out.draftCaption).toBe('A freshly rewritten caption that is clean and finished.');
    expect(out.title).toBe('Rewritten');
  });

  it('still normalises dashes in the regenerated caption (existing behaviour intact)', async () => {
    const model = stubModel(mutatingReply({ draftCaption: 'She is here — for everyone.' }));
    const out = await regeneratePost(base, 'fix', repairCtx(model));
    expect(out.draftCaption).not.toMatch(/[—–]/);
    expect(out.date).toBe('14 May');
  });
});

describe('regeneratePost — the shape.ts instructed-rewrite path (b)', () => {
  // Reconstructed exactly as shape.ts builds its PlanPostRow from a stored
  // content_cycle_posts row (isoToLabel(scheduled_date), FORMAT_LABEL[format], …).
  const shapePost: PlanPostRow = {
    date: '3 Aug', day: 'Sun', title: 'Sunday Style', category: 'Styling',
    pillar: 'Stable Foundations', format: 'Carousel', postingTime: '8pm', whoPosts: 'Sprigly',
    competitorInsight: 'No competitor data this cycle. Rationale.',
    draftCaption: 'The original caption as the client last saw it.',
    notes: '', clientWritesOwn: false,
  };

  it('lands the caption change and leaves structural fields byte-identical', async () => {
    const model = stubModel(mutatingReply({ draftCaption: 'A softer, warmer caption for the same slot.' }));
    const out = await regeneratePost(shapePost, 'The client asked: "make it softer"', repairCtx(model));

    expect(out.draftCaption).toBe('A softer, warmer caption for the same slot.');
    for (const field of STRUCTURAL_FIELDS) {
      expect(out[field]).toBe(shapePost[field]);
    }
  });
});

describe('regeneratePost — conditional pillar pinning (d, e)', () => {
  it('(d) lets the model replace an out-of-vocab SENTINEL pillar — "New idea"', async () => {
    // app/src/lib/mutations.ts addGeneratingPost inserts pillar 'New idea' and relies
    // on the repair loop replacing it. An unconditional pin would break this.
    const input = { ...base, pillar: 'New idea' };
    const out = await regeneratePost(input, 'invalid-pillar', repairCtx(stubModel(mutatingReply())));
    expect(out.pillar).toBe('Ethical Without Compromise');
    expect(codeGateCheck(out, VOCAB)).toEqual([]);   // and the gate is now satisfied
  });

  it('(d) lets the model replace the weekly-session "Weather" sentinel too', async () => {
    const input = { ...base, pillar: 'Weather' };
    const out = await regeneratePost(input, 'invalid-pillar', repairCtx(stubModel(mutatingReply())));
    expect(out.pillar).toBe('Ethical Without Compromise');
  });

  it('(d) keeps the model pillar when BOTH input and output are invalid, so the gate still flags it', async () => {
    const input = { ...base, pillar: 'New idea' };
    const model = stubModel(mutatingReply({ pillar: 'Also Not A Pillar' }));
    const out = await regeneratePost(input, 'invalid-pillar', repairCtx(model));
    expect(out.pillar).toBe('Also Not A Pillar');
    expect(codes(out)).toContain('invalid-pillar');   // existing accept-with-warning behaviour preserved
  });

  it('(e) blocks a mutation of a VALID pillar — the input wins', async () => {
    const out = await regeneratePost(base, 'fix the caption', repairCtx(stubModel(mutatingReply())));
    expect(base.pillar).toBe('Stable Foundations');
    expect(out.pillar).toBe('Stable Foundations');   // not the model's 'Ethical Without Compromise'
  });
});

describe('applyCodeGate / applyCritic — slot count and order invariance (f)', () => {
  // Guards the implicit 1:1 `out.push(post)` invariant in both loops: slot COUNT and
  // ORDER are structure too, and nothing else asserts them. If either loop is ever
  // restructured (filtered, batched, reordered, deduped) this fails loudly.
  const plan: PlanPostRow[] = ['1 May', '2 May', '3 May', '4 May', '5 May'].map((date, i) => ({
    ...base,
    date,
    title: `P${i + 1}`,
    // Posts 2 and 4 carry an em dash → the gate fails them → they get regenerated.
    draftCaption: i === 1 || i === 3
      ? 'A caption with an em — dash that the gate rejects.'
      : 'A clean caption with nothing wrong about it at all.',
  }));
  const inputDates = plan.map((p) => p.date);
  const inputTitles = plan.map((p) => p.title);

  it('applyCodeGate returns exactly one row per input row, in order, with dates intact', async () => {
    const model = stubModel(mutatingReply());   // every repair mutates date + format
    const res = await applyCodeGate(plan, repairCtx(model));

    expect(res.rows).toHaveLength(plan.length);
    expect(res.rows.map((r) => r.date)).toEqual(inputDates);
    expect(res.rows.every((r) => r.format === 'Reel')).toBe(true);
    expect(res.checked).toBe(plan.length);
    expect(res.repaired).toBe(2);
    expect(res.acceptedWithWarning).toEqual([]);
  });

  it('applyCritic returns exactly one row per input row, in order, even when a post exhausts its retries', async () => {
    // Critic fails P2 forever (→ 3 repairs, then accept-with-warning); passes the rest.
    const model = stubModel((params) => {
      if (params.system === CRITIC_SYS) {
        const failing = params.messages[0]?.content.includes('"P2"');
        return JSON.stringify(failing
          ? { pass: false, issues: ['off voice'], suggested_fix: 'warm it up' }
          : { pass: true, issues: [], suggested_fix: '' });
      }
      return mutatingReply({ title: 'P2' })();   // repair keeps the title so it stays identifiable
    });

    const criticCtx: CriticContext = {
      criticPrompt: CRITIC_SYS, voiceMd: null,
      planConfig: { pillars: [], categories: [], registerMap: {} },
      historicPosts: [], voiceEdits: [],
      model, modelName: 'stub', audit: AUDIT, clientId: 'client-1',
      logger: LOG, logMeta: {}, exampleCount: 4,
    };
    const clean = plan.map((p) => ({ ...p, draftCaption: 'A clean caption with nothing wrong about it.' }));
    const res = await applyCritic(clean, criticCtx, repairCtx(model));

    expect(res.rows).toHaveLength(clean.length);
    expect(res.rows.map((r) => r.date)).toEqual(inputDates);
    expect(res.rows.map((r) => r.title)).toEqual(inputTitles);
    expect(res.checked).toBe(clean.length);
    expect(res.acceptedWithWarning.map((w) => w.index)).toEqual([1]);   // P2, still at its own index
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CORRUPTED HASHTAGS — the Build D dogfood run published-adjacent bug.
// A generated caption carried "#ritualovertoutine" for the client's real
// "#ritualoverroutine". The gate never looked at tags.
// ════════════════════════════════════════════════════════════════════════════

describe('editDistance', () => {
  it('measures substitutions, insertions and deletions', () => {
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abc', 'abd')).toBe(1);
    expect(editDistance('abc', 'ab')).toBe(1);
    expect(editDistance('abc', 'abcd')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('bails out early rather than computing a distance nobody needs', () => {
    expect(editDistance('short', 'a-very-much-longer-string', 2)).toBeGreaterThan(2);
  });
});

describe('extractHashtags', () => {
  it('pulls tags out lowercased, without the hash', () => {
    expect(extractHashtags('Lovely day #EarlOfEast #ritualOverRoutine!')).toEqual(['earlofeast', 'ritualoverroutine']);
  });
  it('returns nothing for a caption with no tags', () => {
    expect(extractHashtags('No tags here at all.')).toEqual([]);
  });
});

describe('checkHashtags — catch mangled brand tags, allow novel ones', () => {
  const known = VOCAB.knownHashtags!;

  it('THE BUG: catches #ritualovertoutine as a mistyped #ritualoverroutine', () => {
    // The exact string that reached a generated caption in the Build D dogfood run.
    expect(checkHashtags('a caption // #earlofeast #ritualovertoutine', known))
      .toEqual([['ritualovertoutine', 'ritualoverroutine']]);
  });

  it('passes a hashtag the client actually uses', () => {
    expect(checkHashtags('#ritualoverroutine #earlofeast #greenhouse', known)).toEqual([]);
  });

  it('passes a GENUINELY NOVEL hashtag — the model may invent tags', () => {
    // Blocking new tags would make captions worse. Only mangled KNOWN tags are wrong.
    expect(checkHashtags('#autumnlight #slowmornings #octoberathome', known)).toEqual([]);
  });

  it('does not flag a short word that merely resembles a known tag', () => {
    // "#solo" vs known "#soho" is one edit, but 1/4 = 0.25 > the 0.2 ratio: two ordinary
    // distinct words, not a typo. A bare distance threshold would wrongly block this.
    expect(checkHashtags('#solo', known)).toEqual([]);
  });

  it('catches a two-edit corruption of a long tag', () => {
    expect(checkHashtags('#homefragrence', ['homefragrance'])).toEqual([['homefragrence', 'homefragrance']]);
  });

  it('is disabled entirely when the client has no scraped history', () => {
    // No basis to judge → do not second-guess.
    expect(checkHashtags('#anythingatall #ritualovertoutine', [])).toEqual([]);
  });

  it('reports the CLOSEST known tag when several are near', () => {
    expect(checkHashtags('#earlofeastt', ['earlofeast', 'earlofeastsoho'])).toEqual([['earlofeastt', 'earlofeast']]);
  });
});

describe('codeGateCheck — corrupted-hashtag issue', () => {
  it('flags the corrupted tag and names the correction', () => {
    const post = { ...base, draftCaption: 'A clean caption about candles. // #earlofeast #ritualovertoutine' };
    const issues = codeGateCheck(post, VOCAB);
    expect(issues.map((i) => i.code)).toContain('corrupted-hashtag');
    const issue = issues.find((i) => i.code === 'corrupted-hashtag')!;
    expect(issue.detail).toContain('#ritualovertoutine');
    expect(issue.detail).toContain('#ritualoverroutine');
  });

  it('a caption with correct tags passes the whole gate', () => {
    expect(codeGateCheck({ ...base, draftCaption: 'A clean caption. // #earlofeast #ritualoverroutine' }, VOCAB)).toEqual([]);
  });

  it('a caption with a novel tag passes the whole gate', () => {
    expect(codeGateCheck({ ...base, draftCaption: 'A clean caption. // #autumnlight' }, VOCAB)).toEqual([]);
  });

  it('does not fire when the vocab carries no hashtags at all', () => {
    const noTags: CodeGateVocab = { categories: VOCAB.categories, pillars: VOCAB.pillars };
    expect(codeGateCheck({ ...base, draftCaption: 'A clean caption. // #ritualovertoutine' }, noTags)).toEqual([]);
  });
});
