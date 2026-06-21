import type { ReactNode } from 'react'
import Link from 'next/link'
import { Reveal } from './Reveal'
import { BOOKING_URL } from '@/lib/config'

interface CtaBandProps {
  label?: string
  heading?: ReactNode
  body?: string
  buttonText?: string
  footnote?: string | null
}

export default function CtaBand({
  label = 'Start here',
  heading = (
    <>
      See exactly what we&rsquo;d{' '}
      <em className="fraunces-soft text-coral">automate first.</em>
    </>
  ),
  body = "20 minutes on a call. We'll either show you the two or three workflows where AI agents would pay back fastest in your business, or we'll tell you it's not the right fit. Either way, you leave with a clear answer.",
  buttonText = 'Book a discovery call',
  footnote = "Costs a fraction of the hire it replaces. Exact pricing depends on your workflows. You'll get a number on the call, in writing the same day.",
}: CtaBandProps) {
  return (
    <section
      id="book"
      className="bg-white py-[130px] px-6 md:px-12 text-center"
    >
      <Reveal className="max-w-[800px] mx-auto">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-coral mb-7">
          {label}
        </p>
        <h2
          className="font-serif font-normal tracking-[-0.025em] text-[#334155] mb-7"
          style={{
            fontSize: 'clamp(38px, 5vw, 60px)',
            lineHeight: 1.05,
          }}
        >
          {heading}
        </h2>
        <p className="text-[17px] text-ink-mid mb-11 leading-[1.55] max-w-[560px] mx-auto">
          {body}
        </p>
        <Link
          href={BOOKING_URL}
          className="inline-flex items-center gap-[10px] px-7 py-4 bg-coral text-white rounded-lg font-medium text-[15px] transition-all duration-200 hover:-translate-y-px"
          style={{ boxShadow: '0 4px 20px rgba(255,111,98,0.30)' }}
        >
          {buttonText}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </Link>
        {footnote && (
          <p className="text-[13px] text-ink-light mt-7 tracking-[0.01em]">{footnote}</p>
        )}
      </Reveal>
    </section>
  )
}
