import { Reveal } from './Reveal'

export default function TrustStrip() {
  return (
    <section
      className="bg-paper py-20 border-b border-ink/10 px-6 md:px-12"
      aria-label="Client testimonial"
    >
      <Reveal className="max-w-[1100px] mx-auto text-center">
        <blockquote>
          <p
            className="font-serif font-normal tracking-[-0.015em] text-ink mx-auto mb-6"
            style={{ fontSize: 'clamp(22px, 2.2vw, 28px)', lineHeight: 1.4, maxWidth: 820 }}
          >
            <span className="text-coral/70 italic font-medium">&ldquo;</span>
            I built Sprigly after years of watching small firms lose work to slow turnaround,
            not because the work was hard, but because it all sat with one or two people.
            The first agents are live with early clients now, and the first thing every founder
            says is the same: &lsquo;it actually sounds like me.&rsquo;
            <span className="text-coral/70 italic font-medium">&rdquo;</span>
          </p>
          <footer className="flex items-center justify-center gap-3 text-[13px] text-ink-mid flex-wrap gap-y-1">
            <cite className="font-serif italic text-[15px] text-ink not-italic">
              John, founder of Sprigly
            </cite>
          </footer>
        </blockquote>
      </Reveal>
    </section>
  )
}
