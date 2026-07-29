'use client';

/**
 * Sheet.tsx — the chrome every bottom sheet on this surface shares.
 *
 * Session A shipped two sheets that each drew their own scrim, their own 92% panel and their own
 * grabber bar. Session B adds five more (voice, approval, add, rollup, the draft detail variant),
 * and seven hand-rolled copies of the same chrome is how one of them ends up without a focus trap
 * — which is exactly the P1 the Session A audit found on the move sheet.
 *
 * ── The grabber is a control (round 6, P7) ───────────────────────────────────────────
 *
 * The phone check found the grabber inert: it looks like the iOS affordance for "drag me down",
 * and it did nothing. Two gestures now, plus the one that already worked:
 *
 *   drag down    past DISMISS_PX, and the sheet closes. Under it, it springs back.
 *   tap          the grabber, and the sheet closes. A tap is a drag of zero distance, so the
 *                same handler answers both and there is no second target.
 *   scrim tap    unchanged.
 *
 * The drag is applied to `style.transform` through a ref rather than through React state. A
 * pointermove fires at display rate; putting it through a setState would re-render the whole
 * sheet — its tabs, its caption, its action row — sixty times a second while a thumb is moving.
 *
 * The transform is on the PANEL only, never on the scrim: dimming that moves with the sheet
 * reads as the whole app sliding away. The scrim stays put and the sheet leaves it.
 *
 * `prefers-reduced-motion` is honoured by the spring-back transition, not by the drag: refusing
 * to follow a thumb is not a reduced-motion accommodation, it is a broken control.
 */
import React, { useRef } from 'react';
import { useFocusTrap } from '../a11y';

/** How far down the sheet has to travel before letting go closes it. */
const DISMISS_PX = 96;
/** Under this, a pointer sequence was a tap and not a drag. */
const TAP_SLOP_PX = 6;
/**
 * Swallow the click a browser synthesises after the pointer sequence that just dismissed us.
 *
 * ── The bug this exists for ──────────────────────────────────────────────────────────
 *
 * Dismissal happens on `pointerup`, and the sheet unmounts inside that handler. The browser then
 * dispatches the `click` for that same sequence at the same coordinates — onto whatever is
 * underneath NOW. The grabber is a full-width band at the top of a sheet pinned to `bottom-0
 * h-[92%]`, so at 390×844 it sits at y 67.5–101.5 directly over `PlanShell`'s title row (the ‹ ›
 * month arrows) and Today row. A ghost click on `next-month` switched the month, and the
 * surface's re-anchor moved the selected day to the new month's earliest post: the operator
 * closed a sheet on 13 August and landed on 2 September.
 *
 * Capture phase, so it runs before anything on the way down, and scoped THREE ways so it can only
 * ever eat the one click it is for:
 *
 *   - by time: `setTimeout(…, 0)`. A browser dispatches the compatibility click in the same
 *     input-dispatch turn as the `pointerup` that caused it, so the disarm always runs after that
 *     click and before the client's next deliberate tap. The grabber carries `touch-action: none`,
 *     so there is no 300ms tap delay to outlast.
 *   - by place: within GHOST_RADIUS_PX of where the finger lifted. A compatibility click is at
 *     the same coordinates by definition; a real tap somewhere else must not be touched.
 *   - by count: one. It disarms itself the moment it fires.
 */
const GHOST_RADIUS_PX = 24;

function swallowNextClick(at: { x: number; y: number }): void {
  if (typeof window === 'undefined') return;
  const kill = (e: Event) => {
    const m = e as MouseEvent;
    if (Math.abs(m.clientX - at.x) > GHOST_RADIUS_PX || Math.abs(m.clientY - at.y) > GHOST_RADIUS_PX) return;
    e.stopPropagation();
    e.preventDefault();
    disarm();
  };
  const disarm = () => {
    window.removeEventListener('click', kill, true);
    window.clearTimeout(timer);
  };
  const timer = window.setTimeout(disarm, 0);
  window.addEventListener('click', kill, true);
}

export interface SheetProps {
  open: boolean;
  /** The accessible name. A sheet without one is a dialog a screen reader cannot announce. */
  label: string;
  testid: string;
  onClose: () => void;
  /** 0 = a sheet over the surface. 1 = a sheet over a sheet (Move opens FROM the detail sheet,
   *  which stays mounted underneath it). Layers are ordered in z rather than sharing one. */
  layer?: 0 | 1;
  /**
   * True when the caller renders its own ✕ in the sheet's header.
   *
   * The grabber is then DECORATIVE for assistive tech — pointer-only, `tabIndex={-1}`, hidden
   * from the accessibility tree — which is how a real iOS sheet models it: the handle is a
   * gesture affordance, and VoiceOver dismisses with its own escape, not by finding the bar.
   * Exposing both would put two buttons called "Close" on one sheet, doing one thing.
   *
   * Where there is no ✕ (the detail and add sheets) the grabber IS the close control and carries
   * the name. Escape works either way — the focus trap owns it.
   */
  hasOwnClose?: boolean;
  /** Sheet body. The caller owns the whole inside — this component owns only the frame. */
  children: React.ReactNode;
}

export function Sheet({ open, label, testid, onClose, layer = 0, hasOwnClose = false, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // `travelled` is the largest ABSOLUTE movement seen, which is what separates a tap from a
  // gesture. `dy` is the clamped downward offset, which is what separates a dismissal from a
  // hesitation. Two facts, because one number cannot tell an upward drag from a still thumb.
  const drag = useRef({ x: 0, y: 0, dy: 0, travelled: 0, active: false });

  useFocusTrap(open, ref, onClose);

  const setOffset = (px: number) => {
    const el = panel.current;
    if (!el) return;
    el.style.transition = px === 0 ? 'transform 180ms cubic-bezier(.22,.61,.36,1)' : 'none';
    el.style.transform = px === 0 ? '' : `translateY(${px}px)`;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, dy: 0, travelled: 0, active: true };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const raw = e.clientY - drag.current.y;
    drag.current.travelled = Math.max(drag.current.travelled, Math.abs(raw));
    // The sheet FOLLOWS downward only. A sheet dragged up is one trying to be taller than it is.
    drag.current.dy = Math.max(0, raw);
    setOffset(drag.current.dy);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const { dy, travelled } = drag.current;
    drag.current.active = false;
    setOffset(0);
    // A tap IS a drag of no distance, and it closes too. A drag that went far enough down
    // closes as well. Everything between — a hesitation, or a drag that went UP and came to
    // nothing — springs back, because neither is an instruction to dismiss.
    if (travelled <= TAP_SLOP_PX || dy >= DISMISS_PX) {
      // ARM THE GUARD FIRST. The sheet unmounts inside `onClose`, and the click the browser is
      // about to send for this gesture would then land on the shell underneath. It is armed at
      // the point the finger LIFTED, which is where that click will be.
      swallowNextClick({ x: e.clientX, y: e.clientY });
      onClose();
    }
  };

  if (!open) return null;

  const z = layer === 0 ? { scrim: 'z-[30]', panel: 'z-[31]' } : { scrim: 'z-[32]', panel: 'z-[33]' };

  return (
    <>
      <div data-testid={`${testid}-scrim`} aria-hidden="true" onClick={onClose}
        className={`absolute inset-0 ${z.scrim} bg-chrome-deep/[.34]`} />
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={label} data-testid={testid} tabIndex={-1}
        // Every sheet in the set is the same height, so opening one never changes how much of
        // the app you can see. 92%, because at 90% the cut landed mid-word on the month title.
        // No overflow clip here: the panel's shadow reaches UP past its own top edge, and the
        // shell's own overflow-hidden already contains the downward drag.
        className={`absolute inset-x-0 bottom-0 h-[92%] ${z.panel} outline-none`}
      >
        <div
          ref={panel}
          // The padding reserves the home indicator's strip; the BACKGROUND still runs under it,
          // which is the point — a sheet that stopped short of the edge would show a band of
          // canvas beneath it. `env()` is 0 on hardware without an indicator, so this is a
          // no-op everywhere else.
          className="flex h-full flex-col rounded-t-[26px] bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-18px_50px_-12px_rgb(30_41_59_/_0.28)]"
        >
          {/* The grabber's hit area is 34px tall around a 5px bar — visually inert, and it clears
              the touch floor for a control a thumb reaches for without looking. */}
          <button
            type="button" data-testid={`${testid}-grabber`}
            {...(hasOwnClose
              ? { 'aria-hidden': true as const, tabIndex: -1 }
              : { 'aria-label': 'Close' })}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            className="flex h-[34px] w-full flex-none touch-none items-center justify-center"
          >
            <span aria-hidden="true" className="block h-[5px] w-[38px] rounded-full bg-line/45" />
          </button>
          {children}
        </div>
      </div>
    </>
  );
}
