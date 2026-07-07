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
        bg: '#F5F4F2',
        surface: '#FFFFFF',
        coral: '#E87766',
        'coral-strong': '#FF6F62',
        'coral-tint': '#FCE9E5',
        ink: '#1B2430',
        muted: '#8A94A3',
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
        sheet: '0 24px 60px -16px rgba(27,36,48,.34)',
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
