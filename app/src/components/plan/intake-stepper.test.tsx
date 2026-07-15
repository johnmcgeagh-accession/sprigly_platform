/**
 * intake stepper test (Build 5, FIX 4) — the payload builder lands the right answers/omissions
 * (skips → omitted → server merge preserves prior save), and pre-fill (FIX 1) renders the saved
 * answer on step 1. Interaction (step-through/back/review-jump) is covered by the described
 * phone-viewport pass in the report (the app vitest env is node — no jsdom for click simulation).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// IntakeCapture imports @/lib/types (type-only) — no runtime deps to mock.
import { IntakeCapture, buildIntakePayload } from './IntakeCapture';

const QS = ['Any key dates?', 'Anything new?', 'Any looks or themes?'];

describe('buildIntakePayload', () => {
  it('sends only non-empty answers — a skipped/blank question is omitted (prior save preserved by the merge)', () => {
    const p = buildIntakePayload(QS, { 'Any key dates?': 'launch on the 5th', 'Anything new?': '   ', 'Any looks or themes?': '' }, '  ', '');
    expect(p.answers).toEqual({ 'Any key dates?': 'launch on the 5th' });   // blank + whitespace omitted
    expect(p.freeNotes).toBe('');
    expect(p.durableItems).toEqual([]);
  });

  it('trims freeNotes and turns durable text into an idea item', () => {
    const p = buildIntakePayload(QS, {}, '  make Fridays warmer  ', '  Connie relaunch next quarter  ');
    expect(p.freeNotes).toBe('make Fridays warmer');
    expect(p.durableItems).toEqual([{ type: 'idea', text: 'Connie relaunch next quarter' }]);
  });
});

describe('IntakeCapture — freeform primary flow (Prompt 2)', () => {
  const base = {
    questions: QS, prePlanning: true, busy: false, monthLabel: 'August 2026',
    durable: [{ id: 'd1', type: 'idea', content: 'lean into provenance', createdAt: '2026-07-01T00:00:00Z' }],
    onSubmit: vi.fn(), onClose: vi.fn(),
  };

  it('opens on ONE freeform box, with the base questions surfaced as hints (not fields), plus a separate durable box', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: '' }} />);
    expect(html).toContain('data-testid="intake-freeform"');   // the single large box
    expect(html).toContain('data-testid="intake-hints"');      // questions as hint lines
    expect(html).toContain('Any key dates?');                  // a base question surfaces as a hint
    expect(html).toContain('data-testid="intake-durable"');    // durable stays a distinct box
    expect(html).toContain('data-testid="intake-guided-link"');// guided mode is reachable, secondary
    expect(html).not.toContain('Step 1 of');                   // NOT the stepper by default
  });

  it('pre-fills the running brief (FIX 1 / item 5): the accumulated freeNotes show as "brief so far"', () => {
    const html = renderToStaticMarkup(
      <IntakeCapture {...base} intake={{ answers: {}, freeNotes: 'Launching Wren on the 25th.' }} />,
    );
    expect(html).toContain('data-testid="intake-sofar"');
    expect(html).toContain('Launching Wren on the 25th.');
    expect(html).toContain('Add anything new');                // the input invites adding, not re-typing
  });

  it('shows the post-cutoff framing when the cycle has generated', () => {
    const html = renderToStaticMarkup(
      <IntakeCapture {...base} prePlanning={false} intake={{ answers: {}, freeNotes: '' }} />,
    );
    expect(html).toContain('This month has generated');
  });
});
