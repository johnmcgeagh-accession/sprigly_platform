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

const LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

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
