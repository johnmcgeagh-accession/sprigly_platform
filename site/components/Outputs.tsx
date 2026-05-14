import { Reveal } from './Reveal'

const outputs = [
  {
    num: 'i.',
    title: 'Research and prep',
    body: "Background on the people you're meeting and the companies you're pitching to. Ready before you walk into the room.",
    status: 'live' as const,
    send: '"Brief me on Acme Ltd. Meeting their MD Tuesday at 10."',
    get: "A two-page brief: company background, recent news, the MD's role and likely priorities, three angles to lead with.",
  },
  {
    num: 'ii.',
    title: 'Proposals and client docs',
    body: "Built from your previous work, so they sound like you wrote them. Not generic AI output. Not a template.",
    status: 'live' as const,
    send: '"Proposal for Acme. They want a Q1 brand refresh, budget around £35k. Use the Brighton Coffee deck as a base."',
    get: "A full proposal in your format, your voice, your pricing structure. On your desk in an hour.",
  },
  {
    num: 'iii.',
    title: 'Quality control',
    body: "Your standards, applied consistently. Catches the things only experience would catch, before anything goes to a client.",
    status: 'soon' as const,
    send: 'A draft proposal, report or client email.',
    get: "Flagged inconsistencies, missing scope items, tone mismatches, and the small-print issues you'd normally only catch on the third read.",
  },
  {
    num: 'iv.',
    title: 'Reporting and patterns',
    body: "The numbers and trends you'd ask about if you had time. Pulled together each week, ready to act on.",
    status: 'soon' as const,
    send: 'Connect your CRM, time-tracking and accounting tools once.',
    get: 'A Monday-morning summary: pipeline movement, capacity vs forecast, which clients are slipping, where margin is leaking.',
  },
]

const dayCards = [
  {
    title: 'Brief by email or Slack',
    body: 'However you already work. No new app. No new login. No prompts to learn.',
  },
  {
    title: "Get it back the way you'd write it",
    body: "In your voice, in your format, ready to send or refine. Usually within the hour.",
  },
  {
    title: 'Your team carries on',
    body: "Nobody changes how they work. Nobody learns new software. The agent fits around your team, not the other way around.",
  },
]

export default function Outputs() {
  return (
    <section
      id="outputs"
      className="py-[130px] px-6 md:px-12 bg-peach-soft border-t border-ink/10 border-b"
    >
      <div className="max-w-[1200px] mx-auto">
        <Reveal className="mb-16 max-w-[800px]">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            What you get
          </p>
          <h2
            className="font-serif font-normal tracking-[-0.025em] text-ink"
            style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            Real work. <em className="fraunces-soft text-coral">Sent and returned.</em>
          </h2>
        </Reveal>

        <Reveal className="max-w-[720px] mb-16 text-[17px] leading-[1.6] text-ink-mid">
          In the first two weeks we capture how your business works: your voice, your
          formats, your standards, the things only your senior people know. After that, you brief
          by email or Slack. The work comes back the way you&rsquo;d write it, usually within an hour.
        </Reveal>

        <Reveal stagger className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {outputs.map((o) => (
            <article
              key={o.num}
              className="bg-white border border-ink/10 rounded-[20px] relative transition-all duration-500 hover:-translate-y-2 hover:border-coral/25 hover:shadow-[0_24px_48px_rgba(31,26,24,0.06)]"
              style={{ padding: '40px 36px' }}
            >
              {o.status === 'live' ? (
                <span className="absolute top-6 right-6 text-[10px] uppercase tracking-[0.12em] text-coral font-medium flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-coral rounded-full" aria-hidden="true" />
                  Live
                </span>
              ) : (
                <span className="absolute top-6 right-6 text-[10px] uppercase tracking-[0.12em] text-ink-light font-medium">
                  Coming soon
                </span>
              )}

              <div className="font-serif italic text-sm text-coral mb-3">{o.num}</div>
              <h3 className="font-serif font-medium text-[26px] tracking-[-0.015em] leading-[1.2] mb-[14px] text-ink">
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
        </Reveal>

        <Reveal className="mt-[72px] pt-14 border-t border-ink/10">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-ink-mid mb-8">
            How it works day to day
          </p>
          <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {dayCards.map((card) => (
              <div key={card.title}>
                <h4 className="font-serif font-medium text-[18px] tracking-[-0.015em] leading-[1.3] mb-[10px] text-ink">
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
