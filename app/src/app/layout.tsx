import type { Metadata, Viewport } from 'next';
import './globals.css';
import { loadActiveThemeVars, CORAL_THEME_COLOR } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Sprigly — your plan',
  description: 'Your monthly content plan',
};

// Brand rule: theme-color is the strong coral (design/DECISIONS.md §13). This stays the default
// for every route — the expired page, and every flag-off tenant on the legacy PlanApp. The plan
// page overrides it for the REDESIGN only, where the bands have a canvas to match; the argument
// for that departure is written out in `generateViewport` (app/page.tsx).
export const viewport: Viewport = { themeColor: CORAL_THEME_COLOR };

// Read live so an admin theme switch repaints on the next load (no rebuild). Never cached.
export const dynamic = 'force-dynamic';

/**
 * The canvas, painted all the way out to the hardware.
 *
 * ── What the phone showed ────────────────────────────────────────────────────────────
 * Safari paints two bands the page does not own — the status bar above, the toolbar below —
 * and a rubber-band overscroll briefly reveals a third surface behind the document. All three
 * were rendering a different colour to the plan, so the surface read as a light sheet posted
 * onto something else rather than as one continuous thing under the client's thumb. The bands
 * are `theme-color` (fixed on the page, see `generateViewport` in page.tsx); this is the rest.
 *
 * SCOPED TO THE REDESIGN, on purpose. `plan_redesign` is a per-tenant flag defaulting to OFF
 * (flags.ts), so flag-off tenants are still served `PlanApp`, whose canvas is the white in
 * globals.css. Repainting the document for everyone would change a surface this session was
 * not asked to touch. `:has()` scopes it to the document that actually contains the redesign
 * root; where it is unsupported the page renders exactly as it does today.
 *
 * NO safe-area padding. Insetting the body would letterbox the surface and undo the seam this
 * closes — the shell is meant to bleed to every edge. The insets are consumed where content
 * would genuinely collide with the hardware: the floating nav's bottom offset, and the sheets'.
 */
const CANVAS_CSS = [
  // Both elements: iOS propagates the body's background to the viewport canvas only when html
  // has none, and the propagation rules are subtle enough that setting both is the honest way
  // to be certain. `min-height` keeps html painted under short content.
  'html:has(.plan-redesign) { background: rgb(var(--t-canvas, 242 243 245)); min-height: 100%; }',
  'html:has(.plan-redesign) body { background: rgb(var(--t-canvas, 242 243 245)); }',
].join('\n');

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Inject the ACTIVE theme's tokens as :root CSS vars. Empty string (no active theme / DB down)
  // → Tailwind's Sprigly-Coral fallbacks render byte-identically.
  const themeVars = await loadActiveThemeVars();
  return (
    <html lang="en">
      <head>
        <style id="sprigly-canvas" dangerouslySetInnerHTML={{ __html: CANVAS_CSS }} />
        {themeVars ? <style id="sprigly-theme" dangerouslySetInnerHTML={{ __html: themeVars }} /> : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
