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
      /** 1440 is where month and day stop stacking and sit side by side. Tailwind's own
       *  scale jumps 1280 to 1536 and neither is the width this surface was reviewed at. */
      screens: { wide: '1440px' },
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
      /**
       * ── ABOVE 1440 THE COLUMNS GROW, THEN THE SHELL CENTRES (spec §2.6) ──────────
       *
       * The build was laid out at exactly 1440 and the numbers were exact THERE and
       * nowhere else: 196 + 24 + 512 + 20 + 320 + 24 + 344 fits 1440 to the pixel, so
       * every width below it clipped the day column and every width above it left the
       * surplus as one void between the day and the dock.
       *
       * So the fixed month/day widths are gone. They are PROPORTIONS now (680 : 420,
       * which is the reviewed 512 : 320 ratio), the dock is a clamp, and the shell has a
       * ceiling it centres inside:
       *
       *   rail 196 + 24 + month 680 + 20 + day 420 + 24 + dock 400 = 1764
       *
       * At 1440 that resolves to 513 / 317 / 346 — the reviewed layout, within 3px. At
       * 1764 and beyond every column is at its ceiling and the surplus becomes balanced
       * margin rather than a hole in the middle.
       */
      width: {
        rail: '196px',
        'rail-tight': '68px',
        /** 320 at the narrow end, 400 at the ceiling, proportional between. */
        dock: 'clamp(320px, 24vw, 400px)',
      },
      maxWidth: {
        /**
         * The shell's old ceiling. Kept because the spec's §2.6 arithmetic is stated in terms
         * of it (rail + columns + dock, all at their ceilings) — but the shell itself is
         * full-width now: capping it there put the rail's and dock's borders 400px inside a
         * 2560 viewport, and the app read as a bordered rectangle floating in a field.
         */
        shell: '1764px',
        /**
         * WHERE THE CEILING LIVES NOW: month 680 + gap 20 + day 420, plus the region's own
         * 24px gutters. The columns still stop growing and the surplus still splits evenly on
         * both sides of them — W1's rule unchanged — except it is inside the app rather than
         * around it, so the two edge regions stay flush with the viewport.
         */
        cols: '1168px',
        /**
         * A modal's content width. The decision it carries is the same size on every screen, so
         * this is fixed rather than proportional.
         *
         * 512 rather than 480 for HEADROOM, not to clear a wrap. The wrap it was blamed for was
         * a browser list indent (see ApprovalSheet), and removing that alone unwraps every row
         * at 480. This buys margin on top: the longest row needs 303px of text column and now
         * gets 376, so a longer label or a three-digit count has somewhere to go. Tuned to the
         * exact wrap point it would break on the next copy change.
         */
        modal: '512px',
      },
      flex: {
        /** The month : day ratio, as grow factors. 680 : 420 is 512 : 320. */
        month: '680 1 0%',
        day: '420 1 0%',
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
