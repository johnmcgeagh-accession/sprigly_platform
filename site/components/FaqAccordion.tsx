'use client'

import { useState } from 'react'

interface FaqItem {
  question: string
  answer: string
}

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className="divide-y divide-ink/10">
      {items.map((item, i) => {
        const isOpen = openIndex === i
        return (
          <div key={i}>
            <button
              onClick={() => setOpenIndex(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-6 py-6 text-left"
              aria-expanded={isOpen}
            >
              <span className="text-[17px] font-medium text-ink leading-[1.3]">
                {item.question}
              </span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
                className="flex-shrink-0 transition-transform duration-200"
                style={{ transform: isOpen ? 'rotate(45deg)' : 'none' }}
              >
                <path d="M9 3V15M3 9H15" stroke="#FF6F62" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {isOpen && (
              <p className="text-[15px] leading-[1.65] text-ink-mid pb-6">
                {item.answer}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
