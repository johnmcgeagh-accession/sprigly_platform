import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import CtaBand from '@/components/CtaBand'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for estate & lettings agents',
  description:
    'Property descriptions, tenancy renewals, landlord reports, compliance letters. The paperwork that runs on repeat, taken off your plate.',
  alternates: { canonical: `${SITE_URL}/for-estate-agents` },
}

export default function EstateAgentsPage() {
  return (
    <>
      <Nav />
      <main className="min-h-screen bg-paper">
        <div className="pt-[140px] pb-[130px] px-6 md:px-12 max-w-[1200px] mx-auto">
          <div className="max-w-[760px]">
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
              For estate & lettings agents
            </p>
            <h1
              className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
              style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
            >
              The paperwork that runs on repeat. <em className="font-serif italic text-coral">Taken off your plate.</em>
            </h1>
            <p className="text-[17px] leading-[1.7] text-ink-mid">
              More detail on this coming soon. In the meantime, book a discovery call to talk
              through your specific agency.
            </p>
          </div>
        </div>
      </main>
      <CtaBand />
      <Footer />
    </>
  )
}
