import { writeFileSync } from 'node:fs';
import { render } from './render.js';
import { registerFonts } from './fonts.js';
import type { ProspectBriefData } from './documents/ProspectBrief.js';

registerFonts();

const data: ProspectBriefData = {
  brandName: 'Ivy Tax Partners',
  url:       'ivyt.co.uk',
  spelling: {
    correctName: 'Ivy Tax Partners',
  },
  founder: {
    name: 'Two principals',
    background:
      'Two founding principals, both with tax specialism backgrounds. Built the firm from a boutique proposition. Not a spin-out of a large practice. Running a growing team while staying client-facing.',
    employers: ['Tax specialism', 'Oxford market'],
    publicProfile: {
      linkedIn: 'Active. Regular HMRC deadline reminders and year-end guidance posts. Educational in tone, not self-promotional.',
    },
    voiceAndTone: {
      description:
        'Professional and measured. Speaks to clients, not peers. LinkedIn content is practical and deadline-driven.',
      examples: [
        'Self-assessment deadline: 31 January. Get your documents in now.',
        'Year-end planning window is closing. Here is what to do before April.',
      ],
    },
    selfNamedPainPoints: [
      {
        quote:  "I'd put the accounts off till the last minute.",
        source: 'Client feedback, paraphrased from LinkedIn comment thread',
        year:   '2024',
      },
    ],
    caresAbout: [
      'Client relationships and practice quality',
      'Growing without losing the boutique standard',
      'Modernising the practice without disrupting what works',
    ],
  },
  positioning:  'HNW and SME tax planning',
  location: {
    registered: 'Oxford',
    localHook:  '20 minutes from John\'s home base. Natural local rapport on the call.',
  },
  stats: [
    { label: 'Est.',       value: '~2015',   sub: 'About ten years trading'            },
    { label: 'Team',       value: '4-6',     sub: 'Two principals and associates'      },
    { label: 'Specialism', value: 'Tax',     sub: 'HNW individuals and small firms'    },
    { label: 'Peak load',  value: 'January', sub: 'Most associate time on returns'     },
    { label: 'Portal',     value: 'Partial', sub: 'New portal, not fully live yet'     },
    { label: 'LinkedIn',   value: 'Active',  sub: 'HMRC deadline posts, regular'       },
  ],
  execSummary: {
    whatTheyActuallyDo:
      'Boutique accountancy firm based in Oxford. Two founding principals specialising in tax planning for high-net-worth individuals and small businesses. Not a generalist practice. Tax is the entire focus.',
    revenueModel:
      'Fee-based tax planning and compliance work. Mix of ongoing retainer clients (HNW) and transactional SME work. January is peak volume. Returns season concentrates demand.',
    distinctiveVsCorporate:
      'Boutique positioning is intentional. They are not trying to grow into a generalist practice. The HNW and SME specialism means clients get a partner-level relationship, not a junior account manager.',
    localOrSpellingIntel:
      'Oxford registered and trading address. 20 minutes from Chipping Norton. Local rapport is a genuine conversation opener.',
  },
  opsTells: [
    {
      icon:     'file-text',
      title:    'Tax return production',
      evidence: 'January peak consumes an estimated 60 percent of associate time. Extraction from scanned documents, manual entry into templates, anomaly checking. All sequential, all manual.',
    },
    {
      icon:     'users',
      title:    'Client onboarding',
      evidence: 'Partly paper-based. The new portal is not fully live, which means some onboarding still runs through the old paper route. Two systems in parallel is operational friction.',
    },
    {
      icon:     'layout-dashboard',
      title:    'Internal reporting',
      evidence: 'Partners spend several hours per week on internal reporting. The pattern is described as highly templated. A strong signal of automatable work.',
    },
    {
      icon:     'mail',
      title:    'HMRC deadline reminders',
      evidence: 'Active LinkedIn presence around deadlines suggests this is partly manual. Personalised client reminders sent ad hoc. Time cost scales with client volume.',
    },
    {
      icon:     'package',
      title:    'Portal handoff gap',
      evidence: 'The digital portal is partially live. Every client who has not fully migrated still triggers a manual process. The handoff between portal and legacy workflow is a recurring time sink.',
    },
    {
      icon:     'clock',
      title:    'Year-end chaser cycle',
      evidence: 'Year-end prompts clients to submit documents late. The firm chases manually by phone and email. A predictable, repeating pattern that scales poorly with more clients.',
    },
  ],
  pipelines: [
    {
      rank:        1,
      name:        'Tax Return Drafting Assistant',
      qualifier:   'AI-assisted extraction and pre-fill for January peak',
      briefIn:     'Scanned client documents: P60s, bank statements, receipts',
      trigger:     'Client submits documents, January window',
      workOut:     'Pre-filled tax return draft with anomaly flags for partner review',
      replaces:    'Manual extraction and data entry',
      hoursPerWeek: '~12 hrs/week in peak',
      whyItFits:   'The workflow is well-defined, high-volume, and templated. Peak-season ROI is immediate and measurable.',
    },
    {
      rank:        2,
      name:        'Meeting Notes to Client Summary',
      qualifier:   'One-click meeting-to-branded-summary pipeline',
      briefIn:     'Meeting recording or typed notes',
      trigger:     'End of every client meeting',
      workOut:     'Branded client summary email, ready to send',
      replaces:    '15 to 20 minutes per meeting across both principals',
      hoursPerWeek: '~3 hrs/week',
      whyItFits:   'Format is predictable. Boutique voice can be baked in. Low risk, fast payback, usable from week one.',
    },
    {
      rank:        3,
      name:        'HMRC Deadline Reminder Engine',
      qualifier:   'Automated personalised deadline reminders at scale',
      briefIn:     'Client list, deadlines calendar, preferred communication style',
      trigger:     'Scheduled: 4 weeks, 2 weeks, and 3 days before each client deadline',
      workOut:     'Personalised HMRC deadline reminder emails in the firm voice',
      replaces:    'Manual calendar watching, ad hoc outreach, and inbound deadline queries',
      whyItFits:   'LinkedIn content shows HMRC deadlines are already a client pain point. Automating removes a recurring manual task and reduces inbound noise.',
    },
    {
      rank:        4,
      name:        'HMRC Deadline Reminder Engine',
      qualifier:   'Automated personalised deadline reminders at scale',
      briefIn:     'Client list, deadlines calendar, preferred communication style',
      trigger:     'Scheduled: 4 weeks, 2 weeks, and 3 days before each client deadline',
      workOut:     'Personalised HMRC deadline reminder emails in the firm voice',
      replaces:    'Manual calendar watching, ad hoc outreach, and inbound deadline queries',
      whyItFits:   'LinkedIn content shows HMRC deadlines are already a client pain point. Automating removes a recurring manual task and reduces inbound noise.',
    },
    {
      rank:        5,
      name:        'HMRC Deadline Reminder Engine',
      qualifier:   'Automated personalised deadline reminders at scale',
      briefIn:     'Client list, deadlines calendar, preferred communication style',
      trigger:     'Scheduled: 4 weeks, 2 weeks, and 3 days before each client deadline',
      workOut:     'Personalised HMRC deadline reminder emails in the firm voice',
      replaces:    'Manual calendar watching, ad hoc outreach, and inbound deadline queries',
      whyItFits:   'LinkedIn content shows HMRC deadlines are already a client pain point. Automating removes a recurring manual task and reduces inbound noise.',
    },
  ],
  callTactics: {
    homeworkHooks: [
      {
        label:       'The portal gap',
        openingLine: 'You mentioned a new client portal. Where does that hand off to a manual process today?',
      },
      {
        label:       'The January crunch',
        openingLine: 'How do you handle the January rush? What breaks first when volume spikes?',
      },
      {
        label:       'First automation move',
        openingLine: 'If you could automate one thing this quarter, what would it be?',
      },
      {
        label:       'Associate time',
        openingLine: 'What are your associates spending most of their time on that you would rather they were not?',
      },
    ],
    theOneQuestion: {
      question:        'If January returns took half the associate time, where would those hours actually go?',
      whyThisQuestion: 'Opens the conversation on value beyond efficiency. Reveals whether they want growth capacity, reduced peak stress, or partner time back. Shapes which pipeline to lead with.',
    },
    dontMention: [
      'Replacing staff. Associates are a growth hire, not a redundancy risk.',
      'Generic AI or ChatGPT comparisons. Positions Sprigly as a commodity.',
      'Competitor software such as QuickBooks AI or FreeAgent. Flags a purchase decision they have not made yet.',
    ],
  },
  risks: [
    {
      category: 'vertical-fit',
      title:    'Vertical conservatism',
      detail:   'Accountancy practices are regulated and risk-averse. Even a boutique firm operates in a compliance environment. New tools need to feel safe, not experimental.',
    },
    {
      category: 'price-sensitivity',
      title:    'Budget band',
      detail:   'Micro-entity accounts signal a modest revenue base. The setup fee needs to feel proportionate. Lead with ROI, not features.',
    },
    {
      category: 'decision-making',
      title:    'Two-principal decision',
      detail:   'Two founding principals means two people need to agree. One champion is not enough. Identify which one is the tech-forward principal and speak to the other\'s priorities separately.',
    },
    {
      category: 'trust-pace',
      title:    'Trust pace',
      detail:   'Accountants build client relationships over years. They will apply the same lens to a vendor. A reference call from a similar practice could unlock this faster than any pitch.',
    },
    {
      category: 'scope-creep',
      title:    'Portal dependency',
      detail:   'If the pipeline needs to integrate with the new portal, scope expands. Keep Phase 1 standalone. Extraction and drafting only, no portal hooks.',
    },
    {
      category: 'competitor-risk',
      title:    'Competitor risk',
      detail:   'QuickBooks and Xero are adding AI features to their core product. If Ivy is already on one of these platforms, the question becomes "why not just wait?" Have a clear answer ready.',
    },
  ],
  meetingDate: '20 May 2026',
  preparedAt:  '16 May 2026',
};

const buffer = await render('prospect-brief', data);
const outPath = 'sample-prospect-brief.pdf';
writeFileSync(outPath, buffer);
console.log(`PDF written: ${outPath} (${buffer.length.toLocaleString()} bytes)`);
