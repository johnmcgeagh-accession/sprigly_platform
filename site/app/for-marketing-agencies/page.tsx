import type { Metadata } from 'next'
import SectorPage, { type SectorData } from '@/components/SectorPage'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for marketing & creative agencies | Sprigly',
  description:
    "Sprigly writes the proposals, updates and case studies, so your team spends more time on the work clients actually pay for.",
  alternates: { canonical: `${SITE_URL}/for-marketing-agencies` },
}

const data: SectorData = {
  eyebrow: 'For marketing & creative agencies',
  headlinePlain: 'Proposals, status reports, case studies.',
  headlineItalic: 'The words about the work, done.',
  subhead:
    "Sprigly writes the proposals, updates, and case studies. Your team gets on with the actual work.",
  pains: [
    "Proposals built from your past work and pricing, so the pitch is ready before the brief goes cold.",
    "Client-facing status reports drafted every Friday in your format, without the Friday scramble.",
    "Case studies written up while the results are still fresh, ready for the next pitch deck.",
  ],
  send: '"Proposal for a 6-month social retainer, similar shape to the Harbour deal."',
  get: "A full proposal in your format and pricing structure, drafted from your past work.",
}

export default function MarketingAgenciesPage() {
  return <SectorPage data={data} />
}
