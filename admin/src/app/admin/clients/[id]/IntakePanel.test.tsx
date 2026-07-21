/**
 * IntakePanel.test.tsx — the panel survives an intake_json the planning arc never writes.
 *
 * The crash: `existingIntake ?? defaultIntake()` only substitutes on null, so a NON-NULL
 * object missing `planContent` reached `intake.planContent.answers` and threw
 * `TypeError: undefined is not an object`. Because IntakePanel is a client component inside
 * the single client page, that took the WHOLE page down — including the OAuth section, which
 * is how a missing Gmail connection became unfixable.
 *
 * The shape below is earl-of-east's ACTUAL uat row (cycle 040d6a1a): intake_json non-null,
 * with `draftApplications` as its only top-level key. The approval arc produces it because
 * draft-apply.ts persistReceipt spreads receipts onto whatever is already there — which for
 * a draft-flow cycle is nothing.
 *
 * Rendered with react-dom/server (the admin vitest env is node), so these assert the markup
 * the browser is served rather than an internal contract.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// The panel imports its server actions, which reach @sprigly/db and parse DATABASE_URL at
// module load. Nothing here submits, so the actions are stubbed to keep this a pure render.
vi.mock('./intake-actions', () => ({
  saveIntake:    async () => ({ ok: true }),
  confirmIntake: async () => ({ ok: true }),
}));

import { renderToStaticMarkup } from 'react-dom/server';
import type { IntakeJson } from '@sprigly/engine';

import { IntakePanel, hasCapturedIntake } from './IntakePanel';

const QUESTIONS = ['What is launching?', 'Anything to avoid?'] as const;

const render = (existingIntake: IntakeJson | null) =>
  renderToStaticMarkup(
    <IntakePanel
      cycleId="cyc-1"
      cycleMonth="2026-09"
      cycleStatus="scheduled"
      clientId="client-1"
      channel="instagram"
      questions={QUESTIONS}
      existingIntake={existingIntake}
    />,
  );

/** earl-of-east, cycle 040d6a1a — verified against uat. */
const APPROVAL_ARC_SHAPE = {
  draftApplications: [
    { id: 'r1', at: '2026-07-21T09:18:50.198Z', sourceText: 'the wilderness relaunch', scope: 'month_scoped', lines: [], changedIds: [] },
  ],
} as unknown as IntakeJson;

/** ivy-t / sprigly — what the planning arc writes. */
const PLANNING_ARC_SHAPE: IntakeJson = {
  planContent:     { answers: { 'What is launching?': 'The Wilderness candle' }, freeNotes: 'keep it calm' },
  businessContext: [],
  otherChannel:    {},
  source:          'manual',
  capturedAt:      '2026-07-14T18:23:54.201Z',
};

describe('IntakePanel — an intake_json missing planContent', () => {
  it('RENDERS instead of throwing, on earl-of-east’s actual shape', () => {
    expect(() => render(APPROVAL_ARC_SHAPE)).not.toThrow();
    expect(render(APPROVAL_ARC_SHAPE)).toContain('Plan content');
  });

  it('renders on a NULL intake too (a cycle that never had one)', () => {
    expect(() => render(null)).not.toThrow();
  });

  it('says plainly that nothing was captured, rather than showing blank fields as data', () => {
    const html = render(APPROVAL_ARC_SHAPE);
    expect(html).toContain('No intake answers for this cycle');
    expect(html).toContain('nothing has been captured yet');
  });

  it('the form stays usable — this is where an admin enters the intake', () => {
    const html = render(APPROVAL_ARC_SHAPE);
    for (const q of QUESTIONS) expect(html).toContain(q);
    expect(html).toContain('<textarea');
  });

  it('does NOT invent answers — the fields are empty, not defaulted to content', () => {
    const html = render(APPROVAL_ARC_SHAPE);
    // Each question's textarea renders with no value.
    expect(html).not.toContain('The Wilderness candle');
  });
});

describe('IntakePanel — planning-arc data is unchanged', () => {
  it('renders ivy-t-shaped data with its answers intact', () => {
    const html = render(PLANNING_ARC_SHAPE);
    expect(html).toContain('The Wilderness candle');
    expect(html).toContain('keep it calm');
  });

  it('shows NO empty-state note when an intake really was captured', () => {
    expect(render(PLANNING_ARC_SHAPE)).not.toContain('No intake answers for this cycle');
  });
});

describe('hasCapturedIntake', () => {
  it('false for null, for the approval-arc shape, and for an empty planContent', () => {
    expect(hasCapturedIntake(null)).toBe(false);
    expect(hasCapturedIntake(APPROVAL_ARC_SHAPE)).toBe(false);
    expect(hasCapturedIntake({ ...PLANNING_ARC_SHAPE, planContent: { answers: {}, freeNotes: '' } })).toBe(false);
    expect(hasCapturedIntake({ ...PLANNING_ARC_SHAPE, planContent: { answers: {}, freeNotes: '   ' } })).toBe(false);
  });

  it('true when there is an answer or a free note', () => {
    expect(hasCapturedIntake(PLANNING_ARC_SHAPE)).toBe(true);
    expect(hasCapturedIntake({ ...PLANNING_ARC_SHAPE, planContent: { answers: {}, freeNotes: 'a note' } })).toBe(true);
  });
});
