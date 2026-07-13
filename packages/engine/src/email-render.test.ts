/**
 * email-render test — the fail-loud renderer + a byte-equivalence guard proving the
 * 'plan_ready' template renders identically to the pre-migration hardcoded app-ready copy.
 * Part A/C of intake-capture Build 2.
 */
import { describe, it, expect } from 'vitest';
import { renderField, renderEmailTemplate, KNOWN_MERGE_FIELDS, unknownMergeFields, MERGE_FIELDS } from './email-render.js';

describe('unknownMergeFields (the admin editor’s publish gate)', () => {
  it('returns [] when every field is known (subject + body)', () => {
    expect(unknownMergeFields('{{clientName}}: hi', 'Hi {{contactName}}, {{intakeLink}} {{leanLine}}')).toEqual([]);
  });
  it('surfaces unknown fields (first-seen, de-duped) across subject + body', () => {
    expect(unknownMergeFields('{{clientName}} {{bogus}}', 'x {{alsoBad}} {{bogus}} {{leanLine}}')).toEqual(['bogus', 'alsoBad']);
  });
  it('the field list and descriptions cover exactly the known fields', () => {
    expect(Object.keys(MERGE_FIELDS).sort()).toEqual([...KNOWN_MERGE_FIELDS].sort());
  });
});

describe('renderField', () => {
  it('substitutes every known merge field', () => {
    const tpl = KNOWN_MERGE_FIELDS.map((f) => `${f}=<{{${f}}}>`).join(' ');
    const merge = Object.fromEntries(KNOWN_MERGE_FIELDS.map((f) => [f, f.toUpperCase()]));
    const out = renderField(tpl, merge);
    for (const f of KNOWN_MERGE_FIELDS) expect(out).toContain(`${f}=<${f.toUpperCase()}>`);
  });

  it('THROWS on an unknown merge field (fail-loud)', () => {
    expect(() => renderField('Hi {{contactName}}, {{bogusField}}', { contactName: 'Sal' }))
      .toThrow(/unknown merge field \{\{bogusField\}\}/);
  });

  it('blanks a KNOWN field with no supplied value', () => {
    expect(renderField('lead:{{leanLine}}:end', {})).toBe('lead::end');
    expect(renderField('{{contactName}} {{leanLine}}', { contactName: 'Sal' })).toBe('Sal ');
  });
});

// Seeded template fixtures (ask mirrors migration 0078 v2; the rest mirror 0077) exercised
// through the renderer. In ask v2 the intro is folded into {{leanLine}} (source-emitted, with
// its own trailing blank line), so the email reads cleanly when leanLine is blank.
const ASK = {
  subjectTemplate: '{{clientName}}: content plan for {{monthLabel}}',
  bodyTemplate: 'Hi {{contactName}},\n\n{{leanLine}}To shape next month\'s content, it\'d help to hear your thinking on a few things:\n\n{{questionsBlock}}\n\nYou can add your thoughts anytime here:\n{{intakeLink}}\n\nThanks,\nThe Sprigly Team',
};
const LAST_CALL = {
  subjectTemplate: '{{monthLabel}}: last call',
  bodyTemplate: 'Hi {{contactName}},\n\nQuick one — {{monthLabel}} generates tomorrow. If there\'s anything you\'d like in it, now\'s the moment:\n{{intakeLink}}\n\nAnd if nothing\'s planned, no problem — we\'ll build the month and you can adjust anything after.\n\nThanks,\nThe Sprigly Team',
};
const PLAN_READY = {
  subjectTemplate: '{{clientName}}: your content plan for {{monthLabel}} is ready',
  bodyTemplate: 'Hi,\n\nYour Sprigly content plan for {{monthLabel}} is ready.\n\nOpen and shape it here:\n{{appLink}}\n\nMove posts, edit captions and add ideas — your changes save as you go.\n\nBest,\nSprigly',
};

describe('seeded templates render correctly', () => {
  it('ask (v2): reads cleanly with a BLANK lean line — greeting straight to the questions, no intro, no dangling blank lines', () => {
    const { subject, body } = renderEmailTemplate(ASK, {
      clientName: 'Ivy T', monthLabel: 'August 2026', contactName: 'Sally',
      questionsBlock: '1. Any key dates?\n2. Anything new?', intakeLink: 'https://app/p/tok',
      // leanLine intentionally omitted → blank
    });
    expect(subject).toBe('Ivy T: content plan for August 2026');
    expect(body).toContain('Hi Sally,\n\nTo shape next month');   // greeting → questions, one blank line
    expect(body).not.toContain('numbers');                        // no intro when leanLine is blank
    expect(body).not.toContain('\n\n\n');                         // no dangling blank lines
    expect(body).toContain('1. Any key dates?\n2. Anything new?');
    expect(body).toContain('https://app/p/tok');
    expect(body).not.toContain('{{');
  });

  it('ask (v2): with a lean-line paragraph (source-emitted, trailing blank), the intro appears and still reads cleanly', () => {
    const leanLine = "we've taken a look at last month's numbers. Here's where the data's pointing.\n\n";
    const { body } = renderEmailTemplate(ASK, {
      contactName: 'Sally', questionsBlock: '1. Any key dates?', intakeLink: 'https://app/p/tok', leanLine,
    });
    expect(body).toContain("Hi Sally,\n\nwe've taken a look at last month's numbers. Here's where the data's pointing.\n\nTo shape next month");
    expect(body).not.toContain('\n\n\n');
  });

  it('last_call: renders the explicit absolution line', () => {
    const { body } = renderEmailTemplate(LAST_CALL, { monthLabel: 'August 2026', contactName: 'Sally', intakeLink: 'https://app/p/tok' });
    expect(body).toContain("if nothing's planned, no problem — we'll build the month and you can adjust anything after");
  });

  it('plan_ready: BYTE-EQUIVALENT to the pre-migration hardcoded sendAppReadyNotification copy', () => {
    const { subject, body } = renderEmailTemplate(PLAN_READY, {
      clientName: 'Ivy T', monthLabel: 'August 2026', appLink: 'https://app.sprigly.co.uk/p/tok123',
    });
    // These are exactly the strings the old hardcoded planning.ts copy produced for the same inputs.
    expect(subject).toBe('Ivy T: your content plan for August 2026 is ready');
    expect(body).toBe(
      'Hi,\n\nYour Sprigly content plan for August 2026 is ready.\n\n' +
      'Open and shape it here:\nhttps://app.sprigly.co.uk/p/tok123\n\n' +
      'Move posts, edit captions and add ideas — your changes save as you go.\n\nBest,\nSprigly',
    );
  });
});
