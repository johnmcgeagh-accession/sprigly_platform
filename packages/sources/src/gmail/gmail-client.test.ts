import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

const { mockDraftsCreate, mockMessagesModify } = vi.hoisted(() => ({
  mockDraftsCreate: vi.fn(),
  mockMessagesModify: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        on: vi.fn(),
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        drafts: { create: mockDraftsCreate },
        messages: { modify: mockMessagesModify, list: vi.fn(), get: vi.fn() },
      },
    }),
  },
}));

import { GmailApiClient } from './gmail-client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient() {
  return new GmailApiClient(
    'client-id',
    'client-secret',
    { accessToken: 'tok', scopes: [] },
    vi.fn(),
  );
}

function decodeMime(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf-8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GmailApiClient.createDraft', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls drafts.create with base64url-encoded MIME message', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'draft-1', message: { id: 'msg-1' } } });

    const client = makeClient();
    await client.createDraft({ to: 'recv@example.com', subject: 'Hello', bodyText: 'Body text' });

    expect(mockDraftsCreate).toHaveBeenCalledOnce();
    const call = (mockDraftsCreate as Mock).mock.calls[0][0];
    expect(call.userId).toBe('me');

    const mime = decodeMime(call.requestBody.message.raw);
    expect(mime).toContain('To: recv@example.com');
    expect(mime).toContain('Subject: Hello');
    expect(mime).toContain('MIME-Version: 1.0');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Body text');
  });

  it('returns draftId and messageId from API response', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'draft-42', message: { id: 'msg-42' } } });

    const client = makeClient();
    const result = await client.createDraft({ to: 'a@b.com', subject: 'S', bodyText: 'B' });

    expect(result).toEqual({ draftId: 'draft-42', messageId: 'msg-42' });
  });

  it('includes threadId in message when provided', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'd', message: { id: 'm' } } });

    const client = makeClient();
    await client.createDraft({ to: 'a@b.com', subject: 'S', bodyText: 'B', threadId: 'thread-99' });

    const call = (mockDraftsCreate as Mock).mock.calls[0][0];
    expect(call.requestBody.message.threadId).toBe('thread-99');
  });

  it('omits threadId from message when not provided', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'd', message: { id: 'm' } } });

    const client = makeClient();
    await client.createDraft({ to: 'a@b.com', subject: 'S', bodyText: 'B' });

    const call = (mockDraftsCreate as Mock).mock.calls[0][0];
    expect(call.requestBody.message.threadId).toBeUndefined();
  });

  it('adds In-Reply-To and References headers when inReplyToMessageId provided', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'd', message: { id: 'm' } } });

    const client = makeClient();
    await client.createDraft({
      to: 'a@b.com',
      subject: 'Re: original',
      bodyText: 'Reply body',
      inReplyToMessageId: 'original-msg-id',
    });

    const mime = decodeMime((mockDraftsCreate as Mock).mock.calls[0][0].requestBody.message.raw);
    expect(mime).toContain('In-Reply-To: <original-msg-id>');
    expect(mime).toContain('References: <original-msg-id>');
  });

  it('omits In-Reply-To and References when inReplyToMessageId not provided', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'd', message: { id: 'm' } } });

    const client = makeClient();
    await client.createDraft({ to: 'a@b.com', subject: 'S', bodyText: 'B' });

    const mime = decodeMime((mockDraftsCreate as Mock).mock.calls[0][0].requestBody.message.raw);
    expect(mime).not.toContain('In-Reply-To');
    expect(mime).not.toContain('References');
  });

  it('uses CRLF line endings in MIME output', async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: 'd', message: { id: 'm' } } });

    const client = makeClient();
    await client.createDraft({ to: 'a@b.com', subject: 'S', bodyText: 'B' });

    const raw = (mockDraftsCreate as Mock).mock.calls[0][0].requestBody.message.raw as string;
    const decoded = Buffer.from(raw, 'base64url').toString('binary');
    expect(decoded).toContain('\r\n');
  });
});
