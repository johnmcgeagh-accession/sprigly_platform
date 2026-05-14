'use client'

import { useEffect, useState } from 'react'

/*
  Intro overlay — fixed layer containing only the large leaf and Sprigly wordmark.
  The hero itself is the canvas: its h1 carries the intro-headline delayed animation,
  so there is nothing to align when the overlay fades — the real h1 is already there.

  t=0:          Coral bg visible. Large leaf mark centred (matching sprigly-hero-panel).
  t=0→0.7s:    "Sprigly" tumbles in from above.
  t=0.7→3.3s:  Sprigly held over the leaf.
  t=3.3→4.0s:  Sprigly tumbles out.
  t=4.2→5.0s:  Hero h1 tumbles in from below (via intro-headline CSS on h1).
  t=5.0→6.2s:  Overlay fades — hero fully revealed.
  t=6.4s:      Component unmounts.
*/
export function IntroOverlay() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    setActive(true)
    const t = setTimeout(() => setActive(false), 10200)
    return () => clearTimeout(t)
  }, [])

  if (!active) return null

  return (
    <div className="intro-full" aria-hidden="true">
      {/* Large sprig mark — visible from frame 0, behind the Sprigly wordmark */}
      <svg
        className="intro-leaf-bg"
        viewBox="0 0 100 110"
        aria-hidden="true"
      >
        <path d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z" fill="white" fillOpacity="0.40" />
        <path d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z" fill="white" fillOpacity="0.32" />
        <line x1="50" y1="76" x2="50" y2="98" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.40" />
      </svg>
      {/* Sprigly wordmark — tumbles in from above, holds, folds out downward */}
      <p className="intro-sprigly">Sprigly</p>
    </div>
  )
}
