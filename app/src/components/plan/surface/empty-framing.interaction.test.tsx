/**
 * @vitest-environment jsdom
 *
 * empty-framing.interaction.test.tsx — what the composer says over a month with nothing in it.
 *
 * OBSERVED (UAT, cycle 0b9677e5, cycle_month 2026-08, zero posts of any status): the dock
 * greeted the client with "September is written. Say what you want different…" while the grid
 * beside it said "Nothing planned across September yet" and the rail said "0 posts this month".
 * The framing was a two-value enum with no member for an empty month, so it took the written
 * one — the agent asserting a month state that is false, in its own opening turn.
 *
 * The blurb is the agent's FIRST TURN, not chrome, which is why this is asserted at all: it is
 * the thing that has to be true.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { VoiceSheet, type VoiceContext } from './VoiceSheet';

function open(context: VoiceContext) {
  render(
    <VoiceSheet
      open monthName="September" cycleId="cyc-1" busy={false} chrome="sheet" context={context}
      onClose={vi.fn()} onSubmit={vi.fn(async () => ({ ok: true as const }))}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ conversationId: null, turns: [] }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the empty month gets its own framing', () => {
  it('never claims the month is written', () => {
    open('empty');
    expect(document.body.textContent).not.toContain('is written');
  });

  it('says the month is empty, in the month\'s own name', () => {
    open('empty');
    expect(document.body.textContent).toContain('Nothing’s planned for September yet');
  });

  /**
   * THE COPY BOUNDARY, AND WHY IT IS A TEST.
   *
   * Traced on the real empty cycle: a brief-shaped sentence typed here parses to `add_note`,
   * renders as "Saved to your ideas", and leaves the month empty. Only a DATED ADD builds
   * anything. Meanwhile the intake overlay — which is on screen at the same time when the
   * client arrives from an Ask email — says "Tell me what's happening this month" and actually
   * does build the month from it.
   *
   * So this composer must not solicit a brief. Two inputs inviting the same sentence, where
   * only one of them acts on it, would teach the client to brief the composer and quietly turn
   * their month into a backlog.
   */
  it('offers a post, not a brief — it must not compete with the intake surface', () => {
    open('empty');
    const text = document.body.textContent ?? '';
    expect(text).toContain('Tell me a post you want');
    expect(text).not.toContain('what’s happening');   // the intake overlay's line, not this one
  });

  it('the placeholder names the same act as the blurb', () => {
    open('empty');
    expect((screen.getByTestId('voice-input') as HTMLTextAreaElement).placeholder)
      .toBe('Add a post — what and when…');
  });
});

describe('the written month is untouched', () => {
  it('still opens with the written framing', () => {
    open('committed');
    expect(document.body.textContent).toContain('September is written');
  });

  it('and the draft month still opens with its own', () => {
    open('draft');
    expect(document.body.textContent).toContain('This is your September draft');
  });
});
