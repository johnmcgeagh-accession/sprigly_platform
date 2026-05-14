import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import CtaBand from '@/components/CtaBand'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for financial advisers',
  description:
    'Suitability reports in 20 minutes. Meeting notes that hold up to Consumer Duty scrutiny. Built for FCA-regulated firms.',
  alternates: { canonical: `${SITE_URL}/for-financial-advisers` },
}

export default function FinancialAdvisersPage() {
  return (
    <>
      <Nav />
      <main className="min-h-screen bg-paper">
        <div className="pt-[140px] pb-[130px] px-6 md:px-12 max-w-[1200px] mx-auto">
          <div className="max-w-[760px]">
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
              For financial advisers
            </p>
            <h1
              className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
              style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
            >
              Suitability reports in 20 minutes. <em className="font-serif italic text-coral">Built for FCA-regulated firms.</em>
            </h1>
            <p className="text-[17px] leading-[1.7] text-ink-mid">
              More detail on this coming soon. In the meantime, book a discovery call to talk
              through your practice.
            </p>
          </div>
        </div>
      </main>
      <CtaBand />
      <Footer />
    </>
  )
}
