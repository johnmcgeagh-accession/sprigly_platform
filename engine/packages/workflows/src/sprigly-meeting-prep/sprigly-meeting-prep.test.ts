import { describe, it, expect, vi } from 'vitest';
import type { IncomingEvent, WorkflowContext, ClientConfig, ModelCompleteResult } from '@sprigly/engine';
import { parseMeetingPrepInput } from './parse-input.js';
import { spriglyMeetingPrepWorkflow } from './sprigly-meeting-prep.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeEvent = (subject: string, body = ''): IncomingEvent => ({
  id: 'evt-1',
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: { subject, from: 'john@example.com' },
  receivedAt: new Date(),
  content: { text: body === '' ? subject : (subject + '\n' + body), structured: { subject } },
  reply: { channel: 'email', data: {} },
});

const mockModelResult = (content: string): ModelCompleteResult => ({
  content,
  inputTokens: 50,
  outputTokens: 200,
  modelId: 'claude-sonnet',
  stopReason: 'end_turn',
});

const makeCtx = (): WorkflowContext => ({
  clientId: 'client-1',
  clientConfig: {
    id: 'cfg-1', clientId: 'client-1',
    brandVoice: 'Direct and professional.',
    signature: 'John', authorName: 'John', settings: {},
  } satisfies ClientConfig,
  model:   { complete: vi.fn().mockResolvedValue(mockModelResult('Generated output.')) },
  audit:   { logModelCall: vi.fn().mockResolvedValue(undefined) },
  prompts: { resolve: vi.fn().mockResolvedValue('Prepare for: {{topic}}\nNotes: {{notes}}') },
  eventId: 'evt-1',
  runId:   'run-1',
});

// ─── parseMeetingPrepInput ─────────────────────────────────────────────────

describe('parseMeetingPrepInput', () => {
  it('parses minimal valid input', () => {
    const result = parseMeetingPrepInput(makeEvent('Meeting Prep: My Topic'));
    expect(result).toMatchObject({ topic: 'My Topic' });
  });

  it('parses notes body field', () => {
    // TODO: expand once you add more body fields to SPEC
    const result = parseMeetingPrepInput(makeEvent('Meeting Prep: My Topic', 'Notes: bring slides'));
    expect(result).toMatchObject({ topic: 'My Topic', notes: 'bring slides' });
  });

  it('returns null for non-matching subject', () => {
    expect(parseMeetingPrepInput(makeEvent('Prospect: some firm'))).toBeNull();
  });

  it('returns null for empty primary value', () => {
    expect(parseMeetingPrepInput(makeEvent('Meeting Prep:'))).toBeNull();
    expect(parseMeetingPrepInput(makeEvent('Meeting Prep:   '))).toBeNull();
  });

  it('is case-insensitive on the prefix', () => {
    expect(parseMeetingPrepInput(makeEvent('MEETING PREP: Firm'))?.topic).toBe('Firm');
  });

  it('falls back to content.structured.subject when sourceMetadata has no subject', () => {
    const event: IncomingEvent = {
      ...makeEvent(''),
      sourceMetadata: {},
      content: { text: 'Meeting Prep: Fallback Firm', structured: { subject: 'Meeting Prep: Fallback Firm' } },
    };
    expect(parseMeetingPrepInput(event)?.topic).toBe('Fallback Firm');
  });
});

// ─── spriglyMeetingPrepWorkflow.parseInput ──────────────────────────────────────────

describe('spriglyMeetingPrepWorkflow.parseInput', () => {
  it('delegates to parseMeetingPrepInput', () => {
    expect(spriglyMeetingPrepWorkflow.parseInput(makeEvent('Meeting Prep: Firm')))
      .toMatchObject({ topic: 'Firm' });
    expect(spriglyMeetingPrepWorkflow.parseInput(makeEvent('Blog: not this workflow'))).toBeNull();
  });
});

// ─── spriglyMeetingPrepWorkflow.run ─────────────────────────────────────────────────

describe('spriglyMeetingPrepWorkflow.run', () => {
  it('makes exactly 1 model call', async () => {
    // TODO: update this count when you add more steps
    const ctx = makeCtx();
    await spriglyMeetingPrepWorkflow.run({ topic: 'My Topic' }, ctx);
    expect(ctx.model.complete).toHaveBeenCalledTimes(1);
  });

  it('resolves the generate prompt', async () => {
    const ctx = makeCtx();
    await spriglyMeetingPrepWorkflow.run({ topic: 'My Topic' }, ctx);
    expect(vi.mocked(ctx.prompts.resolve).mock.calls[0]?.[2]).toBe('generate');
  });

  it('passes topic and notes into the prompt via template substitution', async () => {
    const ctx = makeCtx();
    await spriglyMeetingPrepWorkflow.run({ topic: 'My Topic', notes: 'bring slides' }, ctx);
    const sentMessage = vi.mocked(ctx.model.complete).mock.calls[0]?.[0].messages[0]?.content ?? '';
    expect(sentMessage).toContain('My Topic');
    expect(sentMessage).toContain('bring slides');
    expect(sentMessage).not.toContain('{{topic}}');
    expect(sentMessage).not.toContain('{{notes}}');
  });

  it('uses sonnet model', async () => {
    const ctx = makeCtx();
    await spriglyMeetingPrepWorkflow.run({ topic: 'Firm' }, ctx);
    expect(vi.mocked(ctx.model.complete).mock.calls[0]?.[0].model).toBe('sonnet');
  });

  it('logs audit with correct action name', async () => {
    const ctx = makeCtx();
    await spriglyMeetingPrepWorkflow.run({ topic: 'Firm' }, ctx);
    expect(vi.mocked(ctx.audit.logModelCall).mock.calls[0]?.[0].action).toBe('meeting-prep-generate');
  });

  it('returns text output', async () => {
    const ctx = makeCtx();
    const output = await spriglyMeetingPrepWorkflow.run({ topic: 'Firm' }, ctx);
    expect(typeof output.text).toBe('string');
    expect(output.text.length).toBeGreaterThan(0);
  });

  it('routes to db-save-output by default', () => {
    // TODO: add gmail-reply-with-attachment once output shape is confirmed
    const dest = spriglyMeetingPrepWorkflow.defaultDestinations[0];
    expect(dest?.destinationId).toBe('db-save-output');
  });

  it('throws when prompt contains unedited sentinel', async () => {
    const ctx: WorkflowContext = {
      ...makeCtx(),
      prompts: { resolve: vi.fn().mockResolvedValue('__PROMPT_NOT_CUSTOMISED__\nTODO: ...') },
    };
    await expect(
      spriglyMeetingPrepWorkflow.run({ topic: 'Firm' }, ctx),
    ).rejects.toThrow('has not been customised');
  });
});
