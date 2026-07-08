import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sprigly — your plan',
  description: 'Your monthly content plan',
};

// Brand rule: theme-color is the strong coral (#FF6F62). See design/DECISIONS.md §13.
export const viewport: Viewport = {
  themeColor: '#FF6F62',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
