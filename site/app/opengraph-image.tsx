import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Sprigly: AI agents trained on the way your business actually works'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#FF6F62',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 25% 25%, rgba(255,220,200,0.20) 0%, transparent 50%), radial-gradient(ellipse at 75% 75%, rgba(122,31,34,0.20) 0%, transparent 55%)',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              color: 'white',
              fontSize: 66,
              lineHeight: 1.05,
              letterSpacing: '-0.025em',
              marginBottom: 36,
              fontFamily: 'Georgia, serif',
              fontWeight: 400,
            }}
          >
            More capacity.<br />Without the next hire.
          </div>
          <div
            style={{
              color: 'white',
              opacity: 0.9,
              fontSize: 26,
              fontFamily: 'Arial, sans-serif',
              fontWeight: 400,
              maxWidth: 660,
              lineHeight: 1.4,
              marginBottom: 56,
            }}
          >
            AI agents for founder-led businesses. Built around how your business actually works.
          </div>
          <div
            style={{
              color: 'white',
              fontSize: 34,
              letterSpacing: '-0.02em',
              fontFamily: 'Georgia, serif',
              fontWeight: 500,
              opacity: 0.9,
            }}
          >
            Sprigly
          </div>
        </div>
      </div>
    ),
    size
  )
}
