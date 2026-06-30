export const COLOURS = {
  coral:     '#E87766',
  navy:      '#1E2A4A',
  amber:     '#F59E0B',
  offWhite:  '#F7F5F0',
  white:     '#FFFFFF',
  black:     '#111111',
  midGrey:   '#6B7280',
  lightGrey: '#E5E7EB',
  navyBorder: 'rgba(30,42,74,0.12)',
} as const;

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
} as const;

// Register via registerFonts() before render for production.
// Tests stub these families with Helvetica via src/test-setup.ts.
// Primary face is Inter — see README for why Plus Jakarta Sans was not used.
export const FONT = {
  family:    'Inter',
  editorial: 'DM Serif Display',
  sizes: {
    xs:   7,
    sm:   8,
    body: 9,
    md:   10,
    lg:   13,
    xl:   18,
    xxl:  22,
  },
} as const;
