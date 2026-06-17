import type { Metadata } from 'next'
import { Fraunces, Inter, Plus_Jakarta_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

import './globals.css'

// Only load Vercel observability tools when actually deployed on Vercel
const isVercel = process.env.VERCEL === '1'
import { SITE_URL } from '@/lib/config'

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'optional',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'opsz'],
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Sprigly. AI agents trained on the way your business actually works.',
    template: '%s | Sprigly',
  },
  description:
    'AI agents for founder-led businesses. Send a brief by email or Slack. Get proposals, reports and client comms back in your voice, in hours, not days.',
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: SITE_URL,
    siteName: 'Sprigly',
    title: 'Sprigly. AI agents trained on the way your business actually works.',
    description:
      'AI agents for founder-led businesses. Send a brief by email or Slack. Get proposals, reports and client comms back in your voice, in hours, not days.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sprigly. AI agents trained on the way your business actually works.',
    description:
      'AI agents for founder-led businesses. Send a brief by email or Slack. Get proposals, reports and client comms back in your voice, in hours, not days.',
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: SITE_URL,
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Sprigly',
  url: SITE_URL,
  description:
    'AI agents for founder-led businesses. Built around how your business actually works.',
  founder: {
    '@type': 'Person',
    name: 'John',
    jobTitle: 'Founder',
  },
  address: {
    '@type': 'PostalAddress',
    addressRegion: 'Oxfordshire',
    addressCountry: 'GB',
  },
  areaServed: 'GB',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jakarta.variable}`}>
      <head>
        <meta name="color-scheme" content="only light" />
        <meta name="theme-color" content="#FF6F62" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="bg-paper text-ink font-sans film-grain">
        {children}
        {isVercel && <Analytics />}
        {isVercel && <SpeedInsights />}
      </body>
    </html>
  )
}
