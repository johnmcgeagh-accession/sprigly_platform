export const dynamic = 'force-dynamic';

export default function Expired() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#F8F9FB', color: '#1E2A4A' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 26 }}>This link has expired</div>
        <p style={{ color: '#5B647A', fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>
          Your link is no longer active &mdash; it may have expired or been replaced. Ask Sprigly for a
          fresh one and you&rsquo;ll be straight back in.
        </p>
      </div>
    </main>
  );
}
