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
 * The canvas, painted behind the whole document.
 *
 * ── IT DOES NOT REACH THE HARDWARE, AND THIS USED TO SAY IT DID ──────────────────────
 *
 * This block claimed the canvas was "painted all the way out to the hardware" and that "the
 * shell is meant to bleed to every edge". Neither is in effect, and neither ever was: bleeding
 * into the safe areas requires `viewport-fit=cover` in the viewport meta, and that is set
 * nowhere — not in the `viewport` export below, not in `generateViewport` in page.tsx. Verified
 * from what is actually emitted: `width=device-width, initial-scale=1`. Without it iOS lays the
 * page out INSIDE the safe areas and `env(safe-area-inset-*)` resolves to 0, which is also why
 * the inset arithmetic in `NavPill` and `frame.ts` has no observable effect today.
 *
 * ENABLING IT IS DELIBERATELY NOT DONE HERE. It is a real improvement and it is a bigger change
 * than one attribute: `viewport-fit=cover` extends the layout into EVERY safe area, including
 * the top, and `PlanShell` has no top inset handling — the wordmark at `pt-1.5` would slide
 * under the status bar and the notch. Every sheet and overlay needs the same audit at the
 * bottom. It wants its own pass with its own on-device check, not a ride along on a fix for a
 * confirmed defect, where a regression could not be attributed to either.
 *
 * `frame.ts` has been made inset-aware in the meantime, so that pass is a one-line change here
 * rather than a change that also has to remember to go and correct a padding constant.
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
 * NO safe-area padding on the body, and with `viewport-fit` unset there is nothing for it to
 * pad against anyway. Where content genuinely could collide with the hardware — the floating
 * nav's bottom offset, the sheets', the scroll reservation in `frame.ts` — the inset is already
 * consumed in the arithmetic, so those are correct on the day the meta tag changes rather than
 * needing to be found again.
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
