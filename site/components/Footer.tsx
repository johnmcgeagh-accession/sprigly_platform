import Link from 'next/link'

function SpriglyMark() {
  return (
    <svg
      viewBox="0 0 100 110"
      className="w-[20px] h-[22px] flex-shrink-0"
      aria-hidden="true"
    >
      <path
        d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z"
        fill="white"
      />
      <path
        d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z"
        fill="white"
        opacity={0.78}
      />
      <line
        x1="50" y1="76" x2="50" y2="98"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function Footer() {
  return (
    <footer className="bg-coral-shadow text-peach px-6 md:px-12 pt-[100px] pb-10">
      <div className="max-w-[1200px] mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1fr] gap-12 mb-14">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1 max-w-[320px]">
            <Link
              href="/"
              className="flex items-center gap-[10px] font-serif text-[22px] font-medium tracking-[-0.02em] text-white no-underline"
              aria-label="Sprigly — home"
            >
              <SpriglyMark />
              Sprigly
            </Link>
            <p className="font-serif italic font-normal text-[17px] leading-[1.4] mt-[14px] text-peach/70">
              AI agents trained on the way your business actually works.
            </p>
          </div>

          {/* Product */}
          <nav aria-label="Product links">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-peach/75 mb-[18px]">
              Product
            </h3>
            <Link href="#outputs" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">Research &amp; prep</Link>
            <Link href="#outputs" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">Proposals &amp; docs</Link>
            <Link href="#outputs" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">Quality control</Link>
            <Link href="#outputs" className="block text-sm text-peach/78 hover:text-white transition-colors">Reporting</Link>
          </nav>

          {/* Company */}
          <nav aria-label="Company links">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-peach/75 mb-[18px]">
              Company
            </h3>
            <Link href="#how" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">How it works</Link>
            <Link href="#compare" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">Why Sprigly</Link>
            <Link href="/about" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">About</Link>
            <Link href="/book" className="block text-sm text-peach/78 hover:text-white transition-colors">Contact</Link>
          </nav>

          {/* Resources */}
          <nav aria-label="Resources links">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-peach/75 mb-[18px]">
              Resources
            </h3>
            <Link href="/book" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">Book a discovery call</Link>
            <Link href="/blog" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">Field notes</Link>
            <Link href="/privacy" className="block text-sm text-peach/78 mb-[10px] hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="block text-sm text-peach/78 hover:text-white transition-colors">Terms</Link>
          </nav>
        </div>

        <div
          className="flex flex-col md:flex-row justify-between items-center gap-3 pt-8 border-t"
          style={{ borderColor: 'rgba(255,232,221,0.15)' }}
        >
          <div className="text-[13px] text-peach/65">&copy; 2026 Sprigly Ltd. Registered in England.</div>
          <div className="text-[13px] text-peach/65">
            <a href="mailto:hello@sprigly.co.uk" className="hover:text-peach transition-colors">
              hello@sprigly.co.uk
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
