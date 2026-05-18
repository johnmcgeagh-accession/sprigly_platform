import { describe, it, expect } from 'vitest';
import { parseEmailInput } from './index.js';
import type { EmailInputSpec, ParsedEmailInput } from './index.js';

// ── Fixture spec (mirrors the prospect workflow's spec) ───────────────────────

const SPEC: EmailInputSpec = {
  subjectPrefix: 'Prospect:',
  bodyFields: [
    { key: 'url',           aliases: ['URL', 'Website'] },
    { key: 'sector',        aliases: ['Sector', 'Industry'] },
    { key: 'meetingDate',   aliases: ['Meeting date', 'Meeting'] },
    { key: 'whyInterested', aliases: ['Why interested', 'Why', 'Interest'] },
    { key: 'notes',         aliases: ['Notes'] },
  ],
};

// Asserts a non-null result; throws in tests that expect valid input.
function parse(subject: string, body = ''): ParsedEmailInput {
  const result = parseEmailInput(subject, body, SPEC);
  if (result === null) throw new Error(`Unexpected null for subject="${subject}"`);
  return result;
}

// ── Subject parsing ───────────────────────────────────────────────────────────

describe('parseEmailInput — subject matching', () => {
  it('returns null when subject does not start with the prefix', () => {
    expect(parseEmailInput('Blog: some topic', '', SPEC)).toBeNull();
    expect(parseEmailInput('Re: Prospect: Firm', '', SPEC)).toBeNull();
  });

  it('returns null when primary value after prefix is empty', () => {
    expect(parseEmailInput('Prospect:', '', SPEC)).toBeNull();
    expect(parseEmailInput('Prospect:   ', '', SPEC)).toBeNull();
  });

  it('is case-insensitive on the prefix', () => {
    expect(parse('PROSPECT: Firm').primaryValue).toBe('Firm');
    expect(parse('prospect: Firm').primaryValue).toBe('Firm');
    expect(parse('Prospect: Firm').primaryValue).toBe('Firm');
  });

  it('extracts trimmed primary value', () => {
    expect(parse('Prospect:  Ivy Tax Partners  ').primaryValue).toBe('Ivy Tax Partners');
  });

  it('returns empty bodyFields when body is empty', () => {
    const result = parse('Prospect: Test Firm');
    expect(result.primaryValue).toBe('Test Firm');
    expect(result.bodyFields).toEqual({});
  });
});

// ── Single-line body fields ───────────────────────────────────────────────────

describe('parseEmailInput — single-line body fields', () => {
  it('parses a URL field', () => {
    expect(parse('Prospect: Test', 'URL: https://test.co.uk').bodyFields['url']).toBe('https://test.co.uk');
  });

  it('parses a Sector field', () => {
    expect(parse('Prospect: Test', 'Sector: Accountancy').bodyFields['sector']).toBe('Accountancy');
  });

  it('parses a Meeting date field', () => {
    expect(parse('Prospect: Test', 'Meeting date: 22 May 2026').bodyFields['meetingDate']).toBe('22 May 2026');
  });

  it('parses a Why field (alias)', () => {
    expect(parse('Prospect: Test', 'Why: Strong LinkedIn presence').bodyFields['whyInterested']).toBe('Strong LinkedIn presence');
  });

  it('parses a Notes field', () => {
    expect(parse('Prospect: Test', 'Notes: Two principals').bodyFields['notes']).toBe('Two principals');
  });

  it('parses multiple fields from one body', () => {
    const body = 'URL: testfirm.co.uk\nSector: IFA\nMeeting date: 20 May 2026\nNotes: Local firm';
    expect(parse('Prospect: Test Firm', body).bodyFields).toMatchObject({
      url: 'testfirm.co.uk',
      sector: 'IFA',
      meetingDate: '20 May 2026',
      notes: 'Local firm',
    });
  });

  it('ignores unrecognised field labels', () => {
    expect(parse('Prospect: Test', 'Unknown: value').bodyFields).toEqual({});
  });

  it('ignores lines before the first field declaration', () => {
    const body = 'some preamble text\nURL: https://test.co.uk';
    expect(parse('Prospect: Test', body).bodyFields['url']).toBe('https://test.co.uk');
  });
});

// ── Alias matching ────────────────────────────────────────────────────────────

describe('parseEmailInput — alias matching', () => {
  it('matches field by canonical key (lowercase)', () => {
    expect(parse('Prospect: Test', 'url: https://test.co.uk').bodyFields['url']).toBe('https://test.co.uk');
  });

  it('matches URL field via Website alias', () => {
    expect(parse('Prospect: Test', 'Website: https://test.co.uk').bodyFields['url']).toBe('https://test.co.uk');
    expect(parse('Prospect: Test', 'WEBSITE: https://test.co.uk').bodyFields['url']).toBe('https://test.co.uk');
  });

  it('matches sector field via Industry alias', () => {
    expect(parse('Prospect: Test', 'Industry: Accountancy').bodyFields['sector']).toBe('Accountancy');
  });

  it('matches meetingDate via Meeting alias and case variations', () => {
    expect(parse('Prospect: Test', 'Meeting: 22 May 2026').bodyFields['meetingDate']).toBe('22 May 2026');
    expect(parse('Prospect: Test', 'MEETING DATE: 22 May 2026').bodyFields['meetingDate']).toBe('22 May 2026');
  });

  it('matches whyInterested via Why interested and Interest aliases', () => {
    expect(parse('Prospect: Test', 'Why interested: Strong LinkedIn').bodyFields['whyInterested']).toBe('Strong LinkedIn');
    expect(parse('Prospect: Test', 'Interest: Strong LinkedIn').bodyFields['whyInterested']).toBe('Strong LinkedIn');
  });
});

// ── Multi-line continuation ───────────────────────────────────────────────────

describe('parseEmailInput — multi-line continuation', () => {
  it('accumulates continuation lines joined by \\n', () => {
    const body = [
      'Why: Strong LinkedIn presence',
      'attended networking events',
      'relevant to professional services sector',
    ].join('\n');
    expect(parse('Prospect: Test', body).bodyFields['whyInterested']).toBe(
      'Strong LinkedIn presence\nattended networking events\nrelevant to professional services sector',
    );
  });

  it('stops accumulation when the next known field starts', () => {
    const body = [
      'Why: reason one',
      'continued reason',
      'Meeting date: 22 May 2026',
    ].join('\n');
    const result = parse('Prospect: Test', body);
    expect(result.bodyFields['whyInterested']).toBe('reason one\ncontinued reason');
    expect(result.bodyFields['meetingDate']).toBe('22 May 2026');
  });

  it('handles a field with empty first-line value followed by continuation', () => {
    const body = 'Notes:\nTwo principals\nboutique positioning';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('Two principals\nboutique positioning');
  });
});

// ── Blank lines: preserved as paragraph separators ───────────────────────────

describe('parseEmailInput — blank lines preserved as paragraph separators', () => {
  // Blank continuation lines are preserved as \n\n (paragraph breaks), not
  // stripped. This preserves the user's paragraph structure in Notes / Why
  // fields, which downstream prompts render with original formatting intact.

  it('preserves a single blank line between continuation lines as \\n\\n', () => {
    const body = 'Notes: First paragraph\n\nSecond paragraph';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('First paragraph\n\nSecond paragraph');
  });

  it('collapses multiple consecutive blank lines to a single \\n\\n', () => {
    const body = 'Notes: First paragraph\n\n\nSecond paragraph';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('First paragraph\n\nSecond paragraph');
  });

  it('drops leading blank lines within a field value', () => {
    const body = 'Notes:\n\nFirst paragraph';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('First paragraph');
  });

  it('drops trailing blank lines within a field value', () => {
    const body = 'Notes: Last paragraph\n\n\nMeeting date: 22 May 2026';
    const result = parse('Prospect: Test', body);
    expect(result.bodyFields['notes']).toBe('Last paragraph');
    expect(result.bodyFields['meetingDate']).toBe('22 May 2026');
  });

  it('blank line followed by next field declaration closes the current field cleanly', () => {
    const body = ['Notes: Two principals', '', 'Meeting date: 22 May 2026'].join('\n');
    const result = parse('Prospect: Test', body);
    expect(result.bodyFields['notes']).toBe('Two principals');
    expect(result.bodyFields['meetingDate']).toBe('22 May 2026');
  });

  it('three-paragraph notes field preserves both paragraph breaks', () => {
    const body = 'Notes: Para one\n\nPara two\n\nPara three';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('Para one\n\nPara two\n\nPara three');
  });
});

// ── Colon-in-continuation edge cases ─────────────────────────────────────────

describe('parseEmailInput — continuation lines containing colons', () => {
  it('does not misread "ratio 2:1" as a new field (digit before colon)', () => {
    const body = [
      'Notes: Fee model is unusual',
      'approximately 2:1 fixed vs variable charges',
      'Meeting date: 22 May 2026',
    ].join('\n');
    const result = parse('Prospect: Test', body);
    expect(result.bodyFields['notes']).toBe(
      'Fee model is unusual\napproximately 2:1 fixed vs variable charges',
    );
    expect(result.bodyFields['meetingDate']).toBe('22 May 2026');
  });

  it('does not misread "https://..." as a new field (no space after colon)', () => {
    const body = ['URL: https://example.com', 'https://linkedin.com/company/example'].join('\n');
    expect(parse('Prospect: Test', body).bodyFields['url']).toBe(
      'https://example.com\nhttps://linkedin.com/company/example',
    );
  });

  it('does not misread "site:linkedin.com" continuation as a new field', () => {
    const body = 'Notes: search tip: site:linkedin.com works well';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe(
      'search tip: site:linkedin.com works well',
    );
  });

  it('does not misread an all-digit "3:2" continuation as a new field', () => {
    const body = 'Notes: split\n3:2 in favour';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('split\n3:2 in favour');
  });
});

// ── Unknown field isolation ───────────────────────────────────────────────────

describe('parseEmailInput — unknown field isolation', () => {
  it('unknown field closes previous known field; its continuation is discarded', () => {
    const body = [
      'Why: reason one',
      'Unknown field: some value',
      'should not be appended to Why',
      'Meeting date: 22 May 2026',
    ].join('\n');
    const result = parse('Prospect: Test Firm', body);
    expect(result.bodyFields['whyInterested']).toBe('reason one');
    expect(result.bodyFields['meetingDate']).toBe('22 May 2026');
    expect(Object.keys(result.bodyFields)).not.toContain('unknown field');
  });

  it('unknown field with colon-containing continuation does not leak into next known field', () => {
    const body = [
      'Notes: note one',
      'Custom label: ignored value',
      'continuation of custom: still ignored',
      'Sector: Accountancy',
    ].join('\n');
    const result = parse('Prospect: Test', body);
    expect(result.bodyFields['notes']).toBe('note one');
    expect(result.bodyFields['sector']).toBe('Accountancy');
  });
});

// ── Whitespace handling ───────────────────────────────────────────────────────

describe('parseEmailInput — whitespace handling', () => {
  it('strips trailing whitespace from continuation lines', () => {
    const body = 'Notes: Two principals   \nboutique positioning   ';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('Two principals\nboutique positioning');
  });

  it('strips trailing whitespace from single-line field values', () => {
    expect(parse('Prospect: Test', 'Sector: Accountancy   ').bodyFields['sector']).toBe('Accountancy');
  });

  it('handles lines with only whitespace as blank lines', () => {
    const body = 'Notes: para one\n   \npara two';
    expect(parse('Prospect: Test', body).bodyFields['notes']).toBe('para one\n\npara two');
  });
});

// ── Line ending normalisation ─────────────────────────────────────────────────

describe('parseEmailInput — line endings', () => {
  it('handles CRLF line endings identically to LF', () => {
    const body = 'URL: https://example.com\r\nSector: Accountancy\r\nMeeting date: 22 May 2026';
    expect(parse('Prospect: Test', body).bodyFields).toMatchObject({
      url: 'https://example.com',
      sector: 'Accountancy',
      meetingDate: '22 May 2026',
    });
  });

  it('handles mixed CRLF and LF in the same body', () => {
    const body = 'URL: https://example.com\r\nSector: Accountancy\nNotes: note here';
    const result = parse('Prospect: Test', body);
    expect(result.bodyFields['url']).toBe('https://example.com');
    expect(result.bodyFields['sector']).toBe('Accountancy');
    expect(result.bodyFields['notes']).toBe('note here');
  });
});
