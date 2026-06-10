import Link from 'next/link'
import { Reveal } from './Reveal'

const verticals = [
  {
    title: 'Estate & lettings agents',
    body: 'Property descriptions, tenancy renewals, landlord reports, compliance letters. The paperwork that runs on repeat, taken off your plate.',
    href: '/for-estate-agents',
    catchAll: false,
  },
  {
    title: 'Financial advisers',
    body: 'Suitability reports in 20 minutes. Meeting notes that hold up to Consumer Duty scrutiny. Built for FCA-regulated firms.',
    href: '/for-financial-advisers',
    catchAll: false,
  },
  {
    title: 'Recruitment agencies',
    body: "CV formatting, candidate summaries, job specs, client updates. The paperwork between placements, done while you're on the phone.",
    href: '/for-recruitment-agencies',
    catchAll: false,
  },
  {
    title: 'Accountants & bookkeepers',
    body: "Onboarding letters, management accounts commentary, deadline chasing. The client comms that eat the hours you can't bill.",
    href: '/for-accountants',
    catchAll: false,
  },
  {
    title: 'Marketing & creative agencies',
    body: 'Proposals, status reports, case studies. The words about the work, so your team can do the work.',
    href: '/for-marketing-agencies',
    catchAll: false,
  },
  {
    title: 'Every other founder-led business',
    body: "Don't see your sector? The agents are built around your workflows, not an industry template. If the same few people are the bottleneck, it fits.",
    href: '/for-founder-led-businesses',
    catchAll: true,
  },
]

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export default function Verticals() {
  return (
    <section className="py-[130px] px-6 md:px-12 bg-peach-soft border-t border-ink/10 border-b">
      <div className="max-w-[1200px] mx-auto">
        <Reveal className="max-w-[800px] mb-5">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            Built for
          </p>
          <h2
            className="font-serif font-normal tracking-[-0.025em] text-ink"
            style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            Built around your business.{' '}
            <em className="fraunces-soft text-coral">Whatever your sector.</em>
          </h2>
        </Reveal>

        <Reveal className="max-w-[640px] mb-[60px] text-[17px] leading-[1.6] text-ink-mid">
          Every Sprigly agent is built around one specific business &mdash; yours. These are
          the sectors where founders most often start.
        </Reveal>

        <Reveal stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {verticals.map((v) => (
            <article
              key={v.title}
              className={[
                'flex flex-col rounded-[20px] border transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_24px_48px_rgba(31,26,24,0.06)]',
                v.catchAll
                  ? 'bg-coral/[0.13] border-coral/30 hover:border-coral/50'
                  : 'bg-white border-ink/10 hover:border-coral/25',
              ].join(' ')}
              style={{ padding: '48px 36px' }}
            >
              <h3 className="font-serif font-medium text-[22px] tracking-[-0.015em] leading-[1.2] mb-[14px] text-ink">
                {v.title}
              </h3>
              <p className="text-[15px] leading-[1.55] text-ink-mid mb-6 flex-grow">{v.body}</p>

              {v.catchAll ? (
                <div className="flex flex-col gap-3">
                  <Link
                    href={v.href}
                    className="inline-flex items-center gap-2 bg-coral text-white px-5 py-[10px] rounded-lg font-medium text-[14px] transition-all duration-200 hover:-translate-y-px self-start"
                    style={{ boxShadow: '0 2px 12px rgba(255,111,98,0.30)' }}
                  >
                    See how it fits
                    <ArrowIcon />
                  </Link>
                  <p className="text-[12px] text-ink-light">
                    Or skip ahead &mdash;{' '}
                    <Link href="/book" className="underline underline-offset-2 hover:text-coral transition-colors">
                      book a 20-minute call.
                    </Link>
                  </p>
                </div>
              ) : (
                <Link
                  href={v.href}
                  className="inline-flex items-center gap-2 text-[14px] text-coral font-medium hover:gap-3 transition-all duration-200"
                >
                  Learn more
                  <span className="sr-only"> about {v.title}</span>
                  <ArrowIcon />
                </Link>
              )}
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
