import Link from 'next/link'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import CtaBand from '@/components/CtaBand'
import { Reveal } from '@/components/Reveal'
import { BOOKING_URL } from '@/lib/config'

export interface SectorData {
  eyebrow: string
  headlinePlain: string
  headlineItalic: string
  subhead: string
  pains: [string, string, string]
  send: string
  get: string
  disclaimer?: string
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

const HOW_IT_LANDS = [
  {
    title: 'Brief by email or Slack',
    body: 'However you already work. No new app. No new login. No prompts to learn.',
  },
  {
    title: 'Comes back in your voice',
    body: 'In your format, your tone, ready to send or refine. Usually within the hour.',
  },
  {
    title: 'Nothing goes out without your approval',
    body: 'Every output waits for your okay. You review, you approve, it goes.',
  },
]

export default function SectorPage({ data }: { data: SectorData }) {
  return (
    <>
      <Nav />
      <main className="bg-paper">

        {/* ── Hero ── */}
        <section
          className="pt-[140px] pb-[100px] px-6 md:px-12"
          style={{
            background: '#FFFFFF',
          }}
        >
          <div className="max-w-[1200px] mx-auto">
            <Reveal className="max-w-[800px]">
              <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
                {data.eyebrow}
              </p>
              <h1
                className="font-serif font-normal tracking-[-0.025em] text-[#334155] mb-6"
                style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
              >
                {data.headlinePlain}{' '}
                <em className="fraunces-soft text-coral">{data.headlineItalic}</em>
              </h1>
              <p className="text-[18px] leading-[1.65] text-ink-mid mb-9 max-w-[600px]">
                {data.subhead}
              </p>
              <Link
                href={BOOKING_URL}
                className="inline-flex items-center gap-[10px] px-8 py-[14px] bg-coral text-white rounded-lg font-semibold text-[15px] transition-all duration-200 hover:-translate-y-px"
                style={{ boxShadow: '0 4px 20px rgba(255,111,98,0.30)' }}
              >
                Book a call
                <ArrowIcon />
              </Link>
              <p className="mt-3 text-[13px] text-ink-light">20 minutes. Free. No pitch.</p>
            </Reveal>
          </div>
        </section>

        {/* ── What's eating the week ── */}
        <section className="py-[100px] px-6 md:px-12 border-b border-ink/10">
          <div className="max-w-[1200px] mx-auto">
            <Reveal className="max-w-[640px] mb-[60px]">
              <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
                The hours that add up
              </p>
              <h2
                className="font-serif font-normal tracking-[-0.025em] text-[#334155]"
                style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', lineHeight: 1.1 }}
              >
                Where the time actually goes.
              </h2>
            </Reveal>
            <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {data.pains.map((pain, i) => (
                <div key={i} className="flex flex-col">
                  <div className="font-serif italic text-[16px] text-coral mb-4">
                    {(['i.', 'ii.', 'iii.'] as const)[i]}
                  </div>
                  <p className="text-[16px] leading-[1.65] text-ink-mid">{pain}</p>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ── Worked example ── */}
        <section className="py-[100px] px-6 md:px-12 bg-peach-soft border-b border-ink/10">
          <div className="max-w-[1200px] mx-auto">
            <Reveal className="max-w-[640px] mb-[52px]">
              <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
                What it looks like in practice
              </p>
              <h2
                className="font-serif font-normal tracking-[-0.025em] text-[#334155]"
                style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', lineHeight: 1.1 }}
              >
                A real brief.{' '}
                <em className="fraunces-soft text-coral">A real output.</em>
              </h2>
            </Reveal>
            <Reveal>
              <div
                className="bg-white border border-ink/10 rounded-[20px] max-w-[680px]"
                style={{ padding: '40px 36px' }}
              >
                <div className="space-y-[10px]">
                  <div className="flex gap-[14px] text-[15px] leading-[1.6]">
                    <span className="font-serif italic text-coral flex-shrink-0 w-12">Send</span>
                    <span className="text-ink-mid">{data.send}</span>
                  </div>
                  <div className="flex gap-[14px] text-[15px] leading-[1.6] pt-[14px] border-t border-ink/10">
                    <span className="font-serif italic text-coral flex-shrink-0 w-12">Get</span>
                    <span className="text-ink-mid">{data.get}</span>
                  </div>
                </div>
                {data.disclaimer && (
                  <p className="mt-[18px] pt-[18px] border-t border-ink/10 text-[13px] text-ink-mid italic leading-[1.55]">
                    {data.disclaimer}
                  </p>
                )}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── How it lands in your business ── */}
        <section className="py-[100px] px-6 md:px-12 border-b border-ink/10">
          <div className="max-w-[1200px] mx-auto">
            <Reveal className="max-w-[640px] mb-[60px]">
              <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
                How it works
              </p>
              <h2
                className="font-serif font-normal tracking-[-0.025em] text-[#334155]"
                style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', lineHeight: 1.1 }}
              >
                Fits into how your team{' '}
                <em className="fraunces-soft text-coral">already works.</em>
              </h2>
            </Reveal>
            <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-10">
              {HOW_IT_LANDS.map((item) => (
                <div key={item.title}>
                  <h3 className="font-serif font-medium text-[20px] tracking-[-0.015em] leading-[1.2] mb-[12px] text-[#334155]">
                    {item.title}
                  </h3>
                  <p className="text-[15px] leading-[1.6] text-ink-mid">{item.body}</p>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

      </main>
      <CtaBand />
      <Footer />
    </>
  )
}
