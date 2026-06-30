import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sprigly — your plan',
  description: 'Your monthly content plan',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
