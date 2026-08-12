/**
 * write-cycle.test.ts — which month a draft WRITE lands on.
 *
 * The rule has three cases and each one is a bug that happened: absent falls back (every
 * caller sent nothing, and refusing them would break the surface), a cycle the client owns is
 * honoured (the whole defect — writes landed on the link's month, not the viewed one), and
 * anything else is REFUSED rather than defaulted (a silent fallback is survivable for a list
 * and not for an approval).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ owned: new Set<string>() }));
vi.mock('@/lib/agent/cycle-state', () => ({
  cycleBelongsToClient: async (_c: string, id: string) => h.owned.has(id),
}));

import { resolveWriteCycle, requestedCycleId } from './write-cycle';

const SESSION = { clientId: 'client-1', cycleId: '11111111-1111-4111-8111-111111111111' };
const OWNED   = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';

beforeEach(() => { h.owned.clear(); h.owned.add(SESSION.cycleId); h.owned.add(OWNED); });

describe('resolveWriteCycle', () => {
  it('falls back to the session cycle when nothing is asked for', async () => {
    for (const absent of [undefined, null, '', '   ']) {
      expect(await resolveWriteCycle(SESSION, absent)).toEqual({ ok: true, cycleId: SESSION.cycleId });
    }
  });

  /** THE FIX: a September link may write to November, because the surface lets them walk
   *  there. Client-scoped, not link-scoped. */
  it('honours another month THIS CLIENT owns', async () => {
    expect(await resolveWriteCycle(SESSION, OWNED)).toEqual({ ok: true, cycleId: OWNED });
  });

  it('needs no lookup for the session’s own cycle — the token is already proof of it', async () => {
    h.owned.clear();                                   // even with ownership unresolvable
    expect(await resolveWriteCycle(SESSION, SESSION.cycleId)).toEqual({ ok: true, cycleId: SESSION.cycleId });
  });

  it('REFUSES a cycle belonging to someone else — never falls back to the session’s', async () => {
    expect(await resolveWriteCycle(SESSION, FOREIGN)).toEqual({ ok: false, error: 'forbidden' });
  });

  it('REFUSES a malformed id before it reaches the database', async () => {
    for (const junk of ['not-a-uuid', '../../etc', '1', 'DROP TABLE', `${OWNED}x`]) {
      expect(await resolveWriteCycle(SESSION, junk)).toEqual({ ok: false, error: 'forbidden' });
    }
  });

  it('REFUSES a well-formed id that does not exist', async () => {
    expect(await resolveWriteCycle(SESSION, '44444444-4444-4444-8444-444444444444'))
      .toEqual({ ok: false, error: 'forbidden' });
  });

  it('refuses a non-string rather than coercing it', async () => {
    for (const weird of [42, {}, [], true]) {
      const r = await resolveWriteCycle(SESSION, weird);
      // Not a string → treated as absent, which is the safe direction: the session's own
      // cycle, never someone else's and never a stringified object.
      expect(r).toEqual({ ok: true, cycleId: SESSION.cycleId });
    }
  });

  it('trims, so a padded id from a query string still resolves', async () => {
    expect(await resolveWriteCycle(SESSION, ` ${OWNED} `)).toEqual({ ok: true, cycleId: OWNED });
  });
});

describe('requestedCycleId', () => {
  it('reads the key without asserting its type, and tolerates no body at all', () => {
    expect(requestedCycleId({ cycleId: OWNED })).toBe(OWNED);
    expect(requestedCycleId({})).toBeUndefined();
    expect(requestedCycleId(null)).toBeUndefined();
    expect(requestedCycleId(undefined)).toBeUndefined();
  });
});
