import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import CtaBand from '@/components/CtaBand'
import { Reveal } from '@/components/Reveal'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'How handoff works',
  description:
    "How Sprigly fits into your day. One engine, three ways to hand work off. You decide how much rein to give it.",
  alternates: {
    canonical: `${SITE_URL}/how-handoff-works`,
  },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/how-handoff-works`,
    title: 'How handoff works | Sprigly',
    description:
      "How Sprigly fits into your day. One engine, three ways to hand work off. You decide how much rein to give it.",
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How handoff works | Sprigly',
    description:
      "How Sprigly fits into your day. One engine, three ways to hand work off. You decide how much rein to give it.",
  },
}

const tiers = [
  {
    label: 'New starter',
    scope: 'Specific jobs only',
    fill: 1,
    body: "You forward specific jobs to a dedicated Sprigly inbox, or tag and send them. Tightly scoped. Sprigly only ever sees what you choose to pass it, and you see everything before it goes out.",
  },
  {
    label: 'Finding its feet',
    scope: 'Dedicated inbox',
    fill: 2,
    body: "Sprigly looks after a dedicated inbox and handles whatever lands there, tagged or not. Less for you to sort. It's working a defined patch on its own.",
  },
  {
    label: 'Experienced colleague',
    scope: 'Full inbox',
    fill: 3,
    body: "Sprigly watches your live inbox and uses its judgement: when to act, and what to do with the result, all inside the rules you've set. Most off your plate.",
  },
]

function ScopeBar({ fill }: { fill: number }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        marginBottom: 20,
      }}
      aria-hidden="true"
    >
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          style={{
            height: 4,
            flex: 1,
            borderRadius: 2,
            background: n <= fill ? '#FF6F62' : 'rgba(31,26,24,0.10)',
            opacity: n <= fill ? (0.5 + (n / fill) * 0.5) : 1,
          }}
        />
      ))}
    </div>
  )
}

export default function HowHandoffWorksPage() {
  return (
    <>
      <Nav />
      <main>
        {/* Hero */}
        <section className="bg-paper pt-[140px] pb-[80px] px-6 md:px-12 border-b border-ink/10">
          <div className="max-w-[800px] mx-auto">
            <Reveal>
              <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
                How it works
              </p>
              <h1
                className="font-serif font-normal tracking-[-0.025em] text-ink mb-8"
                style={{ fontSize: 'clamp(38px, 5vw, 64px)', lineHeight: 1.05 }}
              >
                How Sprigly fits into your day
              </h1>
              <p className="text-[18px] leading-[1.65] text-ink-mid max-w-[640px]">
                There's one thing happening underneath everything Sprigly does: it watches work come
                in and does it your way, trained on your voice, your formats and the standards your
                team works to. How much it handles, and how much it decides for itself, is up to you.
              </p>
            </Reveal>
          </div>
        </section>

        {/* One engine section */}
        <section className="py-[90px] px-6 md:px-12 bg-paper border-b border-ink/10">
          <div className="max-w-[800px] mx-auto">
            <Reveal>
              <h2
                className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
                style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', lineHeight: 1.1 }}
              >
                One engine, three ways to use it
              </h2>
              <p className="text-[17px] leading-[1.65] text-ink-mid max-w-[640px]">
                "You hand it off" and "it watches for the work" aren't different products. They're
                the same engine with more or less of your inbox in view, and more or less licence to
                act on its own. You start it where you're comfortable and open it up as you go.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Think of it like a hire */}
        <section className="py-[90px] px-6 md:px-12 bg-paper border-b border-ink/10">
          <div className="max-w-[1100px] mx-auto">
            <Reveal className="max-w-[700px] mb-14">
              <h2
                className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
                style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', lineHeight: 1.1 }}
              >
                Think of it like a hire
              </h2>
              <p className="text-[17px] leading-[1.65] text-ink-mid">
                How much you let Sprigly do is the same call you'd make with a new member of staff.
                A new starter gets tightly scoped work and you check everything. As they show they
                understand how you operate, you hand over more and check less. Sprigly works the same
                way. More access, more off your plate. You decide how much rein to give it, and most
                people widen that as they watch it work.
              </p>
            </Reveal>

            {/* Progression tiers */}
            <Reveal stagger>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {tiers.map((tier) => (
                  <div
                    key={tier.label}
                    style={{
                      padding: '28px 28px 32px',
                      background: 'white',
                      borderRadius: 16,
                      border: '1px solid rgba(31,26,24,0.08)',
                    }}
                  >
                    {/* Scope bar shows progression visually */}
                    <ScopeBar fill={tier.fill} />

                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.14em',
                        color: '#FF6F62',
                        marginBottom: 6,
                      }}
                    >
                      {tier.scope}
                    </div>

                    <h3
                      className="font-serif font-normal tracking-[-0.015em] text-ink mb-4"
                      style={{ fontSize: 20, lineHeight: 1.15 }}
                    >
                      {tier.label}
                    </h3>
                    <p style={{ fontSize: 14, color: '#5C4F4A', lineHeight: 1.6 }}>{tier.body}</p>
                  </div>
                ))}
              </div>

              {/* Progression label */}
              <div
                className="mt-5 hidden md:flex items-center gap-3"
                style={{ fontSize: 12, color: '#8A7E78' }}
              >
                <span>More access</span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: 'linear-gradient(to right, rgba(31,26,24,0.10), rgba(255,111,98,0.35))',
                  }}
                  aria-hidden="true"
                />
                <span>More off your plate</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* One rule */}
        <section className="py-[90px] px-6 md:px-12 bg-paper border-b border-ink/10">
          <div className="max-w-[800px] mx-auto">
            <Reveal>
              <h2
                className="font-serif font-normal tracking-[-0.025em] text-ink mb-6"
                style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', lineHeight: 1.1 }}
              >
                One rule that never changes
              </h2>
              <p className="text-[17px] leading-[1.65] text-ink-mid max-w-[600px]">
                A human approves before anything goes out. At every level, however much you've handed
                over. That's what makes giving Sprigly more to do feel safe rather than scary.
              </p>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <CtaBand
          label="Start here"
          heading="See where Sprigly would start in your business"
          body="Twenty minutes on a call. We'll show you where it would pay back fastest, or tell you it isn't the right fit."
          buttonText="Book your discovery call"
          footnote={null}
        />
      </main>
      <Footer />
    </>
  )
}
