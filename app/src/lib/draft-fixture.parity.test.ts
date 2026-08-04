/**
 * draft-fixture.parity.test.ts — the seeded draft month is made of real rows.
 *
 * ── What this is for ─────────────────────────────────────────────────────────────────
 *
 * `e2e-draft-fixture.ts` invents a month for Playwright to review. A fixture is a fake like any
 * other, and the failure mode is the same one this project keeps hitting: it goes on passing
 * its own tests long after it has stopped resembling what the assembler actually writes, so the
 * suite proves the surface renders a shape production never produces.
 *
 * TypeScript catches half of it — `beatMeta` is typed as `BeatMeta`, so a renamed or added
 * field is a compile error in the fixture. This file catches the other half, which types
 * cannot: whether the evidence a beat carries is READ by anything. A perfectly-typed
 * `productCoverage` on a beat nobody derives a product line from is a fixture testing itself.
 *
 * So every beat below is run through the REAL readers the surface uses — `groundingLines` for
 * the sheet, `monthSummary` for the panel, `approvalCounts` for the Generate confirm — and the
 * output is asserted. If a reader stops consuming a field, or a rule changes, this fails here
 * with the fixture named, rather than in a Playwright assertion about text on a screen.
 *
 * It is also where the e2e's expected STRINGS come from. The specs assert the exact grounding
 * lines; those strings are derived here from the fixture's own data, so the e2e can never be
 * "fixed" by pasting in whatever the screen happened to say.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@sprigly/db', () => ({ db: {}, sql: {} }));

// The fixture is imported from its own subpath, NOT through the package barrel — the barrel
// is mocked above (it carries the database client) and the fixture itself touches nothing.
import {
  DRAFT_BEATS, DRAFT_APPROVAL_COUNTS, DRAFT_BACKLOG_BEAT, DRAFT_BACKLOG_TEXT,
  draftBeatRows,
} from '@sprigly/db/e2e-draft-fixture';
import { groundingLines, monthSummary } from './draft-rationale';
import { approvalCounts } from '@/components/plan/surface/approval-counts';
import type { BeatEvidence, DraftBeatView } from './types';

/** The fixture as the surface sees it — the same mapping `toDraftBeat` (plan.ts) performs. */
const views: DraftBeatView[] = DRAFT_BEATS.map((b, i) => ({
  id: b.id, cycleId: 'cyc-draft', date: b.date, format: b.format, pillar: b.pillar,
  title: b.title, position: i + 1,
  slotType: b.beatMeta.slotType,
  evidence: b.beatMeta.rationaleEvidence as BeatEvidence,
  assumptions: b.beatMeta.assumptions ?? [],
}));

const linesFor = (id: string) => {
  const v = views.find((b) => b.id === id)!;
  return groundingLines(v.evidence, v.pillar);
};
const kinds = (id: string) => linesFor(id).map((l) => l.kind);

describe('every beat carries evidence something actually reads', () => {
  it('no beat is unexplained — each produces at least one grounding line', () => {
    // A beat with evidence nothing derives a line from renders an empty sheet, which is the
    // honest rendering of a beat we cannot justify — and a useless fixture.
    for (const v of views) {
      expect(groundingLines(v.evidence, v.pillar).length, v.title).toBeGreaterThan(0);
    }
  });

  it('the SERIES beat produces a series line naming the series and when it last ran', () => {
    expect(kinds(DRAFT_BEATS[0]!.id)).toContain('series');
    expect(linesFor(DRAFT_BEATS[0]!.id).find((l) => l.kind === 'series')!.text)
      .toBe('Weekend Style Guide — weekly; last ran 27 June');
  });

  it('the FEATURED product beat takes productCoverageFact’s date branch, with its sample', () => {
    expect(linesFor(DRAFT_BEATS[1]!.id).find((l) => l.kind === 'product')!.text)
      .toBe('the linen shirt — last in a caption on 12 May (4 captions)');
  });

  it('the NEVER-FEATURED product beat takes the null branch and prints no sample at all', () => {
    // `lastFeatured: null` is a stronger claim than any date and must never render as a zero
    // or an epoch — and `mentions: 0` must not surface as "(0 captions)".
    const text = linesFor(DRAFT_BEATS[2]!.id).find((l) => l.kind === 'product')!.text;
    expect(text).toBe('the corduroy overshirt — never appeared in a caption');
    expect(text).not.toContain('caption)');
    expect(text).not.toMatch(/1970|0 caption/);
  });

  it('the BACKLOG beat quotes her sentence and dates it to the month she sent it', () => {
    const line = linesFor(DRAFT_BACKLOG_BEAT).find((l) => l.kind === 'backlog')!;
    expect(line.text).toBe('From what you told us in June');
    expect(line.quote).toBe(DRAFT_BACKLOG_TEXT);
  });

  it('the PILLAR-ONLY beat shows its share and its cadence and nothing it does not have', () => {
    // The honest thin case. Asserting the absences is the point: a fixture that quietly grew a
    // product or a series here would stop testing what this beat exists to test.
    expect(kinds(DRAFT_BEATS[4]!.id)).toEqual(['pillar', 'cadence']);
  });

  it('an experiment from a competitor carries no backlog line — there are no words of hers', () => {
    expect(kinds(DRAFT_BEATS[5]!.id)).not.toContain('backlog');
    expect(views[5]!.slotType).toBe('experiment');
  });

  it('the fixture covers every line kind the sheet can draw for an assembled beat', () => {
    // 'added' and 'thin' are excluded by construction: they belong to a client-added beat and
    // to a template month, neither of which this fixture is. Naming them here is the record
    // that they are absent on purpose rather than forgotten.
    const seen = new Set(views.flatMap((v) => groundingLines(v.evidence, v.pillar).map((l) => l.kind)));
    expect([...seen].sort()).toEqual(['backlog', 'cadence', 'format', 'pillar', 'product', 'series']);
  });
});

describe('the month summary the panel will render', () => {
  const summary = monthSummary(views, { monthName: 'September', editable: true })!;
  const section = (key: string) => summary.sections.find((s) => s.key === key);

  it('heads with the count and the span', () => {
    expect(summary.headline).toBe('8 planned posts across 5 weeks');
  });

  it('has the four sections the e2e asserts, because the fixture has the evidence for them', () => {
    expect(summary.sections.map((s) => s.key)).toEqual(
      expect.arrayContaining(['mix', 'series', 'products', 'client', 'assumptions']));
  });

  it('counts exactly the beats whose sheet shows her own words', () => {
    // One beat carries a backlogIdea; `fromClient` counts beats, not lines.
    expect(section('client')!.facts[0]!.text).toBe('1 idea you gave us in June');
    expect(section('client')!.facts[0]!.opensIdeas).toBe(true);
  });

  it('names both products, including the one that has never been featured', () => {
    const texts = section('products')!.facts.map((f) => f.text);
    expect(texts.some((t) => t.includes('the corduroy overshirt'))).toBe(true);
    expect(texts.some((t) => t.includes('the linen shirt'))).toBe(true);
  });

  it('has an ANSWERABLE assumption, which is the row the e2e taps', () => {
    const answerable = section('assumptions')!.facts.filter((f) => f.answerable);
    // Exactly one: the panel deliberately asks one thing rather than all of them.
    expect(answerable).toHaveLength(1);
    expect(answerable[0]!.text.length).toBeGreaterThan(0);
  });
});

describe('what approving this month starts', () => {
  it('the fixture’s stated counts are the arithmetic the fan-out will actually do', () => {
    // DRAFT_APPROVAL_COUNTS is written down in the fixture so the e2e asserts a number derived
    // from the data rather than one copied off the screen under test. This is the check that
    // the written-down number is true.
    expect(approvalCounts(DRAFT_BEATS)).toEqual(DRAFT_APPROVAL_COUNTS);
  });

  it('and they are not all the same number, so a wrong implementation cannot pass', () => {
    const { captions, hooks, scripts } = DRAFT_APPROVAL_COUNTS;
    expect(new Set([captions, hooks, scripts]).size).toBe(3);
  });
});

describe('the rows the seed inserts', () => {
  const rows = draftBeatRows();

  it('are ALL status=draft — one committed row would make this a committed month', () => {
    // `resolveSurfaceKind` answers 'draft' only when committedPostCount === 0, and
    // `approveDraftCore` refuses a mixed cycle outright with `mixed_state`.
    expect(rows.every((r) => r.status === 'draft')).toBe(true);
  });

  it('carry their heading in sourceMeta.title, which is where toDraftBeat reads it', () => {
    expect(rows.every((r) => typeof r.sourceMeta['title'] === 'string' && r.sourceMeta['title'])).toBe(true);
  });

  it('are dated in one month and ordered by position', () => {
    expect(rows.every((r) => r.scheduledDate.startsWith('2026-09'))).toBe(true);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('have unique ids and dates a client could still edit on the frozen today', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    // PLAN_TODAY is 2026-07-08; every September date is ahead of it, so the whole month is
    // mutable and no test is silently exercising the read-only path instead.
    expect(rows.every((r) => r.scheduledDate > '2026-07-08')).toBe(true);
  });
});
