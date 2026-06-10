import type { Metadata } from 'next'
import SectorPage, { type SectorData } from '@/components/SectorPage'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for recruitment agencies | Sprigly',
  description:
    "Sprigly does the admin between placements — CV formatting, candidate summaries, client updates — so you stay responsive without burning your evenings.",
  alternates: { canonical: `${SITE_URL}/for-recruitment-agencies` },
}

const data: SectorData = {
  eyebrow: 'For recruitment agencies',
  headlinePlain: 'CVs formatted. Summaries written. Clients updated.',
  headlineItalic: "While you're on the phone.",
  subhead:
    "Sprigly does the admin between placements — so you stay responsive without burning your evenings.",
  pains: [
    "CV reformatting — every candidate's CV in your template before it goes to a client, without the copy-paste.",
    "Candidate summaries — shortlist notes in your voice, covering what the client actually wants to know.",
    "Client update emails — progress updates drafted and ready to send while you're focused on the search.",
  ],
  send: '“Three CVs attached for the Henley FD role. Client is BrightPay.”',
  get: "Three formatted CVs in your template plus a shortlist summary email in your voice, ready to send.",
}

export default function RecruitmentAgenciesPage() {
  return <SectorPage data={data} />
}
