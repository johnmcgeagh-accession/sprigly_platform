import { Reveal } from './Reveal'

const agents = [
  { name: 'Research',        status: 'Analysing brief…',    delay: '0s'    },
  { name: 'Brand Voice',     status: 'Adapting tone…',      delay: '0.15s' },
  { name: 'Proposal Writer', status: 'Drafting sections…',  delay: '0.30s' },
  { name: 'QA / Fact Check', status: 'Reviewing output…',   delay: '0.45s' },
]

const docLines = [0.88, 0.72, 0.94, 0.65, 0.80, 0.55, 0.76]

export default function HowItWorks() {
  return (
    <section
      id="how"
      className="py-[100px] px-6 md:px-12"
      style={{
        background: 'linear-gradient(to bottom, #FFE4D8 0%, #FCFAF6 100px, #FCFAF6 100%)',
      }}
    >
      <div className="max-w-[1100px] mx-auto">

        {/* Workflow panel */}
        <Reveal className="max-w-[680px] mx-auto">

          {/* Step indicators */}
          <div className="flex gap-0 mb-6">
            {[
              { n: '01', label: 'Email brief sent',    dotCls: 'hw-dot-1', barCls: 'hw-bar-1' },
              { n: '02', label: 'AI agents working',   dotCls: 'hw-dot-2', barCls: 'hw-bar-2' },
              { n: '03', label: 'Deliverable ready',    dotCls: 'hw-dot-3', barCls: 'hw-bar-3' },
            ].map(({ n, label, dotCls, barCls }) => (
              <div key={n} className={`flex-1 px-3 first:pl-0 last:pr-0 ${dotCls}`}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-light mb-1">
                  {n}
                </p>
                <p className="text-[13px] font-medium text-ink mb-2 leading-tight">{label}</p>
                <div className="h-[2px] bg-ink/[0.08] rounded-full overflow-hidden">
                  <div className={`h-full bg-coral rounded-full ${barCls}`} style={{ width: '0%' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Animation container */}
          <div
            className="relative overflow-hidden rounded-2xl border border-ink/[0.07]"
            style={{
              height: '400px',
              background: 'white',
              boxShadow: '0 2px 24px rgba(31,26,24,0.07)',
            }}
          >

            {/* ── Step 1: Email brief ── */}
            <div className="hw-step-1 absolute inset-0 p-7 flex flex-col">
              <div className="flex-grow rounded-xl border border-ink/[0.07] bg-[#F9F7F4] p-6 flex flex-col">
                {/* Email header */}
                <div className="flex items-center gap-3 pb-4 mb-4 border-b border-ink/[0.07]">
                  <div className="w-9 h-9 rounded-full bg-coral/[0.12] flex items-center justify-center text-[15px]">
                    ✉
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.10em] text-ink-light">New brief</p>
                    <p className="text-[13px] font-semibold text-ink">workspace@sprigly.co.uk</p>
                  </div>
                </div>
                {/* Email meta */}
                <p className="text-[12px] text-ink-mid mb-4">
                  <span className="font-medium text-ink">Subject:</span>{' '}
                  Client project brief: TechCorp digital ops
                </p>
                {/* Email body */}
                <div className="text-[13px] text-ink-mid leading-[1.65] flex-grow">
                  <p>Hi team,</p>
                  <p className="mt-2">
                    We need a brief for TechCorp by Thursday. Budget £45k,
                    focus on digital operations. Meeting notes attached.
                  </p>
                </div>
                {/* Sent badge */}
                <div className="mt-5 flex justify-end">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-full">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Brief sent
                  </span>
                </div>
              </div>
            </div>

            {/* ── Step 2: AI agents working ── */}
            <div className="hw-step-2 absolute inset-0 p-7 flex flex-col">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-light mb-4">
                Working on: TechCorp brief
              </p>
              <div className="grid grid-cols-2 gap-3 flex-grow">
                {agents.map((agent) => (
                  <div
                    key={agent.name}
                    className="bg-[#F9F7F4] rounded-xl border border-ink/[0.07] p-4 flex flex-col"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[12px] font-semibold text-ink">{agent.name}</p>
                      <div className="flex gap-1">
                        {[0, 1, 2].map((d) => (
                          <div
                            key={d}
                            className="agent-dot w-[5px] h-[5px] rounded-full bg-coral"
                            style={{ animationDelay: `calc(${agent.delay} + ${d * 0.3}s)` }}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="text-[11px] text-ink-mid flex-grow">{agent.status}</p>
                    <div className="mt-3 h-[3px] bg-coral/[0.14] rounded-full overflow-hidden">
                      <div
                        className="agent-progress h-full bg-coral rounded-full"
                        style={{ animationDelay: agent.delay, width: '0%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Step 3: Proposal delivered ── */}
            <div className="hw-step-3 absolute inset-0 p-7 flex flex-col">
              <div className="flex-grow rounded-xl border border-ink/[0.07] bg-[#F9F7F4] p-6 flex flex-col overflow-hidden">
                {/* Doc header */}
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-ink/[0.07]">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-coral/[0.14] flex items-center justify-center">
                      <div className="w-3 h-3 rounded-sm bg-coral/60" />
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                      Sprigly
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-2.5 py-1 rounded-full">
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Ready to send
                  </span>
                </div>
                {/* Doc title */}
                <p className="text-[10px] uppercase tracking-[0.12em] text-ink-light mb-1">Report</p>
                <p className="font-serif text-[18px] font-medium text-ink leading-tight mb-1">
                  Digital Operations Transformation
                </p>
                <p className="text-[12px] text-ink-mid mb-5">
                  Prepared for TechCorp · May 2026
                </p>
                {/* Fake text body */}
                <div className="space-y-[7px]">
                  {docLines.map((w, i) => (
                    <div
                      key={i}
                      className="h-[7px] bg-ink/[0.08] rounded-full"
                      style={{ width: `${w * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* Outcome line */}
          <p
            className="text-center mt-10 font-serif italic text-ink-mid"
            style={{ fontSize: 'clamp(15px, 1.6vw, 18px)' }}
          >
            A 3–5 hour job, done in under 60 minutes.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
