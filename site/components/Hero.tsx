import Link from 'next/link'
import { BOOKING_URL } from '@/lib/config'
import RotatingWord from './RotatingWord'
import { HeroIntro } from './HeroIntro'

/*
  RIPPLE_MARK — leaf silhouette derived from the Sprigly mark, centred at (0,0).
  The Sprigly mark has two leaf petals meeting at a point (top: y=10, bottom: y=76)
  in a 100×110 viewBox, centred at roughly (50, 43). Scaled ×5 and recentred here
  so the ripple rings match the earlier viewport scale.
  Spans: ±130 x, ±165 y — pointed at both top and bottom.
*/
const RIPPLE_MARK =
  'M 0,-165 ' +
  'C -70,-155 -130,-85 -130,5 ' +
  'C -130,85 -70,155 0,165 ' +
  'C 70,155 130,85 130,5 ' +
  'C 130,-85 70,-155 0,-165 Z'

export default function Hero() {
  return (
    <section
      data-hero
      className="relative min-h-svh overflow-hidden text-white"
      style={{
        background: 'linear-gradient(160deg, #FF9080 0%, #FF6F62 40%, #E85040 100%)',
      }}
    >
      {/*
        Ripple SVG — full viewport, pointer-events off.
        Double-wrapper pattern: outer <g> translates to leaf position via SVG attr
        (y=300 puts rings behind the leaf mark area at the top of the content column);
        inner <g> elements get CSS animations only, no SVG transform, so
        CSS transform-origin works from the ring's own centre.
      */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="hero-ripple-svg absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        <g transform="translate(720,340)">
          {[1, 2, 3, 4, 5].map((n) => (
            <g key={n} className={`hero-ripple hero-ripple-${n}`}>
              <path
                d={RIPPLE_MARK}
                fill="none"
                stroke="white"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </g>
      </svg>

      {/* Intro animation — scoped to the hero, clipped by overflow-hidden */}
      <HeroIntro />

      {/* Large decorative leaf mark — permanent background, same position as intro overlay leaf */}
      {/*<div className="hero-leaf-large" aria-hidden="true">
        <svg viewBox="0 0 100 110">
          <path d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z" fill="white" fillOpacity="0.40" />
          <path d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z" fill="white" fillOpacity="0.32" />
          <line x1="50" y1="76" x2="50" y2="98" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.40" />
        </svg>
      </div>*/}

      {/* Content column — perspective enables rotateX on the h1 intro animation */}
      <div className="relative z-10 min-h-svh flex flex-col items-center justify-center text-center px-6 pb-20 pt-28" style={{ perspective: '900px' }}>

        {/* Sprigly mark — sits above the headline, origins the ripple visually */}
       {/* <div className="hero-leaf mb-7" aria-hidden="true">
          <svg width="48" height="54" viewBox="0 0 100 110">
            <path
              d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z"
              fill="white"
              fillOpacity="0.45"
            />
            <path
              d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z"
              fill="white"
              fillOpacity="0.36"
            />
            <line
              x1="50" y1="76" x2="50" y2="98"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeOpacity="0.45"
            />
          </svg>
        </div>*/}

        {/* Headline — hidden until Sprigly exits, then tumbles in via intro-headline animation */}
        <h1
          className="intro-headline font-serif font-normal tracking-[-0.025em] text-white max-w-[800px]"
          style={{
            fontSize: 'clamp(42px, 6vw, 82px)',
            lineHeight: 1.05,
            textShadow: '0 2px 32px rgba(0,0,0,0.22)',
          }}
        >
          More capacity.{' '}
          <em className="fraunces-soft">Without</em>{' '}
          the next hire.
        </h1>

        {/* Subheadline */}
        <p
          className="hero-sub mt-6 text-white/88 max-w-[600px]"
          style={{
            fontSize: 'clamp(16px, 1.8vw, 20px)',
            lineHeight: 1.55,
            textShadow: '0 1px 16px rgba(0,0,0,0.16)',
          }}
        >
          Sprigly learns how your business works: your voice, your formats, the standards only your people know. Send it a brief, or let it spot the work itself. Your Sprigly agents deliver the{' '}
          <RotatingWord />
        </p>

        {/* Supporting line */}
        <p
          className="hero-support mt-3 text-white/60"
          style={{ fontSize: '14px' }}
        >
          Built for founder-led agencies. 
        </p>

        {/* CTA */}
        <div className="hero-cta mt-9 flex flex-col items-center gap-3">
          <Link
            href={BOOKING_URL}
            className="inline-flex items-center gap-[10px] px-8 py-[14px] bg-white text-coral-deep rounded-lg font-semibold text-[15px] transition-all duration-200 hover:-translate-y-px"
            style={{ boxShadow: '0 4px 28px rgba(0,0,0,0.22)' }}
          >
            Get started
            <ArrowIcon />
          </Link>
          <p className="text-white/55 text-[13px]">Book a free 20 minute discovery call. </p>
        </div>
      </div>
    </section>
  )
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
