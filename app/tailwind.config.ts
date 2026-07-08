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
        // Page background: a soft cool light-grey (John, Stage 6) so white surface cards
        // read as cards again. Cards stay #FFFFFF. See design/DECISIONS.md §13/§15.
        bg: '#F3F4F6',
        surface: '#FFFFFF',
        // Dual-coral is deliberate: coral is the primary/mark, coral-strong the strong
        // interactive variant (and the HTML theme-color). Recorded in DECISIONS §13.
        coral: '#E87766',
        'coral-strong': '#FF6F62',
        'coral-tint': '#FCE9E5',
        // Coral TEXT rule (supersedes Stage 5 coral-deep): coral is never used for small
        // text. These two tokens are the ONLY coral text allowed, each with a hard
        // constraint baked into the name:
        //  · coral-heading — large display/serif text ONLY (≥24px, or ≥18.66px bold).
        //    #DE6E5C = 3.24:1 on white (WCAG large-text ≥3:1). Never for small text.
        'coral-heading': '#DE6E5C',
        //  · coral-on-tint — coral text ONLY on coral-tint (active-nav label).
        //    #B04830 = 4.70:1 on #FCE9E5 (small-text AA). Never on white.
        'coral-on-tint': '#B04830',
        // slate #334155 (= slate-700) is the brand dark-surface colour; ink was dropped.
        // Small coral emphasis text now uses slate — emphasis via weight, not colour.
        // Text tokens below re-verified against pure white: muted 5.98, amber-deep 6.92,
        // danger 5.94 — all still clear AA, no re-darkening needed.
        muted: '#5C6470',
        'amber-deep': '#7A5200',
        line: '#ECEAE6',
        'line-soft': '#F1EFEC',
        'amber-tint': '#FDF0D8',
        danger: '#B23A2E',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-dm-serif)', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(51,65,85,.04), 0 6px 18px rgba(51,65,85,.06)',
        sheet: '0 24px 60px -16px rgba(51,65,85,.34)',
        coral: '0 8px 20px -6px rgba(232,119,102,.55)',
      },
      transitionTimingFunction: {
        sheet: 'cubic-bezier(.22,.61,.36,1)',
      },
    },
  },
  plugins: [],
};

export default config;
