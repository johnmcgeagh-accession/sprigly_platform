'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Reveal } from './Reveal'

const cards = [
  {
    num: '1',
    title: 'You hand it off',
    body: "Brief it the way you'd brief a colleague, by email, text or Slack. Or tag a subject line, like Proposal: or Prospect:, and send it on. The work comes back done.",
  },
  {
    num: '2',
    title: 'It picks the work up for you',
    body: 'Forward the jobs you want handled to a dedicated Sprigly inbox, and Sprigly takes them from there.',
  },
  {
    num: '3',
    title: 'It watches for the work',
    body: "Tell it once how you want things handled. Sprigly watches the inbox, does the work your way, and waits for your okay before anything goes out.",
  },
]

function SprigLeaf({ color = '#FF6F62' }: { color?: string }) {
  return (
    <svg width="36" height="40" viewBox="0 0 100 110" aria-hidden="true">
      <path
        d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z"
        fill={color}
        opacity={0.9}
      />
      <path
        d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z"
        fill={color}
        opacity={0.65}
      />
      <line x1="50" y1="76" x2="50" y2="98" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity={0.8} />
    </svg>
  )
}

function Stage1({ paused }: { paused: boolean }) {
  const ps = paused ? 'paused' : 'running'
  return (
    <div
      className="tw-stage"
      aria-label="You hand it off: brief sent, trained engine works, work returned ready to approve"
    >
      {/* Frame 1: Brief composed */}
      <div className="tw-frame tw-frame-1" style={{ animationPlayState: ps }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          <div className="tw-email-card">
            <div className="tw-email-label">To: Sprigly</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 0',
                borderBottom: '1px solid rgba(31,26,24,0.07)',
              }}
            >
              <span style={{ color: '#FF6F62', fontWeight: 700, fontSize: 12 }}>Proposal:</span>
              <span style={{ fontSize: 13, color: '#1F1A18', fontWeight: 500 }}>Acme brief</span>
            </div>
            <div className="tw-email-body">Same format as Brighton. 3-month proposal.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <span className="tw-pill-coral">Send ↗</span>
            </div>
          </div>
        </div>
      </div>

      {/* Frame 2: Engine working */}
      <div className="tw-frame tw-frame-2" style={{ animationPlayState: ps }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <SprigLeaf />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1F1A18', marginBottom: 12 }}>
            Your agents working…
          </div>
          <div className="tw-progress-track" style={{ width: 200, margin: '0 auto' }}>
            <div className="tw-progress-bar" style={{ animationPlayState: ps }} />
          </div>
          <div style={{ fontSize: 12, color: '#8A7E78', marginTop: 10 }}>
            Checking your past work
          </div>
        </div>
      </div>

      {/* Frame 3: Ready to approve */}
      <div className="tw-frame tw-frame-3" style={{ animationPlayState: ps }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          <div className="tw-done-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="tw-check-circle-white">✓</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Acme Proposal</span>
            </div>
            <div
              style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)', marginBottom: 18, lineHeight: 1.55 }}
            >
              Ready to approve · Matches your Brighton format
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="tw-pill-white-ghost">Review</span>
              <span className="tw-pill-white">Approve →</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stage2({ paused }: { paused: boolean }) {
  const ps = paused ? 'paused' : 'running'
  return (
    <div
      className="tw-stage"
      aria-label="It picks the work up: job forwarded to inbox, Sprigly works, draft ready"
    >
      {/* Frame 1: Job arrives in inbox */}
      <div className="tw-frame tw-frame-1" style={{ animationPlayState: ps }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#8A7E78',
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              marginBottom: 12,
            }}
          >
            Sprigly inbox
          </div>
          <div className="tw-inbox-row">
            <span className="tw-forward-badge">→</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1F1A18' }}>
                Follow-up: Smith &amp; Co
              </div>
              <div style={{ fontSize: 12, color: '#8A7E78', marginTop: 2 }}>Forwarded from you</div>
            </div>
          </div>
        </div>
      </div>

      {/* Frame 2: Sprigly working */}
      <div className="tw-frame tw-frame-2" style={{ animationPlayState: ps }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <SprigLeaf />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1F1A18', marginBottom: 12 }}>
            On it.
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 7 }}>
            <span className="tw-dot tw-dot-1" />
            <span className="tw-dot tw-dot-2" />
            <span className="tw-dot tw-dot-3" />
          </div>
          <div style={{ fontSize: 12, color: '#8A7E78', marginTop: 10 }}>Follow-up: Smith &amp; Co</div>
        </div>
      </div>

      {/* Frame 3: Draft waiting */}
      <div className="tw-frame tw-frame-3" style={{ animationPlayState: ps }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          <div
            className="tw-inbox-row"
            style={{ border: '1.5px solid rgba(30,42,74,0.18)', background: 'rgba(30,42,74,0.03)' }}
          >
            <span className="tw-check-coral-sm">✓</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1F1A18' }}>
                Follow-up: Smith &amp; Co
              </div>
              <div style={{ fontSize: 12, color: '#8A7E78', marginTop: 2 }}>
                Draft ready · Waiting in your inbox
              </div>
            </div>
            <span className="tw-pill-coral-sm">Open →</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stage3({ paused }: { paused: boolean }) {
  const ps = paused ? 'paused' : 'running'
  return (
    <div
      className="tw-stage"
      aria-label="It watches for the work: inbox watched, job spotted, pauses for your approval before sending"
    >
      {/* Frame 1: Watching */}
      <div className="tw-frame tw-frame-1" style={{ animationPlayState: ps }}>
        <div style={{ width: '100%', maxWidth: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
            <span className="tw-watch-dot" style={{ animationPlayState: ps }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1F1A18' }}>
              Watching your inbox
            </span>
          </div>
          <div className="tw-rule-row">
            <span style={{ color: '#FF6F62', fontWeight: 700, fontSize: 12 }}>Proposal:</span>
            <span style={{ fontSize: 12, color: '#5C4F4A' }}>draft proposal</span>
          </div>
          <div className="tw-rule-row">
            <span style={{ color: '#FF6F62', fontWeight: 700, fontSize: 12 }}>Prospect:</span>
            <span style={{ fontSize: 12, color: '#5C4F4A' }}>create intro pack</span>
          </div>
        </div>
      </div>

      {/* Frame 2: Match found */}
      <div className="tw-frame tw-frame-2" style={{ animationPlayState: ps }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          <div className="tw-email-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <span className="tw-forward-badge">→</span>
              <span style={{ color: '#FF6F62', fontWeight: 700, fontSize: 12 }}>Proposal:</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#1F1A18' }}>
                Taylor &amp; Partners
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#5C4F4A', marginBottom: 10 }}>
              Match found · Working
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="tw-dot tw-dot-1" />
              <span className="tw-dot tw-dot-2" />
              <span className="tw-dot tw-dot-3" />
            </div>
          </div>
        </div>
      </div>

      {/* Frame 3: Awaiting approval */}
      <div className="tw-frame tw-frame-3" style={{ animationPlayState: ps }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          <div className="tw-approval-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>⏸</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1F1A18' }}>
                Ready, waiting for your okay
              </span>
            </div>
            <div
              style={{ fontSize: 12, color: '#5C4F4A', marginBottom: 18, lineHeight: 1.55 }}
            >
              Draft prepared. Won't go out until you say so.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="tw-pill-ghost">Discard</span>
              <span className="tw-pill-coral">Send ↗</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const STAGES = [Stage1, Stage2, Stage3]

export default function ThreeWays() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setPaused(!entry.isIntersecting),
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    let next = idx
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      next = (idx + 1) % cards.length
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      next = (idx - 1 + cards.length) % cards.length
    } else {
      return
    }
    setActive(next)
    cardRefs.current[next]?.focus()
  }, [])

  const ActiveStage = STAGES[active]

  return (
    <section
      ref={sectionRef}
      id="three-ways"
      className="py-[100px] md:py-[130px] px-6 md:px-12 bg-paper border-b border-ink/10"
    >
      <div className="max-w-[1100px] mx-auto">
        <Reveal className="max-w-[700px] mb-14">
          <p className="text-2xs font-medium uppercase tracking-[0.15em] text-coral mb-5">
            How it works
          </p>
          <h2
            className="font-serif font-normal tracking-[-0.025em] text-ink"
            style={{ fontSize: 'clamp(32px, 4vw, 52px)', lineHeight: 1.1 }}
          >
            Three ways to hand work off.{' '}
            <em className="fraunces-soft text-coral">You're always in control.</em>
          </h2>
        </Reveal>

        <div className="tw-layout">
          {/* Cards */}
          <div className="tw-cards" role="tablist" aria-label="Handoff modes">
            {cards.map((card, i) => (
              <button
                key={i}
                ref={(el) => { cardRefs.current[i] = el }}
                role="tab"
                aria-selected={i === active}
                aria-controls={`tw-panel-${i}`}
                id={`tw-tab-${i}`}
                className="tw-card"
                data-active={i === active ? 'true' : 'false'}
                tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(e) => handleKeyDown(e, i)}
              >
                <span
                  className="tw-card-num"
                  style={{ color: i === active ? '#FF6F62' : '#8A7E78' }}
                >
                  {card.num}
                </span>
                <div>
                  <div className="tw-card-title">{card.title}</div>
                  <div className="tw-card-body">{card.body}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Stage panel */}
          <div
            id={`tw-panel-${active}`}
            role="tabpanel"
            aria-labelledby={`tw-tab-${active}`}
            className="tw-panel"
          >
            <ActiveStage key={active} paused={paused} />
          </div>
        </div>

        <div className="mt-10">
          <Link
            href="/how-handoff-works"
            className="text-[13px] text-coral font-medium underline underline-offset-2 hover:opacity-75 transition-opacity"
          >
            See how handoff works →
          </Link>
        </div>
      </div>
    </section>
  )
}
