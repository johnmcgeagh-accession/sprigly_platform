/**
 * @vitest-environment jsdom
 *
 * agent-voice.interaction.test.tsx — one register, everywhere the agent speaks (round 8, fix 7).
 *
 * ── What this is guarding ────────────────────────────────────────────────────────────
 *
 * The agent had three unrelated looks on this surface: a sentence in the same dark slab that
 * reports a save, a reshape that showed nothing at all while it ran, and a raw transcript set in
 * body copy one size off the framing paragraph above it. Three appearances, no shared shape, so
 * nothing about the first taught the client anything about the second.
 *
 * The tests below are about SAMENESS as much as correctness: they assert that the voice sheet,
 * the toast and the reshape all render the same component, and that the dark confirmation slab
 * is still reserved for the app reporting on itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { AgentSays, AgentDots } from './AgentVoice';
import { Feedback } from './Feedback';

afterEach(cleanup);

describe('the block', () => {
  it('says what the agent said, in the agent’s own field', () => {
    render(<AgentSays>Moved to Friday, if you approve it.</AgentSays>);
    const block = screen.getByTestId('agent-says');
    expect(screen.getByTestId('agent-says-text').textContent).toBe('Moved to Friday, if you approve it.');
    // The tint field + accent edge is what makes it read as somebody talking rather than as the
    // app reporting. `chrome-deep` is the confirmation slab and must never appear here.
    expect(block.className).toContain('bg-coral-100');
    expect(block.className).toContain('border-coral-700');
    expect(block.className).not.toContain('chrome-deep');
  });

  it('is announced, and named — a live region with no name is a noise', () => {
    render(<AgentSays>Anything.</AgentSays>);
    const block = screen.getByTestId('agent-says');
    expect(block.getAttribute('role')).toBe('status');
    expect(block.getAttribute('aria-live')).toBe('polite');
    expect(block.getAttribute('aria-label')).toBe('Sprigly');
  });

  it('working with nothing to say yet is the dots alone', () => {
    render(<AgentSays working />);
    expect(screen.getByTestId('agent-dots')).toBeTruthy();
    expect(screen.queryByTestId('agent-says-text')).toBeNull();
  });

  it('working WITH words shows both — the sentence so far is not the whole sentence', () => {
    render(<AgentSays working>The candle relaunches</AgentSays>);
    expect(screen.getByTestId('agent-says-text').textContent).toBe('The candle relaunches');
    expect(screen.getByTestId('agent-dots')).toBeTruthy();
  });

  it('finished words carry no dots', () => {
    render(<AgentSays>All done.</AgentSays>);
    expect(screen.queryByTestId('agent-dots')).toBeNull();
  });
});

describe('the dots', () => {
  it('are three, staggered, on the surface’s own pulse', () => {
    const { container } = render(<AgentDots />);
    const dots = container.querySelectorAll('span > span');
    expect(dots).toHaveLength(3);
    // The same keyframes a post that is on its way uses. One idea, one rhythm.
    for (const d of dots) expect(d.className).toContain('animate-dot-pulse');
    // Behind motion-safe, so reduced motion holds them still rather than removing them.
    for (const d of dots) expect(d.className).toContain('motion-safe:');
    expect([...dots].map((d) => (d as HTMLElement).style.animationDelay)).toEqual(['0ms', '160ms', '320ms']);
  });

  it('are hidden from a screen reader — the words beside them carry the meaning', () => {
    render(<AgentDots />);
    expect(screen.getByTestId('agent-dots').getAttribute('aria-hidden')).toBe('true');
  });

  it('take the light tier on a dark field and the text tier on a light one', () => {
    const { container } = render(<AgentDots tone="light" />);
    expect(container.querySelector('span > span')!.className).toContain('bg-coral-500');
    cleanup();
    const plain = render(<AgentDots />);
    expect(plain.container.querySelector('span > span')!.className).toContain('bg-coral-700');
  });
});

describe('the top slot: a reply is not a confirmation', () => {
  const noop = () => {};

  it('an agent reply renders in the agent’s register, NOT the dark slab', () => {
    render(<Feedback undo={null} onDismiss={noop} agent="That would move it into November — shall I?" />);
    expect(screen.getByTestId('feedback-agent')).toBeTruthy();
    expect(screen.getByTestId('feedback-agent-text').textContent)
      .toBe('That would move it into November — shall I?');
    expect(screen.queryByTestId('feedback')).toBeNull();
  });

  it('a plain statement keeps the dark slab — the app reporting on itself', () => {
    render(<Feedback undo={null} onDismiss={noop} message="Moved to Friday." />);
    const slab = screen.getByTestId('feedback');
    expect(slab.className).toContain('bg-chrome-deep');
    expect(screen.queryByTestId('feedback-agent')).toBeNull();
  });

  it('the agent WORKING shows the dots before there are any words', () => {
    render(<Feedback undo={null} onDismiss={noop} agentWorking />);
    expect(screen.getByTestId('agent-dots')).toBeTruthy();
    expect(screen.queryByTestId('feedback-agent-text')).toBeNull();
  });

  it('UNDO OUTRANKS THE AGENT — it is time-limited and destructive to miss', () => {
    render(
      <Feedback
        undo={{ message: 'Moved to 3 November.', onUndo: noop }}
        onDismiss={noop}
        agent="Done — moved it."
        agentWorking
      />,
    );
    expect(screen.getByTestId('feedback')).toBeTruthy();
    expect(screen.getByTestId('feedback-undo')).toBeTruthy();
    expect(screen.queryByTestId('feedback-agent')).toBeNull();
  });

  it('and the agent outranks a plain message, which is the reply to what they just said', () => {
    render(<Feedback undo={null} onDismiss={noop} message="Saved." agent="I’ve put that up to approve." />);
    expect(screen.getByTestId('feedback-agent-text').textContent).toBe('I’ve put that up to approve.');
    expect(screen.queryByTestId('feedback')).toBeNull();
  });

  it('nothing at all renders nothing', () => {
    const { container } = render(<Feedback undo={null} onDismiss={noop} />);
    expect(container.firstChild).toBeNull();
  });
});
