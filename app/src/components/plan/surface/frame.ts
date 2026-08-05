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
 * The bottom padding a scrolling panel takes in each shell.
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
