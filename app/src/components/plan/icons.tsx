/** Icon set for the plan redesign — ported from design/reference/*.html. CurrentColor
 *  throughout so Tailwind text-* colours drive them. */
import React from 'react';

type P = { className?: string | undefined };
const svg = (children: React.ReactNode, vb = '0 0 24 24') => ({ className }: P) => (
  <svg viewBox={vb} fill="none" className={className} aria-hidden="true">{children}</svg>
);

export function SprigMark({ className }: P) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="M16 29V11" stroke="#E87766" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 15C16 9 19.5 5.5 27 5.5 27 12 23 15.5 16 15Z" fill="#FF6F62" />
      <path d="M16 20C16 15.5 13 13 6.5 13.5 6.5 19 9.8 21.6 16 20Z" fill="#E87766" />
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
