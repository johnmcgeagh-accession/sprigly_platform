import { describe, it, expect } from 'vitest';
import { composeProspectEmail } from './compose-prospect-email.js';
import type { ProspectBriefData } from '@sprigly/pdf-render';

const DATA: ProspectBriefData = {
  brandName: 'Ivy Tax Partners',
  url: 'ivyt.co.uk',
  preparedAt: '16 May 2026',
  spelling: { correctName: 'Ivy Tax Partners' },
  founder: {
    name: 'Jane Smith',
    background: 'Twenty years in tax advisory.',
    employers: ['Big Four'],
    publicProfile: {},
    voiceAndTone: { description: 'Direct.', examples: [] },
    selfNamedPainPoints: [],
    caresAbout: ['Clients'],
  },
  positioning: 'HNW tax planning, Oxford',
  location: { registered: 'Oxford' },
  stats: [{ label: 'Founded', value: '2005' }],
  execSummary: {
    whatTheyActuallyDo: 'Personal tax advice for high-net-worth individuals.',
    revenueModel: 'Retainer fees.',
    distinctiveVsCorporate: 'Partner-led relationships.',
  },
  opsTells: [],
  pipelines: [{
    rank: 1,
    name: 'Tax Return Drafting',
    qualifier: 'AI-assisted preparation',
    briefIn: 'Client records',
    trigger: 'Year-end',
    workOut: 'Draft return',
    replaces: 'Six hours per client',
    whyItFits: 'Returns are templated.',
  }],
  callTactics: {
    homeworkHooks: [],
    theOneQuestion: { question: 'How long does a return take?', whyThisQuestion: 'Opens the time discussion.' },
    dontMention: [],
  },
  risks: [{
    category: 'price-sensitivity',
    title: 'Price sensitivity',
    detail: 'HNW clients expect premium. Price point must match.',
  }],
};

const PDF = Buffer.from('%PDF-1.4 test');

describe('composeProspectEmail', () => {
  it('includes To and From headers', () => {
    const result = composeProspectEmail({ toEmail: 'john@aigura.co.uk', fromEmail: 'sprigly@gmail.com', data: DATA, pdf: PDF });
    expect(result).toContain('To: john@aigura.co.uk');
    expect(result).toContain('From: sprigly@gmail.com');
  });

  it('subject contains brand name', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('Subject: Prospect brief: Ivy Tax Partners');
  });

  it('is multipart/mixed', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('Content-Type: multipart/mixed');
  });

  it('body contains brand name and exec summary', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('Ivy Tax Partners');
    expect(result).toContain('Personal tax advice for high-net-worth individuals.');
  });

  it('body contains top pipeline', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('Tax Return Drafting');
  });

  it('body contains key risk', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('Price sensitivity');
  });

  it('includes PDF attachment with correct Content-Type', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('Content-Type: application/pdf');
    expect(result).toContain('Content-Disposition: attachment');
  });

  it('attachment filename is derived from brand name', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('Ivy-Tax-Partners-prospect-brief.pdf');
  });

  it('PDF content is base64-encoded in the attachment', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain(PDF.toString('base64'));
  });

  it('body ends with "PDF attached."', () => {
    const result = composeProspectEmail({ toEmail: 'a@b.com', fromEmail: 'c@d.com', data: DATA, pdf: PDF });
    expect(result).toContain('PDF attached.');
  });
});
