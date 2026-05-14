'use client'

import { useEffect, useRef, useState } from 'react'

const WORDS = [
  'proposals',
  'follow-ups',
  'blog posts',
  'social posts',
  'lead lists',
  'client updates',
  'case studies',
  'cold emails',
  'meeting prep',
  'prospect research',
]

const TYPING_SPEED = 65
const DELETE_SPEED = 40
const HOLD_MS = 1400

export default function RotatingWord() {
  const [displayed, setDisplayed] = useState('')
  const [reduced, setReduced] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)
  const s = useRef({
    wordIdx: 0,
    charIdx: 0,
    phase: 'typing' as 'typing' | 'holding' | 'deleting',
    active: false,
    timer: null as ReturnType<typeof setTimeout> | null,
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches) {
      setReduced(true)
      setDisplayed(WORDS[0])
      return
    }

    function tick() {
      const cur = s.current
      if (!cur.active) return
      const word = WORDS[cur.wordIdx]

      if (cur.phase === 'typing') {
        cur.charIdx++
        setDisplayed(word.slice(0, cur.charIdx))
        if (cur.charIdx >= word.length) {
          cur.phase = 'holding'
          cur.timer = setTimeout(tick, HOLD_MS)
        } else {
          cur.timer = setTimeout(tick, TYPING_SPEED)
        }
      } else if (cur.phase === 'holding') {
        cur.phase = 'deleting'
        cur.timer = setTimeout(tick, DELETE_SPEED)
      } else {
        cur.charIdx--
        setDisplayed(word.slice(0, cur.charIdx))
        if (cur.charIdx <= 0) {
          cur.wordIdx = (cur.wordIdx + 1) % WORDS.length
          cur.phase = 'typing'
          cur.timer = setTimeout(tick, TYPING_SPEED * 2)
        } else {
          cur.timer = setTimeout(tick, DELETE_SPEED)
        }
      }
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const cur = s.current
        if (entry.isIntersecting && !cur.active) {
          cur.active = true
          tick()
        } else if (!entry.isIntersecting && cur.active) {
          cur.active = false
          if (cur.timer) clearTimeout(cur.timer)
        }
      },
      { threshold: 0.1 }
    )

    if (containerRef.current) observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      s.current.active = false
      if (s.current.timer) clearTimeout(s.current.timer)
    }
  }, [])

  return (
    <span
      ref={containerRef}
      aria-live="polite"
      aria-atomic="true"
      style={{
        display: 'inline-block',
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: 700,
        minWidth: '12ch',
        textAlign: 'left',
      }}
    >
      {displayed}
      {!reduced && <span className="rotating-word-cursor" aria-hidden="true" />}
    </span>
  )
}
