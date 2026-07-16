import { Fraunces, Inter } from 'next/font/google';

/**
 * Brand fonts for the cycle card only (self-hosted via next/font — no runtime Google request).
 * Matches the client app's fonts.ts (app/src/app/fonts.ts): Fraunces = display serif (normal +
 * italic), Inter = body/UI. Scoped to the card's own elements via `.className` so the rest of the
 * admin (system-font, gray utilities) is untouched — this build restyles nothing existing.
 */
export const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'opsz'],
});

export const inter = Inter({ subsets: ['latin'], display: 'swap' });
