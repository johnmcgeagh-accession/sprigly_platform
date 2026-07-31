/**
 * ai-change-cap.test.ts — the rules three packages now share.
 *
 * The classification is the part worth pinning hardest. It decides what gets billed again and
 * what stops, so each class is exercised with the shape it actually arrives in — a source_meta
 * blob written by a path in another package — rather than with a string.
 */
import { describe, it, expect } from 'vitest';
import {
  isCapReached, remainingChanges, isQuotaBanked, bankedAt,
  classifyGenerationFailure, capAnnouncement, bankedLine, resetDayLabel,
  QUOTA_BANKED_KEY, QUOTA_BANKED_AT_KEY,
} from './ai-change-cap.js';

const NOW = new Date('2026-07-31T10:00:00Z');

describe('the allowance', () => {
  it('is reached at the limit, not past it', () => {
    expect(isCapReached({ used: 29, limit: 30, overrideUntil: null }, NOW)).toBe(false);
    expect(isCapReached({ used: 30, limit: 30, overrideUntil: null }, NOW)).toBe(true);
    expect(isCapReached({ used: 31, limit: 30, overrideUntil: null }, NOW)).toBe(true);
  });

  it('an override in the FUTURE makes it unreachable; an expired one does nothing', () => {
    expect(isCapReached({ used: 99, limit: 30, overrideUntil: '2026-12-01T00:00:00Z' }, NOW)).toBe(false);
    expect(isCapReached({ used: 99, limit: 30, overrideUntil: '2026-01-01T00:00:00Z' }, NOW)).toBe(true);
  });

  it('remaining never goes negative, and is Infinity under an override', () => {
    expect(remainingChanges({ used: 28, limit: 30, overrideUntil: null }, NOW)).toBe(2);
    expect(remainingChanges({ used: 44, limit: 30, overrideUntil: null }, NOW)).toBe(0);
    expect(remainingChanges({ used: 44, limit: 30, overrideUntil: '2026-12-01T00:00:00Z' }, NOW)).toBe(Infinity);
  });
});

describe('banked work is a FLAG, never a message', () => {
  it('reads the flag', () => {
    expect(isQuotaBanked({ [QUOTA_BANKED_KEY]: true })).toBe(true);
    expect(isQuotaBanked({ [QUOTA_BANKED_KEY]: false })).toBe(false);
    expect(isQuotaBanked({})).toBe(false);
    expect(isQuotaBanked(null)).toBe(false);
    expect(isQuotaBanked('nonsense')).toBe(false);
  });

  it('a truthy-but-not-true value is NOT banked — jsonb has no schema, so the check is exact', () => {
    expect(isQuotaBanked({ [QUOTA_BANKED_KEY]: 'true' })).toBe(false);
    expect(isQuotaBanked({ [QUOTA_BANKED_KEY]: 1 })).toBe(false);
  });

  it('carries when it was banked, defensively', () => {
    expect(bankedAt({ [QUOTA_BANKED_AT_KEY]: '2026-07-20T09:00:00Z' })).toBe('2026-07-20T09:00:00Z');
    expect(bankedAt({ [QUOTA_BANKED_AT_KEY]: '   ' })).toBeNull();
    expect(bankedAt({})).toBeNull();
  });
});

describe('classification — what may be retried, and what may not', () => {
  const meta = (error: string, extra: Record<string, unknown> = {}) => ({ generationError: error, ...extra });

  it('QUOTA comes off the flag, whatever the message says', () => {
    expect(classifyGenerationFailure(meta('Bedrock timed out', { [QUOTA_BANKED_KEY]: true }))).toBe('quota');
    expect(classifyGenerationFailure({ [QUOTA_BANKED_KEY]: true })).toBe('quota');
  });

  it('and from the pre-flag sentence, for rows written before the flag existed', () => {
    expect(classifyGenerationFailure(meta('You’ve used all 30 AI changes this month.'))).toBe('quota');
  });

  it('TRANSIENT: the failures that are about the moment', () => {
    for (const e of [
      'Bedrock timed out after 180s',
      'ETIMEDOUT connecting to bedrock-runtime.eu-west-2.amazonaws.com',
      'ThrottlingException: Too many requests',
      'ServiceUnavailableException',
      'socket hang up',
      'Request failed with status code 503',
      'Model temporarily unavailable',
    ]) {
      expect(classifyGenerationFailure(meta(e)), e).toBe('transient');
    }
  });

  it('DETERMINISTIC: the failures that are about the request — and that is the DEFAULT', () => {
    for (const e of [
      'Could not produce a clean caption for that change — left it unchanged.',
      'Could not get that change on-brand — left the caption as it was.',
      'shape: cycle 1234 not found',
      'something nobody has seen before',
    ]) {
      expect(classifyGenerationFailure(meta(e)), e).toBe('deterministic');
    }
  });

  /**
   * ABSENT is not the same as UNRECOGNISED, and they get opposite answers on purpose. Every
   * writer of `generation_failed` records a reason, so a row with none was written by something
   * we cannot account for — calling that deterministic would strand it permanently. The retry
   * is bounded, so being wrong costs two attempts; being wrong the other way costs the post.
   */
  it('no error at all is TRANSIENT — nothing said this was about the request, and the retry is bounded', () => {
    expect(classifyGenerationFailure({})).toBe('transient');
    expect(classifyGenerationFailure(null)).toBe('transient');
    expect(classifyGenerationFailure({ generationError: '' })).toBe('transient');
    // …but a message that IS there and is not a known transient one stops.
    expect(classifyGenerationFailure({ generationError: 'shape: cycle 1234 not found' })).toBe('deterministic');
  });
});

describe('what the client reads', () => {
  it('the announcement states the cost, the balance, the date and the offer — in that order', () => {
    const s = capAnnouncement({ needed: 4, remaining: 1, resetsOn: '2026-08-01T00:00:00Z' });
    expect(s).toContain('4 changes');
    expect(s).toContain('1 left this month');
    expect(s).toContain('1 August');
    expect(s).toMatch(/save the whole thing/);
    expect(s.indexOf('4 changes')).toBeLessThan(s.indexOf('1 left'));
    expect(s.indexOf('1 left')).toBeLessThan(s.indexOf('1 August'));
  });

  it('none left reads as none left, not as "0 left"', () => {
    expect(capAnnouncement({ needed: 1, remaining: 0, resetsOn: '2026-08-01T00:00:00Z' }))
      .toContain('you’ve none left this month');
  });

  it('one change is singular', () => {
    expect(capAnnouncement({ needed: 1, remaining: 0, resetsOn: '2026-08-01T00:00:00Z' })).toContain('1 change written');
  });

  it('the banked line names the date and never promises anything is coming before it', () => {
    const s = bankedLine('2026-08-01T00:00:00Z');
    expect(s).toBe('Waiting for your changes to refresh on 1 August.');
    expect(s).not.toMatch(/on its way|shortly|soon/i);
  });

  it('the copy never uses the words the client fence bans', () => {
    const all = [
      capAnnouncement({ needed: 3, remaining: 0, resetsOn: '2026-08-01T00:00:00Z' }),
      bankedLine('2026-08-01T00:00:00Z'),
    ].join(' ');
    expect(all).not.toMatch(/\b(failed|failure|retry|retried|retrying|approve|approved)\b/i);
  });

  it('the date label survives an instant, a plain date, and nonsense', () => {
    expect(resetDayLabel('2026-08-01T00:00:00Z')).toBe('1 August');
    expect(resetDayLabel('2026-12-01')).toBe('1 December');
    expect(resetDayLabel('whenever')).toBe('whenever');
  });
});
