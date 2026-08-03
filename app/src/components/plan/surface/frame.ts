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

/** The bottom padding a scrolling panel takes in each shell. */
export function scrollPad(frame: SurfaceFrame): string {
  return frame === 'desktop' ? 'pb-5' : 'pb-[104px]';
}
