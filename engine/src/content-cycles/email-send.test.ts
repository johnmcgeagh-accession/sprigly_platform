/**
 * email-send test — resolve published template → render → deliver through the seam, ALWAYS
 * pinned to APP_DELIVERY_PIN. Missing template / render failure are non-fatal (return false,
 * never throw). Part A of intake-capture Build 2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const deliverMock = vi.fn();

vi.mock('drizzle-orm', () => ({ and: vi.fn(() => 'and'), eq: vi.fn(() => 'eq'), desc: vi.fn(() => 'desc') }));
vi.mock('@sprigly/db', () => ({
  db: {},
  emailTemplates: { key: {}, isPublished: {}, version: {}, subjectTemplate: {}, bodyTemplate: {} },
}));
vi.mock('@sprigly/destinations', () => ({
  GmailReplyWithAttachment: vi.fn().mockImplementation(() => ({ deliver: deliverMock })),
}));

import { deliverTemplatedEmail, getPublishedTemplate, APP_DELIVERY_PIN } from './email-send.js';

// Kept as a typed handle alongside the `as never` cast, so tests can assert on what was
// logged without fighting the cast the deps signature needs.
const logSpies = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const LOGGER = logSpies as never;

function makeDb(templateRow?: { subjectTemplate: string; bodyTemplate: string }) {
  return {
    select: vi.fn().mockReturnValue({
      from:    vi.fn().mockReturnThis(),
      where:   vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit:   vi.fn().mockResolvedValue(templateRow ? [templateRow] : []),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const deps = (db: unknown) => ({ db: db as never, encProvider: {} as never, googleClientId: 'id', googleClientSecret: 'sec', logger: LOGGER });

beforeEach(() => { vi.clearAllMocks(); deliverMock.mockResolvedValue({ success: true }); });

describe('deliverTemplatedEmail', () => {
  it('renders the published template and delivers PINNED to APP_DELIVERY_PIN', async () => {
    const db = makeDb({ subjectTemplate: '{{clientName}} hi', bodyTemplate: 'body {{monthLabel}}' });
    const ok = await deliverTemplatedEmail(deps(db), { key: 'ask', clientId: 'c1', merge: { clientName: 'Ivy', monthLabel: 'Aug 2026' } });
    expect(ok).toBe(true);
    expect(deliverMock).toHaveBeenCalledTimes(1);
    const [, event, config] = deliverMock.mock.calls[0]!;
    expect(event.clientId).toBe('c1');
    expect(config.settings.to).toEqual({ mode: 'address', address: APP_DELIVERY_PIN });
    expect(config.settings.noAttachment).toBe(true);
    expect(config.settings.subjectTemplate).toBe('Ivy hi');    // pre-rendered (seam sub is a no-op)
    expect(config.settings.bodyTemplate).toBe('body Aug 2026');
  });

  it('returns false (no send) when no published template exists', async () => {
    const ok = await deliverTemplatedEmail(deps(makeDb(undefined)), { key: 'nudge', clientId: 'c1', merge: {} });
    expect(ok).toBe(false);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('returns false (non-fatal) when the template references an unknown merge field', async () => {
    const db = makeDb({ subjectTemplate: 'hi {{bogusField}}', bodyTemplate: 'x' });
    const ok = await deliverTemplatedEmail(deps(db), { key: 'ask', clientId: 'c1', merge: {} });
    expect(ok).toBe(false);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('returns false when the seam reports failure', async () => {
    deliverMock.mockResolvedValue({ success: false, error: 'no tokens' });
    const db = makeDb({ subjectTemplate: 's', bodyTemplate: 'b' });
    expect(await deliverTemplatedEmail(deps(db), { key: 'ask', clientId: 'c1', merge: {} })).toBe(false);
  });

  it('getPublishedTemplate returns null when nothing is published', async () => {
    expect(await getPublishedTemplate(makeDb(undefined), 'plan_ready')).toBeNull();
  });
});

// ── Operator send identity ────────────────────────────────────────────────────
// Notification templates are Sprigly writing TO a client, never AS one. Sending them with
// the client's own Gmail tokens made a platform notification depend on a per-client
// integration: earl-of-east has no Gmail row, so its plan-ready email failed with
// "No Gmail tokens for client" and the client heard nothing.

describe('operator send identity', () => {
  const OPERATOR = '199678dd-d7d3-4e3b-91b8-8dd8150742d9';   // the operator's own connection
  const CLIENT   = 'd5ea71c4-8859-4be2-9335-3b4b484ec312';   // earl-of-east — no oauth row

  const tpl = { subjectTemplate: 'subject', bodyTemplate: 'body' };
  /** The clientId the destination was handed — i.e. whose tokens it will use. */
  const sentAs = () => (deliverMock.mock.calls[0]![1] as { clientId: string }).clientId;
  const recipient = () =>
    (deliverMock.mock.calls[0]![2] as { settings: { to: { address: string } } }).settings.to.address;

  it('THE earl-of-east CASE: sends via the operator, for a client with no oauth row', async () => {
    process.env['OPERATOR_SEND_CLIENT_ID'] = OPERATOR;
    try {
      const ok = await deliverTemplatedEmail(deps(makeDb(tpl)), {
        key: 'plan_ready', clientId: CLIENT, merge: { clientName: 'Earl of East' },
      });
      expect(ok).toBe(true);
      expect(sentAs()).toBe(OPERATOR);          // the operator's tokens, not the client's
      expect(sentAs()).not.toBe(CLIENT);
    } finally { delete process.env['OPERATOR_SEND_CLIENT_ID']; }
  });

  it('the delivery PIN is unchanged — only the sender moved', async () => {
    process.env['OPERATOR_SEND_CLIENT_ID'] = OPERATOR;
    try {
      await deliverTemplatedEmail(deps(makeDb(tpl)), { key: 'plan_ready', clientId: CLIENT, merge: {} });
      expect(recipient()).toBe(APP_DELIVERY_PIN);
    } finally { delete process.env['OPERATOR_SEND_CLIENT_ID']; }
  });

  it('every notification template routes the same way — none of them acts AS the client', async () => {
    process.env['OPERATOR_SEND_CLIENT_ID'] = OPERATOR;
    try {
      for (const key of ['ask', 'ask_drafted', 'nudge', 'last_call', 'plan_ready', 'plan_ready_auto'] as const) {
        deliverMock.mockClear();
        await deliverTemplatedEmail(deps(makeDb(tpl)), { key, clientId: CLIENT, merge: {} });
        expect({ key, sentAs: sentAs() }).toEqual({ key, sentAs: OPERATOR });
      }
    } finally { delete process.env['OPERATOR_SEND_CLIENT_ID']; }
  });

  it('UNCONFIGURED falls back to the client and SAYS SO — a deploy changes nothing silently', async () => {
    delete process.env['OPERATOR_SEND_CLIENT_ID'];
    await deliverTemplatedEmail(deps(makeDb(tpl)), { key: 'plan_ready', clientId: CLIENT, merge: {} });
    expect(sentAs()).toBe(CLIENT);
    expect(logSpies.warn).toHaveBeenCalledWith(
      expect.objectContaining({ env: 'OPERATOR_SEND_CLIENT_ID' }),
      expect.stringContaining('no operator send identity configured'),
    );
  });

  it('an empty or blank value is not a configuration', async () => {
    for (const v of ['', '   ']) {
      process.env['OPERATOR_SEND_CLIENT_ID'] = v;
      deliverMock.mockClear();
      await deliverTemplatedEmail(deps(makeDb(tpl)), { key: 'plan_ready', clientId: CLIENT, merge: {} });
      expect(sentAs()).toBe(CLIENT);
    }
    delete process.env['OPERATOR_SEND_CLIENT_ID'];
  });

  it('MISSING OPERATOR TOKENS fail exactly like missing client tokens — false, never silent', async () => {
    process.env['OPERATOR_SEND_CLIENT_ID'] = OPERATOR;
    try {
      deliverMock.mockResolvedValue({ success: false, error: 'No Gmail tokens for client' });
      const ok = await deliverTemplatedEmail(deps(makeDb(tpl)), { key: 'plan_ready', clientId: CLIENT, merge: {} });

      // false is what releases the settlement claim and leaves the sweep to retry.
      expect(ok).toBe(false);
      expect(logSpies.warn).toHaveBeenCalledWith(
        expect.objectContaining({ sentAs: OPERATOR, err: 'No Gmail tokens for client' }),
        expect.stringContaining('not sent'),
      );
    } finally { delete process.env['OPERATOR_SEND_CLIENT_ID']; }
  });
});
