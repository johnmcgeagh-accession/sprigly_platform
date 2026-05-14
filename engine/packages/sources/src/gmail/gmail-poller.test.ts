import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { GmailPoller } from './gmail-poller.js';
import { GmailApiClient } from './gmail-client.js';
import { getTokens } from '@sprigly/oauth-tokens';
import { incomingEvents, processedExternalIds } from '@sprigly/db';
import type { RoutingRule } from '@sprigly/engine';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('./gmail-client.js', () => ({ GmailApiClient: vi.fn() }));

vi.mock('@sprigly/oauth-tokens', () => ({
  getTokens:   vi.fn().mockResolvedValue({ accessToken: 'test-tok', scopes: [] }),
  storeTokens: vi.fn().mockResolvedValue(undefined),
}));

// Stub schema table objects — avoids the real DB connection from @sprigly/db/client
vi.mock('@sprigly/db', () => ({
  incomingEvents:       { _: 'incoming_events' },
  processedExternalIds: { _: 'processed_external_ids' },
  eq:  vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeRule(conditions = [{ field: 'subject', op: 'startsWith', value: 'Blog:' }]): RoutingRule {
  return {
    id:           'rule-1',
    clientId:     'client-1',
    enabled:      true,
    match:        { source: 'email', conditions: conditions as RoutingRule['match']['conditions'] },
    workflowId:   'sprigly-blog-post',
    destinations: [],
    clientConfigId: 'config-1',
    priority:     10,
  };
}

function makeGmailMessage(subject = 'Blog: Test post') {
  return {
    threadId:     'thread-1',
    internalDate: String(Date.now()),
    payload: {
      body: { data: Buffer.from('Email body text', 'utf-8').toString('base64url') },
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From',    value: 'sender@example.com' },
        { name: 'To',      value: 'client@example.com' },
        { name: 'Date',    value: 'Wed, 14 May 2026 10:00:00 +0000' },
      ],
    },
  };
}

function makeDb(existingProcessedRows: Array<{ id: string }> = []) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert       = vi.fn().mockReturnValue({ values: insertValues });
  const limit        = vi.fn().mockResolvedValue(existingProcessedRows);
  const where        = vi.fn().mockReturnValue({ limit });
  const from         = vi.fn().mockReturnValue({ where });
  const select       = vi.fn().mockReturnValue({ from });
  return { select, insert, insertValues } as unknown as typeof import('@sprigly/db').db & {
    insert: Mock; insertValues: Mock;
  };
}

function makeGmailClient(messageIds: string[], message = makeGmailMessage()) {
  const mockClient = {
    listMessageIds: vi.fn().mockResolvedValue(messageIds),
    getMessage:     vi.fn().mockResolvedValue(message),
    markAsRead:     vi.fn().mockResolvedValue(undefined),
  };
  (GmailApiClient as unknown as Mock).mockImplementation(() => mockClient);
  return mockClient;
}

function makeRouter(rules: RoutingRule[] = []) {
  return { loadRules: vi.fn().mockResolvedValue(rules) } as unknown as import('@sprigly/engine').EventRouter;
}

const MOCK_ENC_PROVIDER = {} as import('@sprigly/oauth-tokens').EncryptionProvider;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GmailPoller — no-match path', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not insert into incomingEvents when no rule matches', async () => {
    const db     = makeDb();
    const client = makeGmailClient(['msg-1'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]); // no rules — nothing matches

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    const count  = await poller.poll('client-1');

    expect(count).toBe(0);
    expect((db.insert as Mock)).not.toHaveBeenCalledWith(incomingEvents);
  });

  it('inserts into processedExternalIds (idempotency record) when no rule matches', async () => {
    const db     = makeDb();
    const client = makeGmailClient(['msg-1'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.insert as Mock)).toHaveBeenCalledWith(processedExternalIds);
    const [call] = (db.insertValues as Mock).mock.calls;
    expect(call[0]).toMatchObject({ clientId: 'client-1', source: 'gmail', externalId: 'msg-1' });
  });

  it('calls markAsRead on the Gmail API when no rule matches', async () => {
    const db     = makeDb();
    const client = makeGmailClient(['msg-1'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.markAsRead).toHaveBeenCalledWith('msg-1');
  });
});

describe('GmailPoller — match path', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('inserts into incomingEvents when a rule matches', async () => {
    const db     = makeDb();
    const client = makeGmailClient(['msg-2'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    const count  = await poller.poll('client-1');

    expect(count).toBe(1);
    expect((db.insert as Mock)).toHaveBeenCalledWith(incomingEvents);
  });

  it('also inserts processedExternalIds and calls markAsRead when a rule matches', async () => {
    const db     = makeDb();
    const client = makeGmailClient(['msg-2'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.insert as Mock)).toHaveBeenCalledWith(processedExternalIds);
    expect(client.markAsRead).toHaveBeenCalledWith('msg-2');
  });

  it('inserts incomingEvents before processedExternalIds (match-path ordering)', async () => {
    const db     = makeDb();
    makeGmailClient(['msg-2'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    const insertCalls = (db.insert as Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(insertCalls[0]).toBe(incomingEvents);
    expect(insertCalls[1]).toBe(processedExternalIds);
  });
});

describe('GmailPoller — already-seen path (idempotency)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skips getMessage when message is already in processedExternalIds', async () => {
    const db     = makeDb([{ id: 'pid-1' }]); // existing record
    const client = makeGmailClient(['msg-3']);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    const count  = await poller.poll('client-1');

    expect(count).toBe(0);
    expect(client.getMessage).not.toHaveBeenCalled();
  });

  it('does not insert any rows when message already processed', async () => {
    const db     = makeDb([{ id: 'pid-1' }]);
    makeGmailClient(['msg-3']);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.insert as Mock)).not.toHaveBeenCalled();
  });

  it('still calls markAsRead on already-seen messages (Gmail cleanup)', async () => {
    const db     = makeDb([{ id: 'pid-1' }]);
    const client = makeGmailClient(['msg-3']);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.markAsRead).toHaveBeenCalledWith('msg-3');
  });
});

describe('GmailPoller — no tokens', () => {
  it('returns 0 immediately when no OAuth tokens stored', async () => {
    (getTokens as Mock).mockResolvedValueOnce(null);
    const db     = makeDb();
    const client = makeGmailClient([]);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    const count  = await poller.poll('client-1');

    expect(count).toBe(0);
    expect(client.listMessageIds).not.toHaveBeenCalled();
  });
});
