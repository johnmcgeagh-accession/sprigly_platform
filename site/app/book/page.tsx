import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { BOOKING_URL, SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Book a discovery call',
  description:
    '20 minutes. We\'ll show you the workflows where AI agents would pay back fastest, or tell you it\'s not the right fit.',
  alternates: { canonical: `${SITE_URL}/book` },
}

export default function BookPage() {
  return (
    <>
      <Nav />
      <main className="min-h-screen bg-paper flex items-center justify-center px-6 py-[140px]">
        <div className="max-w-[640px] w-full text-center">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            Start here
          </p>
          <h1
            className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
            style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            Book a discovery call.
          </h1>
          <p className="text-[17px] leading-[1.6] text-ink-mid mb-10 max-w-[480px] mx-auto">
            20 minutes. We'll show you the two or three workflows where AI agents would pay back
            fastest, or tell you it's not the right fit. Either way, you leave with a clear
            answer.
          </p>
          {/*
            Booking embed goes here.
            Swap BOOKING_URL in lib/config.ts to your Cal.com or SavvyCal link,
            then replace this placeholder with their embed widget.
          */}
          <div className="rounded-[20px] border border-ink/10 bg-white p-12 text-ink-mid text-[15px]">
            <p className="mb-4">
              Booking calendar coming soon.
            </p>
            <p>
              In the meantime, email{' '}
              <a
                href="mailto:hello@sprigly.co.uk"
                className="text-coral underline underline-offset-2"
              >
                hello@sprigly.co.uk
              </a>{' '}
              to arrange a call.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
