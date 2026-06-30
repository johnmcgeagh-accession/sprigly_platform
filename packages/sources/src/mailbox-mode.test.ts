import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { switchPollingMode } from './mailbox-mode.js';
import { oauthConnections, routingRules } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@sprigly/db', () => ({
  oauthConnections: {
    id: 'oc.id', clientId: 'oc.clientId', provider: 'oc.provider', _: 'oauth_connections',
  },
  routingRules: {
    id: 'rr.id', clientId: 'rr.clientId', source: 'rr.source',
    autoCreated: 'rr.autoCreated', isFallback: 'rr.isFallback',
    _: 'routing_rules',
  },
}));

// eq and and are imported directly from drizzle-orm in the implementation,
// so mock drizzle-orm to make them spyable.
vi.mock('drizzle-orm', () => ({
  eq:  vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

interface Tx { update: Mock; insert: Mock; select: Mock; }

/**
 * makeDb — builds a mock db with a transaction that runs its callback
 * synchronously using a `tx` object. Each DB table has its own isolated
 * update/set/where mocks so assertions can target them independently.
 *
 * @param existingAutoRule    If non-null, the tx.select returns this row
 *                            (simulates an existing auto-created rule).
 * @param connectionClientId  What UPDATE...RETURNING returns. Null means no
 *                            row matched (connection not found).
 */
function makeDb(
  existingAutoRule: { id: string } | null = null,
  connectionClientId: string | null = 'client-1',
) {
  // ── Connection update mocks ───────────────────────────────────────────────
  // Chain: update → set → where → returning → resolves to [{clientId}] | []
  const connUpdateReturning = vi.fn().mockResolvedValue(
    connectionClientId !== null ? [{ clientId: connectionClientId }] : [],
  );
  const connUpdateWhere = vi.fn().mockReturnValue({ returning: connUpdateReturning });
  const connUpdateSet   = vi.fn().mockReturnValue({ where: connUpdateWhere });

  // ── Rules update mocks (re-enable or disable) ─────────────────────────────
  const rulesUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const rulesUpdateSet   = vi.fn().mockReturnValue({ where: rulesUpdateWhere });

  // ── Rules insert mock ─────────────────────────────────────────────────────
  const rulesInsertValues = vi.fn().mockResolvedValue(undefined);

  // ── Rules select mock (existing-rule lookup in full mode) ─────────────────
  const rulesSelectLimit = vi.fn().mockResolvedValue(existingAutoRule ? [existingAutoRule] : []);
  const rulesSelectWhere = vi.fn().mockReturnValue({ limit: rulesSelectLimit });
  const rulesSelectFrom  = vi.fn().mockReturnValue({ where: rulesSelectWhere });

  const tx: Tx = {
    update: vi.fn().mockImplementation((table: unknown) => {
      if (table === oauthConnections) return { set: connUpdateSet };
      return { set: rulesUpdateSet };
    }),
    insert: vi.fn().mockReturnValue({ values: rulesInsertValues }),
    select: vi.fn().mockReturnValue({ from: rulesSelectFrom }),
  };

  const transaction = vi.fn().mockImplementation(
    (cb: (tx: Tx) => Promise<void>) => cb(tx),
  );

  return {
    transaction,
    tx,
    connUpdateSet,
    connUpdateWhere,
    connUpdateReturning,
    rulesUpdateSet,
    rulesUpdateWhere,
    rulesInsertValues,
    rulesSelectLimit,
  } as unknown as typeof import('@sprigly/db').db & {
    transaction:          Mock;
    tx:                   typeof tx;
    connUpdateSet:        Mock;
    connUpdateWhere:      Mock;
    connUpdateReturning:  Mock;
    rulesUpdateSet:       Mock;
    rulesUpdateWhere:     Mock;
    rulesInsertValues:    Mock;
    rulesSelectLimit:     Mock;
  };
}

// ── Switch to full: no existing rule ─────────────────────────────────────────

describe('switchPollingMode → full (no existing rule)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates an enabled match-all fallback rule targeting sprigly-inbox-noop', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'full');

    expect(db.tx.insert).toHaveBeenCalledWith(routingRules);
    const values = (db as unknown as { rulesInsertValues: Mock }).rulesInsertValues.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      clientId:        'client-1',  // derived from RETURNING
      source:          'email',
      matchConditions: [],
      workflowId:      'sprigly-inbox-noop',
      enabled:         true,
      isFallback:      true,
      autoCreated:     true,
    });
  });

  it('sets polling_mode = full and resets last_polled_at on the connection', async () => {
    const db   = makeDb(null);
    const before = new Date();
    await switchPollingMode(db, 'conn-1', 'full');
    const after = new Date();

    expect(db.tx.update).toHaveBeenCalledWith(oauthConnections);
    const setArg = (db as unknown as { connUpdateSet: Mock }).connUpdateSet.mock.calls[0]?.[0] as {
      pollingMode: string; lastPolledAt: Date;
    };
    expect(setArg.pollingMode).toBe('full');
    expect(setArg.lastPolledAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(setArg.lastPolledAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('keys the connection update on oauthConnections.id (not clientId or provider)', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'full');
    expect(eq).toHaveBeenCalledWith(oauthConnections.id, 'conn-1');
    // clientId and provider must NOT be used as keys for the connection update
    expect(eq).not.toHaveBeenCalledWith(oauthConnections.clientId, expect.anything());
    expect(eq).not.toHaveBeenCalledWith(oauthConnections.provider, expect.anything());
  });

  it('wraps all operations in a single transaction', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'full');
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('looks up the existing rule using autoCreated = true filter (guards against touching manual rules)', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'full');
    expect(eq).toHaveBeenCalledWith(routingRules.autoCreated, true);
  });

  it('no-op when the connection id does not match any row', async () => {
    const db = makeDb(null, null); // RETURNING returns []
    await switchPollingMode(db, 'conn-bad', 'full');
    // Rules management must not run — no insert, no rule update
    expect(db.tx.insert).not.toHaveBeenCalled();
    expect(db.tx.update).not.toHaveBeenCalledWith(routingRules);
  });
});

// ── Switch to full: existing disabled rule ────────────────────────────────────

describe('switchPollingMode → full (existing disabled rule)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('re-enables the existing rule rather than creating a duplicate', async () => {
    const db = makeDb({ id: 'rule-existing' });
    await switchPollingMode(db, 'conn-1', 'full');

    expect(db.tx.update).toHaveBeenCalledWith(routingRules);
    expect(db.tx.insert).not.toHaveBeenCalled();

    const setArg = (db as unknown as { rulesUpdateSet: Mock }).rulesUpdateSet.mock.calls[0]?.[0] as {
      enabled: boolean;
    };
    expect(setArg.enabled).toBe(true);
  });

  it('sets polling_mode = full and resets last_polled_at', async () => {
    const db = makeDb({ id: 'rule-existing' });
    await switchPollingMode(db, 'conn-1', 'full');

    const setArg = (db as unknown as { connUpdateSet: Mock }).connUpdateSet.mock.calls[0]?.[0] as {
      pollingMode: string;
    };
    expect(setArg.pollingMode).toBe('full');
  });
});

// ── Idempotency: switch to full twice ─────────────────────────────────────────

describe('switchPollingMode → full twice (idempotency)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('second switch re-enables the rule created by the first; does not insert again', async () => {
    const db1 = makeDb(null);
    await switchPollingMode(db1, 'conn-1', 'full');
    expect(db1.tx.insert).toHaveBeenCalledOnce();

    const db2 = makeDb({ id: 'rule-created-by-first' });
    await switchPollingMode(db2, 'conn-1', 'full');
    expect(db2.tx.insert).not.toHaveBeenCalled();
    expect(db2.tx.update).toHaveBeenCalledWith(routingRules);
  });
});

// ── Switch to selective ───────────────────────────────────────────────────────

describe('switchPollingMode → selective', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('disables the auto-created fallback rule', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'selective');

    expect(db.tx.update).toHaveBeenCalledWith(routingRules);
    const setArg = (db as unknown as { rulesUpdateSet: Mock }).rulesUpdateSet.mock.calls[0]?.[0] as {
      enabled: boolean;
    };
    expect(setArg.enabled).toBe(false);
  });

  it('sets polling_mode = selective and resets last_polled_at', async () => {
    const db   = makeDb(null);
    const before = new Date();
    await switchPollingMode(db, 'conn-1', 'selective');
    const after = new Date();

    const setArg = (db as unknown as { connUpdateSet: Mock }).connUpdateSet.mock.calls[0]?.[0] as {
      pollingMode: string; lastPolledAt: Date;
    };
    expect(setArg.pollingMode).toBe('selective');
    expect(setArg.lastPolledAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(setArg.lastPolledAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('keys the connection update on oauthConnections.id', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'selective');
    expect(eq).toHaveBeenCalledWith(oauthConnections.id, 'conn-1');
  });

  it('does NOT insert any routing rule', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'selective');
    expect(db.tx.insert).not.toHaveBeenCalled();
  });

  it('applies autoCreated = true filter so manual rules are never disabled', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'selective');
    expect(eq).toHaveBeenCalledWith(routingRules.autoCreated, true);
    expect(eq).toHaveBeenCalledWith(routingRules.isFallback, true);
  });

  it('wraps all operations in a single transaction', async () => {
    const db = makeDb(null);
    await switchPollingMode(db, 'conn-1', 'selective');
    expect(db.transaction).toHaveBeenCalledOnce();
  });
});

// ── Atomicity ─────────────────────────────────────────────────────────────────

describe('switchPollingMode — atomicity', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects when the transaction throws (caller sees a failed, not partial, operation)', async () => {
    const db = makeDb(null);
    (db.transaction as Mock).mockRejectedValueOnce(new Error('db crash'));

    await expect(switchPollingMode(db, 'conn-1', 'full')).rejects.toThrow('db crash');
  });
});
