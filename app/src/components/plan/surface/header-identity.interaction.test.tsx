/**
 * @vitest-environment jsdom
 *
 * header-identity.interaction.test.tsx — whose product is this? (round 8, fix 4)
 *
 * ── What the phone showed ────────────────────────────────────────────────────────────
 *
 * The wordmark was 17px of `chrome` grey — the same colour and roughly the same weight as every
 * other word on the surface — sitting above a 20px month title. Smaller than the thing under it
 * and coloured like the thing under it, which is a wordmark that has stopped being a wordmark.
 * The header said what month it was and nothing about who was showing it to you.
 *
 * The identity now takes the accent and the top of the scale, and the month steps down beneath
 * it. Two rules this file keeps honest, because both are easy to lose to a later tidy-up:
 *
 *   THE SCALE. Wordmark ≥ month title, always, in px read off the class rather than trusted.
 *   THE TIER. The accent has one text-safe tier on this canvas. `accent-600` — the logo's own
 *   tone — is 2.35:1 against it and is ruled out by the spec's contrast table by name. A future
 *   "make it match the mark" would be a legibility regression, so it is a test, not a comment.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { PlanShell } from './PlanShell';

afterEach(cleanup);

function shell(over: Partial<React.ComponentProps<typeof PlanShell>> = {}) {
  const onView = vi.fn();
  render(
    <PlanShell
      monthLabel="October 2026" view="day" onView={onView} micLabel="Talk to your plan"
      onToday={() => {}} todayEnabled
      {...over}
    >
      <div data-testid="content" />
    </PlanShell>,
  );
  return { onView };
}

/** The px a Tailwind arbitrary text size declares, e.g. `text-[22px]` → 22. */
const sizeOf = (el: Element): number => {
  const m = /text-\[(\d+(?:\.\d+)?)px\]/.exec(el.className);
  expect(m, `no arbitrary text size on: ${el.className}`).toBeTruthy();
  return Number(m![1]);
};

const wordmark = () => screen.getByText('Sprigly');

describe('the wordmark leads', () => {
  it('is at least as large as the month title', () => {
    shell();
    expect(sizeOf(wordmark())).toBeGreaterThanOrEqual(sizeOf(screen.getByTestId('month-title')));
  });

  it('and the month title has actually stepped DOWN — not the wordmark merely matching it', () => {
    shell();
    expect(sizeOf(wordmark())).toBeGreaterThan(sizeOf(screen.getByTestId('month-title')));
  });

  it('renders in the accent, not in chrome', () => {
    shell();
    expect(wordmark().className).toContain('text-coral-700');
    expect(wordmark().className).not.toContain('text-chrome');
  });

  it('NEVER in accent-600 — the logo tone is 2.35:1 on canvas and is not a text colour', () => {
    shell();
    expect(wordmark().className).not.toMatch(/\btext-coral-(500|600)\b/);
  });

  it('keeps its ruled face, and the month keeps the sans ladder', () => {
    shell();
    expect(wordmark().className).toContain('font-logo');
    expect(screen.getByTestId('month-title').className).not.toContain('font-logo');
  });

  it('the MARK beside it keeps the identity tone — it is a fill, not text', () => {
    const { container } = render(
      <PlanShell monthLabel="October 2026" view="day" onView={() => {}} micLabel="x" onToday={() => {}} todayEnabled>
        <div />
      </PlanShell>,
    );
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('text-coral-600');
  });
});

describe('what the change must NOT have cost', () => {
  it('the month is still the h1 — the scale moved, the structure did not', () => {
    shell();
    const title = screen.getByTestId('month-title');
    expect(title.tagName).toBe('H1');
    expect(title.textContent).toBe('October 2026');
    // And the wordmark is still not a heading.
    expect(wordmark().tagName).toBe('SPAN');
  });

  it('the month still fits on one line at the narrowest month name we have', () => {
    shell({ monthLabel: 'September 2026' });
    expect(screen.getByTestId('month-title').className).toContain('whitespace-nowrap');
  });

  it('the arrows still work either side of it', () => {
    const onPrev = vi.fn(); const onNext = vi.fn();
    shell({ onPrevMonth: onPrev, onNextMonth: onNext });
    fireEvent.click(screen.getByTestId('prev-month'));
    fireEvent.click(screen.getByTestId('next-month'));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('Today is still on the month row, not back in a row of its own', () => {
    shell();
    const today = screen.getByTestId('today-btn');
    const title = screen.getByTestId('month-title');
    expect(today.parentElement).toBe(title.closest('div')!.parentElement);
  });
});

describe('the nav clears the home indicator (fix 3)', () => {
  it('the floating pill offsets by the bottom safe-area inset', () => {
    shell();
    // The shell bleeds to every edge on purpose; this is the one thing that must not.
    expect(screen.getByTestId('nav-pill').className).toContain('env(safe-area-inset-bottom');
  });
});
