import type { Config } from 'tailwindcss';

/** A themed colour token: reads a CSS var (injected from the active theme, RGB channels) with a
 *  "Sprigly Coral" fallback, in `<alpha-value>` form so Tailwind opacity modifiers keep working. */
const t = (cssVar: string, fallbackRgb: string): string => `rgb(var(${cssVar}, ${fallbackRgb}) / <alpha-value>)`;

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
      /**
       * THE DESKTOP COLUMN ARITHMETIC (docs/design/desktop-plan-surface.md §2.1).
       *
       *   rail 196 + 24 + month 512 + 20 + day 320 + 24 + dock 344 = 1440
       *
       * Named here rather than written into the shell as arbitrary values, for the same reason
       * colours are: a layout constant that four components have to agree on belongs in one
       * place, and the surface's own fence is built on the principle that a component NAMES a
       * value rather than declaring one. `rail-tight` and `dock-tight` are the 1080–1279 band.
       */
      width: {
        rail: '196px',
        'rail-tight': '68px',
        month: '512px',
        day: '320px',
        dock: '344px',
        'dock-tight': '320px',
      },
      // PLATFORM THEMING: every design token resolves to a CSS variable injected at the layout
      // root from the ACTIVE theme (admin-managed, global). RGB-channel form + <alpha-value> so
      // Tailwind opacity modifiers (`bg-line/40`, `text-coral-800/85`) keep working. Each var has
      // a fallback = the "Sprigly Coral" value, so with NO injection the app renders byte-identical
      // to the closed system. Switching the active theme in admin repaints on next load — no rebuild.
      colors: {
        bg:      t('--t-canvas', '242 243 245'),    // page canvas
        surface: t('--t-surface', '255 255 255'),   // cards, modals, steppers

        // Accent scale (was the coral ramp).
        //
        // 500 and 650 are the round-5 tiers. 650 is the FILLED-CONTROL tier — the one that
        // carries white — and 600 is identity-only, non-text (DESIGN.md, the ink rule). The
        // fallbacks are the coral system's equivalents, chosen so the rule still holds with no
        // theme injected: white on the 650 fallback (#D25B48) is 3.94:1, and chrome-deep on
        // the 500 fallback (#F0968A) is 6.57:1.
        'coral-500': t('--t-accent-500', '240 150 138'),
        'coral-650': t('--t-accent-650', '210 91 72'),
        'coral-600': t('--t-accent-600', '232 112 95'),
        'coral-700': t('--t-accent-700', '196 82 63'),
        'coral-800': t('--t-accent-800', '138 51 35'),
        'coral-100': t('--t-accent-100', '250 221 214'),
        // Legacy aliases → the accent scale.
        coral:            t('--t-accent-600', '232 112 95'),
        'coral-strong':   t('--t-accent-600', '232 112 95'),
        'coral-tint':     t('--t-accent-100', '250 221 214'),
        'coral-cta':      t('--t-accent-700', '196 82 63'),
        'coral-heading':  t('--t-accent-600', '232 112 95'),
        'coral-on-tint':  t('--t-accent-800', '138 51 35'),
        'amber-deep':     t('--t-accent-800', '138 51 35'),
        'amber-tint':     t('--t-accent-100', '250 221 214'),

        // Dark-chrome (brand slate).
        chrome:        t('--t-chrome', '51 65 85'),
        'chrome-deep': t('--t-chrome-deep', '30 41 59'),
        'chrome-soft': t('--t-chrome-soft', '184 191 201'),

        // Neutrals.
        muted:       t('--t-muted', '92 100 112'),
        line:        t('--t-line', '143 146 150'),
        border:      t('--t-line', '143 146 150'),
        'line-soft': t('--t-line-soft', '244 245 246'),
        danger:      t('--t-danger', '178 58 46'),
      },
      // Brand type system (matched to sprigly.co.uk): Fraunces display serif + Inter body/UI
      // sans + Plus Jakarta Sans 800 for the logo wordmark only.
      fontFamily: {
        sans:  ['var(--font-inter)', 'system-ui', 'sans-serif'],       // body + UI chrome
        serif: ['var(--font-fraunces)', 'Georgia', 'serif'],           // display moments
        logo:  ['var(--font-jakarta)', 'system-ui', 'sans-serif'],     // "Sprigly" wordmark (800)
      },
      boxShadow: {
        card: '0 1px 2px rgba(51,65,85,.04), 0 6px 18px rgba(51,65,85,.06)',
        sheet: '0 24px 60px -16px rgba(51,65,85,.34)',
        coral: '0 8px 20px -6px rgba(232,112,95,.55)',
      },
      transitionTimingFunction: {
        sheet: 'cubic-bezier(.22,.61,.36,1)',
      },
      /**
       * The "On its way" ellipsis (round 7, fix 6).
       *
       * Three dots that travel rather than three dots that sit there. A static staircase of
       * opacities reads as a decoration; the same three dots pulsing in sequence read as *work
       * in progress*, which is the one thing the marker exists to say.
       *
       * Opacity only — no transform, no layout property — so it composites on the GPU and costs
       * nothing on a phone that is also polling for the caption. It rests at .28 rather than 0,
       * because a dot that vanishes leaves a gap and the ellipsis loses its shape.
       *
       * Applied through Tailwind's `motion-safe:` variant, so `prefers-reduced-motion: reduce`
       * gets the static staircase and loses nothing: the words beside it carry the state.
       */
      keyframes: {
        'dot-pulse': {
          '0%, 70%, 100%': { opacity: '0.28' },
          '35%':           { opacity: '1' },
        },
      },
      animation: {
        'dot-pulse': 'dot-pulse 1.4s cubic-bezier(.22,.61,.36,1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
