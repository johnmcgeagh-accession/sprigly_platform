/** Icon set for the plan redesign — ported from design/reference/*.html. CurrentColor
 *  throughout so Tailwind text-* colours drive them. */
import React from 'react';
import type { WeatherIcon } from '@/lib/weather';

type P = { className?: string | undefined };
const svg = (children: React.ReactNode, vb = '0 0 24 24') => ({ className }: P) => (
  <svg viewBox={vb} fill="none" className={className} aria-hidden="true">{children}</svg>
);

/** The real Sprigly mark (design/reference → studio/svg_logos/sprigly-mark-coral.svg):
 *  two curved leaves meeting at a pointed top, stem below. Brand coral (non-text). */
export function SprigMark({ className }: P) {
  return (
    <svg viewBox="0 0 100 110" fill="#E87766" className={className} aria-hidden="true">
      <path d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z" />
      <path d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z" opacity="0.78" />
      <line x1="50" y1="76" x2="50" y2="98" stroke="#E87766" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export const InstagramIcon = svg(<>
  <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.8" />
  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
  <circle cx="17.2" cy="6.8" r="1.3" fill="currentColor" />
</>);
export const MailIcon = svg(<>
  <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
  <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
</>);

/** Single-image / carousel / email formats share this frame; reel gets a play. */
export const ImageIcon = svg(<>
  <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
  <circle cx="9" cy="10" r="1.7" fill="currentColor" />
  <path d="M4.5 17l4.5-4 3.5 3 3-2.5 4 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
</>);
export const ReelIcon = svg(<>
  <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
  <path d="M10 9l5 3-5 3V9Z" fill="currentColor" />
</>);

export const CalendarIcon = svg(<>
  <rect x="3.5" y="4.5" width="17" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
  <path d="M3.5 9h17M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>);
export const TimelineIcon = svg(<>
  <circle cx="6" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
  <circle cx="6" cy="17" r="2" stroke="currentColor" strokeWidth="1.8" />
  <path d="M11 7h9M11 17h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>);
export const TasksIcon = svg(<>
  <path d="M4 7l2 2 3-3M4 17l2 2 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M13 7h7M13 17h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>);
export const ApprovalsIcon = svg(
  <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" fill="currentColor" />,
);
export const NotesIcon = svg(<>
  <path d="M5 4h11l3 3v13H5V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  <path d="M8 10h8M8 14h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>);

export const SparkIcon = svg(
  <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" fill="currentColor" />,
);
export const MicIcon = svg(<>
  <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Z" fill="currentColor" />
  <path d="M6 11.5a6 6 0 0 0 12 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>);
export const ChevronLeft = svg(<path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />);
export const ChevronRight = svg(<path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />);
export const ChevronDown = svg(<path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />);
export const CheckIcon = svg(<path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />);
export const RevertIcon = svg(<path d="M9 5L4 10l5 5M4 10h9a7 7 0 0 1 0 14H8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />);
export const TrashIcon = svg(<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />);
export const CloseIcon = svg(<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />);
export const SendIcon = svg(<>
  <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" fill="currentColor" />
  <circle cx="18.5" cy="17.5" r="1.5" fill="currentColor" />
</>);

export function ChannelIcon({ channel, className }: { channel: string; className?: string | undefined }) {
  return channel === 'email' ? <MailIcon className={className} /> : <InstagramIcon className={className} />;
}
export function FormatIcon({ format, className }: { format: string; className?: string | undefined }) {
  return format === 'reel' ? <ReelIcon className={className} /> : <ImageIcon className={className} />;
}

export const FORMAT_LABEL: Record<string, string> = {
  reel: 'Reel', carousel: 'Carousel', single: 'Single image', email: 'Email',
};

// ── Weather overlay glyphs (Slice 4) ──────────────────────────────────────────
// Compact line icons, currentColor throughout so `text-muted` drives them; always
// aria-hidden (the accessible info lives in the tooltip / day-header label).
const CLOUD = 'M7 16h8.2a3.3 3.3 0 0 0 .4-6.57A4.6 4.6 0 0 0 7 8.2 3.4 3.4 0 0 0 7 16Z';

const SunGlyph = svg(<>
  <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
  <path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
</>);
/** "Hot sun" — a filled core + bolder rays so a scorcher reads at a glance (used only
 *  ≥32° on an otherwise-sunny day, tinted amber). Quiet accent, not an alert. */
const HotSunGlyph = svg(<>
  <circle cx="12" cy="12" r="4.4" fill="currentColor" />
  <path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
</>);
const PartlyCloudyGlyph = svg(<>
  <circle cx="8.5" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
  <path d="M8.5 2.6v1.6M2.6 8.5h1.6M4.6 4.6l1.1 1.1M12.4 4.6l-1.1 1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  <path d="M9 19h8a3.1 3.1 0 0 0 .3-6.2A4.3 4.3 0 0 0 9 11.5 3.2 3.2 0 0 0 9 19Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
</>);
const OvercastGlyph = svg(<path d={CLOUD} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill="none" />);
const FogGlyph = svg(<>
  <path d="M7 14h8.2a3.3 3.3 0 0 0 .4-6.57A4.6 4.6 0 0 0 7 6.2 3.4 3.4 0 0 0 7 14Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  <path d="M5 17.5h14M7 20.5h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
</>);
const RainGlyph = svg(<>
  <path d={CLOUD} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  <path d="M9.5 18l-1 2.2M13 18l-1 2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>);
const HeavyRainGlyph = svg(<>
  <path d={CLOUD} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  <path d="M8 18l-1.2 2.6M12 18l-1.2 2.6M16 18l-1.2 2.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
</>);
const SnowGlyph = svg(<>
  <path d={CLOUD} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  <circle cx="8.5" cy="19.5" r="1" fill="currentColor" /><circle cx="12" cy="20.2" r="1" fill="currentColor" /><circle cx="15.5" cy="19.5" r="1" fill="currentColor" />
</>);
const ThunderGlyph = svg(<>
  <path d={CLOUD} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  <path d="M12.6 17.3l-2.6 3.4h2.4l-1.6 2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
</>);

/** 'hot-sun' is a render-only variant (temperature-driven), not a WMO icon bucket — so
 *  the glyph map is keyed on WeatherIcon plus that one extra visual variant. */
export type WeatherGlyphKind = WeatherIcon | 'hot-sun';
const WEATHER_GLYPHS: Record<WeatherGlyphKind, (p: P) => React.ReactElement> = {
  sun: SunGlyph, 'hot-sun': HotSunGlyph, 'partly-cloudy': PartlyCloudyGlyph, overcast: OvercastGlyph, fog: FogGlyph,
  rain: RainGlyph, 'heavy-rain': HeavyRainGlyph, snow: SnowGlyph, thunder: ThunderGlyph,
};

export function WeatherGlyph({ icon, className }: { icon: WeatherGlyphKind; className?: string | undefined }) {
  const G = WEATHER_GLYPHS[icon];
  return <G className={className} />;
}
