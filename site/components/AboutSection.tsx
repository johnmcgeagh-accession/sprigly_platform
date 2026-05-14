import Link from 'next/link'
import { Reveal } from './Reveal'

export default function AboutSection() {
  return (
    <section className="py-[130px] px-6 md:px-12 bg-peach-soft border-t border-ink/10">
      <div className="max-w-[1200px] mx-auto">
        <Reveal className="max-w-[760px]">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            About
          </p>
          <h2
            className="font-serif font-normal tracking-[-0.025em] text-ink mb-10"
            style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            Built for businesses where <em className="fraunces-soft text-coral">the same few people</em> keep becoming the bottleneck.
          </h2>

          <div className="space-y-5 text-[17px] leading-[1.7] text-ink-mid mb-10">
            <p>
              Sprigly is built for small, owner-managed businesses where the admin never quite
              stops and generic software has never quite fitted. Where hiring another pair of
              hands costs too much, and the same few people keep becoming the bottleneck.
            </p>
            <p>
              It starts with a free 20-minute call, then a proper look at your workflows. Every
              agent we configure is built around how your specific business actually works. Not a
              standard package. UK-based. Oxfordshire-rooted.
            </p>
          </div>

          <Link
            href="/about"
            className="inline-flex items-center gap-2 text-[14px] text-coral font-medium hover:gap-3 transition-all duration-200"
          >
            More about Sprigly
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  )
}
