import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Font } from './pdf-elements.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dir, '..', 'fonts');

/**
 * Register font families from bundled local TTF files.
 * Call once before the first renderToBuffer() call.
 * Not called automatically — keeps the package side-effect-free so
 * tests can import render() without triggering font loading.
 *
 * Primary face is Inter (see README for why, not Plus Jakarta Sans).
 * DM Serif Display is used for editorial headings only.
 */
export function registerFonts(): void {
  Font.register({
    family: 'Inter',
    fonts: [
      { src: join(fontsDir, 'inter', 'Inter-Regular.ttf'),      fontWeight: 400 },
      { src: join(fontsDir, 'inter', 'Inter-Italic.ttf'),       fontWeight: 400, fontStyle: 'italic' },
      { src: join(fontsDir, 'inter', 'Inter-Medium.ttf'),       fontWeight: 500 },
      { src: join(fontsDir, 'inter', 'Inter-MediumItalic.ttf'), fontWeight: 500, fontStyle: 'italic' },
      { src: join(fontsDir, 'inter', 'Inter-SemiBold.ttf'),     fontWeight: 600 },
      { src: join(fontsDir, 'inter', 'Inter-Bold.ttf'),         fontWeight: 700 },
    ],
  });

  Font.register({
    family: 'DM Serif Display',
    fonts: [
      { src: join(fontsDir, 'DMSerifDisplay-Regular.ttf'), fontWeight: 400 },
      { src: join(fontsDir, 'DMSerifDisplay-Italic.ttf'),  fontWeight: 400, fontStyle: 'italic' },
    ],
  });
}
