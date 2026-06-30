import { describe, it, expect, vi } from 'vitest';
import type { IncomingEvent, WorkflowContext } from '@sprigly/engine';
import { parseInboxNoopInput } from './parse-input.js';
import { spriglyInboxNoopWorkflow } from './sprigly-inbox-noop.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeEvent = (overrides: Partial<IncomingEvent['sourceMetadata']> = {}): IncomingEvent => ({
  id:           'evt-1',
  clientId:     'client-1',
  source:       'email',
  receivedAt:   new Date(),
  content:      { text: 'body text', structured: {} },
  reply:        { channel: 'email', data: {} },
  sourceMetadata: {
    messageId: 'msg-1',
    subject:   'Hello world',
    from:      'sender@example.com',
    ...overrides,
  },
});

const makeCtx = (): WorkflowContext => ({
  clientId:     'client-1',
  eventId:      'evt-1',
  runId:        'run-1',
  clientConfig: {
    id:         'cfg-1',
    clientId:   'client-1',
    brandVoice: '',
    signature:  '',
    authorName: '',
    settings:   {},
  },
  model: { complete: vi.fn() },
  audit: { logModelCall: vi.fn().mockResolvedValue(undefined) },
  prompts: { resolve: vi.fn() },
});

// ─── parseInboxNoopInput ─────────────────────────────────────────────────────

describe('parseInboxNoopInput', () => {
  it('extracts messageId, subject, and from from sourceMetadata', () => {
    const result = parseInboxNoopInput(makeEvent());
    expect(result).toEqual({ messageId: 'msg-1', subject: 'Hello world', from: 'sender@example.com' });
  });

  it('accepts every email — never returns null', () => {
    // Simulate an email with unusual subject that no other workflow would match
    const result = parseInboxNoopInput(makeEvent({ subject: 'Random unrecognised subject' }));
    expect(result).not.toBeNull();
  });

  it('uses safe defaults when metadata fields are absent', () => {
    const result = parseInboxNoopInput(makeEvent({ messageId: undefined, subject: undefined, from: undefined }));
    expect(result.messageId).toBe('');
    expect(result.subject).toBe('(no subject)');
    expect(result.from).toBe('');
  });
});

// ─── spriglyInboxNoopWorkflow.parseInput ─────────────────────────────────────

describe('spriglyInboxNoopWorkflow.parseInput', () => {
  it('returns non-null for any email', () => {
    expect(spriglyInboxNoopWorkflow.parseInput(makeEvent())).not.toBeNull();
    expect(spriglyInboxNoopWorkflow.parseInput(makeEvent({ subject: 'Completely unrelated' }))).not.toBeNull();
  });
});

// ─── spriglyInboxNoopWorkflow.run — safety properties ────────────────────────

describe('spriglyInboxNoopWorkflow.run — safety properties', () => {
  it('makes zero model calls', async () => {
    const ctx = makeCtx();
    await spriglyInboxNoopWorkflow.run({ messageId: 'msg-1', subject: 'Hello', from: 'a@b.com' }, ctx);
    expect(ctx.model.complete).not.toHaveBeenCalled();
  });

  it('resolves no prompts', async () => {
    const ctx = makeCtx();
    await spriglyInboxNoopWorkflow.run({ messageId: 'msg-1', subject: 'Hello', from: 'a@b.com' }, ctx);
    expect(ctx.prompts.resolve).not.toHaveBeenCalled();
  });

  it('records exactly one audit entry confirming the email was seen', async () => {
    const ctx = makeCtx();
    await spriglyInboxNoopWorkflow.run({ messageId: 'msg-1', subject: 'Subject line', from: 'sender@example.com' }, ctx);
    expect(ctx.audit.logModelCall).toHaveBeenCalledOnce();
    const call = vi.mocked(ctx.audit.logModelCall).mock.calls[0]?.[0];
    expect(call?.action).toBe('inbox-noop-seen');
    expect(call?.inputTokens).toBe(0);
    expect(call?.outputTokens).toBe(0);
    expect(call?.modelId).toBe('none');
    expect(call?.metadata).toMatchObject({ messageId: 'msg-1', subject: 'Subject line', from: 'sender@example.com' });
  });

  it('returns a seen-status output with the original message fields', async () => {
    const ctx = makeCtx();
    const output = await spriglyInboxNoopWorkflow.run(
      { messageId: 'msg-1', subject: 'Subject line', from: 'sender@example.com' },
      ctx,
    );
    expect(output).toEqual({
      status:    'seen',
      messageId: 'msg-1',
      subject:   'Subject line',
      from:      'sender@example.com',
    });
  });
});
