# @sprigly/pdf-render

React-PDF document renderer for Sprigly. Currently produces one document type: `prospect-brief`, a 7-page discovery-prep PDF generated from structured prospect data.

## Usage

```typescript
import { render } from '@sprigly/pdf-render';
import { registerFonts } from '@sprigly/pdf-render/fonts';

registerFonts(); // call once at worker/server startup
const buffer = await render('prospect-brief', data);
```

## Font choice

**Primary typeface: Inter** (not Plus Jakarta Sans as specified in the Sprigly brand guide).

The Google Fonts builds of Plus Jakarta Sans available for react-pdf lack proper ligature substitution glyphs in their TTF files. Common character sequences involving `fi`, `ff`, and `fl` render as truncated characters — `firm` becomes `frm`, `Confidential` becomes `Confdential`, etc. This is a PDFKit/fontkit GSUB ligature rendering issue specific to how those TTF files encode their glyph tables.

Inter is visually similar (geometric sans-serif, comparable x-height and weight range), has full OpenType ligature support, renders cleanly across all weights, and is well-tested with react-pdf. All 6 weight/style variants used by this package are bundled in `fonts/inter/` under the OFL licence.

If a properly-built Plus Jakarta Sans TTF (with correct ligature tables) becomes available, the swap is a one-line change in `src/theme.ts`: `family: 'Inter'` → `family: 'Plus Jakarta Sans'`, plus registering the new files in `src/fonts.ts`.

**Editorial typeface: DM Serif Display** — used for the cover brand name and the "one question" callout. Unchanged from the brand spec. Bundled in `fonts/DMSerifDisplay-{Regular,Italic}.ttf`.

## Bundled fonts

| File | Weight | Style |
|------|--------|-------|
| `fonts/inter/Inter-Regular.ttf` | 400 | normal |
| `fonts/inter/Inter-Italic.ttf` | 400 | italic |
| `fonts/inter/Inter-Medium.ttf` | 500 | normal |
| `fonts/inter/Inter-MediumItalic.ttf` | 500 | italic |
| `fonts/inter/Inter-SemiBold.ttf` | 600 | normal |
| `fonts/inter/Inter-Bold.ttf` | 700 | normal |
| `fonts/DMSerifDisplay-Regular.ttf` | 400 | normal |
| `fonts/DMSerifDisplay-Italic.ttf` | 400 | italic |

All fonts are licensed under the SIL Open Font Licence 1.1.

## Generating a sample

```bash
npx tsx src/sample.ts
# → sample-prospect-brief.pdf
```

## Tests

Tests use Helvetica (a built-in PDF font) aliased as `Inter` and `DM Serif Display` to avoid font I/O. Visual fidelity is not tested — only that `renderToBuffer` returns a valid non-empty Buffer.

```bash
npx vitest run
```
