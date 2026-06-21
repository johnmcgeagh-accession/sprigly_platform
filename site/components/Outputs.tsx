import Link from 'next/link'
import { Reveal } from './Reveal'
import { BOOKING_URL } from '@/lib/config'

const outputs = [
  {
    num: 'i.',
    title: 'Research and prep',
    body: "Background on the people you're meeting and the companies you're pitching to. Ready before you walk into the room.",
    send: '"Brief me on Acme Ltd. Meeting their MD Tuesday at 10."',
    get: "A two-page brief: company background, recent news, the MD's role and likely priorities, three angles to lead with.",
  },
  {
    num: 'ii.',
    title: 'Proposals and client docs',
    body: "Built from your previous work, so they sound like you wrote them. Not generic AI output. Not a template.",
    send: '"Proposal for Acme. They want a Q1 brand refresh, budget around £35k. Use the Brighton Coffee deck as a base."',
    get: "A full proposal in your format, your voice, your pricing structure. On your desk in an hour.",
  },
  {
    num: 'iii.',
    title: 'Quality control',
    body: "Your standards, applied consistently. Catches the things only you would catch, before anything goes to a client.",
    send: 'A draft proposal, report or client email.',
    get: "Flagged inconsistencies, missing scope items, tone mismatches, and the small-print issues you'd normally only catch on the third read.",
  },
  {
    num: 'iv.',
    title: 'Reporting and patterns',
    body: "The numbers and trends you'd ask about if you had time. Pulled together each week, ready to act on.",
    send: 'Connect your CRM, time-tracking and accounting tools once.',
    get: 'A Monday-morning summary: pipeline movement, capacity vs forecast, which clients are slipping, where margin is leaking.',
  },
]

const outcomes = [
  {
    title: "Client work goes out the day it's asked for",
    body: "The lead that came in on Monday gets a proposal back by Tuesday morning, not next week. No more losing deals to slow turnaround.",
  },
  {
    title: 'Senior people stop drafting from scratch',
    body: "Your most expensive person reviews a draft that's already 80% there, in their voice and your format, then adds the judgement only they can.",
  },
  {
    title: 'The next client without the next salary',
    body: "No three-month recruitment. No £50k+ salary line. The capacity is in place from week one, and it scales the moment you need it.",
  },
]

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export default function Outputs() {
  return (
    <section
      id="outputs"
      className="py-[130px] px-6 md:px-12 bg-white border-t border-ink/10 border-b"
    >
      <div className="max-w-[1200px] mx-auto">
        <Reveal className="mb-16 max-w-[800px]">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            What you get
          </p>
          <h2
            className="font-serif font-normal tracking-[-0.025em] text-[#334155]"
            style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            Real work. <em className="fraunces-soft text-coral">Sent and returned.</em>
          </h2>
        </Reveal>

        <Reveal className="max-w-[720px] mb-16 text-[17px] leading-[1.6] text-ink-mid">
          In the first two weeks we capture how your business works: your voice, your
          formats, your standards, the things only your senior people know. After that, you brief
          by email or Slack. The work comes back the way you&rsquo;d write it, usually within an hour.
          Here are four places founders usually start. Yours might be different. That&rsquo;s the point.
        </Reveal>

        <Reveal stagger className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {outputs.map((o) => (
            <article
              key={o.num}
              className="bg-white border border-ink/10 rounded-[20px] transition-all duration-500 hover:-translate-y-2 hover:border-coral/25 hover:shadow-[0_24px_48px_rgba(31,26,24,0.06)]"
              style={{ padding: '40px 36px' }}
            >
              <div className="font-serif italic text-sm text-coral mb-3">{o.num}</div>
              <h3 className="font-serif font-medium text-[26px] tracking-[-0.015em] leading-[1.2] mb-[14px] text-[#334155]">
                {o.title}
              </h3>
              <p className="text-[15px] leading-[1.55] text-ink-mid">{o.body}</p>

              <div className="mt-[18px] pt-[18px] border-t border-ink/10 space-y-[10px]">
                <div className="flex gap-[14px] text-sm leading-[1.5]">
                  <span className="font-serif italic text-coral flex-shrink-0 w-12">Send</span>
                  <span className="text-ink-mid">{o.send}</span>
                </div>
                <div className="flex gap-[14px] text-sm leading-[1.5]">
                  <span className="font-serif italic text-coral flex-shrink-0 w-12">Get</span>
                  <span className="text-ink-mid">{o.get}</span>
                </div>
              </div>
            </article>
          ))}

          {/* CTA card — slate, spans full width */}
          <article
            className="md:col-span-2 rounded-[20px] flex flex-col md:flex-row md:items-center md:justify-between gap-8"
            style={{ padding: '40px 36px', background: '#334155' }}
          >
            <div className="flex-1 max-w-[640px]">
              <h3
                className="font-serif font-medium text-[26px] tracking-[-0.015em] leading-[1.2] mb-[14px] text-white"
              >
                Something else{' '}
                <em className="fraunces-soft text-coral">on your plate?</em>
              </h3>
              <p className="text-[15px] leading-[1.55] text-white/70">
                That&rsquo;s usually where the best agent lives. The four above are where founders often
                start. The right one for you comes out of a 20-minute conversation.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Link
                href={BOOKING_URL}
                className="inline-flex items-center gap-[10px] px-7 py-[13px] bg-coral text-white rounded-lg font-semibold text-[15px] transition-all duration-200 hover:-translate-y-px"
                style={{ boxShadow: '0 4px 20px rgba(255,111,98,0.40)' }}
              >
                Book a discovery call
                <ArrowIcon />
              </Link>
            </div>
          </article>
        </Reveal>

        <Reveal className="mt-[72px] pt-14 border-t border-ink/10">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-ink-mid mb-8">
            What changes in your week
          </p>
          <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {outcomes.map((card) => (
              <div key={card.title}>
                <h4 className="font-serif font-medium text-[18px] tracking-[-0.015em] leading-[1.3] mb-[10px] text-[#334155]">
                  {card.title}
                </h4>
                <p className="text-sm leading-[1.55] text-ink-mid">{card.body}</p>
              </div>
            ))}
          </Reveal>
        </Reveal>
      </div>
    </section>
  )
}
