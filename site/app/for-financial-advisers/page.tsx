import type { Metadata } from 'next'
import SectorPage, { type SectorData } from '@/components/SectorPage'
import { SITE_URL } from '@/lib/config'

export const metadata: Metadata = {
  title: 'AI agents for financial advisers | Sprigly',
  description:
    "Sprigly drafts the suitability reports and review letters. You sign off every one before it goes to a client. Built for FCA-regulated firms.",
  alternates: { canonical: `${SITE_URL}/for-financial-advisers` },
}

const data: SectorData = {
  eyebrow: 'For financial advisers',
  headlinePlain: 'Suitability reports and review letters.',
  headlineItalic: 'Every draft reviewed before it leaves.',
  subhead:
    "Sprigly drafts the reports and letters. You sign off every one before it goes anywhere near a client. Built for FCA-regulated firms.",
  pains: [
    "Suitability reports — drafted from your meeting notes in your firm's template, flagged where your judgement is needed.",
    "Meeting and file notes — written up before you've left the room.",
    "Annual review letters — in your format, ready for your signature.",
  ],
  send: 'Meeting notes from a pension transfer review.',
  get: "A draft suitability report in your firm's template, flagged where it needs your judgement.",
  disclaimer:
    "Drafts only — every document is reviewed and approved by the adviser before anything reaches a client.",
}

export default function FinancialAdvisersPage() {
  return <SectorPage data={data} />
}
