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
 * approving. Gap 4 landed this session, so a beat the client's own words created finally says so.
 *
 * A separate component from `DetailSheet` rather than a mode of it: a `DraftBeatView` is not a
 * `PlanPost` and was made a separate type on purpose (see types.ts). Modelling one as the other
 * with empty strings invites exactly the confusion the draft fence exists to prevent. The shared
 * parts — the sheet chrome, the format control, the tile — are shared as components.
 */
import React, { useState } from 'react';
import type { DraftBeatView, PostFormat } from '@/lib/types';
import { Sheet } from './Sheet';
import { FormatControl } from './FormatControl';
import { FormatTile, InfoGlyph, CalGlyph, BinGlyph } from './icons';
import { dayTitle } from './dates';
import { rationaleFor, slotLabel } from '@/lib/draft-rationale';

export function DraftDetailSheet({
  beat, editable, busy, onClose, onMove, onDelete, onFormat,
}: {
  beat: DraftBeatView | null;
  editable: boolean;
  busy: boolean;
  onClose: () => void;
  onMove: () => void;
  onDelete: () => void;
  onFormat: (f: PostFormat) => void;
}) {
  const [insights, setInsights] = useState(false);

  // A new beat is a new sheet: never inherit the last one's open insights.
  const [openedId, setOpenedId] = useState<string | null>(null);
  if (beat && openedId !== beat.id) { setOpenedId(beat.id); setInsights(false); }

  if (!beat) return null;

  const reason = rationaleFor(beat.evidence, beat.pillar);
  const experiment = slotLabel(beat.slotType);

  return (
    <Sheet open label={beat.title} testid="detail-sheet" onClose={onClose}>
      <>
        <div className="flex-none border-b border-line/30 px-[18px] pb-3.5 pt-1.5">
          <div className="flex items-start gap-3">
            <FormatTile format={beat.format} large />
            <div className="min-w-0 flex-1">
              <h2 className="mb-1 text-[20px] font-bold leading-[1.25] tracking-[-.025em] text-chrome">{beat.title}</h2>
              <p data-testid="detail-meta" className="text-[13.5px] font-medium text-muted">
                {[dayTitle(beat.date), beat.pillar].filter(Boolean).join(' · ')}
              </p>
            </div>
            {reason && (
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

        {insights && reason && (
          <div data-testid="insights" className="flex-none px-[18px] pt-3">
            <div className="rounded-2xl border border-coral-600/45 bg-coral-100 px-3.5 py-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[.1em] text-coral-800">Why this one is here</h3>
              <p className="mt-1.5 text-[13.5px] leading-normal text-coral-800">{reason}</p>
              {experiment && (
                // §2.1: the marker's explanation lives HERE, not in a tooltip on the card.
                <p data-testid="experiment-note" className="mt-2 text-[13.5px] leading-normal text-coral-800">
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
            <ActionBtn testid="act-move" label="Move" onClick={onMove}><CalGlyph className="h-[19px] w-[19px]" /></ActionBtn>
            <ActionBtn testid="act-delete" label="Delete" destructive onClick={onDelete}>
              <BinGlyph className="h-[19px] w-[19px]" />
            </ActionBtn>
          </div>
        )}
      </>
    </Sheet>
  );
}

/** The same button as the committed sheet's, at the same 56px (round 6, P12). Two of them here
 *  rather than three, because Shape has nothing to act on. */
function ActionBtn({
  testid, label, onClick, children, destructive,
}: {
  testid: string; label: string; onClick: () => void; children: React.ReactNode; destructive?: boolean;
}) {
  return (
    <button
      type="button" data-testid={testid} onClick={onClick}
      className={[
        'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[14px] px-1 py-1.5 transition-colors duration-100',
        destructive
          // White on danger is 5.94:1. The only saturated fill on the surface, on the only
          // action that destroys something.
          ? 'bg-danger text-white active:bg-danger/[.86]'
          : 'bg-surface text-chrome ring-1 ring-inset ring-line/55 active:bg-line-soft active:ring-line',
      ].join(' ')}
    >
      {children}
      <span className="text-[12px] font-semibold tracking-[-.01em]">{label}</span>
    </button>
  );
}
