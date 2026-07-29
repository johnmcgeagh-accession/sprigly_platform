/**
 * refusals.test.ts — a refused write has to say what happened to the client's change.
 *
 * The surface is optimistic-first for reversible mutations, and that trade is only honest if the
 * rollback is visible AND specific. "Something went wrong. Please try again." — the sentence
 * every refused write used to get — cannot be acted on: it does not tell "that date has passed"
 * (do something different) from a network blip (do the same thing again).
 */
import { describe, it, expect } from 'vitest';
import { refusalMessage } from './refusals';

describe('refusalMessage', () => {
  it('prefers the route’s OWN sentence — it was written beside the guard that produced it', () => {
    expect(refusalMessage({ message: 'This month’s draft is closed for changes.' }, 409))
      .toBe('This month’s draft is closed for changes.');
  });

  it('turns a bare code into something a client can act on', () => {
    expect(refusalMessage({ error: 'read_only' }, 403)).toContain('already passed');
    expect(refusalMessage({ error: 'not_found' }, 404)).toContain('may have been removed');
    expect(refusalMessage({ error: 'caption_required' }, 422)).toContain('caption first');
  });

  it('names the network as the network, and says the change is not lost', () => {
    const m = refusalMessage(null, 0);
    expect(m).toContain('couldn’t reach the server');
    expect(m).toContain('Nothing has changed');
  });

  it('never blames the client for a code we do not recognise', () => {
    const m = refusalMessage({ error: 'some_new_code' }, 500);
    expect(m).toContain('Nothing has changed');
    expect(m).not.toMatch(/you |your /i);
  });

  it('handles an empty error body, which is a real case', () => {
    expect(refusalMessage(undefined, 500)).toContain('Nothing has changed');
    expect(refusalMessage({}, 500)).toContain('Nothing has changed');
  });

  it('ignores a blank message rather than showing one', () => {
    expect(refusalMessage({ message: '   ', error: 'read_only' }, 403)).toContain('already passed');
  });

  it('says what happened to the change, on every path — that is the question being asked', () => {
    for (const body of [{ error: 'read_only' }, { error: 'unknown' }, null]) {
      expect(refusalMessage(body, body ? 403 : 0)).toMatch(/can’t change|Nothing has changed|may have been removed/);
    }
  });
});
