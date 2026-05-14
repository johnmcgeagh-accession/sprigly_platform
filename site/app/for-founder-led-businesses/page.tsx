import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import CtaBand from '@/components/CtaBand'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for founder-led businesses',
  description:
    'Proposals, client comms, research, reports and whatever else is taking your time. Built around how your business actually works.',
  alternates: { canonical: `${SITE_URL}/for-founder-led-businesses` },
}

export default function FounderLedPage() {
  return (
    <>
      <Nav />
      <main className="min-h-screen bg-paper">
        <div className="pt-[140px] pb-[130px] px-6 md:px-12 max-w-[1200px] mx-auto">
          <div className="max-w-[760px]">
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
              For founder-led businesses
            </p>
            <h1
              className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
              style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
            >
              Proposals, comms, research, reports. <em className="font-serif italic text-coral">Off your plate.</em>
            </h1>
            <p className="text-[17px] leading-[1.7] text-ink-mid">
              More detail on this coming soon. In the meantime, book a discovery call to talk
              through your specific business.
            </p>
          </div>
        </div>
      </main>
      <CtaBand />
      <Footer />
    </>
  )
}
