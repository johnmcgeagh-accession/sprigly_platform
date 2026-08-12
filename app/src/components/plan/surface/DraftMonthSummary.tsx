'use client';

/**
 * DraftMonthSummary.tsx — the month's argument, at the head of the month. (S1/S2, M1–M4)
 *
 * THE PROBLEM IT SOLVES is a misreading, not a missing feature. A client opening a draft sees
 * thirty title-only rows and no words, and the honest reading of that screen — from someone who
 * has not been told otherwise — is *this isn't finished*. It is finished, for what a draft is: a
 * DIRECTION OF TRAVEL, agreed first, written afterwards. This panel says so and then states what
 * the month actually is.
 *
 * ── The tint (M1) ────────────────────────────────────────────────────────────────────
 *
 * It takes the accent-100 tint the day's assumption strip used to hold, so it reads as THE SYSTEM
 * SPEAKING rather than as page chrome. That only became affordable when the strip went (M4):
 * two tinted blocks on one screen would have been two things claiming to be the voice. Every
 * colour resolves through the same `coral-*` tokens the insights panel uses; no new value, no hex.
 * `coral-800` on `coral-100` is the sanctioned ink pair, and no ink here carries alpha.
 *
 * ── One tap target, one meaning (M2) ─────────────────────────────────────────────────
 *
 * Closed, the panel is the headline and ONE invitation — "Tap to see why these posts are here".
 * It used to close with the stage sentence, which meant the closed state said two things and the
 * chevron's job had to be inferred from a chevron. The stage sentence now OPENS the expanded
 * panel, where it belongs: it is the answer to "why these", not a caption on the count.
 *
 * ── The shaping prompt (M3) ──────────────────────────────────────────────────────────
 *
 * The panel ends with "Not right? Tell us what to change", and its placement is the argument:
 * the client has just read the reasoning and formed an opinion, which is the moment to offer the
 * change. It opens THE SAME conversation sheet the mic opens — no second interface, no second
 * consequence to learn.
 *
 * ── What it may say ──────────────────────────────────────────────────────────────────
 *
 * Nothing this component composes, except the two chrome strings below. Every fact arrives from
 * `monthSummary` (draft-rationale.ts), which reads the beats' evidence and the same shared facts
 * `groundingLines` reads — one module, two renderings, so the panel and the beat sheet cannot
 * disagree. There is no model prose on this path. A section with no evidence behind it is not
 * built, so a thin month renders a shorter panel rather than a padded one.
 *
 * DRAFT ONLY. It is rendered by `DraftSurface`, which is the draft branch; a committed month has
 * captions to read and needs no account of itself.
 */
import React from 'react';
import type { MonthSummary } from '@/lib/draft-rationale';
import { ChevronD, ChevronR } from './icons';

/** The closed state's one invitation. Plain, and it names what opening gets you rather than
 *  labelling the control ("More" says nothing; "Why these" is the whole proposition). */
const OPEN_CTA = 'Tap to see why these posts are here';

/** The panel's closing row. A question first, because it invites a no as readily as a yes. */
const SHAPE_CTA = 'Not right? Tell us what to change';

/**
 * The second closing row: the same invitation at a different SIZE.
 *
 * `SHAPE_CTA` opens the conversation, which is built for one change at a time — say a sentence,
 * read a receipt, say the next. A client who has just read the whole month's reasoning and
 * disagrees with several things at once is not well served by that: they would be typing six
 * sentences and reading six receipts. The wizard takes the lot in one go and decomposes it.
 *
 * Both lead to the same place — a brief, applied to this month, additively. What differs is
 * whether the client is making a change or restating the month.
 */
const BRIEF_CTA = 'Lots to change? Brief the whole month';

export function DraftMonthSummary({
  summary, expanded, onToggle, onAnswer, onShape, onIdeas, onBrief,
}: {
  /** Already derived. Null renders nothing at all — see monthSummary on the empty month. */
  summary: MonthSummary | null;
  expanded: boolean;
  onToggle: () => void;
  /** Answer the one assumption the month can act on. Takes the question as the client read it,
   *  so the conversation opens on the thing they tapped. */
  onAnswer: (question: string) => void;
  /** Reshape the month. Absent on a month that can no longer be changed, in which case the
   *  closing row is not rendered — a prompt that can only refuse is worse than no prompt. */
  onShape?: (() => void) | undefined;
  /**
   * Go and read the ideas the "From you" line counts. Desktop only — Ideas is a rail
   * destination and the phone has no rail, so on mobile the line stays a statement. That is a
   * deliberate degrade, not an oversight: a link is worse than no link when it goes nowhere.
   */
  onIdeas?: (() => void) | undefined;
  /** Open the briefing wizard on this month. Absent on the same terms as `onShape` — a month
   *  that can no longer be changed gets no invitation to change it. */
  onBrief?: (() => void) | undefined;
}) {
  if (!summary || summary.sections.length === 0) return null;
  const detailId = 'draft-summary-detail';

  return (
    <section data-testid="draft-summary" className="mb-3 rounded-2xl border border-coral-600/45 bg-coral-100">
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
          <span data-testid="draft-summary-headline" className="block break-words text-[15px] font-semibold leading-[1.3] tracking-[-.015em] text-coral-800">
            {summary.headline}
          </span>
          <span data-testid="draft-summary-cta" className="mt-0.5 block break-words text-[13.5px] leading-normal text-coral-800">
            {OPEN_CTA}
          </span>
        </span>
        {expanded
          ? <ChevronD className="h-[17px] w-[17px] flex-none text-coral-800" />
          : <ChevronR className="h-[17px] w-[17px] flex-none text-coral-800" />}
      </button>

      {expanded && (
        <div id={detailId} data-testid="draft-summary-detail" className="border-t border-coral-600/25 px-3.5 pb-3.5 pt-3">
          {/* THE STAGE, as the opening sentence — what a draft is, and what happens next. */}
          {summary.stage && (
            <p data-testid="draft-summary-stage" className="break-words text-[13.5px] leading-normal text-coral-800">
              {summary.stage}
            </p>
          )}

          {summary.sections.map((s) => (
            <section key={s.key} data-testid="draft-summary-section" data-section={s.key} className="mt-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[.1em] text-coral-800">{s.heading}</h3>
              {/* A real list, because that is what it is. The count sits in its own column rather
                  than inside the sentence, so seven pillars read as a comparison and not as seven
                  sentences that happen to end in a number.
                  `list-none pl-0` is LOAD-BEARING, not tidying: Tailwind preflight is disabled on
                  this surface (globals.css), so a bare `ul` keeps the browser's disc marker and
                  its 40px indent. The 390px render showed the cost — the indent pushed the
                  longest pillar onto two lines and left its count stranded beside the first. */}
              <ul className="mt-1.5 list-none space-y-1 pl-0">
                {s.facts.map((f, i) => (
                  <li key={`${s.key}-${i}`} data-testid="draft-summary-fact" data-answerable={f.answerable ? 'true' : undefined}>
                    {f.answerable
                      ? <PromptRow testid="assumption-nudge" label={f.text} onClick={() => onAnswer(f.text)} />
                      : f.opensIdeas && onIdeas
                      ? <PromptRow testid="summary-ideas" label={f.text} onClick={onIdeas} />
                      : (
                        <span className="flex gap-3 text-[13.5px] leading-normal text-coral-800">
                          <span className="min-w-0 flex-1 break-words">{f.text}</span>
                          {f.count && <span className="flex-none font-semibold tabular-nums text-coral-800">{f.count}</span>}
                        </span>
                      )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {(onShape || onBrief) && (
            <div className="mt-3.5 flex flex-col gap-2 border-t border-coral-600/25 pt-3.5">
              {onShape && <PromptRow testid="summary-shape" label={SHAPE_CTA} onClick={onShape} />}
              {onBrief && <PromptRow testid="summary-brief" label={BRIEF_CTA} onClick={onBrief} />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A tappable row inside the tint.
 *
 * It cannot be carried by colour: the panel is already `coral-100`, so a `coral-100` button —
 * which is what the day's strip was — would be invisible here. It sits on `surface` instead, with
 * its own edge and a chevron, so "this one does something" is stated by the fill, the border AND
 * the glyph rather than inferred from any one of them.
 */
function PromptRow({ testid, label, onClick }: { testid: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button" data-testid={testid} onClick={onClick}
      className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-coral-600/35 bg-surface px-3 py-2.5 text-left text-[13.5px] leading-normal text-coral-800"
    >
      <span className="min-w-0 flex-1 break-words">{label}</span>
      <ChevronR className="h-4 w-4 flex-none" />
    </button>
  );
}
