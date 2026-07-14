import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sprigly — your plan',
  description: 'Your monthly content plan',
};

// Brand rule: theme-color is the strong coral (#E8705F). See design/DECISIONS.md §13.
export const viewport: Viewport = {
  themeColor: '#E8705F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
