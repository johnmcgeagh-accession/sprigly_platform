import { describe, it, expect, vi } from 'vitest';
import { composeProspectEmail } from './compose-prospect-email.js';
import type { ProspectBriefData } from '@sprigly/pdf-render';

// Tests the MIME composition path that gmail-reply-prospect-brief uses.
// Full deliver() tests require Gmail OAuth mocks — covered by integration tests.
// This confirms the Buffer is preserved end-to-end through the MIME composer.

const DATA: ProspectBriefData = {
  brandName: 'Ivy Tax Partners',
  url: 'ivyt.co.uk',
  preparedAt: '16 May 2026',
  spelling: { correctName: 'Ivy Tax Partners' },
  founder: {
    name: 'Jane Smith',
    background: 'Twenty years in tax.',
    employers: ['Big Four'],
    publicProfile: {},
    voiceAndTone: { description: 'Direct.', examples: [] },
    selfNamedPainPoints: [],
    caresAbout: ['Clients'],
  },
  positioning: 'HNW tax, Oxford',
  location: { registered: 'Oxford' },
  stats: [{ label: 'Founded', value: '2005' }],
  execSummary: {
    whatTheyActuallyDo: 'Personal tax advice.',
    revenueModel: 'Retainer fees.',
    distinctiveVsCorporate: 'Partner-led.',
  },
  opsTells: [],
  pipelines: [{
    rank: 1,
    name: 'Tax Return Drafting',
    qualifier: 'AI-assisted prep',
    briefIn: 'Client records',
    trigger: 'Year-end',
    workOut: 'Draft return',
    replaces: 'Six hours per client',
    whyItFits: 'Returns are templated.',
  }],
  callTactics: {
    homeworkHooks: [],
    theOneQuestion: { question: 'How long per return?', whyThisQuestion: 'Opens value.' },
    dontMention: [],
  },
  risks: [{ category: 'price-sensitivity', title: 'Price sensitivity', detail: 'HNW clients expect premium.' }],
};

describe('gmail-reply-prospect-brief — Buffer preserved in MIME output', () => {
  it('PDF Buffer bytes are base64-encoded verbatim in the attachment part', () => {
    const pdf = Buffer.from('%PDF-1.4 real content here');
    const raw = composeProspectEmail({ toEmail: 'john@aigura.co.uk', fromEmail: 'sprigly@gmail.com', data: DATA, pdf });
    // The base64 of the Buffer must appear literally in the multipart message
    expect(raw).toContain(pdf.toString('base64'));
  });

  it('PDF content is NOT replaced with "[binary]" placeholder', () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    const raw = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf });
    expect(raw).not.toContain('[binary]');
  });

  it('message contains both text/plain body part and application/pdf attachment part', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf });
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain('Content-Type: application/pdf');
  });

  it('text body contains "PDF attached." sentinel', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf });
    expect(raw).toContain('PDF attached.');
  });
});
