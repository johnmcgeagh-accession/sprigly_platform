import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import type { RequestEmailDeps } from './request-email.js';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@sprigly/db', () => ({
  db:            {},
  clients:       Symbol('clients'),
  clientChannels: Symbol('clientChannels'),
  contentCycles: Symbol('contentCycles'),
}));

vi.mock('drizzle-orm', () => ({
  eq:  (_col: unknown, _val: unknown) => 'eq',
  and: (..._args: unknown[]) => 'and',
}));

vi.mock('../lean-line.js', () => ({
  buildLeanLine: vi.fn(),
}));

vi.mock('./machine.js', () => ({
  transitionCycle: vi.fn(),
}));

import { buildLeanLine } from '../lean-line.js';
import { transitionCycle } from './machine.js';
import {
  runRequestEmail,
  addOneMonth,
  buildMonthLabel,
  buildBody,
  BASE_QUESTIONS,
  GREETING_INTRO,
  QUESTION_TRANSITION,
  SIGN_OFF,
} from './request-email.js';

const buildLeanLineMock   = buildLeanLine   as ReturnType<typeof vi.fn>;
const transitionCycleMock = transitionCycle as ReturnType<typeof vi.fn>;

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CYCLE_ID   = 'cycle-abc';
const CLIENT_ID  = 'client-abc';
const FOLDER_ID  = 'folder-123';

const BASE_CYCLE = {
  id:          CYCLE_ID,
  clientId:    CLIENT_ID,
  channel:     'instagram',
  cycleMonth:  '2026-05',
  status:      'scheduled',
  priorStatus: null,
};

const BASE_CONFIG: Record<string, unknown> = {
  contact_email: 'john.mcgeagh@gmail.com',
  contact_name:  'Sally',
};

/** Sequential-result mock DB: each .limit() call pops the next batch. */
function makeDb(queryResults: Array<unknown[]>): RequestEmailDeps['db'] {
  let idx = 0;
  const chain: Record<string, unknown> = {};
  chain['select']    = vi.fn().mockReturnValue(chain);
  chain['from']      = vi.fn().mockReturnValue(chain);
  chain['where']     = vi.fn().mockReturnValue(chain);
  chain['limit']     = vi.fn().mockImplementation(() => Promise.resolve(queryResults[idx++] ?? []));
  chain['update']    = vi.fn().mockReturnValue(chain);
  chain['set']       = vi.fn().mockReturnValue(chain);
  chain['returning'] = vi.fn().mockResolvedValue([]);
  return chain as unknown as RequestEmailDeps['db'];
}

function makeDefaultDb(overrides: { cycleStatus?: string; cycleMonth?: string } = {}) {
  const { cycleStatus = 'scheduled', cycleMonth = '2026-05' } = overrides;
  return makeDb([
    [{ ...BASE_CYCLE, cycleMonth, status: cycleStatus }],
    [{ name: 'Ivy T' }],
    [{ driveFolderId: FOLDER_ID }],
  ]);
}

function makeDrive(config: Record<string, unknown> = BASE_CONFIG): RequestEmailDeps['drive'] {
  return {
    listFiles:    vi.fn().mockResolvedValue([{ id: 'cfg-id', name: 'calendar-config.json' }]),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify(config))),
  } as unknown as RequestEmailDeps['drive'];
}

function makeGmail(draftId: string | null = 'draft-xyz') {
  return { createDraft: vi.fn().mockResolvedValue(draftId) };
}

function makeDeps(overrides: {
  db?:                RequestEmailDeps['db'];
  config?:            Record<string, unknown>;
  gmailDraftService?: RequestEmailDeps['gmailDraftService'];
  cycleMonth?:        string;
} = {}): RequestEmailDeps {
  const config     = overrides.config ?? BASE_CONFIG;
  const cycleMonth = overrides.cycleMonth ?? '2026-05';
  return {
    db:                overrides.db    ?? makeDefaultDb({ cycleMonth }),
    drive:             makeDrive(config),
    gmailDraftService: (overrides.gmailDraftService ?? makeGmail()) as unknown as RequestEmailDeps['gmailDraftService'],
    model:             {} as RequestEmailDeps['model'],
    logger:            { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    prompts:           { resolve: vi.fn().mockResolvedValue('system-prompt') } as RequestEmailDeps['prompts'],
  };
}

// ── addOneMonth ───────────────────────────────────────────────────────────────

describe('addOneMonth', () => {
  it('increments month within year', () => {
    expect(addOneMonth('2026-05')).toBe('2026-06');
    expect(addOneMonth('2026-01')).toBe('2026-02');
  });

  it('rolls December to January of next year', () => {
    expect(addOneMonth('2026-12')).toBe('2027-01');
  });
});

// ── buildMonthLabel ───────────────────────────────────────────────────────────

describe('buildMonthLabel', () => {
  it('formats YYYY-MM as "Month YYYY" in UK locale', () => {
    expect(buildMonthLabel('2026-06')).toBe('June 2026');
    expect(buildMonthLabel('2027-01')).toBe('January 2027');
  });
});

// ── buildBody ─────────────────────────────────────────────────────────────────

describe('buildBody', () => {
  it('structure with leanLine present: greeting, blank, intro, blank, lean, blank, transition, blank, questions, blank, sign-off', () => {
    const body = buildBody({
      greeting: 'Hi Sally,',
      leanLine: 'Leaning towards the vests.',
      questions: ['Q1', 'Q2'],
    });
    expect(body).toBe(
      'Hi Sally,\n' +
      '\n' +
      `${GREETING_INTRO}\n` +
      '\n' +
      'Leaning towards the vests.\n' +
      '\n' +
      `${QUESTION_TRANSITION}\n` +
      '\n' +
      '1. Q1\n' +
      '2. Q2\n' +
      '\n' +
      SIGN_OFF,
    );
  });

  it('omits lean section entirely when leanLine is null', () => {
    const body = buildBody({
      greeting: 'Hi there,',
      leanLine: null,
      questions: ['Q1'],
    });
    expect(body).toBe(
      'Hi there,\n' +
      '\n' +
      `${GREETING_INTRO}\n` +
      '\n' +
      `${QUESTION_TRANSITION}\n` +
      '\n' +
      '1. Q1\n' +
      '\n' +
      SIGN_OFF,
    );
    expect(body).not.toContain('\n\n\n'); // no triple blank lines
  });
});

// ── runRequestEmail ───────────────────────────────────────────────────────────

describe('runRequestEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildLeanLineMock.mockResolvedValue('The Megan dress moved 93 units.');
    transitionCycleMock.mockResolvedValue({ ...BASE_CYCLE, status: 'requested' });
  });

  // ── idempotency ─────────────────────────────────────────────────────────────

  it('returns early without drafting when cycle is already requested', async () => {
    const gmail = makeGmail();
    await runRequestEmail(
      CLIENT_ID, 'instagram', '2026-05',
      makeDeps({ db: makeDefaultDb({ cycleStatus: 'requested' }), gmailDraftService: gmail }),
    );
    expect(gmail.createDraft).not.toHaveBeenCalled();
    expect(transitionCycleMock).not.toHaveBeenCalled();
  });

  // ── subject: targetMonth label ───────────────────────────────────────────────

  it('subject uses targetMonth label: dataMonth 2026-05 produces June 2026', async () => {
    const gmail = makeGmail();
    await runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ gmailDraftService: gmail }));
    const { subject } = gmail.createDraft.mock.calls[0]![1] as { subject: string };
    expect(subject).toContain('June 2026');
    expect(subject).not.toContain('May 2026');
  });

  it('subject Dec to Jan year rollover: dataMonth 2026-12 produces January 2027', async () => {
    const gmail = makeGmail();
    await runRequestEmail(
      CLIENT_ID, 'instagram', '2026-12',
      makeDeps({ cycleMonth: '2026-12', gmailDraftService: gmail }),
    );
    const { subject } = gmail.createDraft.mock.calls[0]![1] as { subject: string };
    expect(subject).toContain('January 2027');
    expect(subject).not.toContain('December 2026');
  });

  // ── greeting ────────────────────────────────────────────────────────────────

  it('greets with contact_name when present', async () => {
    const gmail = makeGmail();
    await runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ gmailDraftService: gmail }));
    const { bodyText } = gmail.createDraft.mock.calls[0]![1] as { bodyText: string };
    expect(bodyText).toMatch(/^Hi Sally,\n/);
  });

  it('uses neutral greeting when contact_name absent and contact is an email address', async () => {
    const config = { contact_email: 'john.mcgeagh@gmail.com', contact: 'owner@brand.com' };
    const gmail  = makeGmail();
    await runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ config, gmailDraftService: gmail }));
    const { bodyText } = gmail.createDraft.mock.calls[0]![1] as { bodyText: string };
    expect(bodyText).toMatch(/^Hi there,\n/);
  });

  // ── body structure ───────────────────────────────────────────────────────────

  it('body has greeting, intro, lean line, transition, questions, sign-off in order', async () => {
    const gmail = makeGmail();
    await runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ gmailDraftService: gmail }));
    const { bodyText } = gmail.createDraft.mock.calls[0]![1] as { bodyText: string };
    const greetingPos    = bodyText.indexOf('Hi Sally,');
    const introPos       = bodyText.indexOf(GREETING_INTRO);
    const leanPos        = bodyText.indexOf('The Megan dress');
    const transitionPos  = bodyText.indexOf(QUESTION_TRANSITION);
    const q1Pos          = bodyText.indexOf('1. ');
    const signOffPos     = bodyText.indexOf('Thanks,');
    expect(greetingPos).toBeLessThan(introPos);
    expect(introPos).toBeLessThan(leanPos);
    expect(leanPos).toBeLessThan(transitionPos);
    expect(transitionPos).toBeLessThan(q1Pos);
    expect(q1Pos).toBeLessThan(signOffPos);
  });

  it('omits lean section entirely when leanLine is null; no triple blank lines', async () => {
    buildLeanLineMock.mockResolvedValue(null);
    const gmail = makeGmail();
    await runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ gmailDraftService: gmail }));
    const { bodyText } = gmail.createDraft.mock.calls[0]![1] as { bodyText: string };
    expect(bodyText).not.toContain('\n\n\n');
    const introPos      = bodyText.indexOf(GREETING_INTRO);
    const transitionPos = bodyText.indexOf(QUESTION_TRANSITION);
    expect(introPos).toBeGreaterThan(-1);
    expect(transitionPos).toBeGreaterThan(introPos);
  });

  // ── questions ────────────────────────────────────────────────────────────────

  it('appends extra_questions numbered continuously after base five', async () => {
    const config = { ...BASE_CONFIG, extra_questions: ['Collab plans?', 'New colourways?'] };
    const gmail  = makeGmail();
    await runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ config, gmailDraftService: gmail }));
    const { bodyText } = gmail.createDraft.mock.calls[0]![1] as { bodyText: string };
    expect(bodyText).toContain(`${BASE_QUESTIONS.length + 1}. Collab plans?`);
    expect(bodyText).toContain(`${BASE_QUESTIONS.length + 2}. New colourways?`);
  });

  it('base five questions only when extra_questions absent', async () => {
    const gmail = makeGmail();
    await runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ gmailDraftService: gmail }));
    const { bodyText } = gmail.createDraft.mock.calls[0]![1] as { bodyText: string };
    expect(bodyText).toContain(`${BASE_QUESTIONS.length}. ${BASE_QUESTIONS[BASE_QUESTIONS.length - 1]}`);
    expect(bodyText).not.toContain(`\n${BASE_QUESTIONS.length + 1}.`);
  });

  // ── error paths ──────────────────────────────────────────────────────────────

  it('throws without drafting when contact_email is missing from config', async () => {
    const config = { contact_name: 'Sally' }; // no contact_email
    const gmail  = makeGmail();
    await expect(
      runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ config, gmailDraftService: gmail })),
    ).rejects.toThrow('contact_email missing');
    expect(gmail.createDraft).not.toHaveBeenCalled();
    expect(transitionCycleMock).not.toHaveBeenCalled();
  });

  it('throws without transitioning when createDraft returns null', async () => {
    const gmail = makeGmail(null);
    await expect(
      runRequestEmail(CLIENT_ID, 'instagram', '2026-05', makeDeps({ gmailDraftService: gmail })),
    ).rejects.toThrow('createDraft returned null');
    expect(transitionCycleMock).not.toHaveBeenCalled();
  });
});
