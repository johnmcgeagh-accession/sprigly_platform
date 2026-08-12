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

describe('IntakeCapture — planning workspace (Phase 1)', () => {
  const base = {
    questions: QS, cycleId: 'cyc-1', prePlanning: true, busy: false, monthLabel: 'August 2026', cutoffLabel: '18 July',
    durable: [{ id: 'd1', type: 'idea', content: 'lean into provenance', createdAt: '2026-07-01T00:00:00Z' }],
    savedExtraction: null,
    onSubmit: vi.fn(), onClose: vi.fn(),
  };

  it('opens on the two-column workspace: one conversational input + live preview panel + mic, hints behind (?)', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: '' }} />);
    expect(html).toContain('Let’s plan August 2026 together');   // display-serif title
    expect(html).toContain('data-testid="intake-input"');        // ONE conversational input
    expect(html).toContain('data-testid="intake-preview"');      // live preview panel (right column)
    expect(html).toContain('data-testid="intake-mic"');          // mic affordance
    expect(html).toContain('data-testid="intake-hints-toggle"'); // (?) — hints are behind it
    expect(html).toContain('Save brief');                        // Send renamed (PART C)
    expect(html).not.toContain('data-testid="intake-hints"');    // hints popover closed by default
    expect(html).not.toContain('Step 1 of');                     // NOT the stepper
  });

  it('the durable input is present and renamed to the future-campaign framing', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: '' }} />);
    expect(html).toContain('data-testid="intake-durable"');
    expect(html).toContain('Not this month?');
    expect(html).toContain('worth remembering for a future campaign');
  });

  it('on return, the composer is SEEDED with the saved brief (not empty)', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: 'Launching on the 25th.' }} />);
    // the saved brief is the textarea's value — the reload fix
    expect(html).toContain('Launching on the 25th.');
  });

  it('a first-time brief leaves the composer empty so the placeholder examples still show', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: '' }} />);
    expect(html).toContain('Big launch on the 25th');   // PLACEHOLDER survives the empty case
  });

  // ── The receipt ─────────────────────────────────────────────────────────────────────
  // The returning client's question is "did that save?", so the answer is the first word.
  it('a returning client is told the brief is saved, where it is, and what happens next', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: 'Launching on the 25th.' }} />);
    expect(html).toContain('data-testid="intake-brief-receipt"');
    expect(html).toMatch(/Saved\. Your August 2026 brief is below/);
    expect(html).toContain('edit it or add to it, then save again');
    expect(html).toContain('We’ll build the month from it on 18 July');   // the real cutoff date
    expect(html).not.toContain('Continuing your August 2026 brief');      // the old, too-quiet line
  });

  it('with no cutoff date configured the receipt drops the date rather than inventing one', () => {
    const html = renderToStaticMarkup(
      <IntakeCapture {...base} cutoffLabel={null} intake={{ answers: {}, freeNotes: 'Launching on the 25th.' }} />,
    );
    expect(html).toContain('We’ll build the month from it.');
    expect(html).not.toContain('on null');
  });

  it('no receipt for a first-time brief — there is nothing yet to have saved', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: '' }} />);
    expect(html).not.toContain('data-testid="intake-brief-receipt"');
  });

  // ── The preview panel on a COLD load ────────────────────────────────────────────────
  // live.preview only exists while someone is typing, so on a reload the panel used to claim
  // it had heard nothing about a month it had already extracted into beats.
  const SAVED = {
    launches: ['Hannah in green — new'],
    dates:    [{ when: '15 Sep', label: 'launch' }],
    asks:     ['london fashion week'],
  };

  it('with a saved extraction and nothing live, the panel shows what was taken from the brief', () => {
    const html = renderToStaticMarkup(
      <IntakeCapture {...base} intake={{ answers: {}, freeNotes: 'Big launch of Hannah in green on the 15th.' }} savedExtraction={SAVED} />,
    );
    expect(html).toContain('data-testid="intake-saved-extraction"');
    expect(html).toContain('From your saved brief');
    expect(html).toContain('Hannah in green — new');
    expect(html).toContain('15 Sep');
    expect(html).not.toContain('As you type, I’ll gather it here');   // the empty state is gone
  });

  it('with no saved extraction the empty state is unchanged', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} intake={{ answers: {}, freeNotes: '' }} savedExtraction={null} />);
    expect(html).toContain('data-testid="intake-preview"');
    expect(html).toContain('As you type, I’ll gather it here');
    expect(html).not.toContain('data-testid="intake-saved-extraction"');
  });

  it('shows the post-cutoff framing when the cycle has generated', () => {
    const html = renderToStaticMarkup(<IntakeCapture {...base} prePlanning={false} intake={{ answers: {}, freeNotes: '' }} />);
    expect(html).toContain('This month has generated');
    expect(html).toContain('Send to Sprigly');   // post-cutoff button label
  });
});
