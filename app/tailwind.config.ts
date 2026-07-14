import type { Config } from 'tailwindcss';

/**
 * Tailwind for the plan-surface redesign (Stage 2). Tokens are the mockups' :root
 * block (design/reference/*.html). Preflight is DISABLED so adding Tailwind does not
 * disturb the flag-off PlanApp (which uses inline styles); the redesign gets its own
 * scoped base reset in globals.css under `.plan-redesign`.
 *
 * Text hierarchy reuses Tailwind's native slate scale — slate-700 (#334155) and
 * slate-600 (#475569) match the mockups' --slate / --slate-600 exactly — plus the
 * custom `muted`. Colours are added as flat keys so Tailwind's built-in scales
 * (slate, amber, red) are never clobbered.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        // ── ONE-ACCENT SYSTEM (design pass, supersedes the dual-coral + amber tokens) ────
        // Sprigly coral is the ONLY saturated hue; everything else is neutral ink / white /
        // border. Surfaces are crisp WHITE (the warm cream page bg is gone). Contrasts are
        // stated per token below; see the design-pass report for the full maths.

        // Surfaces — white everywhere; one near-white inset neutral for recessed wells.
        bg: '#FFFFFF',
        surface: '#FFFFFF',

        // The coral scale (Option A). One ramp; consumers use these directly and every legacy
        // coral/amber alias below RE-POINTS onto it (token-level consolidation, no per-
        // component colour freelancing).
        'coral-600': '#E8705F',   // primary actions, brand marks, active nav, focus rings
        'coral-700': '#C4523F',   // filled buttons w/ white text (4.54:1 AA), hover-ink, strong borders, small coral text on white (4.54:1)
        'coral-800': '#8A3323',   // ink on coral-100 fills (6.35:1 AA)
        'coral-100': '#FADDD6',   // tints: beat fills, badges, selected states, hovers

        // Legacy aliases → the scale (so existing `coral`/`coral-tint`/… classes resolve to
        // one ramp). White text is AA only on coral-700; coral-600 carries white for LARGE
        // text (≥18.66px bold / ≥24px) only — see coral-cta / coral-heading.
        coral:            '#E8705F',   // → coral-600 (brand hue, icons, borders, dots, focus)
        'coral-strong':   '#E8705F',   // → coral-600 (the old second bright coral is gone)
        'coral-tint':     '#FADDD6',   // → coral-100
        'coral-cta':      '#C4523F',   // → coral-700 (filled buttons w/ white text, 4.54:1)
        'coral-heading':  '#E8705F',   // → coral-600 (large display text ≥24px, 3.04:1 ≥3:1)
        'coral-on-tint':  '#8A3323',   // → coral-800 (small text on coral-100, 6.35:1)

        // Warm ambers RE-POINTED onto coral — no amber in a one-accent system.
        'amber-deep': '#8A3323',   // → coral-800
        'amber-tint': '#FADDD6',   // → coral-100

        // Neutral ink + borders (cool-neutral, never warm).
        ink:         '#23272F',    // primary / dark-surface ink — the FAB pill joins this
        muted:       '#5C6470',    // secondary text (5.98:1 on white) — unchanged
        line:        '#8F9296',    // border token: ONE grey, 3.13:1 on white (was invisible #ECEAE6)
        border:      '#8F9296',    // explicit alias of the border token
        'line-soft': '#F4F5F6',    // the ONE near-white inset/well neutral (used as a FILL, not a border)

        // Functional status signal — RETAINED (see report): a true error/overdue red, kept
        // distinct from the coral accent so failures never read as brand. Not decorative.
        danger: '#B23A2E',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-dm-serif)', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(51,65,85,.04), 0 6px 18px rgba(51,65,85,.06)',
        sheet: '0 24px 60px -16px rgba(51,65,85,.34)',
        coral: '0 8px 20px -6px rgba(232,112,95,.55)',
      },
      transitionTimingFunction: {
        sheet: 'cubic-bezier(.22,.61,.36,1)',
      },
    },
  },
  plugins: [],
};

export default config;
