import { describe, it, expect } from 'vitest';
import { render } from './render.js';
import type { ProspectBriefData } from './documents/ProspectBrief.js';

const SAMPLE: ProspectBriefData = {
  brandName:  'Test Firm',
  url:        'testfirm.co.uk',
  preparedAt: '16 May 2026',
  spelling: {
    correctName: 'Test Firm',
  },
  founder: {
    name:       'Jane Smith',
    background: 'Founder with 15 years sector experience.',
    employers:  ['Firm A', 'Firm B'],
    publicProfile: {
      linkedIn: 'Active LinkedIn profile.',
    },
    voiceAndTone: {
      description: 'Direct, knowledgeable, client-focused.',
      examples:    ['Admin takes up half my week.'],
    },
    selfNamedPainPoints: [
      { quote: 'Admin takes up half my week.', source: 'LinkedIn post', year: '2024' },
    ],
    caresAbout: [
      'Client outcomes',
      'Building a sustainable practice',
    ],
  },
  positioning: 'Strategic advisory for professional services',
  location: {
    registered: 'Oxford',
    localHook:  '15 minutes from Chipping Norton.',
  },
  stats: [
    { label: 'Founded', value: '2015',   sub: 'Ten years trading' },
    { label: 'Team',    value: '6',      sub: 'Two partners + staff' },
    { label: 'Sector',  value: 'B2B' },
    { label: 'Revenue', value: 'Est.',   sub: 'Micro-entity accounts' },
    { label: 'Reviews', value: '4.8',    sub: '120 Google reviews' },
    { label: 'Cadence', value: 'Active', sub: 'Weekly LinkedIn posts' },
  ],
  execSummary: {
    whatTheyActuallyDo:    'A professional services firm focused on strategic advisory.',
    revenueModel:          'Retainer and project fees.',
    distinctiveVsCorporate: 'Partner-level relationship for every client, not a junior account manager.',
    localOrSpellingIntel:  'Oxford-based, 15 minutes from Chipping Norton.',
  },
  opsTells: [
    { icon: 'file-text',        title: 'Report production', evidence: 'Manual templated reports each quarter. Confirmed on company blog.' },
    { icon: 'mail',             title: 'Client comms',      evidence: 'Email-heavy, no CRM automation visible on contact page.' },
    { icon: 'users',            title: 'Onboarding',        evidence: 'Paper-based intake forms still in use. FAQ page references "posting documents".' },
    { icon: 'layout-dashboard', title: 'Reporting',         evidence: 'Spreadsheet dashboards. LinkedIn post mentions "Friday afternoon reports".' },
  ],
  pipelines: [
    {
      rank:        1,
      name:        'Report Drafting Assistant',
      qualifier:   'AI-assisted quarterly report generation',
      briefIn:     'Client data and previous report',
      trigger:     'End of each quarter',
      workOut:     'Draft report ready for partner review',
      replaces:    'Four hours per report per partner',
      hoursPerWeek: '~8 hrs/week',
      whyItFits:   'Reports are templated. AI excels at structured generation.',
    },
    {
      rank:        2,
      name:        'Meeting Notes to Action Summary',
      qualifier:   'One-click meeting output',
      briefIn:     'Meeting recording or notes',
      trigger:     'After every client meeting',
      workOut:     'Branded action summary email',
      replaces:    '20 minutes per meeting',
      whyItFits:   'High meeting volume. Format is predictable.',
    },
    {
      rank:        3,
      name:        'Client Intake Automation',
      qualifier:   'Structured onboarding pipeline',
      briefIn:     'Intake form data',
      trigger:     'New client signed',
      workOut:     'Populated record and welcome pack',
      replaces:    'Manual data entry and copy-paste',
      whyItFits:   'Paper forms are the biggest friction point flagged by the founder.',
    },
  ],
  callTactics: {
    homeworkHooks: [
      { label: 'Report turnaround', openingLine: 'How long does a quarterly report take from data to client?' },
      { label: 'Peak season',       openingLine: 'What breaks first when you hit your busiest month?' },
      { label: 'First automation',  openingLine: 'If you could automate one task this quarter, what would it be?' },
    ],
    theOneQuestion: {
      question:        'If reports took half the time, where would those hours actually go?',
      whyThisQuestion: 'Opens value beyond efficiency. Reveals what they actually want more time for.',
    },
    dontMention: ['Replacing staff', 'Generic AI chatbots', 'Competitor tools'],
  },
  risks: [
    { category: 'vertical-fit',     title: 'Vertical fit',  detail: 'Professional services can be slow to adopt new tools.' },
    { category: 'price-sensitivity', title: 'Price band',    detail: 'Micro-entity budget may not stretch to implementation fee.' },
    { category: 'decision-making',   title: 'Decision pace', detail: 'Single founder means fast decisions but high personal stakes.' },
    { category: 'trust-pace',        title: 'Trust pace',    detail: 'May want a reference call before committing.' },
  ],
};

describe('render', () => {
  it('returns a Buffer for prospect-brief', async () => {
    const buffer = await render('prospect-brief', SAMPLE);
    expect(Buffer.isBuffer(buffer)).toBe(true);
  }, 30_000);

  it('buffer starts with PDF magic bytes', async () => {
    const buffer = await render('prospect-brief', SAMPLE);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  }, 30_000);

  it('renders with optional fields populated', async () => {
    const buffer = await render('prospect-brief', {
      ...SAMPLE,
      meetingDate: '20 May 2026',
      spelling: { correctName: 'Test Firm', providedName: 'test firm', note: 'Capitalised correctly.' },
      location: { registered: 'Oxford', trading: 'Chipping Norton', localHook: '15 min from base.' },
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
  }, 30_000);

  it('renders with empty selfNamedPainPoints and voiceAndTone examples', async () => {
    const buffer = await render('prospect-brief', {
      ...SAMPLE,
      founder: {
        ...SAMPLE.founder,
        selfNamedPainPoints: [],
        voiceAndTone: { description: 'Measured and professional.', examples: [] },
      },
    });
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  }, 30_000);
});
