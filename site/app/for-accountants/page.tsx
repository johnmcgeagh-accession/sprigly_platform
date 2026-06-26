import type { Metadata } from 'next'
import SectorPage, { type SectorData } from '@/components/SectorPage'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for accountants & bookkeepers | Sprigly',
  description:
    "Sprigly takes the routine client comms and accounts commentary off your team, so you bill more of what you're actually worth.",
  alternates: { canonical: `${SITE_URL}/for-accountants` },
}

const data: SectorData = {
  eyebrow: 'For accountants & bookkeepers',
  headlinePlain: 'The client comms that eat your billable hours.',
  headlineItalic: 'Done without you.',
  subhead:
    "Sprigly takes the routine letters, commentary and chasing off your team, so you bill more of what you're actually worth.",
  pains: [
    "Onboarding packs drafted and ready the moment a new client signs.",
    "Management accounts commentary covering what moved, why, and what to watch, drafted from the numbers and ready for partner review.",
    "Records chasing sent on schedule until the client sends what's needed, without it landing back in your inbox.",
  ],
  send: ''March management accounts attached for Orchard Joinery.'',
  get: "A commentary draft in your format covering what moved, why and what to watch, ready for partner review.",
}

export default function AccountantsPage() {
  return <SectorPage data={data} />
}
