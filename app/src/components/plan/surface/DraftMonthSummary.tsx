'use client';

/**
 * DraftMonthSummary.tsx — the month's argument, at the head of the month. (S1/S2)
 *
 * THE PROBLEM IT SOLVES is a misreading, not a missing feature. A client opening a draft sees
 * thirty title-only rows and no words, and the honest reading of that screen — from someone who
 * has not been told otherwise — is *this isn't finished*. It is finished, for what a draft is: a
 * DIRECTION OF TRAVEL, agreed first, written afterwards. This panel says so, once, before the
 * day content, and then states what the month actually is.
 *
 * ── Why it is collapsed, and what stays visible when it is ───────────────────────────
 *
 * The one thing it must not do is push the month off the screen — the same rule the receipt chip
 * is built around (SummaryChip.tsx), and for the same reason: a client's first sight of their
 * month must be their month. So the closed state is two lines and a chevron, ~80px at 390px,
 * and it scrolls with the day rather than sitting above the scroll region, so it leaves the
 * screen entirely as soon as the client reads past it.
 *
 * Both closed lines carry weight, and the split is deliberate:
 *   THE HEADLINE   how much, over how long — the one thing a client counts for themselves.
 *   THE STAGE      what a draft is and what happens when they agree to it. This is the line the
 *                  misreading needs, so it is NOT behind the tap. A panel that only explains
 *                  itself once you open it has already lost the client who did not.
 * The chevron opens the derivation: the mix, the standing commitments, the products and why
 * each one, her own ideas, and what we assumed.
 *
 * ── What it may say ──────────────────────────────────────────────────────────────────
 *
 * Nothing this component composes. Every line arrives from `monthSummary` (draft-rationale.ts),
 * which reads the beats' evidence and the same shared facts `groundingLines` reads — one module,
 * two renderings, so the panel and the beat sheet cannot disagree. There is no model prose on
 * this path. A section with no evidence behind it is not built, so a thin month renders a shorter
 * panel rather than a padded one.
 *
 * DRAFT ONLY. It is rendered by `DraftSurface`, which is the draft branch; a committed month has
 * captions to read and needs no account of itself.
 */
import React from 'react';
import type { MonthSummary } from '@/lib/draft-rationale';
import { ChevronD, ChevronR } from './icons';

export function DraftMonthSummary({
  summary, expanded, onToggle,
}: {
  /** Already derived. Null renders nothing at all — see monthSummary on the empty month. */
  summary: MonthSummary | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!summary) return null;
  const detailId = 'draft-summary-detail';

  return (
    <section data-testid="draft-summary" className="mb-3 rounded-2xl border border-line/30 bg-line-soft">
      {/* ONE CONTROL, the whole header. Same ruling as the receipt chip: the chevron is a state
          indicator, not a second target, on the element whose job is to be read at a glance. */}
      <button
        type="button" data-testid="draft-summary-toggle"
        aria-expanded={expanded} aria-controls={detailId}
        aria-label="Why this month looks like this"
        onClick={onToggle}
        className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span data-testid="draft-summary-headline" className="block break-words text-[15px] font-semibold leading-[1.3] tracking-[-.015em] text-chrome">
            {summary.headline}
          </span>
          {summary.stage && (
            <span data-testid="draft-summary-stage" className="mt-0.5 block break-words text-[13.5px] leading-normal text-muted">
              {summary.stage}
            </span>
          )}
        </span>
        {expanded
          ? <ChevronD className="h-[17px] w-[17px] flex-none text-muted" />
          : <ChevronR className="h-[17px] w-[17px] flex-none text-muted" />}
      </button>

      {expanded && summary.sections.length > 0 && (
        <div id={detailId} data-testid="draft-summary-detail" className="border-t border-line/30 px-3.5 pb-3.5 pt-1">
          {summary.sections.map((s) => (
            <section key={s.key} data-testid="draft-summary-section" data-section={s.key} className="mt-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[.1em] text-muted">{s.heading}</h3>
              {/* A real list, because that is what it is. The count sits in its own column rather
                  than inside the sentence, so seven pillars read as a comparison and not as seven
                  sentences that happen to end in a number. */}
              <ul className="mt-1.5 space-y-1">
                {s.facts.map((f, i) => (
                  <li key={`${s.key}-${i}`} data-testid="draft-summary-fact" className="flex gap-3 text-[13.5px] leading-normal text-chrome">
                    <span className="min-w-0 flex-1 break-words">{f.text}</span>
                    {f.count && <span className="flex-none font-semibold tabular-nums text-muted">{f.count}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
