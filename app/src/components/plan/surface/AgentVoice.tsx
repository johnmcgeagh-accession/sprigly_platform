'use client';

/**
 * AgentVoice.tsx — one visual register for "the agent is working" and "the agent understood".
 *
 * ── Why one component rather than three good ones ────────────────────────────────────
 *
 * The agent spoke in three unrelated voices on this surface, and the operator's re-check named
 * it: a sentence dropped into the same dark toast that reports a save; a reshape in progress
 * showed nothing at all until it was over; and the voice sheet showed a raw transcript in body
 * copy, indistinguishable from the framing paragraph above it. Nothing tied them together, so
 * there was no way for a client to learn what *the agent talking* looks like — every appearance
 * was the first appearance.
 *
 * A register is only a register if it is the same every time. So this file is the only place the
 * treatment is defined, and the three surfaces import it rather than describe it again:
 *
 *   AgentDots   the three-dot pulse. Working, with nothing yet to say.
 *   AgentSays   the block: the mark, the dots while it is still going, and the words.
 *
 * ── What makes it read as the agent and not as chrome ────────────────────────────────
 *
 * The mark, the accent tint field, and a left edge in the accent. Deliberately NOT the dark
 * `chrome-deep` slab that `Feedback` uses for confirmations: that slab means *the app did a
 * thing to your plan*, and the agent is not the app reporting — it is the other party in a
 * conversation. Two different meanings had one shape, which is exactly what made the agent's
 * replies feel like system messages.
 *
 * ── The dots ─────────────────────────────────────────────────────────────────────────
 *
 * Three, on the `dot-pulse` keyframes the surface already uses for a post that is on its way
 * (tailwind.config.ts), staggered by a third of a cycle. The rhythm is shared on purpose:
 * "something of yours is being made" is one idea, whether it is a caption or a reply. Behind
 * `motion-safe:` — with reduced motion the dots hold at full opacity and say the same thing
 * statically. `aria-hidden`, because the words beside them, or the block's own label, carry it.
 */
import React from 'react';
import { SprigMarkV2 } from './icons';

/** Staggered so the three read as one travelling pulse rather than three blinking lights. */
const DELAYS = ['0ms', '160ms', '320ms'];

export function AgentDots({ tone = 'accent', className = '' }: {
  /** `accent` on a light field, `light` on the dark one. Both are theme tokens. */
  tone?: 'accent' | 'light';
  className?: string;
}) {
  return (
    <span data-testid="agent-dots" aria-hidden="true" className={`inline-flex flex-none items-center gap-[4px] ${className}`}>
      {DELAYS.map((d) => (
        <span
          key={d}
          style={{ animationDelay: d }}
          className={[
            'block h-[5px] w-[5px] rounded-full motion-safe:animate-dot-pulse',
            tone === 'light' ? 'bg-coral-500' : 'bg-coral-700',
          ].join(' ')}
        />
      ))}
    </span>
  );
}

export function AgentSays({
  children, working = false, label = 'Sprigly', testid = 'agent-says', className = '', grows = false, live = true,
}: {
  /** What the agent said. Absent while it is still working — then the dots stand alone. */
  children?: React.ReactNode;
  /** Still going. The dots show; the words, if any, show under them.  */
  working?: boolean;
  /** Screen-reader name for the block. The mark is decorative and cannot supply one. */
  label?: string;
  testid?: string;
  className?: string;
  /**
   * The text GROWS rather than being replaced — a live transcript, appended phrase by phrase.
   *
   * This is the difference between `aria-atomic` true and false, and it is not cosmetic. A reply
   * is one finished sentence that arrives whole: atomic, announce all of it. A transcript is an
   * append-only log, and announcing it atomically re-reads the WHOLE paragraph after every
   * phrase — so a client dictating three sentences hears the first one four times. Non-atomic
   * announces only what was added, which is what they have not heard yet.
   */
  grows?: boolean;
  /**
   * Whether this block is a LIVE region (the conversation sheet). In a thread only the NEWEST
   * agent turn announces — a history of status regions would re-announce the whole conversation
   * on every render. Default true, so every existing single-block use is unchanged.
   */
  live?: boolean;
}) {
  const hasWords = children !== undefined && children !== null && children !== '';
  return (
    <div
      data-testid={testid}
      {...(live ? { role: 'status' as const, 'aria-live': 'polite' as const, 'aria-atomic': grows ? ('false' as const) : ('true' as const) } : {})}
      aria-label={label}
      className={[
        'flex items-start gap-2.5 rounded-[14px] border-l-[3px] border-coral-700 bg-coral-100 px-3 py-2.5',
        className,
      ].join(' ')}
    >
      <SprigMarkV2 aria-hidden="true" className="mt-[2px] h-[15px] w-[15px] flex-none text-coral-700" />
      <div className="min-w-0 flex-1">
        {/* accent-800 on accent-100 is 6.67:1 — the pairing the spec checks by name, and the
            reason the field is the tint rather than a surface with a tint border. */}
        {hasWords && (
          <p data-testid={`${testid}-text`} className="text-[14.5px] leading-[1.45] text-coral-800">{children}</p>
        )}
        {working && <AgentDots className={hasWords ? 'mt-1.5' : 'mt-[3px]'} />}
      </div>
    </div>
  );
}
