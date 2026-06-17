import { Reveal } from './Reveal'

const generic = [
  'You write the prompt every time. Output quality depends on how well you ask.',
  'Knows nothing about your business, your clients, your pricing or your voice.',
  "Output is generic. You spend an hour rewriting it to sound like you.",
  'Inconsistent quality. Sometimes great, sometimes useless.',
  'Lives in a separate tab. Your team has to remember to use it.',
]

const sprigly = [
  'No prompting. Brief it like you\'d brief a junior: "proposal for Acme, similar to Brighton."',
  'Trained on your past work, your voice and your standards. It already knows how you work.',
  "Output in your format, your structure, your tone. Edit if you want to. Most of the time you don't.",
  'Consistent quality. Same voice, same standards, every brief.',
  "Lives in your inbox and Slack. The work just happens where work already happens.",
]

export default function Comparison() {
  return (
    <section
      id="compare"
      className="py-[130px] px-6 md:px-12 bg-[#334155]"
    >
      <div className="max-w-[1100px] mx-auto">
        <Reveal className="max-w-[800px] mb-14">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            Why Sprigly
          </p>
          <h2
            className="font-serif font-normal tracking-[-0.025em] text-white"
            style={{ fontSize: 'clamp(36px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            This isn&rsquo;t{' '}
            <em className="fraunces-soft text-coral">ChatGPT with a wrapper.</em>
          </h2>
        </Reveal>

        <Reveal className="max-w-[720px] mb-14 text-[17px] leading-[1.6] text-white/75">
          Generic AI tools are good at generic tasks. But your business isn&rsquo;t generic. The
          work that wins clients for you isn&rsquo;t the work that wins for someone else. Here&rsquo;s
          the difference.
        </Reveal>

        <Reveal stagger className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Generic column */}
          <div className="bg-white border border-ink/10 rounded-[20px]" style={{ padding: '40px 36px' }}>
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-ink-light mb-[18px]">
              ChatGPT, Claude, generic AI
            </p>
            <h3 className="font-serif font-medium text-[22px] tracking-[-0.015em] mb-6 text-[#334155]">
              You&rsquo;re the one doing the work
            </h3>
            <ul className="space-y-0" role="list">
              {generic.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-[14.5px] leading-[1.55] text-ink-mid py-[14px] border-b border-ink/10 last:border-b-0"
                >
                  <span
                    className="flex-shrink-0 w-[18px] h-[18px] mt-0.5 rounded-full bg-ink/[0.06] flex items-center justify-center text-[11px] font-semibold text-ink-light"
                    aria-hidden="true"
                  >
                    —
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Sprigly column */}
          <div
            className="bg-white border border-coral/35 rounded-[20px]"
            style={{ padding: '40px 36px' }}
          >
            <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-[18px]">
              Sprigly
            </p>
            <h3 className="font-serif font-medium text-[22px] tracking-[-0.015em] mb-6 text-[#334155]">
              The work comes back already done
            </h3>
            <ul className="space-y-0" role="list">
              {sprigly.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-[14.5px] leading-[1.55] text-ink-mid py-[14px] border-b border-ink/10 last:border-b-0"
                >
                  <span
                    className="flex-shrink-0 w-[18px] h-[18px] mt-0.5 rounded-full bg-coral flex items-center justify-center text-[11px] font-semibold text-white"
                    aria-label="Yes"
                  >
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal className="mt-10 max-w-[640px]">
          <p className="text-[17px] leading-[1.6] text-white/75">
            Generic AI gives you a draft to finish. Sprigly gives you the work, done your way.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
