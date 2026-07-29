/**
 * icons.tsx — the icons v2 set, ported from `docs/design/mockups/_sprite.txt`.
 *
 * TOKENS ONLY. Every glyph paints in `currentColor`, so the colour is whatever Tailwind class
 * the caller sets, and every one of those resolves to a `--t-*` theme variable. Round 2's
 * mockups hard-coded a coral hex inside the mark, which is exactly what made them
 * un-reskinnable; the one place a colour is named below (the reel's negative slashes) uses the
 * `fill-coral-100` utility, which is `--t-accent-100` — the tile's own fill.
 *
 * The three FORMAT icons were screenshot-tested at their real rendered size (17px inside a
 * 28px tile) before adoption, and the clapperboard took three attempts: an outlined slate with
 * hairline diagonals reads as browser chrome at that size, and a rotated slate reads as noise.
 * Only the filled slate is unmistakable. Do not re-draw them without repeating that test.
 *
 * Sizing is the caller's: every icon takes `className` and no intrinsic width, so a 17px tile
 * glyph and a 26px nav glyph are the same component at two Tailwind sizes.
 */
import React from 'react';

type P = { className?: string | undefined };

/** Stroked glyph — the default. 1.7 stroke, round caps, matching the mockup sprite's `.ic`. */
const stroked = (children: React.ReactNode) => function Icon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
};

/** Filled glyph, for the few that read better solid at 17px. */
const filled = (children: React.ReactNode) => function Icon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">{children}</svg>
  );
};

// ── The Sprigly mark ─────────────────────────────────────────────────────────────────
/**
 * Two leaves and a stem. The second leaf is NOT a second colour — it is the same tone at
 * `opacity .78`, which is the whole basis of the round-5 ramp (one identity tone, one
 * opacity). `currentColor` throughout so it inherits the accent from its container.
 */
export function SprigMarkV2({ className }: P) {
  return (
    <svg viewBox="0 0 100 110" fill="currentColor" className={className} aria-hidden="true">
      <path d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z" />
      <path d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z" opacity="0.78" />
      <line x1="50" y1="76" x2="50" y2="98" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Format icons (v2) ────────────────────────────────────────────────────────────────

/** Reel — a FILLED clapperboard slate with the diagonals cut OUT of it. The cut-outs are
 *  painted in the tile's own colour (`accent-100`), which is the one constraint on reusing
 *  this icon anywhere the tile is not that colour. */
export function ReelGlyph({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path fill="currentColor" stroke="none" d="M4.6 4.2h14.8a2 2 0 0 1 2 2v3.1H2.6V6.2a2 2 0 0 1 2-2Z" />
      <path className="fill-coral-100" stroke="none" d="M8.2 4.2l-2.4 5.1h1.9l2.4-5.1zM14.4 4.2L12 9.3h1.9l2.4-5.1z" />
      <path d="M2.6 9.3h18.8V18a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2V9.3Z" />
    </svg>
  );
}

/** Carousel — a front sheet with a second peeking behind it. */
export const CarouselGlyph = stroked(<>
  <rect x="3.5" y="6.5" width="13" height="14" rx="2.5" />
  <path d="M7.2 3.5h9.3a3.5 3.5 0 0 1 3.5 3.5v9.6" />
</>);

/** Single post — a frame, a sun and one horizon line. */
export const SingleGlyph = stroked(<>
  <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
  <circle cx="8.8" cy="9.2" r="1.5" />
  <path d="M4.3 17.3l4.5-4.8a1.7 1.7 0 0 1 2.5 0l5.2 5.5" />
</>);

/** The word survives ONLY as `title` and screen-reader text (spec G2, §7). */
export const FORMAT_WORD: Record<string, string> = {
  reel: 'Reel', carousel: 'Carousel', single: 'Single post', email: 'Email',
};

export function FormatGlyph({ format, className }: { format: string; className?: string | undefined }) {
  if (format === 'reel') return <ReelGlyph className={className} />;
  if (format === 'carousel') return <CarouselGlyph className={className} />;
  return <SingleGlyph className={className} />;
}

/**
 * The format icon in its tile: `accent-800` on `accent-100`, 6.67:1. One component so the
 * pairing cannot drift, and so the reel's cut-outs are always over the colour they assume.
 */
export function FormatTile({ format, large }: { format: string; large?: boolean }) {
  const word = FORMAT_WORD[format] ?? 'Post';
  return (
    <span
      data-testid="format-tile" data-format={format} title={word}
      className={[
        'flex flex-none items-center justify-center bg-coral-100 text-coral-800',
        large ? 'h-[34px] w-[34px] rounded-[14px]' : 'h-7 w-7 rounded-[9px]',
      ].join(' ')}
    >
      <FormatGlyph format={format} className={large ? 'h-5 w-5' : 'h-[17px] w-[17px]'} />
      <span className="sr-only">{word}</span>
    </span>
  );
}

// ── Navigation ───────────────────────────────────────────────────────────────────────

export const ChevronL = stroked(<path d="M14.5 5.5l-7 6.5 7 6.5" />);
export const ChevronR = stroked(<path d="M9.5 5.5l7 6.5-7 6.5" />);
export const ChevronU = stroked(<path d="M6 14.5l6-6 6 6" />);
export const ChevronD = stroked(<path d="M6 9.5l6 6 6-6" />);

/** Day — a single rounded cell. The weakest glyph in the set on its own (round-5.1 pressure
 *  test 2), which is why the SELECTED segment carries its word beside it. */
export const NavDayGlyph = stroked(<rect x="4.5" y="4.5" width="15" height="15" rx="4" />);
export const NavMonthGlyph = stroked(<>
  <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
  <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  <path d="M8 13h.01M12 13h.01M16 13h.01M8 16.8h.01M12 16.8h.01" />
</>);
export const NavTasksGlyph = stroked(<path d="M4 7.5l2 2 3.5-3.5M4 16.5l2 2 3.5-3.5M13 8h7M13 17h7" />);

// ── Actions ──────────────────────────────────────────────────────────────────────────

export const PlusGlyph = stroked(<path d="M12 5.5v13M5.5 12h13" />);
export const MicGlyph = stroked(<>
  <rect x="9" y="2.5" width="6" height="11" rx="3" />
  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
</>);
export const CopyGlyph = stroked(<>
  <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
  <path d="M15.5 5.5v-.5a2 2 0 0 0-2-2H6a2.5 2.5 0 0 0-2.5 2.5v7.5a2 2 0 0 0 2 2h.5" />
</>);
export const CalGlyph = stroked(<>
  <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
  <path d="M3.5 9.5h17M8 3v4M16 3v4" />
</>);
export const SparkleGlyph = filled(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />);
export const BinGlyph = stroked(<path d="M4.5 6.5h15M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13" />);
export const CheckGlyph = stroked(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const CloseGlyph = stroked(<path d="M6 6l12 12M18 6L6 18" />);
export const SendGlyph = stroked(<path d="M4.5 12h14M12.5 6l6 6-6 6" />);
/** The experiment marker's lightbulb. Round 6, P14 / §2.1: it sits INSIDE a banner pill beside
 *  the words "Something new" — never alone in a corner, and never with a tooltip. */
export const BulbGlyph = stroked(<>
  <path d="M9.2 17.2a6 6 0 1 1 5.6 0" />
  <path d="M9.6 17.5h4.8M10.4 20.4h3.2" />
</>);
export const KeyboardGlyph = stroked(<>
  <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
  <path d="M6.5 9.6h.01M10 9.6h.01M13.5 9.6h.01M17 9.6h.01M6.5 12.6h.01M10 12.6h.01M13.5 12.6h.01M17 12.6h.01M8 15.6h8" />
</>);
export const InfoGlyph = stroked(<>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 10.8v5.7M12 7.7v.3" />
</>);
