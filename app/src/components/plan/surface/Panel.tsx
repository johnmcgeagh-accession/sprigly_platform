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
import React, { useEffect, useRef } from 'react';
import type { SheetProps } from './Sheet';
import { useFocusTrap } from '../a11y';
import { sheetThemeOpened, sheetThemeClosed } from './theme-color';

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
export type Chrome = 'sheet' | 'panel' | 'modal';


/**
 * Modal — the third frame, for the one decision that is genuinely modal.
 *
 * ── Why this is NOT a Panel, and not a Sheet either ──────────────────────────────────
 *
 * A PANEL is part of the surface and traps nothing. A MODAL suspends it: the approval spends
 * money and writes a month of content, and it is the one moment this surface asks for the
 * client's whole attention. So it keeps everything `Panel` drops — the scrim, the focus trap,
 * `role="dialog"`, `aria-modal`, the browser's theme band — and differs from `Sheet` only in
 * SHAPE: a centred box at content width rather than a panel filling the bottom of the screen.
 *
 * A full-width bottom sheet is a phone shape. At 1764px it would be a wall carrying three
 * counts and two sentences, and the decision it holds is exactly the same size on every
 * screen — which is the argument for a fixed content width rather than a proportional one.
 *
 * No grabber: a modal at the centre of the screen has no edge to drag, and its callers carry
 * their own ✕. Escape and the scrim both close it, which the focus trap and the scrim's own
 * handler already provide.
 */
export function Modal({ open, label, testid, onClose, children }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, onClose);

  // The browser chrome follows a modal for the same reason it follows a sheet: the app behind
  // it is dimmed, and a bright canvas stripe over a dimmed app reads as a rendering fault.
  useEffect(() => {
    if (!open) return;
    sheetThemeOpened();
    return sheetThemeClosed;
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div data-testid={`${testid}-scrim`} aria-hidden="true" onClick={onClose}
        className="absolute inset-0 z-[30] bg-chrome-deep/[.34]" />
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={label} data-testid={testid}
        data-chrome="modal" tabIndex={-1}
        className="absolute left-1/2 top-1/2 z-[31] flex max-h-[86%] w-full max-w-modal -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[26px] bg-surface shadow-[0_40px_90px_-24px_rgb(30_41_59_/_0.5)] outline-none"
      >
        {children}
      </div>
    </>
  );
}
