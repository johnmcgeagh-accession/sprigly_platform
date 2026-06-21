import type { Metadata } from 'next'
import SectorPage, { type SectorData } from '@/components/SectorPage'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for estate & lettings agents | Sprigly',
  description:
    "Sprigly handles the property descriptions, tenancy renewals and landlord reports, so your team can focus on the business, not the admin.",
  alternates: { canonical: `${SITE_URL}/for-estate-agents` },
}

const data: SectorData = {
  eyebrow: 'For estate & lettings agents',
  headlinePlain: 'Property descriptions, renewals, landlord reports.',
  headlineItalic: 'Off the team’s plate.',
  subhead:
    'Sprigly takes the paperwork off your team so you can focus on the viewings, the deals and the clients.',
  pains: [
    'Property descriptions written for every new instruction in your house style, with portal variants ready to post.',
    'Tenancy renewal letters sent to the right tenants at the right time, in your format and voice.',
    'Monthly landlord reports drafted and ready for your review, in the format landlords expect.',
  ],
  send: '‘14 Mill Lane, 3-bed semi, photos attached, available March.’',
  get: 'A listing description in your house style, plus the portal variants, ready to post.',
}

export default function EstateAgentsPage() {
  return <SectorPage data={data} />
}
