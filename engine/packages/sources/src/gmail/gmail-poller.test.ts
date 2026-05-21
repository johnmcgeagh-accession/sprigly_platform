import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { GmailPoller } from './gmail-poller.js';
import { GmailApiClient } from './gmail-client.js';
import { getTokens } from '@sprigly/oauth-tokens';
import { incomingEvents, processedExternalIds, oauthConnections } from '@sprigly/db';
import type { RoutingRule } from '@sprigly/engine';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('./gmail-client.js', () => ({ GmailApiClient: vi.fn() }));

vi.mock('@sprigly/oauth-tokens', () => ({
  getTokens:   vi.fn().mockResolvedValue({ accessToken: 'test-tok', scopes: [] }),
  storeTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sprigly/db', () => ({
  incomingEvents:       { _: 'incoming_events' },
  processedExternalIds: { _: 'processed_external_ids' },
  oauthConnections:     { _: 'oauth_connections' },
  gmailOperationErrors: { _: 'gmail_operation_errors' },
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
    isFallback:   false,
  };
}

// Match-all fallback rule. In full mode, Stage 3 auto-creates one targeting
// sprigly-inbox-noop. conditions: [] evaluates vacuously true for every email.
function makeFallbackRule(): RoutingRule {
  return {
    id:           'rule-fallback',
    clientId:     'client-1',
    enabled:      true,
    match:        { source: 'email', conditions: [] },
    workflowId:   'sprigly-inbox-noop',
    destinations: [],
    clientConfigId: 'config-1',
    priority:     0,
    isFallback:   true,
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

const WATERMARK     = new Date('2026-05-20T09:00:00Z');
// pollingMode is no longer read by the poller — selective vs full is expressed
// purely through which routing rules exist (fallback rule for full mode, none for selective).
const CONN_ROW      = { lastPolledAt: WATERMARK };
const FULL_CONN_ROW = { lastPolledAt: WATERMARK };  // alias for test clarity

/**
 * makeDb — builds a mock db object.
 *
 * selectResults: what .limit(1) resolves to for each .select() call in order.
 *   [0] = connection row select (pollingMode / lastPolledAt)
 *   [1] = idempotency check select
 *
 * Matched-branch inserts go through db.transaction → tx.insert (txInsert/txInsertValues).
 * Unmatched-branch inserts go through db.insert directly (insert/insertValues).
 */
function makeDb(selectResults: unknown[][] = []) {
  let selectCallIndex = 0;

  // ── Transaction mock ───────────────────────────────────────────────────────
  const txInsertValues = vi.fn().mockResolvedValue(undefined);
  const txInsert       = vi.fn().mockReturnValue({ values: txInsertValues });
  const txMock         = { insert: txInsert };

  const transaction = vi.fn().mockImplementation(
    (cb: (tx: typeof txMock) => Promise<void>) => cb(txMock),
  );

  // ── Direct insert mock (unmatched path, error logger) ─────────────────────
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert       = vi.fn().mockReturnValue({ values: insertValues });

  const updateSet    = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const update       = vi.fn().mockReturnValue({ set: updateSet });

  const makeLimitFn = () => {
    const idx = selectCallIndex++;
    return vi.fn().mockResolvedValue(selectResults[idx] ?? []);
  };

  const select = vi.fn().mockImplementation(() => {
    const limit = makeLimitFn();
    const where = vi.fn().mockReturnValue({ limit });
    const from  = vi.fn().mockReturnValue({ where });
    return { from };
  });

  return {
    select,
    insert,
    insertValues,
    update,
    updateSet,
    transaction,
    txInsert,
    txInsertValues,
  } as unknown as typeof import('@sprigly/db').db & {
    insert: Mock; insertValues: Mock; update: Mock; updateSet: Mock;
    transaction: Mock; txInsert: Mock; txInsertValues: Mock;
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

// ── selective, matched email ───────────────────────────────────────────────────

describe('GmailPoller — selective mode, matched email', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches, evaluates, persists, marks read, writes idempotency record', async () => {
    const db     = makeDb([[CONN_ROW], []]);
    const client = makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    const count  = await poller.poll('client-1');

    expect(count).toBe(1);
    expect((db.txInsert as Mock)).toHaveBeenCalledWith(incomingEvents);
    expect((db.txInsert as Mock)).toHaveBeenCalledWith(processedExternalIds);
    expect(client.markAsRead).toHaveBeenCalledWith('msg-1');
  });

  it('inserts incomingEvents before processedExternalIds inside the transaction (ordering matters for crash recovery)', async () => {
    const db = makeDb([[CONN_ROW], []]);
    makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    const insertCalls = (db.txInsert as Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(insertCalls[0]).toBe(incomingEvents);
    expect(insertCalls[1]).toBe(processedExternalIds);
  });

  it('wraps both inserts in a single transaction', async () => {
    const db = makeDb([[CONN_ROW], []]);
    makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.transaction as Mock)).toHaveBeenCalledOnce();
    // Direct db.insert must NOT be called for the matched path
    expect((db.insert as Mock)).not.toHaveBeenCalledWith(incomingEvents);
    expect((db.insert as Mock)).not.toHaveBeenCalledWith(processedExternalIds);
  });

  it('does not call markAsRead if the transaction throws (safe direction: processed but unread)', async () => {
    const db = makeDb([[CONN_ROW], []]);
    const client = makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    (db.transaction as Mock).mockRejectedValueOnce(new Error('db crash'));

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await expect(poller.poll('client-1')).rejects.toThrow('db crash');

    expect(client.markAsRead).not.toHaveBeenCalled();
  });

  it('does not advance the watermark when the transaction throws', async () => {
    const db = makeDb([[CONN_ROW], []]);
    makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    (db.transaction as Mock).mockRejectedValueOnce(new Error('db crash'));

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await expect(poller.poll('client-1')).rejects.toThrow('db crash');

    expect((db.update as Mock)).not.toHaveBeenCalled();
  });

  it('passes the watermark to listMessageIds', async () => {
    const db     = makeDb([[CONN_ROW], []]);
    const client = makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.listMessageIds).toHaveBeenCalledWith(WATERMARK);
  });
});

// ── selective, unmatched email ────────────────────────────────────────────────

describe('GmailPoller — selective mode, unmatched email', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does NOT mark the email as read', async () => {
    const db     = makeDb([[CONN_ROW], []]);
    const client = makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);  // no rules

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.markAsRead).not.toHaveBeenCalled();
  });

  it('does NOT persist to incomingEvents', async () => {
    const db     = makeDb([[CONN_ROW], []]);
    makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.insert as Mock)).not.toHaveBeenCalledWith(incomingEvents);
    expect((db.transaction as Mock)).not.toHaveBeenCalled();
  });

  it('DOES write an idempotency record so the email is not re-evaluated next cycle', async () => {
    const db     = makeDb([[CONN_ROW], []]);
    makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.insert as Mock)).toHaveBeenCalledWith(processedExternalIds);
    const [call] = (db.insertValues as Mock).mock.calls;
    expect(call[0]).toMatchObject({ clientId: 'client-1', source: 'gmail', externalId: 'msg-2' });
  });

  it('returns count 0', async () => {
    const db    = makeDb([[CONN_ROW], []]);
    makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    expect(await poller.poll('client-1')).toBe(0);
  });
});

// ── idempotency skip ─────────────────────────────────────────────────────────

describe('GmailPoller — idempotency skip', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skips getMessage entirely when message is already in processedExternalIds', async () => {
    const db     = makeDb([[CONN_ROW], [{ id: 'pid-1' }]]);  // idempotency hit
    const client = makeGmailClient(['msg-3']);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.getMessage).not.toHaveBeenCalled();
  });

  it('does NOT mark read on an already-seen message', async () => {
    const db     = makeDb([[CONN_ROW], [{ id: 'pid-1' }]]);
    const client = makeGmailClient(['msg-3']);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.markAsRead).not.toHaveBeenCalled();
  });

  it('does not insert any rows for an already-seen message', async () => {
    const db     = makeDb([[CONN_ROW], [{ id: 'pid-1' }]]);
    makeGmailClient(['msg-3']);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.insert as Mock)).not.toHaveBeenCalled();
    expect((db.transaction as Mock)).not.toHaveBeenCalled();
  });
});

// ── watermark advancement ────────────────────────────────────────────────────

describe('GmailPoller — watermark advancement', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('advances last_polled_at after a successful cycle', async () => {
    const db     = makeDb([[CONN_ROW], []]);
    makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    const before = new Date();
    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');
    const after = new Date();

    expect((db.update as Mock)).toHaveBeenCalledWith(oauthConnections);
    const setArg = (db.updateSet as Mock).mock.calls[0]?.[0] as { lastPolledAt: Date };
    expect(setArg.lastPolledAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(setArg.lastPolledAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('advances watermark even when no messages are returned', async () => {
    const db     = makeDb([[CONN_ROW]]);  // no idempotency calls needed
    makeGmailClient([]);  // empty inbox
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.update as Mock)).toHaveBeenCalledWith(oauthConnections);
  });

  it('null watermark (fresh connection): advances watermark without fetching any messages', async () => {
    const freshConn = { lastPolledAt: null };
    const db     = makeDb([[freshConn]]);
    const client = makeGmailClient([]);
    const router = makeRouter([]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    // Watermark is advanced so the next cycle starts from now
    expect((db.update as Mock)).toHaveBeenCalledWith(oauthConnections);
    // No Gmail API call — null watermark must never replay inbox history
    expect(client.listMessageIds).not.toHaveBeenCalled();
  });
});

// ── cross-cycle atomicity ─────────────────────────────────────────────────────
//
// Verifies that a transaction rollback in cycle 1 leaves no orphaned rows,
// so cycle 2 re-processes the message exactly once rather than creating a
// duplicate incomingEvents row.

describe('GmailPoller — cross-cycle atomicity', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('no duplicate incomingEvents row when cycle 1 transaction rolls back and cycle 2 replays', async () => {
    // Cycle 1 and cycle 2 both see the same connection row (watermark not
    // advanced because cycle 1 threw before reaching the watermark update)
    // and both see an idempotency miss (transaction rolled back → no record).
    const db = makeDb([[CONN_ROW], [], [CONN_ROW], []]);
    makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule()]);

    // Cycle 1: transaction throws (simulates a DB crash / process kill
    // mid-write). Neither insert is committed.
    (db.transaction as Mock).mockRejectedValueOnce(new Error('db crash'));

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await expect(poller.poll('client-1')).rejects.toThrow('db crash');

    // Cycle 2: transaction succeeds — message is processed exactly once.
    const count = await poller.poll('client-1');
    expect(count).toBe(1);

    // incomingEvents inserted exactly once across both cycles.
    const incomingEventsCalls = (db.txInsert as Mock).mock.calls.filter(
      (c: unknown[]) => c[0] === incomingEvents,
    );
    expect(incomingEventsCalls).toHaveLength(1);
  });
});

// ── full mode: fallback rule present ─────────────────────────────────────────
//
// Full mode works by having a match-all fallback rule (conditions: [], isFallback: true)
// targeting sprigly-inbox-noop. The poller itself is mode-agnostic — the mark-read
// behaviour comes from matchRules returning the fallback rule, not from a poller
// override. These tests simulate the state after Stage 3 auto-creates the rule.

describe('GmailPoller — full mode, fallback rule present', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('an otherwise-unmatched email matches the fallback rule and is persisted + marked read', async () => {
    const db     = makeDb([[FULL_CONN_ROW], []]);
    const client = makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([makeFallbackRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    expect(await poller.poll('client-1')).toBe(1);
    expect(client.markAsRead).toHaveBeenCalledWith('msg-2');
    expect((db.txInsert as Mock)).toHaveBeenCalledWith(incomingEvents);
    expect((db.txInsert as Mock)).toHaveBeenCalledWith(processedExternalIds);
    expect((db.transaction as Mock)).toHaveBeenCalledOnce();
  });

  it('a matched primary rule fires; fallback is suppressed', async () => {
    const db     = makeDb([[FULL_CONN_ROW], []]);
    const client = makeGmailClient(['msg-1'], makeGmailMessage('Blog: AI tools'));
    const router = makeRouter([makeRule(), makeFallbackRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    expect(await poller.poll('client-1')).toBe(1);
    expect(client.markAsRead).toHaveBeenCalledWith('msg-1');
  });

  it('advances watermark after a successful cycle', async () => {
    const db = makeDb([[FULL_CONN_ROW], []]);
    makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([makeFallbackRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect((db.update as Mock)).toHaveBeenCalledWith(oauthConnections);
  });

  it('does not advance watermark when the transaction throws', async () => {
    const db = makeDb([[FULL_CONN_ROW], []]);
    makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([makeFallbackRule()]);

    (db.transaction as Mock).mockRejectedValueOnce(new Error('db crash'));

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await expect(poller.poll('client-1')).rejects.toThrow('db crash');

    expect((db.update as Mock)).not.toHaveBeenCalled();
  });
});

// ── full mode: no fallback rule (misconfigured) ───────────────────────────────
//
// If full mode is configured but no fallback rule exists yet (e.g. between mode
// switch and Stage 3 auto-creation), the poller falls back to the safe default:
// leave the email untouched (idempotency-only). It does NOT force-persist an
// event with no workflow to route to. The consumer's safety net handles any
// stray persisted events.

describe('GmailPoller — full mode, no fallback rule (safety branch)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('unmatched email is left unread and NOT persisted to incomingEvents', async () => {
    const db     = makeDb([[FULL_CONN_ROW], []]);
    const client = makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);  // no rules at all

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.markAsRead).not.toHaveBeenCalled();
    expect((db.insert as Mock)).not.toHaveBeenCalledWith(incomingEvents);
    expect((db.transaction as Mock)).not.toHaveBeenCalled();
    // Idempotency record written so the email is not re-evaluated next cycle
    expect((db.insert as Mock)).toHaveBeenCalledWith(processedExternalIds);
  });
});

// ── leave-unread safety / selective regression guard ─────────────────────────

describe('GmailPoller — unmatched email: leave-unread safety (both modes)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('selective + no rules: does NOT mark read, does NOT persist to incomingEvents', async () => {
    const db     = makeDb([[CONN_ROW], []]);
    const client = makeGmailClient(['msg-2'], makeGmailMessage('Invoice: quarterly bill'));
    const router = makeRouter([]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    await poller.poll('client-1');

    expect(client.markAsRead).not.toHaveBeenCalled();
    expect((db.insert as Mock)).not.toHaveBeenCalledWith(incomingEvents);
    expect((db.transaction as Mock)).not.toHaveBeenCalled();
  });
});

// ── no tokens / no connection ─────────────────────────────────────────────────

describe('GmailPoller — missing prerequisites', () => {
  it('returns 0 immediately when no OAuth tokens stored', async () => {
    (getTokens as Mock).mockResolvedValueOnce(null);
    const db     = makeDb([[CONN_ROW]]);
    const client = makeGmailClient([]);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    expect(await poller.poll('client-1')).toBe(0);
    expect(client.listMessageIds).not.toHaveBeenCalled();
  });

  it('returns 0 when the oauth_connections row does not exist', async () => {
    const db     = makeDb([[]]); // connection select returns empty
    const client = makeGmailClient([]);
    const router = makeRouter([makeRule()]);

    const poller = new GmailPoller(db, MOCK_ENC_PROVIDER, 'gid', 'gsecret', router);
    expect(await poller.poll('client-1')).toBe(0);
    expect(client.listMessageIds).not.toHaveBeenCalled();
  });
});
