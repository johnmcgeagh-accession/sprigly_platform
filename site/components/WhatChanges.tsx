import { Reveal } from './Reveal'

const cards = [
  {
    num: 'i.',
    title: "Client work goes out the day it's asked for",
    body: "The lead that came in on Monday gets a proposal or a brief back by Tuesday morning, not next week. No more losing deals to slow turnaround. No more \"I'll send that over by Friday\" emails.",
  },
  {
    num: 'ii.',
    title: 'Senior people stop drafting from scratch',
    body: "Your most expensive person isn't writing the first version of the client report at 9pm. They review a draft that's already 80% there, in their voice, in your format, and add the judgement only they can.",
  },
  {
    num: 'iii.',
    title: 'The next client without the next salary',
    body: "No three-month recruitment. No £50k+ salary line. No \"fingers crossed they work out.\" The capacity is in place from week one, and it scales the moment you need it.",
  },
]

export default function WhatChanges() {
  return (
    <section className="py-[130px] px-6 md:px-12 max-w-[1200px] mx-auto">
      <Reveal className="mb-[72px] max-w-[800px]">
        <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
          What changes
        </p>
        <h2
          className="font-serif font-normal tracking-[-0.025em] text-ink"
          style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
        >
          What changes <em className="fraunces-soft text-coral">in your week.</em>
        </h2>
      </Reveal>

      <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card) => (
          <article
            key={card.num}
            className="bg-white flex flex-col rounded-[20px] border border-ink/10 transition-all duration-500 hover:-translate-y-2 hover:border-coral/25 hover:shadow-[0_24px_48px_rgba(31,26,24,0.06)]"
            style={{ padding: '48px 36px', minHeight: 240 }}
          >
            <div className="font-serif italic text-[16px] text-coral mb-5">{card.num}</div>
            <h3 className="font-serif font-medium text-[22px] tracking-[-0.015em] leading-[1.2] mb-[14px] text-ink">
              {card.title}
            </h3>
            <p className="text-[15px] leading-[1.55] text-ink-mid">{card.body}</p>
          </article>
        ))}
      </Reveal>
    </section>
  )
}
