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

describe('IntakeCapture pre-fill (FIX 1)', () => {
  const base = {
    questions: QS, prePlanning: true, busy: false, monthLabel: 'August 2026',
    durable: [{ id: 'd1', type: 'idea', content: 'lean into provenance', createdAt: '2026-07-01T00:00:00Z' }],
    onSubmit: vi.fn(), onClose: vi.fn(),
  };

  it('renders the saved answer for the first question on step 1', () => {
    const html = renderToStaticMarkup(
      <IntakeCapture {...base} intake={{ answers: { 'Any key dates?': 'launch on the 25th' }, freeNotes: '' }} />,
    );
    expect(html).toContain('Any key dates?');            // question heading
    expect(html).toContain('launch on the 25th');        // pre-filled answer value
    expect(html).toContain('Step 1 of 5');               // 3 questions + freeNotes + durable
  });

  it('shows the post-cutoff framing when the cycle has generated', () => {
    const html = renderToStaticMarkup(
      <IntakeCapture {...base} prePlanning={false} intake={{ answers: {}, freeNotes: '' }} />,
    );
    expect(html).toContain('This month has generated');
  });
});
