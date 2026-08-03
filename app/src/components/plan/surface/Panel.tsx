'use client';

/**
 * Panel.tsx — the same content, placed instead of summoned.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────────────
 *
 * The desktop spec's own instruction is that the pieces which are width-agnostic — the detail
 * sheet, the conversation, the approval consequence — are **built once and placed differently,
 * not built twice** (mobile-plan-surface.md §10, desktop-plan-surface.md §10.4). `DetailSheet`
 * is 586 lines of tabs, copy, insights, shape mode and the format control; `VoiceSheet` is 589
 * lines of thread, composer, speech capture and apply lifecycle. Re-implementing either for a
 * second form factor is how the two surfaces start disagreeing about what a post is.
 *
 * So the callers keep their whole inside and swap only their FRAME:
 *
 *     const Frame = chrome === 'panel' ? Panel : Sheet;
 *
 * Both take the same four props. Everything below the frame is identical on both form factors,
 * which is the point — a fix to the caption tab lands on the phone and the desktop at once.
 *
 * ── What a panel deliberately does NOT inherit from a sheet ──────────────────────────
 *
 *   NO SCRIM.        A sheet dims what it covers because it is over the surface. A panel IS the
 *                    surface — nothing behind it is being suspended.
 *   NO FOCUS TRAP.   This is the load-bearing difference. `Sheet` traps focus because it is
 *                    `aria-modal`; a docked conversation that trapped focus would make the month
 *                    beside it unreachable by keyboard, which is the exact opposite of why it is
 *                    docked. Tab moves out of a panel, as it must.
 *   NO GRABBER.      A drag-to-dismiss handle on a region that does not dismiss is the inert
 *                    affordance round 6 (P7) spent a session removing.
 *   NO `theme-color`. The browser band follows a sheet because a sheet dims the app behind it.
 *                    Nothing is dimmed here.
 *   NO `role="dialog"`. It is a `region` with a name. Announcing "dialog" for something that
 *                    never took focus and cannot be dismissed would be a lie to a screen reader.
 *
 * The testid is the CALLER'S, unchanged, so a selector that finds the detail sheet on a phone
 * finds the detail panel on a desktop and the e2e suites do not fork.
 */
import React from 'react';
import type { SheetProps } from './Sheet';

/** The frame props both chromes honour. `layer` and `hasOwnClose` are sheet-only concepts. */
export type PanelProps = Omit<SheetProps, 'layer' | 'hasOwnClose'> & { layer?: 0 | 1; hasOwnClose?: boolean };

export function Panel({ open, label, testid, children }: PanelProps) {
  if (!open) return null;
  return (
    <section
      data-testid={testid}
      data-chrome="panel"
      aria-label={label}
      // `min-h-0` is load-bearing: this is a flex child whose own child scrolls, and without it
      // the scroll region grows to its content and takes the column with it.
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-line/30 bg-surface shadow-card"
    >
      {children}
    </section>
  );
}

/** Pick a frame. Callers take a `chrome` prop and pass it straight through. */
export type Chrome = 'sheet' | 'panel';
