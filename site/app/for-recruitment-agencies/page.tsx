import type { Metadata } from 'next'
import SectorPage, { type SectorData } from '@/components/SectorPage'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for recruitment agencies | Sprigly',
  description:
    "Sprigly handles the CV formatting, candidate summaries and client updates between placements, so you stay responsive without burning your evenings.",
  alternates: { canonical: `${SITE_URL}/for-recruitment-agencies` },
}

const data: SectorData = {
  eyebrow: 'For recruitment agencies',
  headlinePlain: 'CVs formatted. Summaries written. Clients updated.',
  headlineItalic: "While you're on the phone.",
  subhead:
    "Sprigly handles the admin between placements so you can stay responsive without burning your evenings.",
  pains: [
    "Every candidate's CV reformatted into your template before it goes to a client. No copy-pasting.",
    "Shortlist summaries written in your voice, covering what the client actually wants to know.",
    "Progress updates drafted and ready to send while you're focused on the search.",
  ],
  send: '"Three CVs attached for the Henley FD role. Client is BrightPay."',
  get: "Three formatted CVs in your template plus a shortlist summary email in your voice, ready to send.",
}

export default function RecruitmentAgenciesPage() {
  return <SectorPage data={data} />
}
