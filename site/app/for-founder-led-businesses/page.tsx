import type { Metadata } from 'next'
import SectorPage, { type SectorData } from '@/components/SectorPage'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for founder-led businesses | Sprigly',
  description:
    "Sprigly learns exactly how your business works and takes on whatever’s taking most of your time: briefs, proposals, research, client comms.",
  alternates: { canonical: `${SITE_URL}/for-founder-led-businesses` },
}

const data: SectorData = {
  eyebrow: 'For founder-led businesses',
  headlinePlain: 'The work only you can write.',
  headlineItalic: 'Turned around in hours, not days.',
  subhead:
    "Sprigly learns exactly how your business works and takes on whatever’s taking most of your time.",
  pains: [
    "The documents that sit in your queue — briefs, proposals, reports that need your voice and your standards before they go anywhere.",
    "Research and prep — background on who you’re meeting and what they care about, ready before you walk in.",
    "Client comms — updates and follow-ups in your tone, ready to send or hold.",
  ],
  send: '“Brief me on Acme Ltd. Meeting their MD Tuesday at 10.”',
  get: "A two-page brief: company background, recent news, the MD’s role and likely priorities, three angles to lead with.",
  disclaimer:
    "The discovery call exists because every business is different. Twenty minutes, and we’ll tell you what we’d build — or that it isn’t a fit.",
}

export default function FounderLedPage() {
  return <SectorPage data={data} />
}
