import Link from 'next/link'
import { Reveal } from './Reveal'

const verticals = [
  {
    title: 'Founder-led businesses',
    body: 'Proposals, client comms, research, reports and whatever else is taking your time. Built around how your business actually works.',
    href: '/for-founder-led-businesses',
  },
  {
    title: 'Estate & lettings agents',
    body: 'Property descriptions, tenancy renewals, landlord reports, compliance letters. The paperwork that runs on repeat, taken off your plate.',
    href: '/for-estate-agents',
  },
  {
    title: 'Financial advisers',
    body: 'Suitability reports in 20 minutes. Meeting notes that hold up to Consumer Duty scrutiny. Built for FCA-regulated firms.',
    href: '/for-financial-advisers',
  },
]

export default function Verticals() {
  return (
    <section className="py-[130px] px-6 md:px-12 bg-peach-soft border-t border-ink/10 border-b">
      <div className="max-w-[1200px] mx-auto">
        <Reveal className="max-w-[800px] mb-[72px]">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            Built for
          </p>
          <h2
            className="font-serif font-normal tracking-[-0.025em] text-ink"
            style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            Founder-led businesses.{' '}
            <em className="fraunces-soft text-coral">Sector by sector.</em>
          </h2>
        </Reveal>

        <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {verticals.map((v) => (
            <article
              key={v.title}
              className="bg-white p-10 min-h-[240px] flex flex-col rounded-[20px] border border-ink/10 transition-all duration-500 hover:-translate-y-2 hover:border-coral/25 hover:shadow-[0_24px_48px_rgba(31,26,24,0.06)]"
              style={{ padding: '48px 36px' }}
            >
              <h3 className="font-serif font-medium text-[22px] tracking-[-0.015em] leading-[1.2] mb-[14px] text-ink">
                {v.title}
              </h3>
              <p className="text-[15px] leading-[1.55] text-ink-mid mb-6 flex-grow">{v.body}</p>
              <Link
                href={v.href}
                className="inline-flex items-center gap-2 text-[14px] text-coral font-medium hover:gap-3 transition-all duration-200"
              >
                Learn more
                <span className="sr-only"> about {v.title}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </Link>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
