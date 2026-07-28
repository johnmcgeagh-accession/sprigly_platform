/**
 * posting-time.test.ts — gap 1, against the data rather than against the mockups.
 *
 * Every posting time in the design set was "6:00" or "19:00". The live rows are not that. The
 * distinct values actually stored in `source_meta.postingTime` are:
 *
 *     6am · 6pm · 7am · 7pm · 8pm · evening · Evening · Morning
 *
 * Some are clock times and some are NAMED SLOTS, which is what the `PostingTimes` contract
 * describes and what the mockups quietly assumed away. A parser that only accepted 'HH:MM'
 * would have rendered no time at all on every real post while passing every test written from
 * the design — so these cases are the stored values, verbatim, first.
 */
import { describe, it, expect } from 'vitest';
import { normalisePostingTime, isClockTime } from '@/lib/posting-time';

describe('the values actually on disk', () => {
  const STORED: [string, string][] = [
    ['6am', '06:00'],
    ['6pm', '18:00'],
    ['7am', '07:00'],
    ['7pm', '19:00'],
    ['8pm', '20:00'],
    ['evening', 'Evening'],
    ['Evening', 'Evening'],
    ['Morning', 'Morning'],
  ];

  for (const [raw, label] of STORED) {
    it(`"${raw}" reads as ${label}`, () => {
      expect(normalisePostingTime(raw)).toBe(label);
    });
  }

  it('collapses the two spellings of evening into ONE label', () => {
    // Otherwise the move sheet offers 'evening' and 'Evening' as two different slots.
    expect(normalisePostingTime('evening')).toBe(normalisePostingTime('Evening'));
  });
});

describe('clock forms', () => {
  it('normalises to 24-hour, zero-padded', () => {
    expect(normalisePostingTime('6:00')).toBe('06:00');
    expect(normalisePostingTime('06:00')).toBe('06:00');
    expect(normalisePostingTime('18.00')).toBe('18:00');
    expect(normalisePostingTime('11:30pm')).toBe('23:30');
    expect(normalisePostingTime('12am')).toBe('00:00');
    expect(normalisePostingTime('12pm')).toBe('12:00');
  });

  it('refuses an impossible clock rather than storing nonsense', () => {
    expect(normalisePostingTime('25:00')).toBeNull();
    expect(normalisePostingTime('12:75')).toBeNull();
    expect(normalisePostingTime('13pm')).toBeNull();
  });
});

describe('what it will not do', () => {
  it('never invents a clock value for a named slot', () => {
    // 'Evening' as '18:00' would put a number on the surface that exists nowhere in the data.
    expect(normalisePostingTime('Evening')).toBe('Evening');
    expect(isClockTime(normalisePostingTime('Evening'))).toBe(false);
  });

  it('drops a value no surface could render honestly', () => {
    expect(normalisePostingTime('')).toBeNull();
    expect(normalisePostingTime('   ')).toBeNull();
    expect(normalisePostingTime(null)).toBeNull();
    expect(normalisePostingTime('whenever the light is good and the shop is quiet')).toBeNull();
    expect(normalisePostingTime('¯\\_(ツ)_/¯')).toBeNull();
  });
});

describe('isClockTime', () => {
  it('separates what a time input can round-trip from what it cannot', () => {
    expect(isClockTime('06:00')).toBe(true);
    expect(isClockTime('Evening')).toBe(false);
    expect(isClockTime(null)).toBe(false);
  });
});
