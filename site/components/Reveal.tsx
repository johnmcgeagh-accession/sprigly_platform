'use client'

import { useEffect, useRef, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  stagger?: boolean
}

export function Reveal({ children, className = '', stagger = false }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('visible')
      return
    }

    // Immediately reveal elements already in the viewport at mount time.
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight) {
      el.classList.add('visible')
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('visible')
          observer.unobserve(el)
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -40px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-reveal
      data-stagger={stagger ? 'true' : undefined}
      className={className}
    >
      {children}
    </div>
  )
}
