import { Reveal } from './Reveal'

const steps = [
  {
    num: 'i.',
    label: 'Step one · 20 minutes',
    title: 'Discovery call',
    body: "You leave the call knowing whether AI agents can help your business, and which two or three workflows we'd target first. No follow-up sequence. No slides. No pitch.",
  },
  {
    num: 'ii.',
    label: 'Step two · The Sprigly Audit',
    title: 'One-page diagnosis',
    body: 'We sit with the people doing the work and map how it gets done. You leave with a one-page document showing exactly where the time goes and what the first agent will absorb.',
  },
  {
    num: 'iii.',
    label: 'Step three · Live in 2–3 weeks',
    title: 'Working from week one',
    body: 'Trained on your voice, your past work, your standards. Used daily from the moment it goes live. Refined as your business evolves.',
  },
]

export default function Process() {
  return (
    <section
      id="start"
      className="py-[130px] px-6 md:px-12 max-w-[1200px] mx-auto"
    >
      <Reveal className="max-w-[800px] mb-14">
        <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
          How it works
        </p>
        <h2
          className="font-serif font-normal tracking-[-0.025em] text-ink"
          style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
        >
          From <em className="fraunces-soft text-coral">first call</em> to live agents in three weeks.
        </h2>
      </Reveal>

      <Reveal
        stagger
        className="process-steps grid grid-cols-1 md:grid-cols-3 gap-12"
      >
        {steps.map((step) => (
          <div key={step.num} className="relative z-[1]">
            <div
              className="w-16 h-16 bg-paper border border-ink/[0.18] rounded-full flex items-center justify-center font-serif italic text-[22px] text-coral mb-6"
              aria-hidden="true"
            >
              {step.num}
            </div>
            <p className="text-[11px] font-medium tracking-[0.12em] uppercase text-ink-mid mb-3">
              {step.label}
            </p>
            <h3 className="font-serif font-medium text-[24px] tracking-[-0.015em] mb-[14px] text-ink">
              {step.title}
            </h3>
            <p className="text-[15px] leading-[1.55] text-ink-mid">{step.body}</p>
          </div>
        ))}
      </Reveal>
    </section>
  )
}
