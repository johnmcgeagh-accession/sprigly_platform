'use client';

/**
 * DraftDetailSheet.tsx — a planned post, opened. (mockup 05, the draft variant)
 *
 * The committed sheet's structure with two parts removed and one changed, and every removal is
 * because the thing genuinely does not exist yet rather than because it was cut for space:
 *
 *   NO TABS.   There is no caption, hook or script — the words arrive when the month is
 *              generated. Three empty tabs would be three controls that say "broken".
 *   NO SHAPE.  Shape rewrites words. There are none. A rewrite of an empty field is not a
 *              cheaper way of writing it, it is a paid no-op.
 *   NO COPY.   Same reason: nothing to put on a clipboard.
 *   MOVE has no time. `POST /api/plan/draft {op:'move'}` writes a DATE. There is no posting-time
 *              op on the draft route and the assembler stores none, so the picker does not offer
 *              an hour it could not save (gap 1 is the committed month's, and it is closed there).
 *
 * What it keeps is the part that matters most on a draft: the REASON, behind the insights icon.
 * On a committed post that is a nice-to-have; on a planned one it is the whole proposition —
 * the client is being asked to approve a slot, and the evidence for the slot is what they are
 * approving. Gap 4 landed earlier, so a beat the client's own words created finally says so.
 *
 * That affordance now carries the beat's GROUNDING, one fact per line, rather than the card's
 * single compressed sentence. Beats stopped being pillar-shaped — they name a product and the
 * date it was last in a caption, a recurring series and when it last ran, or the sentence she
 * sent us and the month she sent it — and a sentence that fits a three-line card cannot hold
 * that. Extending the insights panel rather than adding a section is the point: the reason a
 * beat exists already lives behind this icon, and a second place to look for it would mean
 * neither place was the answer. Every line is derived from `rationaleEvidence` by
 * `groundingLines`; none of it is model prose, and a field that is absent produces no line.
 *
 * A separate component from `DetailSheet` rather than a mode of it: a `DraftBeatView` is not a
 * `PlanPost` and was made a separate type on purpose (see types.ts). Modelling one as the other
 * with empty strings invites exactly the confusion the draft fence exists to prevent. The shared
 * parts — the sheet chrome, the format control, the tile — are shared as components.
 */
import React, { useState } from 'react';
import type { DraftBeatView, PostFormat } from '@/lib/types';
import { Sheet } from './Sheet';
import { Panel, type PanelChrome } from './Panel';
import { ChevronL } from './icons';
import { FormatControl } from './FormatControl';
import { FormatTile, InfoGlyph, CalGlyph, BinGlyph } from './icons';
import { dayTitle } from './dates';
import { groundingLines, slotLabel } from '@/lib/draft-rationale';

export function DraftDetailSheet({
  beat, editable, busy, onClose, onMove, onDelete, onFormat, chrome,
}: {
  beat: DraftBeatView | null;
  editable: boolean;
  busy: boolean;
  onClose: () => void;
  onMove: () => void;
  onDelete: () => void;
  onFormat: (f: PostFormat) => void;
  /** `panel` places this inline in the desktop day column. See Panel.tsx. */
  chrome: PanelChrome;
}) {
  const [insights, setInsights] = useState(false);

  // A new beat is a new sheet: never inherit the last one's open insights.
  const [openedId, setOpenedId] = useState<string | null>(null);
  if (beat && openedId !== beat.id) { setOpenedId(beat.id); setInsights(false); }

  if (!beat) return null;

  // The SHEET reads the evidence as separate facts, one per line, where the card compresses
  // the same evidence into a sentence (rationaleFor). Same source, two readings — the client
  // is here to study it, so each claim stays separately checkable.
  const grounding = groundingLines(beat.evidence, beat.pillar);
  const experiment = slotLabel(beat.slotType);

  const Frame = chrome === 'panel' ? Panel : Sheet;

  return (
    <Frame open label={beat.title} testid="detail-sheet" onClose={onClose}>
      <>
        {/* THE WAY BACK, and it only exists in panel chrome. A SHEET has the grabber and the
            scrim; a panel replaces the day column outright, so without this the client opens a
            post and the day's other posts are simply gone with no control that says otherwise.
            It names the DAY rather than saying "Back": a direction tells you which way, a day
            tells you where you land — and it is the same string the day header carries. */}
        {chrome === 'panel' && (
          <button
            type="button" data-testid="detail-back" onClick={onClose}
            className="flex min-h-[44px] flex-none items-center gap-1.5 border-b border-line/30 px-3 text-left text-[13.5px] font-semibold text-muted transition-colors duration-100 hover:text-chrome"
          >
            <ChevronL className="h-[15px] w-[15px]" />
            {dayTitle(beat.date)}
          </button>
        )}

        <div className="flex-none border-b border-line/30 px-[18px] pb-3.5 pt-1.5">
          <div className="flex items-start gap-3">
            <FormatTile format={beat.format} large />
            <div className="min-w-0 flex-1">
              {/* The SHEET is where a long title is allowed to be long — it is the surface the
                  card's clamp sends you to. `break-words` only, no clamp. */}
              <h2 className="mb-1 break-words text-[20px] font-bold leading-[1.25] tracking-[-.025em] text-chrome">{beat.title}</h2>
              <p data-testid="detail-meta" className="text-[13.5px] font-medium text-muted">
                {[dayTitle(beat.date), beat.pillar].filter(Boolean).join(' · ')}
              </p>
            </div>
            {grounding.length > 0 && (
              <button
                type="button" data-testid="insights-toggle" aria-expanded={insights}
                aria-label="Why this post is here" onClick={() => setInsights((v) => !v)}
                className={`flex h-11 w-11 flex-none items-center justify-center rounded-full ${insights ? 'bg-coral-650 text-white' : 'bg-line-soft text-chrome'}`}
              >
                <InfoGlyph className="h-[17px] w-[17px]" />
              </button>
            )}
          </div>
        </div>

        {insights && grounding.length > 0 && (
          <div data-testid="insights" className="flex-none px-[18px] pt-3">
            <div className="rounded-2xl border border-coral-600/45 bg-coral-100 px-3.5 py-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[.1em] text-coral-800">Why this one is here</h3>
              {/* One fact per row, each separately checkable, rather than one run-on sentence.
                  A `ul` because that is what this is; the marker is drawn as a dot so the list
                  reads as evidence rather than as instructions.
                  `list-none pl-0` is LOAD-BEARING. Tailwind preflight is disabled on this surface
                  (globals.css), so a bare `ul` keeps the browser's disc marker AND its 40px
                  padding-inline-start — which meant this list drew the browser's dot beside the
                  one it draws itself, and paid 40px of a ~310px measure for the privilege. The
                  grounding lines are long ("WSG (Weekend Style Guide) — weekly; last ran 28
                  August") and every pixel of measure is a word that does not wrap. */}
              <ul className="mt-2 list-none space-y-2 pl-0">
                {grounding.map((line, i) => (
                  <li key={`${line.kind}-${i}`} data-testid="grounding-line" data-kind={line.kind} className="flex gap-2">
                    <span aria-hidden className="mt-[7px] h-[3px] w-[3px] flex-none rounded-full bg-coral-800/55" />
                    <span className="min-w-0 flex-1 text-[13.5px] leading-normal text-coral-800">
                      {line.text}
                      {line.quote && (
                        // HER WORDS, not ours — set apart so it is unmistakably a quotation and
                        // never reads as our summary of what she said.
                        <span data-testid="grounding-quote" className="mt-1 block break-words italic text-coral-800">
                          “{line.quote}”
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {experiment && (
                // §2.1: the marker's explanation lives HERE, not in a tooltip on the card.
                <p data-testid="experiment-note" className="mt-2.5 border-t border-coral-600/25 pt-2.5 text-[13.5px] leading-normal text-coral-800">
                  This one is a new idea we’re trying this month.
                </p>
              )}
            </div>
          </div>
        )}

        {editable && (
          <div className="flex-none px-[18px] pt-3">
            <FormatControl value={beat.format} onChange={onFormat} disabled={busy} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-[18px] pb-4 pt-3 [scrollbar-width:none]">
          <div data-testid="not-written-yet" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
            <p className="text-[15px] font-semibold text-chrome">Nothing written yet</p>
            <p className="mt-1.5 text-[13.5px] leading-normal text-muted">
              This slot is held for you. The words arrive when you say the month is ready.
            </p>
          </div>
        </div>

        {editable && (
          <div className="flex flex-none gap-2 border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-3">
            <ActionBtn testid="act-move" label="Move" onClick={onMove}><CalGlyph className="h-[17px] w-[17px] [stroke-width:1.5]" /></ActionBtn>
            <ActionBtn testid="act-delete" label="Delete" destructive onClick={onDelete}>
              <BinGlyph className="h-[17px] w-[17px] [stroke-width:1.5]" />
            </ActionBtn>
          </div>
        )}
      </>
    </Frame>
  );
}

/** The same button as the committed sheet's, restyled with it (round 7, fix 5). Two of
 *  them here rather than three, because Shape has nothing to act on. */
function ActionBtn({
  testid, label, onClick, children, destructive,
}: {
  testid: string; label: string; onClick: () => void; children: React.ReactNode; destructive?: boolean;
}) {
  return (
    <button
      type="button" data-testid={testid} onClick={onClick}
      className={[
        'flex min-h-[44px] flex-1 flex-row items-center justify-center gap-1.5 rounded-[12px] px-2 transition-colors duration-100',
        destructive
          // `danger` on its own 10% tint over surface — the destructive action is carried by the
          // fill, the colour AND the bin, so nothing about it has to be inferred (S1).
          ? 'bg-danger/10 text-danger active:bg-danger/[.18]'
          : 'bg-line-soft text-chrome active:bg-line/25',
      ].join(' ')}
    >
      {children}
      <span className="text-[15px] font-medium tracking-[-.01em]">{label}</span>
    </button>
  );
}
