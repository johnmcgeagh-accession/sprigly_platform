import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './content/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        coral: {
          DEFAULT: '#FF6F62',
          light: '#FF8575',
          deep: '#C04545',
          shadow: '#7A1F22',
        },
        honey: {
          DEFAULT: '#E8B66A',
          deep: '#B8864A',
        },
        paper: '#FFFFFF',
        peach: {
          DEFAULT: '#FFE8DD',
          soft: '#FFFFFF',
        },
        ink: {
          DEFAULT: '#1F1A18',
          mid: '#5C4F4A',
          light: '#8A7E78',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-fraunces)', 'Georgia', 'serif'],
        fraunces: ['var(--font-fraunces)', 'Georgia', 'serif'],
        inter: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['11px', { letterSpacing: '0.15em' }],
      },
      maxWidth: {
        '8xl': '88rem',
      },
    },
  },
  plugins: [],
}

export default config
