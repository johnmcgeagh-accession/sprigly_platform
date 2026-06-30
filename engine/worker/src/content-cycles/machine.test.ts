import { describe, it, expect, vi } from 'vitest';

// machine.ts imports @sprigly/db (which throws if DATABASE_URL absent).
// isAllowedTransition is pure — mock the module so only the guard is tested.
vi.mock('@sprigly/db', () => ({
  db:            {},
  contentCycles: Symbol('contentCycles'),
}));

import { isAllowedTransition } from './machine.js';
import type { CycleStatus } from '@sprigly/db';

describe('isAllowedTransition', () => {
  it('allows all legal forward transitions', () => {
    const forward: Array<[CycleStatus, CycleStatus]> = [
      ['scheduled',              'requested'],
      ['requested',              'reply_received'],
      ['requested',              'intake_confirmed'],      // no-reply fallback
      ['reply_received',         'awaiting_confirmation'],
      ['reply_received',         'intake_confirmed'],
      ['awaiting_confirmation',  'intake_confirmed'],
      ['intake_confirmed',       'planning'],
      ['planning',               'workbook_built'],
      ['workbook_built',         'delivered'],
      ['delivered',              'active'],
      ['active',                 'finalised'],
      ['finalised',              'awaiting_voice_approval'],
      ['awaiting_voice_approval','voice_merged'],
      ['voice_merged',           'closed'],
    ];
    for (const [from, to] of forward) {
      expect(isAllowedTransition(from, to, null), `${from}→${to}`).toBe(true);
    }
  });

  it('allows any non-closed/failed state → failed', () => {
    const states: CycleStatus[] = [
      'scheduled', 'requested', 'reply_received', 'awaiting_confirmation',
      'intake_confirmed', 'planning', 'workbook_built', 'delivered',
      'active', 'finalised', 'awaiting_voice_approval', 'voice_merged',
    ];
    for (const s of states) {
      expect(isAllowedTransition(s, 'failed', null), `${s}→failed`).toBe(true);
    }
  });

  it('rejects illegal transitions', () => {
    expect(isAllowedTransition('scheduled',    'voice_merged',  null)).toBe(false);
    expect(isAllowedTransition('closed',       'active',        null)).toBe(false);
    expect(isAllowedTransition('planning',     'delivered',     null)).toBe(false); // requires workbook_built
    expect(isAllowedTransition('voice_merged', 'requested',     null)).toBe(false);
    expect(isAllowedTransition('active',       'intake_confirmed', null)).toBe(false);
    expect(isAllowedTransition('closed',       'failed',        null)).toBe(false);
  });

  it('allows failed → prior_status for retry', () => {
    expect(isAllowedTransition('failed', 'planning',               'planning')).toBe(true);
    expect(isAllowedTransition('failed', 'awaiting_voice_approval','awaiting_voice_approval')).toBe(true);
    expect(isAllowedTransition('failed', 'active',                 'active')).toBe(true);
  });

  it('rejects failed → a state that is not prior_status', () => {
    expect(isAllowedTransition('failed', 'active',   'planning')).toBe(false);
    expect(isAllowedTransition('failed', 'closed',   'planning')).toBe(false);
    expect(isAllowedTransition('failed', 'requested','active')).toBe(false);
  });

  it('rejects failed → any when prior_status is null', () => {
    expect(isAllowedTransition('failed', 'planning',               null)).toBe(false);
    expect(isAllowedTransition('failed', 'active',                 null)).toBe(false);
    expect(isAllowedTransition('failed', 'awaiting_voice_approval',null)).toBe(false);
  });
});
