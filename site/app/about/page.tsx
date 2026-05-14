import type { Metadata } from 'next'
import Link from 'next/link'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import CtaBand from '@/components/CtaBand'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'About Sprigly',
  description:
    'Sprigly builds AI agents for small, owner-managed businesses. UK-based, Oxfordshire-rooted.',
  alternates: { canonical: `${SITE_URL}/about` },
}

export default function AboutPage() {
  return (
    <>
      <Nav />
      <main className="min-h-screen bg-paper">
        <div className="pt-[140px] pb-[130px] px-6 md:px-12 max-w-[1200px] mx-auto">
          <div className="max-w-[760px]">
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
              About
            </p>
            <h1
              className="font-serif font-normal tracking-[-0.025em] text-ink mb-12"
              style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
            >
              Built for businesses where the admin never quite stops.
            </h1>

            <div className="space-y-5 text-[17px] leading-[1.7] text-ink-mid mb-10">
              <p>
                Sprigly is built for small, owner-managed businesses where the admin never quite
                stops and generic software has never quite fitted. Where hiring another pair of
                hands costs too much, and the same few people keep becoming the bottleneck.
              </p>
              <p>
                It starts with a free 20-minute call, then a proper look at your workflows. Every
                agent we configure is built around how your specific business actually works. Not
                a standard package. UK-based. Oxfordshire-rooted.
              </p>
            </div>

            <Link
              href="/book"
              className="inline-flex items-center gap-[10px] px-7 py-4 bg-coral text-white rounded-lg font-medium text-[15px] transition-all duration-200 hover:-translate-y-px"
            >
              Book a free discovery call
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </Link>
          </div>
        </div>
      </main>
      <CtaBand />
      <Footer />
    </>
  )
}
