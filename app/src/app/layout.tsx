import type { Metadata, Viewport } from 'next';
import './globals.css';
import { loadActiveThemeVars } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Sprigly — your plan',
  description: 'Your monthly content plan',
};

// Brand rule: theme-color is the strong coral (#E8705F). See design/DECISIONS.md §13.
export const viewport: Viewport = {
  themeColor: '#E8705F',
};

// Read live so an admin theme switch repaints on the next load (no rebuild). Never cached.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Inject the ACTIVE theme's tokens as :root CSS vars. Empty string (no active theme / DB down)
  // → Tailwind's Sprigly-Coral fallbacks render byte-identically.
  const themeVars = await loadActiveThemeVars();
  return (
    <html lang="en">
      <head>{themeVars ? <style id="sprigly-theme" dangerouslySetInnerHTML={{ __html: themeVars }} /> : null}</head>
      <body>{children}</body>
    </html>
  );
}
