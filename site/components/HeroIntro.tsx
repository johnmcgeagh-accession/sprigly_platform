'use client'

import { useEffect, useState } from 'react'

export function HeroIntro() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    setActive(true)
    const t = setTimeout(() => setActive(false), 10200)
    return () => clearTimeout(t)
  }, [])

  if (!active) return null

  return (
    <div
      className="intro-wrapper"
      aria-hidden="true"
    >
      {/* Leaf mark — visible from frame 0, fades with the wrapper */}
      <svg className="intro-leaf-bg" viewBox="0 0 100 110" aria-hidden="true">
        <path
          d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z"
          fill="white" fillOpacity="0.40"
        />
        <path
          d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z"
          fill="white" fillOpacity="0.32"
        />
        <line x1="50" y1="76" x2="50" y2="98" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.40" />
      </svg>

      {/* Sprigly wordmark — folds in then out via introSprigly */}
      <p className="intro-sprigly">Sprigly</p>
    </div>
  )
}
