import { Reveal } from './Reveal'

export default function TrustStrip() {
  return (
    <section
      className="bg-paper py-20 border-b border-ink/10 px-6 md:px-12"
      aria-label="Client testimonial"
    >
      <Reveal className="max-w-[1100px] mx-auto text-center">
        {/* Swap this testimonial when a real attributed one is available */}
        <blockquote>
          <p
            className="font-serif font-normal tracking-[-0.015em] text-ink mx-auto mb-6"
            style={{ fontSize: 'clamp(22px, 2.2vw, 28px)', lineHeight: 1.4, maxWidth: 820 }}
          >
            <span className="text-coral/70 italic font-medium">&ldquo;</span>
            Before, every proposal sat in my queue for three or four days because I was the only
            one who could write them properly. Now they come back overnight, in my voice, and I
            just edit. We&rsquo;ve signed two clients I&rsquo;d have lost to slow turnaround.
            <span className="text-coral/70 italic font-medium">&rdquo;</span>
          </p>
          <footer className="flex items-center justify-center gap-3 text-[13px] text-ink-mid flex-wrap gap-y-1">
            <cite className="font-serif italic text-[15px] text-ink not-italic">
              Founder, 14-person consultancy
            </cite>
            <span className="text-ink-light hidden sm:block" aria-hidden="true">·</span>
            <span className="font-medium">Anonymised at client&rsquo;s request</span>
          </footer>
        </blockquote>
      </Reveal>
    </section>
  )
}
