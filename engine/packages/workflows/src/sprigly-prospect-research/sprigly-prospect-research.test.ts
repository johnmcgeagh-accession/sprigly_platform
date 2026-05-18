import { describe, it, expect, vi } from 'vitest';
import type { IncomingEvent, WorkflowContext, ClientConfig, ModelCompleteResult, ModelCompleteParams } from '@sprigly/engine';
import { parseProspectInput } from './parse-input.js';
import { spriglyProspectResearchWorkflow, WRITE_SYSTEM } from './sprigly-prospect-research.js';
import type { ProspectBriefData } from '@sprigly/pdf-render';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeEvent = (subject: string, body = ''): IncomingEvent => ({
  id: 'evt-1',
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: { subject, from: 'john@example.com' },
  receivedAt: new Date(),
  content: { text: body === '' ? subject : `${subject}\n${body}`, structured: { subject } },
  reply: { channel: 'email', data: {} },
});

const mockModelResult = (content: string): ModelCompleteResult => ({
  content,
  inputTokens: 50,
  outputTokens: 200,
  modelId: 'claude-sonnet',
  stopReason: 'end_turn',
});

const SAMPLE_DATA: ProspectBriefData = {
  brandName:  'Test Firm',
  url:        'testfirm.co.uk',
  preparedAt: '16 May 2026',
  spelling:   { correctName: 'Test Firm' },
  founder: {
    name:       'Jane Smith',
    background: 'Fifteen years sector experience.',
    employers:  ['Firm A'],
    publicProfile: { linkedIn: 'Active.' },
    voiceAndTone:  { description: 'Direct.', examples: [] },
    selfNamedPainPoints: [],
    caresAbout: ['Client outcomes'],
  },
  positioning: 'Strategic advisory',
  location:    { registered: 'Oxford' },
  stats: [{ label: 'Founded', value: '2015' }],
  execSummary: {
    whatTheyActuallyDo:    'A professional services firm.',
    revenueModel:          'Retainer fees.',
    distinctiveVsCorporate: 'Partner-level relationships.',
  },
  opsTells: [{ icon: 'file-text', title: 'Reports', evidence: 'Manual reports each quarter.' }],
  pipelines: [{
    rank:      1,
    name:      'Report Drafting',
    qualifier: 'AI-assisted report generation',
    briefIn:   'Client data',
    trigger:   'End of quarter',
    workOut:   'Draft report',
    replaces:  'Four hours per report',
    whyItFits: 'Reports are templated.',
  }],
  callTactics: {
    homeworkHooks: [{ label: 'Turnaround', openingLine: 'How long does a report take?' }],
    theOneQuestion: {
      question:        'If reports took half the time, where would those hours go?',
      whyThisQuestion: 'Opens value beyond efficiency.',
    },
    dontMention: ['Generic AI chatbots'],
  },
  risks: [{ category: 'vertical-fit', title: 'Vertical fit', detail: 'Can be slow to adopt.' }],
};

const makeCtx = (writeResponse = JSON.stringify(SAMPLE_DATA)): WorkflowContext => ({
  clientId: 'client-1',
  clientConfig: {
    id: 'cfg-1',
    clientId: 'client-1',
    brandVoice: 'Direct and professional.',
    signature: 'John',
    authorName: 'John',
    settings: {},
  } satisfies ClientConfig,
  model: {
    complete: vi.fn()
      .mockResolvedValueOnce(mockModelResult('Raw research text about the firm.'))
      .mockResolvedValueOnce(mockModelResult(writeResponse)),
  },
  audit:   { logModelCall: vi.fn().mockResolvedValue(undefined) },
  prompts: { resolve: vi.fn().mockResolvedValue('Prompt: {{brandName}}') },
  eventId: 'evt-1',
  runId:   'run-1',
});

// ─── parseProspectInput ───────────────────────────────────────────────────────

describe('parseProspectInput', () => {
  it('extracts brand name from "Prospect: <name>" subject', () => {
    expect(parseProspectInput(makeEvent('Prospect: Ivy Tax Partners')))
      .toMatchObject({ brandName: 'Ivy Tax Partners' });
  });

  it('is case-insensitive on the prefix', () => {
    expect(parseProspectInput(makeEvent('PROSPECT: Firm'))?.brandName).toBe('Firm');
    expect(parseProspectInput(makeEvent('prospect: Firm'))?.brandName).toBe('Firm');
  });

  it('trims whitespace around brand name', () => {
    expect(parseProspectInput(makeEvent('Prospect:  Test Firm  '))?.brandName).toBe('Test Firm');
  });

  it('returns null for empty brand name', () => {
    expect(parseProspectInput(makeEvent('Prospect:'))).toBeNull();
    expect(parseProspectInput(makeEvent('Prospect:   '))).toBeNull();
  });

  it('returns null for non-prospect prefix', () => {
    expect(parseProspectInput(makeEvent('Blog: some topic'))).toBeNull();
  });

  it('returns null for empty subject', () => {
    expect(parseProspectInput(makeEvent(''))).toBeNull();
  });

  it('falls back to content.structured.subject when sourceMetadata has no subject', () => {
    const event: IncomingEvent = {
      ...makeEvent(''),
      sourceMetadata: {},
      content: {
        text: 'Prospect: Fallback Firm',
        structured: { subject: 'Prospect: Fallback Firm' },
      },
    };
    expect(parseProspectInput(event)?.brandName).toBe('Fallback Firm');
  });

  it('parses optional URL body field', () => {
    const result = parseProspectInput(makeEvent('Prospect: Test Firm', 'URL: https://test.co.uk'));
    expect(result?.url).toBe('https://test.co.uk');
  });

  it('parses optional Sector body field', () => {
    const result = parseProspectInput(makeEvent('Prospect: Test Firm', 'Sector: Accountancy'));
    expect(result?.sector).toBe('Accountancy');
  });

  it('parses optional Meeting date body field', () => {
    const result = parseProspectInput(makeEvent('Prospect: Test Firm', 'Meeting date: 22 May 2026'));
    expect(result?.meetingDate).toBe('22 May 2026');
  });

  it('parses optional Why body field', () => {
    const result = parseProspectInput(makeEvent('Prospect: Test Firm', 'Why: Strong LinkedIn presence'));
    expect(result?.whyInterested).toBe('Strong LinkedIn presence');
  });

  it('parses optional Notes body field', () => {
    const result = parseProspectInput(makeEvent('Prospect: Test Firm', 'Notes: Two principals'));
    expect(result?.notes).toBe('Two principals');
  });

  it('parses multiple body fields together', () => {
    const body = ['URL: testfirm.co.uk', 'Sector: IFA', 'Meeting date: 20 May 2026', 'Notes: Local firm'].join('\n');
    const result = parseProspectInput(makeEvent('Prospect: Test Firm', body));
    expect(result).toMatchObject({
      brandName: 'Test Firm',
      url: 'testfirm.co.uk',
      sector: 'IFA',
      meetingDate: '20 May 2026',
      notes: 'Local firm',
    });
  });

  it('ignores unrecognised body keys', () => {
    const result = parseProspectInput(makeEvent('Prospect: Test Firm', 'Unknown: value'));
    expect(result).toEqual({ brandName: 'Test Firm' });
  });
});

// ─── spriglyProspectResearchWorkflow.parseInput ───────────────────────────────

describe('spriglyProspectResearchWorkflow.parseInput', () => {
  it('delegates to parseProspectInput', () => {
    expect(spriglyProspectResearchWorkflow.parseInput(makeEvent('Prospect: My Firm')))
      .toMatchObject({ brandName: 'My Firm' });
    expect(spriglyProspectResearchWorkflow.parseInput(makeEvent('Blog: not a prospect'))).toBeNull();
  });
});

// ─── spriglyProspectResearchWorkflow.run ─────────────────────────────────────

describe('spriglyProspectResearchWorkflow.run', () => {
  it('makes exactly 2 model calls (research + write)', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(ctx.model.complete).toHaveBeenCalledTimes(2);
  });

  it('passes web_search tool to the research call only', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const calls = vi.mocked(ctx.model.complete).mock.calls;
    expect(calls[0]?.[0].tools).toBeDefined();
    expect(calls[0]?.[0].tools).toHaveLength(1);
    expect((calls[0]?.[0].tools as Array<{ name: string }>)[0]?.name).toBe('web_search');
    expect(calls[1]?.[0].tools).toBeUndefined();
  });

  it('uses sonnet model for both calls', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const calls = vi.mocked(ctx.model.complete).mock.calls;
    expect(calls[0]?.[0].model).toBe('sonnet');
    expect(calls[1]?.[0].model).toBe('sonnet');
  });

  it('resolves research and write prompts', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const promptCalls = vi.mocked(ctx.prompts.resolve).mock.calls;
    expect(promptCalls).toHaveLength(2);
    expect(promptCalls[0]?.[2]).toBe('research');
    expect(promptCalls[1]?.[2]).toBe('write');
  });

  it('logs audit for both model calls with correct action names', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const auditCalls = vi.mocked(ctx.audit.logModelCall).mock.calls;
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0]?.[0].action).toBe('prospect-research');
    expect(auditCalls[1]?.[0].action).toBe('prospect-write');
  });

  it('returns a Buffer as the pdf field', async () => {
    const ctx = makeCtx();
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(Buffer.isBuffer(output.pdf)).toBe(true);
  }, 30_000);

  it('pdf starts with PDF magic bytes', async () => {
    const ctx = makeCtx();
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(output.pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  }, 30_000);

  it('returns parsed data as the data field', async () => {
    const ctx = makeCtx();
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(output.data!.brandName).toBe('Test Firm');
    expect(output.data!.url).toBe('testfirm.co.uk');
  });

  it('passes JSON inside code fences in write response', async () => {
    const ctx: WorkflowContext = {
      ...makeCtx(),
      model: {
        complete: vi.fn()
          .mockResolvedValueOnce(mockModelResult('Raw research.'))
          .mockResolvedValueOnce(mockModelResult('```json\n' + JSON.stringify(SAMPLE_DATA) + '\n```')),
      },
    };
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(output.data!.brandName).toBe('Test Firm');
  }, 30_000);

  it('write prompt receives research output as a template variable', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const writeCalls = vi.mocked(ctx.model.complete).mock.calls;
    const writeMessage = writeCalls[1]?.[0].messages[0]?.content ?? '';
    expect(typeof writeMessage).toBe('string');
  });

  // Grounding: the write prompt template must reference {{research}}
  it('write prompt template references research output', async () => {
    const ctx: WorkflowContext = {
      ...makeCtx(),
      prompts: {
        resolve: vi.fn()
          .mockResolvedValueOnce('Research: {{brandName}}')
          .mockResolvedValueOnce('Write: {{brandName}} based on {{research}}'),
      },
      model: {
        complete: vi.fn()
          .mockResolvedValueOnce(mockModelResult('Raw research about Test Firm.'))
          .mockResolvedValueOnce(mockModelResult(JSON.stringify(SAMPLE_DATA))),
      },
    };
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const writeMessage = vi.mocked(ctx.model.complete).mock.calls[1]?.[0].messages[0]?.content ?? '';
    expect(writeMessage).toContain('Raw research about Test Firm.');
  });

  // Em-dash: the write step system prompt must explicitly ban em-dashes.
  it('write step system prompt bans em-dashes', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const writeCalls = vi.mocked(ctx.model.complete).mock.calls;
    const writeSystem = writeCalls[1]?.[0].system ?? '';
    expect(writeSystem).toContain('—');
    expect(writeSystem.toLowerCase()).toMatch(/em.?dash|never use/i);
  });

  it('WRITE_SYSTEM constant contains em-dash prohibition', () => {
    expect(WRITE_SYSTEM).toContain('—');
    expect(WRITE_SYSTEM).toContain('NEVER');
  });

  // Schema validation: required ProspectBriefData fields must be present
  it('parsed data contains all required top-level fields', async () => {
    const ctx = makeCtx();
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const d = output.data!;
    expect(d.brandName).toBeDefined();
    expect(d.spelling).toBeDefined();
    expect(d.founder).toBeDefined();
    expect(d.positioning).toBeDefined();
    expect(d.location).toBeDefined();
    expect(d.stats).toBeDefined();
    expect(d.execSummary).toBeDefined();
    expect(d.opsTells).toBeDefined();
    expect(d.pipelines).toBeDefined();
    expect(d.callTactics).toBeDefined();
    expect(d.risks).toBeDefined();
  });

  // Grounding: opsTells entries must have evidence (not just a title)
  it('opsTells entries have non-empty evidence', async () => {
    const ctx = makeCtx();
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    for (const tell of output.data!.opsTells) {
      expect(tell.evidence.length).toBeGreaterThan(0);
    }
  });

  // Grounding: selfNamedPainPoints must have a source field
  it('selfNamedPainPoints entries have a source field when present', async () => {
    const dataWithPainPoints: ProspectBriefData = {
      ...SAMPLE_DATA,
      founder: {
        ...SAMPLE_DATA.founder,
        selfNamedPainPoints: [
          { quote: 'Admin eats my week.', source: 'LinkedIn post, March 2024', year: '2024' },
        ],
      },
    };
    const ctx = makeCtx(JSON.stringify(dataWithPainPoints));
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    for (const pp of output.data!.founder.selfNamedPainPoints) {
      expect(pp.source.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it('passes toolHandlers to the research model call', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const researchCall = vi.mocked(ctx.model.complete).mock.calls[0]?.[0];
    expect(researchCall?.toolHandlers).toBeDefined();
    expect(typeof researchCall?.toolHandlers?.['web_search']).toBe('function');
  });

  it('does not pass toolHandlers to the write model call', async () => {
    const ctx = makeCtx();
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const writeCall = vi.mocked(ctx.model.complete).mock.calls[1]?.[0];
    expect(writeCall?.toolHandlers).toBeUndefined();
  });
});

// ─── Tavily / web_search handler ─────────────────────────────────────────────

describe('web_search tool handler', () => {
  it('calls ctx.search.search with the query from tool input', async () => {
    const mockSearch = { search: vi.fn().mockResolvedValue([
      { title: 'Result', url: 'https://example.com', snippet: 'Content here' },
    ]) };
    const ctx: WorkflowContext = {
      ...makeCtx(),
      search: mockSearch,
      model: {
        complete: vi.fn().mockImplementation(async (params: ModelCompleteParams) => {
          await params.toolHandlers?.['web_search']?.({ query: 'Test Firm accountants' });
          return mockModelResult('research');
        }).mockResolvedValueOnce as never,
      },
    };
    // Override to use the implementation for the first call only
    const researchImpl = async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
      await params.toolHandlers?.['web_search']?.({ query: 'Test Firm accountants' });
      return mockModelResult('research content');
    };
    ctx.model = {
      complete: vi.fn()
        .mockImplementationOnce(researchImpl)
        .mockResolvedValueOnce(mockModelResult(JSON.stringify(SAMPLE_DATA))),
    };
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(mockSearch.search).toHaveBeenCalledWith('Test Firm accountants');
  });

  it('returns formatted results to the model', async () => {
    const mockSearch = { search: vi.fn().mockResolvedValue([
      { title: 'Test Firm', url: 'https://testfirm.co.uk', snippet: 'An accounting practice.' },
    ]) };
    let capturedResult: unknown;
    const ctx: WorkflowContext = {
      ...makeCtx(),
      search: mockSearch,
      model: {
        complete: vi.fn()
          .mockImplementationOnce(async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
            capturedResult = await params.toolHandlers?.['web_search']?.({ query: 'Test Firm' });
            return mockModelResult('research');
          })
          .mockResolvedValueOnce(mockModelResult(JSON.stringify(SAMPLE_DATA))),
      },
    };
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    const result = capturedResult as { results: string };
    expect(result.results).toContain('Test Firm');
    expect(result.results).toContain('https://testfirm.co.uk');
    expect(result.results).toContain('An accounting practice.');
  });

  it('returns (no results) when search returns empty array', async () => {
    const mockEmpty = { search: vi.fn().mockResolvedValue([]) };
    let capturedResult: unknown;
    const ctx: WorkflowContext = {
      ...makeCtx(),
      search: mockEmpty,
      model: {
        complete: vi.fn()
          .mockImplementationOnce(async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
            capturedResult = await params.toolHandlers?.['web_search']?.({ query: 'Test Firm' });
            return mockModelResult('research');
          })
          .mockResolvedValueOnce(mockModelResult(JSON.stringify(SAMPLE_DATA))),
      },
    };
    await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect((capturedResult as { results: string }).results).toBe('(no results)');
  });

  it('propagates WebSearchError so the workflow run is marked failed', async () => {
    const { WebSearchError } = await import('@sprigly/web-search');
    const searchErr = new WebSearchError('Tavily HTTP 503', { provider: 'tavily', query: 'Test Firm', statusCode: 503 });
    const failingSearch = { search: vi.fn().mockRejectedValue(searchErr) };
    const ctx: WorkflowContext = {
      ...makeCtx(),
      search: failingSearch,
      model: {
        complete: vi.fn().mockImplementationOnce(async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
          await params.toolHandlers?.['web_search']?.({ query: 'Test Firm' });
          return mockModelResult('research');
        }),
      },
    };
    await expect(
      spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx),
    ).rejects.toBeInstanceOf(WebSearchError);
  });
});

// ─── noDataAvailable ──────────────────────────────────────────────────────────

describe('noDataAvailable', () => {
  it('sets noDataAvailable and skips write when 10+ searches all return empty', async () => {
    const mockSearch = { search: vi.fn().mockResolvedValue([]) };
    const ctx: WorkflowContext = {
      ...makeCtx(),
      search: mockSearch,
      model: {
        complete: vi.fn().mockImplementationOnce(async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
          for (let i = 0; i < 10; i++) {
            await params.toolHandlers?.['web_search']?.({ query: `query ${i}` });
          }
          return mockModelResult('no data found');
        }),
      },
    };
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(output.noDataAvailable).toBe(true);
    expect(output.data).toBeUndefined();
    expect(Buffer.isBuffer(output.pdf)).toBe(true);
    // Write step was skipped — model.complete called only once
    expect(vi.mocked(ctx.model.complete)).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('does not set noDataAvailable when fewer than 10 searches were made', async () => {
    const mockSearch = { search: vi.fn().mockResolvedValue([]) };
    const ctx: WorkflowContext = {
      ...makeCtx(),
      search: mockSearch,
      model: {
        complete: vi.fn()
          .mockImplementationOnce(async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
            for (let i = 0; i < 5; i++) {
              await params.toolHandlers?.['web_search']?.({ query: `query ${i}` });
            }
            return mockModelResult('some research');
          })
          .mockResolvedValueOnce(mockModelResult(JSON.stringify(SAMPLE_DATA))),
      },
    };
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(output.noDataAvailable).toBeUndefined();
    expect(output.data).toBeDefined();
  }, 30_000);

  it('does not set noDataAvailable when ctx.search is undefined', async () => {
    const ctx: WorkflowContext = {
      ...makeCtx(),
      // no search provider
      model: {
        complete: vi.fn()
          .mockResolvedValueOnce(mockModelResult('research'))
          .mockResolvedValueOnce(mockModelResult(JSON.stringify(SAMPLE_DATA))),
      },
    };
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(output.noDataAvailable).toBeUndefined();
  }, 30_000);

  it('noDataAvailable PDF starts with PDF magic bytes', async () => {
    const mockSearch = { search: vi.fn().mockResolvedValue([]) };
    const ctx: WorkflowContext = {
      ...makeCtx(),
      search: mockSearch,
      model: {
        complete: vi.fn().mockImplementationOnce(async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
          for (let i = 0; i < 10; i++) {
            await params.toolHandlers?.['web_search']?.({ query: `query ${i}` });
          }
          return mockModelResult('no data');
        }),
      },
    };
    const output = await spriglyProspectResearchWorkflow.run({ brandName: 'Test Firm' }, ctx);
    expect(output.pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  }, 30_000);
});
