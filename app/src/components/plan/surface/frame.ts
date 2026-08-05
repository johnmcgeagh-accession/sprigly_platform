/**
 * frame.ts — which shell a panel is rendering inside, and the one thing that depends on it.
 *
 * The mobile shell FLOATS its nav pill over the content, so every scroll region on it reserves
 * the pill's height at the foot or the last card sits under it (spec §1.2, and the round-3
 * finding where the FAB printed over the evidence sentence — the one line that must never be
 * hidden).
 *
 * The desktop shell has a left RAIL instead. Nothing overlaps the content, so that reservation
 * is 104px of dead space at the bottom of four columns at once — most visible on the day column,
 * where it pushes the add slot off a short day.
 *
 * A prop rather than a parent selector: a panel that needs to know its own frame should say so in
 * its signature, not have it done to it from outside by an arbitrary variant nobody greps for.
 */
export type SurfaceFrame = 'mobile' | 'desktop';

/**
 * The reservation, as a length. Both mechanisms below are this same number.
 *
 * ── WHY THE MOBILE VALUE IS A calc AND NOT 104px ─────────────────────────────────────
 *
 * The pill occupies `22px + env(safe-area-inset-bottom) + 56px` measured up from the shell's
 * bottom edge — 56px because the mic (`h-14`) is the taller of the two controls on that row.
 * Its offset is INSET-AWARE (`NavPill.tsx`, `bottom: calc(22px + env(...))`). This reservation
 * was a flat 104px, which is 78px of pill plus 26px of gap AT A ZERO INSET and nothing at all
 * at any other: on a phone with a home indicator (34px in portrait) the pill rises to occupy
 * 112px and the last row of a fully-scrolled panel ends up 8px underneath it.
 *
 * So the two numbers are tied together instead of being kept in step by hand. The 104px is
 * still the same 104px at a zero inset — which is what every current device reports, because
 * `viewport-fit=cover` is not set (see `layout.tsx`) — so this changes nothing today. It is
 * written this way so that enabling `viewport-fit=cover` later is a one-line change that does
 * not silently put content under the client's thumb, rather than a change that quietly needs
 * this file edited too.
 */
export function scrollPad(frame: SurfaceFrame): string {
  return frame === 'desktop' ? 'pb-5' : 'pb-[calc(104px+env(safe-area-inset-bottom,0px))]';
}

/**
 * The SAME reservation, as a SPACER ELEMENT instead of padding — for a scroll region that is
 * also a flex container. `scrollPad` does not work on one, in the browser that matters.
 *
 * ── WHY THERE ARE TWO OF THESE ───────────────────────────────────────────────────────
 *
 * WebKit will not let a scroll container's own end padding CREATE scrollable overflow. It
 * honours the padding once the content overflows on its own, and contributes nothing at all
 * before that. Measured, both engines, 500px panel / 104px reservation:
 *
 *                                   content 450 (fits)          content 550 (overflows)
 *   WebKit    flex-column scroller  sH 500, no scroll, 50px     sH 654, scrolls, 104px
 *   WebKit    block scroller        sH 554, scrolls,   104px    sH 654, scrolls, 104px
 *   Chromium  either                sH 554, scrolls,   104px    sH 654, scrolls, 104px
 *
 * The top-left cell is the defect: the panel reports `scrollHeight === clientHeight`, so
 * `overflow-y:auto` has nothing to scroll, while the content's last pixel sits wherever the
 * leftover slack happens to put it — which on a 2-post day in a 6-row month is 19px UNDER the
 * floating pill, permanently. Three posts "works" only because it tips the content into real
 * overflow, at which point the padding switches on and lands the last row 26px clear. The
 * threshold is the padding turning on, not the scroller waking up.
 *
 * A LARGER CONSTANT CANNOT FIX THIS, and neither can `viewport-fit=cover`. Measured the same
 * way: at `padding-bottom: 400px` WebKit still delivers 50px and still does not scroll. A
 * reservation that contributes nothing contributes nothing at any size, and `viewport-fit`
 * only adds the safe-area inset to the same dead constant — it would move the PILL up by the
 * home indicator while the reservation stayed at zero, so it makes this worse, not better.
 *
 * A spacer is CONTENT. Content always counts toward scrollable overflow, in every engine and
 * in both regimes — the bottom four rows of that table, which agree.
 *
 * `flex-none` is load-bearing: in a flex column a bare `h-[…]` div is `flex-shrink: 1` and the
 * reservation is the first thing squeezed out, which is this bug again by another route.
 *
 * NOT USED BY THE OTHER FOUR PANELS, deliberately. `DayPanel`, `DraftDayPanel`, `IdeasPanel`,
 * `TasksPanel` and `ReceiptPanel` are BLOCK scroll regions (`flex-1` makes them flex ITEMS,
 * which is a different thing), and row 2 of that table says padding is correct on those. They
 * also go multi-column on the desktop shell, where a spacer would be laid out as column
 * content rather than as a foot. If one of them ever gains `flex` + `flex-col`, it needs this
 * instead — that is the one change that silently reopens this.
 */
export function scrollTail(frame: SurfaceFrame): string {
  return frame === 'desktop' ? 'h-5 flex-none' : 'h-[calc(104px+env(safe-area-inset-bottom,0px))] flex-none';
}
