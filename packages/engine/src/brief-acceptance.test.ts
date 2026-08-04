/**
 * brief-acceptance.test.ts — Sally's real August brief, end to end.
 *
 * The brief that fell to couldnt_apply on the single-intent path (docs/reports/
 * ivy-t-rehearsal-failures.md, docs/reports/extraction-contract-2.md) is run through the REAL
 * decomposer and the REAL transforms, with the classifier STUBBED to the known-correct intents
 * (whether the live model returns them is the classify-check harness's job, not this one).
 *
 * The brief text is reconstructed from the failure report — the live plan_inputs row is not in
 * the repo — but each segment and its intent is exactly what that report enumerates. The
 * decomposition itself is exercised for real: the stub model returns the parts, decomposeInput
 * validates the coverage contract against the reconstructed brief, and the segments it yields
 * are asserted.
 *
 * Pure: the DB write layer (writeOps) is simulated by applyOps below, so the transforms run for
 * real against an in-memory fixture draft with no database.
 */
import { describe, it, expect } from 'vitest';
import { decomposeInput, orderIndices } from './brief.js';
import { applyIntent, type TransformBeat, type BeatOp } from './draft-transforms.js';
import type { IntakeRouting, MonthScopedIntent } from './intake-classify.js';
import type { ModelClient } from './types.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-08';
const TODAY = '2026-07-27';

// ── The brief, as ordered spans (kept = an instruction, discarded = connective tissue) ──────

interface Seg { text: string; routing: IntakeRouting }

const ms = (text: string, intent: Omit<MonthScopedIntent, 'sourceText'>): Seg =>
  ({ text, routing: { scope: 'month_scoped', sourceText: text, intent: { ...intent, sourceText: text } } });
const idea = (text: string): Seg =>
  ({ text, routing: { scope: 'evergreen', sourceText: text, reason: 'classified_evergreen' } });

// 8 month-scoped intents.
const SEGMENTS: Seg[] = [
  ms('The Navy Edit launches on 28th August at 7pm.',
    { kind: 'launch', subject: 'Navy Edit', dateRange: { start: '2026-08-28', end: '2026-08-28' } }),
  ms('Weekend Style Guide every Friday in August: 7th — Maggie t-shirt grey marl; 14th — Lily tee and Sophie short co-ord; 21st — Emily sweatshirt in Midnight; 28th — Hannah t-shirt Navy; and 4th September — Orla long sleeve.',
    { kind: 'series', subject: 'Weekend Style Guide', instances: [
      { date: '2026-08-07', subject: 'Maggie t-shirt grey marl' },
      { date: '2026-08-14', subject: 'Lily tee and Sophie short co-ord' },
      { date: '2026-08-21', subject: 'Emily sweatshirt in Midnight' },
      { date: '2026-08-28', subject: 'Hannah t-shirt Navy' },
      { date: '2026-09-04', subject: 'Orla long sleeve' },
    ] }),
  ms('A new mini-series starting early August, one post every three weeks, on What I am most proud of.',
    { kind: 'series', subject: 'What I am most proud of', recurrence: { startDate: '2026-08-01', intervalDays: 21 } }),
  ms('On the 14th the stock leaves the factory for our next drop.',
    { kind: 'event', subject: 'stock leaves the factory', dateRange: { start: '2026-08-14', end: '2026-08-14' } }),
  ms('On the 15th our factory in Portugal starts its annual summer shutdown.',
    { kind: 'event', subject: 'Portugal summer shutdown', dateRange: { start: '2026-08-15', end: '2026-08-15' } }),
  ms('A throwback post using the video of Sally fitting the pre-production long sleeve, given the heatwave.',
    { kind: 'event', subject: 'long sleeve fitting throwback', dateRange: { start: '2026-08-20', end: '2026-08-20' } }),
  ms('In the Navy Edit build-up, a colour-reveal post asking who can guess the main colour, on the 25th.',
    { kind: 'beat_spec', subject: 'Colour-reveal — guess the main colour', dateRange: { start: '2026-08-25', end: '2026-08-25' }, format: 'reel' }),
  ms('Also a post on the 26th asking who can guess which of the girls is wearing the navy.',
    { kind: 'beat_spec', subject: 'Who can guess which of the girls is in navy', dateRange: { start: '2026-08-26', end: '2026-08-26' } }),
  // 5 evergreen ideas.
  idea('At some point a breakdown of how our sweatshirts are made.'),
  idea('We should talk more about how life is busy and clothes should be simple.'),
  idea('More on our organic cotton staples in general.'),
  idea('A theme about the simple things that just work.'),
  idea('And the fact that we never use polyester.'),
  // The DM-pull ask — not a content instruction. Lands wherever the classifier puts it; must
  // not mutate the plan.
  idea('When you get a sec, pull the DMs from last week and let me know the good ones.'),
];

const DISCARDED = ['Hi Sprigly!', 'Thanks so much, Sally x'];

// Build the brief so coverage is exact: greeting, every segment in order, sign-off.
const BRIEF = [DISCARDED[0], ...SEGMENTS.map((s) => s.text), DISCARDED[1]].join(' ');

/** A stub model that returns the decomposition parts for BRIEF (and nothing else is called). */
const stubModel: ModelClient = {
  complete: async () => ({
    content: JSON.stringify({ parts: [
      { text: DISCARDED[0], keep: false },
      ...SEGMENTS.map((s) => ({ text: s.text, keep: true })),
      { text: DISCARDED[1], keep: false },
    ] }),
    modelId: 'stub', inputTokens: 0, outputTokens: 0,
  }),
} as unknown as ModelClient;

// ── The fixture draft — a real assembled August, with two clientTouched beats ───────────────

const observed = (posts: number): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'observed', formatEngagement: { format: 'carousel', avgEngagement: 40, posts } },
});
const TOUCHED_META: BeatMeta = { slotType: 'proven', rationaleEvidence: { basis: 'client_added' }, clientTouched: true };

const draft = (): TransformBeat[] => {
  const beats: TransformBeat[] = [];
  // 16 replaceable observed beats spread across August.
  for (let i = 0; i < 16; i++) {
    const day = String(2 + i).padStart(2, '0');
    beats.push({ id: `obs-${i}`, date: `2026-08-${day}`, format: 'carousel', pillar: 'Everyday Ritual',
      title: `Observed ${i}`, position: i, beatMeta: observed(i + 2) });
  }
  // Two the client has touched — never replaceable.
  beats.push({ id: 'touched-a', date: '2026-08-10', format: 'reel', pillar: 'Brand Story', title: 'The client’s own', position: 16, beatMeta: TOUCHED_META });
  beats.push({ id: 'touched-b', date: '2026-08-19', format: 'single', pillar: 'Brand Story', title: 'Also theirs', position: 17, beatMeta: TOUCHED_META });
  return beats;
};

/** Simulate writeOps against an in-memory array: remove by id, add appended, update patched. */
let addCounter = 0;
function applyOps(beats: TransformBeat[], ops: BeatOp[]): TransformBeat[] {
  let out = [...beats];
  for (const op of ops) {
    if (op.op === 'remove') out = out.filter((b) => b.id !== op.id);
    else if (op.op === 'add') {
      const position = Math.max(-1, ...out.map((b) => b.position)) + 1;
      out.push({ id: `new-${addCounter++}`, date: op.date, format: op.format, pillar: op.pillar, title: op.title, position, beatMeta: op.beatMeta });
    } else {
      out = out.map((b) => b.id === op.id
        ? { ...b, date: op.changes.date ?? b.date, format: op.changes.format ?? b.format, pillar: op.changes.pillar ?? b.pillar, title: op.changes.title ?? b.title, beatMeta: op.beatMeta ?? b.beatMeta }
        : b);
    }
  }
  return out;
}

interface StepResult { seg: Seg; ops: BeatOp[]; deferred: number; kind: string | 'evergreen' }

// ── The run ─────────────────────────────────────────────────────────────────────────────────

async function runBrief(): Promise<{ segments: string[]; results: StepResult[]; initialCount: number; finalBeats: TransformBeat[] }> {
  addCounter = 0;
  const decomposition = await decomposeInput({ text: BRIEF, model: stubModel });
  if (!decomposition) throw new Error('decomposition failed the coverage contract');

  // The classifier is STUBBED: map each segment back to its known routing.
  const byText = new Map(SEGMENTS.map((s) => [s.text, s]));
  const segSteps = decomposition.segments.map((text) => byText.get(text)!);
  const routings = segSteps.map((s) => s.routing);

  let beats = draft();
  const initialCount = beats.length;
  const results: StepResult[] = new Array(segSteps.length);

  for (const i of orderIndices(routings)) {
    const seg = segSteps[i]!;
    // A question segment touches no beats either — it is answered by the apply path and files
    // nothing. Grouped with evergreen here because this harness only cares whether a segment
    // produced ops.
    if (seg.routing.scope === 'evergreen' || seg.routing.scope === 'question') {
      results[i] = { seg, ops: [], deferred: 0, kind: 'evergreen' };
      continue;
    }
    const r = applyIntent(seg.routing.intent, beats, MONTH, TODAY);
    beats = applyOps(beats, r.ops);
    results[i] = { seg, ops: r.ops, deferred: (r.deferred ?? []).length, kind: seg.routing.intent.kind };
  }

  return { segments: decomposition.segments, results, initialCount, finalBeats: beats };
}

const addsOf = (ops: BeatOp[]) => ops.filter((o) => o.op === 'add').length;
const removesOf = (ops: BeatOp[]) => ops.filter((o) => o.op === 'remove').length;

describe('Sally’s August brief — the acceptance run', () => {
  it('decomposes into exactly the 14 known segments (verbatim), discarding the greeting/sign-off', async () => {
    const { segments } = await runBrief();
    expect(segments).toHaveLength(14);
    expect(segments).toEqual(SEGMENTS.map((s) => s.text));   // verbatim, in order
  });

  it('produces 8 month-scoped applications and 6 evergreen filings', async () => {
    const { results } = await runBrief();
    const applied = results.filter((r) => r.kind !== 'evergreen' && r.ops.length > 0);
    const evergreen = results.filter((r) => r.kind === 'evergreen');
    expect(applied).toHaveLength(8);
    expect(evergreen).toHaveLength(6);   // 5 content ideas + the DM-pull
    // the 8 are exactly these kinds
    expect(applied.map((r) => r.kind).sort()).toEqual(
      ['beat_spec', 'beat_spec', 'event', 'event', 'event', 'launch', 'series', 'series'],
    );
  });

  it('defers exactly one dated ask to next cycle — the 4 September Friday', async () => {
    const { results } = await runBrief();
    const total = results.reduce((n, r) => n + r.deferred, 0);
    expect(total).toBe(1);
    // and it comes from the enumerated Style-Guide series (the recurrence mini-series stops at
    // the month end without deferring)
    const styleGuide = results.find((r) => r.kind === 'series' && r.seg.routing.scope === 'month_scoped'
      && (r.seg.routing.intent.instances?.length ?? 0) > 0)!;
    expect(styleGuide.deferred).toBe(1);
  });

  it('the DM-pull ask does NOT mutate the plan', async () => {
    const { results } = await runBrief();
    const dm = results.find((r) => r.seg.text.includes('pull the DMs'))!;
    expect(dm.kind).toBe('evergreen');
    expect(dm.ops).toHaveLength(0);
  });

  it('slot count is never exceeded — every reshape replaces, only a beat_spec adds', async () => {
    const { results, initialCount, finalBeats } = await runBrief();
    for (const r of results) {
      if (r.kind === 'launch' || r.kind === 'series' || r.kind === 'event') {
        expect(removesOf(r.ops)).toBe(addsOf(r.ops));    // balanced — no net growth
      }
      if (r.kind === 'beat_spec') {
        expect(removesOf(r.ops)).toBe(0);                // the client asked for one more
        expect(addsOf(r.ops)).toBe(1);
      }
    }
    // Final count grows ONLY by the two explicit hand-added beat_spec posts.
    expect(finalBeats.length).toBe(initialCount + 2);
  });

  it('never touches a clientTouched beat', async () => {
    const { finalBeats } = await runBrief();
    const touched = finalBeats.filter((b) => b.id === 'touched-a' || b.id === 'touched-b');
    expect(touched).toHaveLength(2);
    // untouched: same fields as the fixture
    expect(touched.every((b) => b.beatMeta?.clientTouched === true)).toBe(true);
    expect(touched.find((b) => b.id === 'touched-a')!.title).toBe('The client’s own');
  });

  it('the receipt has one line per segment', async () => {
    const { segments, results } = await runBrief();
    expect(results).toHaveLength(segments.length);   // 14 == 14
  });
});
