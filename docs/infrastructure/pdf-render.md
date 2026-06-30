# PDF Render

## Purpose

`@sprigly/pdf-render` converts structured workflow output into a PDF `Buffer`. It is a self-contained rendering layer: it takes typed data in and returns bytes out. The rest of the engine treats the result as an opaque `Buffer` -- it knows nothing about the PDF layout.

Currently one document type is supported: `prospect-brief`. The package is designed to add further document types without changing any callers.

---

## Interface

All exports are from `packages/pdf-render/src/render.ts` and `packages/pdf-render/src/fonts.ts`.

### `registerFonts()`

`packages/pdf-render/src/fonts.ts`. Registers Inter and DM Serif Display with the `@react-pdf/renderer` font cache. Must be called once before any `render()` call. Safe to call multiple times (subsequent calls are no-ops).

In production, called at module load time at the top of `sprigly-prospect-research.ts`:
```typescript
import { render, renderNoData, registerFonts } from '@sprigly/pdf-render';
registerFonts();
```

In tests, `packages/pdf-render/src/test-setup.ts` stubs the custom font families with Helvetica (a built-in PDF font that does not require file loading).

### `render(type, data)`

```typescript
async function render<T extends DocumentType>(
  type: T,
  data: RenderParams[T],
): Promise<Buffer>
```

Dispatches to the correct document component based on `type`. Currently:

| `type` | Data type | Component |
|---|---|---|
| `'prospect-brief'` | `ProspectBriefData` | `packages/pdf-render/src/documents/ProspectBrief.tsx` |

Throws `Error: Unknown document type: <type>` for unrecognised types.

### `renderNoData(brandName)`

```typescript
async function renderNoData(brandName: string): Promise<Buffer>
```

Renders a single-page fallback PDF when no research data was found. Contains a plain message explaining the situation and suggesting the user re-submit with a website URL. Used by `sprigly-prospect-research` when all web searches return empty results.

### `ProspectBriefData`

The data contract for the `prospect-brief` document. Defined in `packages/pdf-render/src/documents/ProspectBrief.tsx`. The `normalizeBriefData()` function in `sprigly-prospect-research.ts` coerces raw LLM output into this shape before calling `render()`. Key shape:

```typescript
interface ProspectBriefData {
  brandName: string;
  url: string;
  preparedAt: string;
  positioning: string;
  meetingDate?: string;
  spelling: { correctName: string; providedName?: string; note?: string };
  location: { registered: string; trading?: string; localHook?: string };
  stats: unknown[];
  founder: {
    name: string;
    background: string;
    employers: unknown[];
    education?: string;
    publicProfile: { linkedIn?: string; podcasts?: string[]; interviews?: string[] };
    voiceAndTone: { description: string; examples: unknown[] };
    selfNamedPainPoints: unknown[];
    caresAbout: unknown[];
  };
  execSummary: {
    whatTheyActuallyDo: string;
    revenueModel: string;
    distinctiveVsCorporate: string;
    localOrSpellingIntel?: string;
  };
  opsTells: unknown[];
  pipelines: unknown[];
  risks: unknown[];
  callTactics: {
    homeworkHooks: unknown[];
    dontMention: unknown[];
    theOneQuestion: { question: string; whyThisQuestion: string };
  };
}
```

---

## Implementation notes

### Rendering pipeline

`render()` calls `React.createElement()` to build the document element, then calls `@react-pdf/renderer`'s `renderToBuffer()` which converts the React tree to a PDF `Buffer`. The entire operation is async -- `renderToBuffer` does the layout synchronously but wraps the result in a Promise.

### Fonts

Two font families are bundled:

| Family | Role | Font files |
|---|---|---|
| `Inter` | Body copy, all data fields | `packages/pdf-render/fonts/inter/` |
| `DM Serif Display` | Section headers and editorial callouts | Registered in `fonts.ts` |

`Inter` is used for nearly everything. `DM Serif Display` provides contrast on large display text. Both are registered as static (non-variable) font files. The `theme.ts` constants `FONT.family` and `FONT.editorial` name these families for use in document styles.

Why Inter and not Plus Jakarta Sans: see `architecture/decisions.md` ADR 4.

### Theme

`packages/pdf-render/src/theme.ts` exports three constant objects used across all document components:

- `COLOURS`: Brand palette including `coral`, `navy`, `offWhite`, `midGrey`.
- `SPACING`: XS/SM/MD/LG/XL in points.
- `FONT`: Family names and a `sizes` map (xs=7pt through xxl=22pt).

All document components and the `renderNoData()` fallback page import from `theme.ts`. Changing a colour or spacing value here propagates everywhere.

### Buffer stripping

The `ProspectOutput` returned by `sprigly-prospect-research` contains a top-level `pdf` field that is a raw `Buffer`. `stripBuffers()` in `packages/engine/src/strip-buffers.ts` replaces Buffer instances with the string `'[binary]'` before storing the output to `workflow_runs.output`. The PDF bytes themselves are delivered via `GmailReplyWithAttachment` and never persisted to the database.

---

## How to extend

### Adding a new document type

1. Create `packages/pdf-render/src/documents/<DocumentName>.tsx`. Define the `<DocumentName>Data` interface and the React component that renders it.
2. Add the new type to the `DocumentType` union in `packages/pdf-render/src/render.ts`:
   ```typescript
   export type DocumentType = 'prospect-brief' | 'your-new-type';
   ```
3. Add to `RenderParams`:
   ```typescript
   export interface RenderParams {
     'prospect-brief': ProspectBriefData;
     'your-new-type': YourNewTypeData;
   }
   ```
4. Add a dispatch branch in `render()`:
   ```typescript
   if (type === 'your-new-type') {
     const el = React.createElement(YourNewDocument, { data: data as YourNewTypeData });
     return renderToBuffer(el as ReactElement<DocumentProps>);
   }
   ```
5. Call `registerFonts()` before any render in the workflow that uses this type (or confirm it is already called at module load).
6. Update `workflows/existing.md` if the new document type is used by a workflow.

---

## Gotchas

**`registerFonts()` must run before `render()`.** If called after, the renderer uses a fallback font and the output looks wrong. In production, call it at module load time. In tests, the `test-setup.ts` vitest setup file stubs fonts -- import it in `vitest.config.ts` as `setupFiles`. Do not call `registerFonts()` in tests (it will try to load font files from disk and fail in the test environment).

**`@react-pdf/renderer` uses a CSS subset.** The layout engine is based on Yoga (CSS Flexbox). Properties that work in a browser but are not supported include: `position: absolute`, `overflow: hidden`, `grid`, CSS custom properties, and most pseudo-selectors. If a layout is not rendering as expected, check the `@react-pdf/renderer` documentation for supported properties. Work around layout constraints by adjusting the component structure rather than trying to use unsupported CSS.

**React version pinning.** `@react-pdf/renderer` has strict React peer dependency requirements. Upgrading React across the monorepo requires verifying compatibility with this package first.

**`renderToBuffer` is synchronous in CPU usage.** It is wrapped in a Promise but does not use worker threads. Complex documents with many pages will block the event loop during layout computation. This is not a concern for the current brief format but is worth noting before adding very large document types.

**The second font family.** `DM Serif Display` is registered but only used for a small number of display text elements. If the brief is printed in black and white, the serif/sans-serif contrast is the only visual hierarchy -- remove it at your peril.

---

## Cross-references

- `architecture/decisions.md` ADR 3 (react-pdf over Puppeteer/pdfmake)
- `architecture/decisions.md` ADR 4 (Inter over Plus Jakarta Sans)
- `workflows/existing.md` (which workflows produce PDFs)
- `infrastructure/destinations.md` (how the PDF buffer travels from workflow output to email attachment)
