import { Plus_Jakarta_Sans, DM_Serif_Display } from 'next/font/google';

/**
 * Self-hosted fonts for the redesign (next/font downloads + serves them at build —
 * no runtime Google request, per the brand rule). Applied as CSS variables on the
 * PlanRedesign root; Tailwind's font-sans / font-serif map to these variables.
 */
export const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-dm-serif',
  display: 'swap',
});
