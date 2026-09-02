import { describe, it, expect } from 'vitest';
import {
  applyLaunchArc, applyEvent, applyEmphasis, applyBeatEdit, applyIntent,
  replacementCandidates, isReplaceable, replacementTier, resolveBeatRef, resolveEmphasisTarget,
  resolveEmphasisIntent,
  type TransformBeat,
} from './draft-transforms.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-09';
const TODAY = '2026-09-01';

const observed = (posts: number, avg = 40): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: {
    basis: 'observed',
    formatEngagement: { format: 'carousel', avgEngagement: avg, posts },
    cadenceBasis: { postsPerWeek: 3, source: 'observed', months: 4 },
  },
});
const template = (): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'template', reason: 'insufficient history' },
});
const clientTouched = (): BeatMeta => ({ ...observed(50), clientTouched: true });
const clientExperiment = (): BeatMeta => ({
  slotType: 'experiment',
  rationaleEvidence: { basis: 'observed', candidateRank: { rank: 1, of: 2, origin: 'client' } },
});

const beat = (id: string, date: string, meta: BeatMeta | null, over: Partial<TransformBeat> = {}): TransformBeat => ({
  id, date, format: 'carousel', pillar: 'Everyday Ritual', title: `Beat ${id}`, position: 0, beatMeta: meta, ...over,
});

const launch = (over: Partial<MonthScopedIntent> = {}): MonthScopedIntent => ({
  kind: 'launch', subject: 'the navy edit', sourceText: 'The navy edit drops on the 28th',
  dateRange: { start: '2026-09-28', end: '2026-09-28' }, ...over,
});

describe('the replacement rule — what may be evicted, and in what order', () => {
  it('protects a beat the CLIENT touched — their hand outranks the algorithm', () => {
    expect(isReplaceable(beat('a', '2026-09-05', clientTouched()))).toBe(false);
  });

  it('protects an experiment sourced from a client idea', () => {
    expect(isReplaceable(beat('a', '2026-09-05', clientExperiment()))).toBe(false);
  });

  // POLICY CHANGE (rehearsal fixes, commit 3): a beat an EARLIER SENTENCE created is no
  // longer protected forever — it is tier 2, replaceable only once tiers 0-1 are gone. A
  // beat the client placed BY HAND is still absolutely protected. The old rule starved the
  // pool: every sentence's output immunised the month against the next sentence.
  it('a previous input’s untouched beat is LAST RESORT, not protected', () => {
    const fromInput: BeatMeta = { slotType: 'proven', rationaleEvidence: { basis: 'client_input', reason: 'x' } as BeatMeta['rationaleEvidence'] };
    expect(isReplaceable(beat('a', '2026-09-05', fromInput))).toBe(true);
    expect(replacementTier(beat('a', '2026-09-05', fromInput))).toBe(2);
  });

  it('but a beat the client ADDED BY HAND is never replaceable', () => {
    const manuallyAdded: BeatMeta = { slotType: 'proven', rationaleEvidence: { basis: 'client_added' } };
    expect(isReplaceable(beat('b', '2026-09-06', manuallyAdded))).toBe(false);
    expect(replacementTier(beat('b', '2026-09-06', manuallyAdded))).toBeNull();
  });

  it('and a previous input’s beat the client TOUCHED goes back to protected', () => {
    const touchedInput: BeatMeta = {
      slotType: 'proven', clientTouched: true,
      rationaleEvidence: { basis: 'client_input', reason: 'x' } as BeatMeta['rationaleEvidence'],
    };
    expect(isReplaceable(beat('c', '2026-09-07', touchedInput))).toBe(false);
  });

  it('allows an ordinary observed beat', () => {
    expect(isReplaceable(beat('a', '2026-09-05', observed(20)))).toBe(true);
  });

  it('ranks TEMPLATE-basis beats first — no history justified them at all', () => {
    const pool = replacementCandidates([
      beat('strong', '2026-09-05', observed(30, 90)),
      beat('tmpl',   '2026-09-06', template()),
      beat('weak',   '2026-09-07', observed(3, 10)),
    ]);
    expect(pool[0]!.id).toBe('tmpl');
  });

  it('then ranks by smallest sample — the weakest claim goes first', () => {
    const pool = replacementCandidates([
      beat('n30', '2026-09-05', observed(30)),
      beat('n3',  '2026-09-06', observed(3)),
      beat('n12', '2026-09-07', observed(12)),
    ]);
    expect(pool.map((b) => b.id)).toEqual(['n3', 'n12', 'n30']);
  });

  it('is a TOTAL order — identical evidence still yields a stable, repeatable pick', () => {
    const beats = [beat('b', '2026-09-06', observed(10)), beat('a', '2026-09-05', observed(10))];
    expect(replacementCandidates(beats).map((b) => b.id))
      .toEqual(replacementCandidates([...beats].reverse()).map((b) => b.id));
  });
});

describe('applyLaunchArc', () => {
  const month = [
    beat('t1', '2026-09-02', template()),
    beat('t2', '2026-09-09', template()),
    beat('t3', '2026-09-16', template()),
    beat('s1', '2026-09-23', observed(30, 90)),
  ];

  it('places a three-part arc around the date and removes three beats — slot count is flat', () => {
    const { ops } = applyLaunchArc(launch(), month, MONTH);
    const adds = ops.filter((o) => o.op === 'add');
    const removes = ops.filter((o) => o.op === 'remove');
    expect(adds).toHaveLength(3);
    expect(removes).toHaveLength(3);
  });

  it('builds tease → launch → follow-up around the anchor', () => {
    const adds = applyLaunchArc(launch(), month, MONTH).ops.filter((o) => o.op === 'add') as Array<{ date: string; title: string; format: string }>;
    expect(adds.map((a) => a.date)).toEqual(['2026-09-23', '2026-09-28', '2026-09-30']);
    expect(adds.map((a) => a.title)).toEqual([
      'the navy edit — Tease', 'the navy edit — Launch', 'the navy edit — Follow-up',
    ]);
    expect(adds[1]!.format).toBe('reel');
  });

  it('clamps the arc INSIDE the plan month — a follow-up cannot spill into October', () => {
    const adds = applyLaunchArc(launch({ dateRange: { start: '2026-09-30', end: '2026-09-30' } }), month, MONTH)
      .ops.filter((o) => o.op === 'add') as Array<{ date: string }>;
    for (const a of adds) expect(a.date.startsWith('2026-09')).toBe(true);
  });

  it('evicts the WEAKEST beats, never the strong one', () => {
    const removed = applyLaunchArc(launch(), month, MONTH).ops
      .filter((o) => o.op === 'remove').map((o) => (o as { id: string }).id);
    expect(removed.sort()).toEqual(['t1', 't2', 't3']);
    expect(removed).not.toContain('s1');
  });

  it('gives every new beat HONEST evidence quoting the client', () => {
    const adds = applyLaunchArc(launch(), month, MONTH).ops.filter((o) => o.op === 'add') as Array<{ beatMeta: BeatMeta }>;
    for (const a of adds) {
      expect(a.beatMeta.rationaleEvidence.basis).toBe('client_input');
      expect(a.beatMeta.rationaleEvidence.reason).toBe('The navy edit drops on the 28th');
      expect(a.beatMeta.rationaleEvidence.formatEngagement).toBeUndefined();   // no metrics pretended
    }
  });

  it('places a PARTIAL arc and says so, rather than evicting protected beats', () => {
    const guarded = [beat('t1', '2026-09-02', template()), beat('c1', '2026-09-09', clientTouched())];
    const res = applyLaunchArc(launch(), guarded, MONTH);
    expect(res.ops.filter((o) => o.op === 'add')).toHaveLength(1);
    expect(res.note).toMatch(/Added 1 of 3/);
  });

  it('does nothing, loudly, when every beat is protected', () => {
    const res = applyLaunchArc(launch(), [beat('c1', '2026-09-09', clientTouched())], MONTH);
    expect(res.ops).toEqual([]);
    // The copy now names a remedy instead of only naming the refusal.
    expect(res.note).toMatch(/add a day or drop something to make room/);
  });

  it('refuses without a date', () => {
    const res = applyLaunchArc(launch({ dateRange: null }), month, MONTH);
    expect(res.ops).toEqual([]);
    expect(res.note).toMatch(/No date/);
  });
});

describe('applyEvent', () => {
  const month = [beat('t1', '2026-09-02', template()), beat('s1', '2026-09-20', observed(40, 90))];
  const event: MonthScopedIntent = {
    kind: 'event', subject: 'market stall', sourceText: 'We have a market stall on the 12th',
    dateRange: { start: '2026-09-12', end: '2026-09-12' },
  };

  it('replaces one weak beat with a single dated beat', () => {
    const { ops } = applyEvent(event, month, MONTH);
    expect(ops).toHaveLength(2);
    expect(ops.find((o) => o.op === 'remove')).toMatchObject({ id: 't1' });
    expect(ops.find((o) => o.op === 'add')).toMatchObject({ date: '2026-09-12', title: 'market stall' });
  });

  it('never exceeds the slot count', () => {
    const { ops } = applyEvent(event, month, MONTH);
    const net = ops.filter((o) => o.op === 'add').length - ops.filter((o) => o.op === 'remove').length;
    expect(net).toBe(0);
  });
});

/**
 * A SERIES BEAT KEEPS ITS IDENTITY THROUGH AN EMPHASIS.
 *
 * `seriesDue` is the ONLY thing on a placed beat that says "this is the client's standing
 * Saturday commitment" — there is no column and no status for it. `reweighted` replaces the
 * whole `rationaleEvidence` object and `draft-apply.ts` writes that object over the row's
 * beat_meta, so before this the marker was one re-pillar away from gone, and a beat that lost
 * it was indistinguishable from an ordinary one for the rest of its life.
 */
describe('emphasis and series identity', () => {
  const seriesEvidence = { name: 'WSG (Weekend Style Guide)', dayOfWeek: 'Saturday', lastPlanned: '2026-08-29', monthsObserved: 4 };
  const seriesBeat = (): BeatMeta => ({
    slotType: 'proven',
    rationaleEvidence: {
      basis: 'observed',
      seriesDue: seriesEvidence,
      formatEngagement: { format: 'carousel', avgEngagement: 40, posts: 5 },
      pillarShare: 0.2,
    } as BeatMeta['rationaleEvidence'],
  });
  const VOCAB = ['Product & Fragrance', 'Everyday Ritual'];
  const intent: MonthScopedIntent = {
    kind: 'emphasis', subject: 'more product', sourceText: 'more product this month', emphasis: 'Product & Fragrance',
  };
  /** One eligible beat, so the third-of-the-month tilt lands on the series beat. */
  const monthOf = (meta: BeatMeta) => [beat('s', '2026-09-12', meta)];

  it('carries seriesDue through a re-pillar — the beat is still that series', () => {
    const op = applyEmphasis(intent, monthOf(seriesBeat()), TODAY, VOCAB).ops[0] as { beatMeta: BeatMeta };
    expect(op.beatMeta.rationaleEvidence.basis).toBe('emphasis_reweight');
    expect(op.beatMeta.rationaleEvidence.seriesDue).toEqual(seriesEvidence);
  });

  it('still drops the pillar metrics, which is the whole point of the basis', () => {
    const op = applyEmphasis(intent, monthOf(seriesBeat()), TODAY, VOCAB).ops[0] as { beatMeta: BeatMeta };
    // A measurement of a pillar the beat no longer has must not survive; an identity must.
    expect(op.beatMeta.rationaleEvidence.pillarShare).toBeUndefined();
    expect(op.beatMeta.rationaleEvidence.formatEngagement).toBeUndefined();
  });

  it('adds no seriesDue to a beat that never had one', () => {
    const op = applyEmphasis(intent, monthOf(observed(5)), TODAY, VOCAB).ops[0] as { beatMeta: BeatMeta };
    expect(op.beatMeta.rationaleEvidence.seriesDue).toBeUndefined();
  });

  it('survives a FORMAT emphasis too, not only a pillar one', () => {
    const op = applyEmphasis({ ...intent, emphasis: 'reel' }, monthOf(seriesBeat()), TODAY, VOCAB).ops[0] as { beatMeta: BeatMeta };
    expect(op.beatMeta.rationaleEvidence.seriesDue).toEqual(seriesEvidence);
  });
});

describe('applyEmphasis', () => {
  const month = [
    beat('past', '2026-08-20', observed(5)),                                    // before today
    beat('a', '2026-09-05', observed(5)),
    beat('b', '2026-09-08', observed(8)),
    beat('c', '2026-09-12', observed(12)),
    beat('touched', '2026-09-15', clientTouched()),
  ];
  /** The client's configured pillars. Supplied now because the match resolves against them —
   *  see `resolveEmphasisTarget`. The month's own beats are all 'Everyday Ritual'. */
  const VOCAB = ['Product & Fragrance', 'Everyday Ritual', 'Home & Space', 'Brand Story & Culture'];
  const emphasis: MonthScopedIntent = {
    kind: 'emphasis', subject: 'more product', sourceText: 'more product this month', emphasis: 'Product & Fragrance',
  };
  const run = (i: MonthScopedIntent = emphasis, m = month) => applyEmphasis(i, m, TODAY, VOCAB);

  it('never touches a PAST-dated beat', () => {
    expect(run().ops.map((o) => (o as { id: string }).id)).not.toContain('past');
  });

  it('never touches a CLIENT-EDITED beat', () => {
    expect(run().ops.map((o) => (o as { id: string }).id)).not.toContain('touched');
  });

  it('tilts the month rather than replacing it — at most a third of eligible beats', () => {
    const res = run();
    expect(res.ops.length).toBeLessThanOrEqual(1);        // 3 eligible → floor(3/3) = 1
    expect(res.ops.every((o) => o.op === 'update')).toBe(true);
  });

  it('converts the weakest-evidence beats first', () => {
    expect((run().ops[0] as { id: string }).id).toBe('a');   // n=5
  });

  it('recognises a FORMAT emphasis and changes format, not pillar', () => {
    const res = run({ ...emphasis, emphasis: 'reel' });
    expect(res.ops[0]).toMatchObject({ op: 'update', changes: { format: 'reel' } });
  });

  it('REPLACES a re-pillared beat’s evidence — stale metrics must not survive the move', () => {
    // The beat cited "Everyday Ritual is 20% of what you post". It is now under Product &
    // Fragrance. Carrying the old share over would be misleading, so the evidence is
    // replaced with the honest one: the client asked for this.
    const op = run().ops[0] as { beatMeta: BeatMeta };
    expect(op.beatMeta.rationaleEvidence.basis).toBe('emphasis_reweight');
    expect(op.beatMeta.rationaleEvidence.reason).toBe('more product this month');
    expect(op.beatMeta.rationaleEvidence.pillarShare).toBeUndefined();
    expect(op.beatMeta.rationaleEvidence.formatEngagement).toBeUndefined();
  });

  it('says so when there is nothing eligible left', () => {
    const res = run(emphasis, [beat('touched', '2026-09-15', clientTouched())]);
    expect(res.ops).toEqual([]);
    expect(res.note).toBeTruthy();
  });

  /**
   * ── THE PHRASE IS NEVER THE PILLAR ───────────────────────────────────────────────
   *
   * The match was case-insensitive EQUALITY, and the eligibility filter (`b.pillar !==
   * target`) doubled as the match test — so a phrase equal to no pillar was unequal to every
   * pillar, made every future untouched beat eligible, and wrote itself into the `pillar`
   * column of a third of them. Missing was the maximum-damage case. Only the 120-character
   * cap in `intake-classify.ts` kept whole sentences out, which is why no `emphasis_reweight`
   * beat exists anywhere in the corpus.
   */
  describe('a phrase that names no pillar', () => {
    const sentence: MonthScopedIntent = {
      kind: 'emphasis',
      subject: 'back to school',
      sourceText: 'the back to school should talk about the juggle of the school run and working life',
      emphasis: 'Back to school content should focus on the juggle of the school run and working life',
    };

    it('changes NOTHING — no ops at all', () => {
      expect(run(sentence).ops).toEqual([]);
    });

    it('never writes the phrase into a pillar', () => {
      const written = run(sentence).ops.map((o) => (o as { changes?: { pillar?: string } }).changes?.pillar);
      expect(written).not.toContain(sentence.emphasis);
      // …and the guarantee, stated against ANY input rather than this one.
      for (const p of run(sentence).ops.map((o) => (o as { changes?: { pillar?: string } }).changes?.pillar)) {
        if (p) expect(VOCAB).toContain(p);
      }
    });

    it('tells the client what they could have named', () => {
      const note = run(sentence).note!;
      expect(note).toContain('doesn’t name one of your content pillars');
      expect(note).toContain('Product & Fragrance');
      expect(note).toContain('nothing on the calendar has moved');
    });

    /**
     * "Names no pillar" is not "means nothing". The sentence is what the client wants this
     * month's captions to be about; it simply names no beat and no date. It comes back as
     * CONTEXT so the caller can put it where the caption generator reads it — every
     * client_input transform before this one wrote the sentence to
     * beat_meta.rationaleEvidence.reason, which nothing downstream of the receipt opens.
     */
    it('hands the sentence back as month CONTEXT, verbatim', () => {
      const res = run(sentence);
      expect(res.context).toBe(sentence.sourceText);
      expect(res.ops).toEqual([]);          // and still changes nothing
    });

    it('carries the sourceText, not the (possibly truncated) emphasis phrase', () => {
      const res = run({ ...sentence, emphasis: 'a shortened fragment' });
      expect(res.context).toBe(sentence.sourceText);
    });

    it('an AMBIGUOUS phrase is a question, not context — it named a pillar, just not which', () => {
      const res = applyEmphasis(
        { kind: 'emphasis', subject: 'x', sourceText: 'more everyday product', emphasis: 'everyday product' },
        month, TODAY, ['Product & Fragrance', 'Everyday Ritual'],
      );
      expect(res.ops).toEqual([]);
      expect(res.context).toBeUndefined();
      expect(res.note).toContain('which did you mean');
    });

    it('a MATCHED phrase is not context — it changed the month instead', () => {
      expect(run({ ...emphasis, emphasis: 'more of the product stuff' }).context).toBeUndefined();
    });

    it('a matched phrase writes the CANONICAL pillar name, not the client’s words', () => {
      const res = run({ ...emphasis, emphasis: 'more of the product stuff please' });
      expect(res.ops[0]).toMatchObject({ changes: { pillar: 'Product & Fragrance' } });
    });
  });
});

/**
 * The matching rule itself. Exported and tested directly because it is what the whole
 * transform now turns on, and a rule only observable through a database and a model call is
 * a rule nobody will check.
 */
/**
 * ── THE FIELD THE CLASSIFIER FILLS WITH A QUANTIFIER ─────────────────────────────────
 *
 * Measured live against the September draft, 5 runs each, every value below observed verbatim:
 *
 *   "can we lean into the morning routine more"   emphasis "more"      subject "morning routine"
 *   "can we do more reels this month"             emphasis "more"      subject "more reels"
 *                                                 emphasis "increase"  subject "more reels"
 *   "Karen lands mid-month. Can we lean into
 *    the school run more?"                        emphasis "more"      subject "school run"
 *
 * `more` is in EMPHASIS_STOPWORDS, so it normalises to nothing and matches nothing. The topic
 * was in `subject` the whole time. `intent.emphasis ?? intent.subject` did not help, because
 * `??` guards against absent and "more" is present.
 */
describe('resolveEmphasisIntent — the quantifier does not get to be the answer', () => {
  const IVY = [
    'Simplify Your Morning', 'Born From Real Need', 'Stable Foundations',
    'Ethical Without Compromise', 'Understands Real Women', 'Personal Relationships',
    'A Supportive Friend, Always By Your Side',
  ];
  const intent = (emphasis: string | null, subject: string) =>
    ({ emphasis, subject }) as Pick<MonthScopedIntent, 'emphasis' | 'subject'>;

  it('falls through a quantifier to the topic — the three reported inputs', () => {
    expect(resolveEmphasisIntent(intent('more', 'morning routine'), IVY).target)
      .toEqual({ kind: 'pillar', name: 'Simplify Your Morning' });
    expect(resolveEmphasisIntent(intent('more', 'more reels'), IVY).target)
      .toEqual({ kind: 'format', name: 'reel' });
    expect(resolveEmphasisIntent(intent('increase', 'more reels'), IVY).target)
      .toEqual({ kind: 'format', name: 'reel' });
  });

  it('"increase" and "decrease" fall through too — they survive normalisation and match nothing', () => {
    // Distinct from "more": these are NOT stopwords, so they are tried and lose on merit rather
    // than being filtered before the attempt. Both routes have to reach the subject.
    expect(resolveEmphasisIntent(intent('decrease', 'less founder stuff'), IVY).target.kind).toBe('none');
    expect(resolveEmphasisIntent(intent('increase', 'morning routine'), IVY).target)
      .toEqual({ kind: 'pillar', name: 'Simplify Your Morning' });
  });

  it('a real instruction in `emphasis` still WINS — the back-to-school brief', () => {
    // The field is not always a quantifier, and when it carries the client's actual instruction
    // it is the better phrase. It resolves to `none` here because the sentence names no pillar,
    // which is correct and is what the month-context path is for — but it must be what gets
    // quoted, not the shorter subject.
    const real = 'back to school content should focus on the juggle of the school run and working life, tied to the new Karen range photoshoot';
    const r = resolveEmphasisIntent(intent(real, 'back to school — juggle of the school run and working life'), IVY);
    expect(r.target.kind).toBe('none');
    expect(r.phrase).toBe(real);
  });

  it('quotes the TOPIC, not the quantifier, when neither names a pillar', () => {
    // "school run" is not one of Ivy T's pillars, so the outcome is still `none` — the receipt
    // is the thing that changes. Before this, the client was told: Noted for this month: "more".
    const r = resolveEmphasisIntent(intent('more', 'school run'), IVY);
    expect(r.target.kind).toBe('none');
    expect(r.phrase).toBe('school run');
  });

  it('AMBIGUOUS stops the search — it is a match, not a miss', () => {
    // Falling through to `subject` here would silently resolve an ambiguity that is the
    // client's to resolve.
    const r = resolveEmphasisIntent(intent('more real need women', 'morning routine'), IVY);
    expect(r.target.kind).toBe('ambiguous');
  });

  it('an emphasis of only stopwords is dropped before it is tried', () => {
    expect(resolveEmphasisIntent(intent('more of the', 'morning routine'), IVY).phrase).toBe('morning routine');
    expect(resolveEmphasisIntent(intent(null, 'morning routine'), IVY).phrase).toBe('morning routine');
  });

  it('nothing usable at all yields no phrase, and the caller says so', () => {
    expect(resolveEmphasisIntent(intent('more', 'the'), IVY)).toEqual({ target: { kind: 'none', candidates: [] }, phrase: '' });
  });
});

describe('resolveEmphasisTarget', () => {
  const IVY = [
    'Simplify Your Morning', 'Born From Real Need', 'Stable Foundations',
    'Ethical Without Compromise', 'Understands Real Women', 'Personal Relationships',
    'A Supportive Friend, Always By Your Side',
  ];
  const EOE = ['Product & Fragrance', 'Everyday Ritual', 'Home & Space', 'Workshops & Experiences', 'Brand Story & Culture'];

  it('matches a pillar named exactly', () => {
    expect(resolveEmphasisTarget('Product & Fragrance', EOE)).toEqual({ kind: 'pillar', name: 'Product & Fragrance' });
  });

  it('matches a pillar named loosely, inside a sentence', () => {
    expect(resolveEmphasisTarget('more product this month', EOE)).toEqual({ kind: 'pillar', name: 'Product & Fragrance' });
    expect(resolveEmphasisTarget('lean into the morning routine', IVY)).toEqual({ kind: 'pillar', name: 'Simplify Your Morning' });
    expect(resolveEmphasisTarget('more workshops please', EOE)).toEqual({ kind: 'pillar', name: 'Workshops & Experiences' });
  });

  it('reads “&” and “and” as the same word', () => {
    expect(resolveEmphasisTarget('home and space', EOE)).toEqual({ kind: 'pillar', name: 'Home & Space' });
  });

  it('prefers the pillar supplying MORE of its own words', () => {
    // 'women' hits Understands Real Women only; 'real women' hits it twice and Born From
    // Real Need once, so the count decides rather than the order.
    expect(resolveEmphasisTarget('more real women', IVY)).toEqual({ kind: 'pillar', name: 'Understands Real Women' });
  });

  it('refuses to guess when two pillars fit equally — and names both', () => {
    const r = resolveEmphasisTarget('more real content', IVY);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates).toEqual(['Born From Real Need', 'Understands Real Women']);
  });

  it('THE FAILING CASE: a whole sentence names nothing', () => {
    const r = resolveEmphasisTarget('Back to school content should focus on the juggle of the school run and working life, tied to the new Karen range photoshoot', IVY);
    expect(r.kind).toBe('none');
  });

  it('matches a FORMAT, including plurals and everyday synonyms', () => {
    for (const [phrase, name] of [['reel', 'reel'], ['more reels', 'reel'], ['more video', 'reel'],
      ['carousels', 'carousel'], ['more photos', 'single'], ['single', 'single']] as const) {
      expect(resolveEmphasisTarget(phrase, IVY), phrase).toEqual({ kind: 'format', name });
    }
  });

  it('a pillar outranks a format when a phrase names both', () => {
    // The richer ask, and the cheaper one to be wrong about: a re-pillar shows on the card,
    // a format swap changes what has to be shot.
    expect(resolveEmphasisTarget('more product reels', EOE)).toEqual({ kind: 'pillar', name: 'Product & Fragrance' });
  });

  it('two different formats named at once is not a format ask', () => {
    expect(resolveEmphasisTarget('reels and carousels', IVY).kind).toBe('none');
  });

  it('function words alone match nothing', () => {
    expect(resolveEmphasisTarget('more of this please', IVY).kind).toBe('none');
    expect(resolveEmphasisTarget('a the and of', IVY).kind).toBe('none');
  });

  it('an empty vocabulary yields no pillar, and still finds a format', () => {
    expect(resolveEmphasisTarget('more product', []).kind).toBe('none');
    expect(resolveEmphasisTarget('more reels', [])).toEqual({ kind: 'format', name: 'reel' });
  });
});

describe('resolveBeatRef + applyBeatEdit', () => {
  const month = [
    beat('fri-reel', '2026-09-04', observed(10), { format: 'reel' }),      // a Friday
    beat('fri-car',  '2026-09-11', observed(10), { format: 'carousel' }),  // also a Friday
    beat('wed',      '2026-09-02', observed(10), { format: 'single' }),
  ];

  it('resolves "the Friday reel" to exactly one beat', () => {
    expect(resolveBeatRef('the friday reel', month).map((b) => b.id)).toEqual(['fri-reel']);
  });

  it('resolves a day-of-month reference', () => {
    expect(resolveBeatRef('the 2nd', month).map((b) => b.id)).toEqual(['wed']);
  });

  it('returns MULTIPLE matches for an ambiguous reference — the caller must not guess', () => {
    expect(resolveBeatRef('friday', month)).toHaveLength(2);
  });

  it('refuses an ambiguous reference rather than picking one', () => {
    const res = applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'friday', edit: 'drop' }, month, MONTH);
    expect(res.ops).toEqual([]);
    expect(res.note).toMatch(/could be 2 different posts/);
  });

  it('says so when the reference matches nothing', () => {
    const res = applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the tuesday email', edit: 'drop' }, month, MONTH);
    expect(res.note).toMatch(/couldn’t find/);
  });

  it('drops, swaps format and moves an unambiguous reference', () => {
    expect(applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'drop' }, month, MONTH).ops)
      .toEqual([{ op: 'remove', id: 'fri-reel' }]);
    expect(applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'swap_format', editValue: 'carousel' }, month, MONTH).ops)
      .toEqual([{ op: 'update', id: 'fri-reel', changes: { format: 'carousel' } }]);
    expect(applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'move', editValue: '2026-09-06' }, month, MONTH).ops)
      .toEqual([{ op: 'update', id: 'fri-reel', changes: { date: '2026-09-06' } }]);
  });

  it('rejects a format it cannot plan for', () => {
    const res = applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'swap_format', editValue: 'story' }, month, MONTH);
    expect(res.ops).toEqual([]);
  });
});

describe('applyIntent — determinism', () => {
  const month = [beat('t1', '2026-09-02', template()), beat('t2', '2026-09-09', template()), beat('t3', '2026-09-16', template())];

  it('same intent, same month → identical ops', () => {
    expect(applyIntent(launch(), month, MONTH, TODAY)).toEqual(applyIntent(launch(), month, MONTH, TODAY));
  });

  it('is independent of input row order', () => {
    const a = applyIntent(launch(), month, MONTH, TODAY);
    const b = applyIntent(launch(), [...month].reverse(), MONTH, TODAY);
    expect(a.ops).toEqual(b.ops);
  });
});
