'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BOOKING_URL } from '@/lib/config'

const NAV_LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '/how-handoff-works', label: 'How handoff works' },
  { href: '#outputs', label: 'What you get' },
  { href: '#start', label: 'Get started' },
]

function SpriglyMark({ scrolled }: { scrolled: boolean }) {
  const color = scrolled ? '#FF6F62' : 'white'
  return (
    <svg viewBox="0 0 100 110" className="w-[22px] h-[24px] flex-shrink-0" aria-hidden="true">
      <path
        d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z"
        fill={color}
      />
      <path
        d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z"
        fill={color}
        opacity={0.78}
      />
      <line x1="50" y1="76" x2="50" y2="98" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const hero = document.querySelector('[data-hero]')
    if (!hero) return
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0.1 }
    )
    observer.observe(hero)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-[22px] md:px-12 transition-all duration-200 ${
          scrolled
            ? 'bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.07)]'
            : 'bg-transparent'
        }`}
        aria-label="Main navigation"
      >
        <Link
          href="/"
          className={`flex items-center gap-[10px] text-[22px] tracking-[-0.025em] transition-colors duration-200 no-underline ${
            scrolled ? 'text-coral' : 'text-white'
          }`}
          style={{ fontFamily: 'var(--font-jakarta)', fontWeight: 800 }}
          aria-label="Sprigly — home"
        >
          <SpriglyMark scrolled={scrolled} />
          Sprigly
        </Link>

        <div className="flex items-center gap-8 text-sm font-normal">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`transition-all duration-200 hover:opacity-100 hidden md:block ${
                scrolled ? 'text-[#334155] opacity-70' : 'text-white opacity-80'
              }`}
            >
              {label}
            </Link>
          ))}

          <Link
            href={BOOKING_URL}
            className={`px-[18px] py-[10px] rounded-lg text-[13px] font-medium transition-all duration-200 hover:-translate-y-px hidden md:inline-flex ${
              scrolled
                ? 'bg-coral text-white'
                : 'border border-white/70 text-white hover:bg-white/10'
            }`}
          >
            Book a discovery call
          </Link>

          <button
            className={`md:hidden flex items-center justify-center w-10 h-10 -mr-2 transition-colors duration-200 ${
              scrolled ? 'text-[#334155]' : 'text-white'
            }`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
          >
            {menuOpen ? (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d="M17 5L5 17M5 5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d="M3 6H19M3 11H19M3 16H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      <div
        id="mobile-menu"
        className={`fixed inset-0 z-40 md:hidden flex flex-col transition-opacity duration-200 ${
          menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: scrolled ? 'rgba(255,255,255,0.97)' : 'rgba(232,80,64,0.97)' }}
        aria-hidden={!menuOpen}
      >
        <div className="h-[80px] flex-shrink-0" />
        <nav className="flex flex-col px-6 pt-8 pb-12 gap-1 flex-1" aria-label="Mobile navigation">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-[24px] font-medium tracking-[-0.02em] py-3 border-b last:border-0 ${
                scrolled ? 'text-[#334155] border-[#334155]/10' : 'text-white border-white/15'
              }`}
              onClick={closeMenu}
            >
              {label}
            </Link>
          ))}
          <div className="mt-8">
            <Link
              href={BOOKING_URL}
              className={`inline-flex items-center gap-[10px] px-7 py-4 rounded-lg font-medium text-[15px] transition-all duration-200 ${
                scrolled
                  ? 'bg-coral text-white'
                  : 'border border-white/70 text-white hover:bg-white/10'
              }`}
              onClick={closeMenu}
            >
              Book a discovery call
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </Link>
          </div>
        </nav>
      </div>
    </>
  )
}
