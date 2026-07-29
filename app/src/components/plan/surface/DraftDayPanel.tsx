'use client';

/**
 * DraftDayPanel.tsx — the selected day of a DRAFT month.
 *
 * The same skeleton as `DayPanel`, in a provisional skin. The density rule is shared code
 * (`rows.ts`), not a re-implementation, because a rule written twice becomes two rules: the day
 * view's compact row and this one would drift, and one of them would grow the pillar back.
 *
 * ── What makes it read as a draft ────────────────────────────────────────────────────
 *
 * A DASHED EDGE AND NO SHADOW. Provisional things should not look settled (DESIGN.md →
 * Elevation). The committed card's `shadow-card` is absent here, deliberately, and it is the
 * single strongest signal on the screen that this month is not finished.
 *
 * A REASON INSTEAD OF AN EXCERPT. A draft beat has no caption to excerpt — the words arrive when
 * the month is generated. What it has is EVIDENCE, so the card's second line is
 * `rationaleFor(beat.evidence)`: the measured figure with its sample size, or the client's own
 * sentence quoted back (gap 4, closed this session). A beat whose evidence supports nothing
 * sayable shows nothing, which is the contract's own rule.
 *
 * NO TIME. Every draft card in the mockups states one, and none of them is real: `loadDraftBeats`
 * reads no posting time and the assembler writes none, so the times in the mockups were the
 * `PostingTimes` contract's documented EXAMPLES. A card here states what is recorded, which for a
 * planned post is the day and not the hour.
 *
 * THE ONE CARD THAT IS NOT DASHED is the one that changed while you were looking: a solid accent
 * edge, an `accent-100` wash and a "New" badge (spec §3, round 4's R1).
 */
import React from 'react';
import type { DraftBeatView } from '@/lib/types';
import { FormatTile, PlusGlyph, BulbGlyph, ChevronR } from './icons';
import { dayTitle } from './dates';
import { rationaleFor, slotLabel } from '@/lib/draft-rationale';
import { CompactRows, ROWS_BEFORE_MORE, densityOf } from './rows';

export function DraftDayPanel({
  date, today, beats, editable, changedIds, onOpen, onAdd, nudge, footer,
}: {
  date: string;
  today: string;
  /** The day's beats, already ordered by (date, position). */
  beats: DraftBeatView[];
  editable: boolean;
  changedIds: readonly string[];
  onOpen: (beatId: string) => void;
  onAdd: () => void;
  /** The month's one answerable assumption, re-voiced. Absent when there is nothing to ask. */
  nudge?: { question: string; onAnswer: () => void } | undefined;
  /** The thin-month line, when the month is thin. Rendered at the FOOT of the day, after the
   *  client has read what there is (spec §9.2) — never above it as a caveat. */
  footer?: React.ReactNode | undefined;
}) {
  const heading = date === today ? `Today · ${dayTitle(date)}` : dayTitle(date);
  const count = beats.length;
  const density = densityOf(count);

  return (
    <div data-testid="day-panel" data-date={date} data-surface="draft" className="flex-1 overflow-y-auto px-5 pb-[104px] pt-3 [scrollbar-width:none]">
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 data-testid="day-title" className="text-[22px] font-bold tracking-[-.02em] text-chrome">{heading}</h2>
        <span className="flex-1" />
        <span data-testid="day-count" className="text-[12.5px] font-semibold tabular-nums text-muted">
          {/* "planned posts", never "beats" (§7). A client has never heard the word and the
              thing it names looks to them exactly like a post. */}
          {count === 0 ? 'Nothing drafted' : `${count} planned post${count === 1 ? '' : 's'}`}
        </span>
      </div>

      {density === 'cards' && beats.map((b) => (
        <DraftCard key={b.id} beat={b} changed={changedIds.includes(b.id)} onOpen={() => onOpen(b.id)} />
      ))}
      {density === 'rows' && (
        <div className="mb-2.5">
          <CompactRows
            items={beats.map((b) => ({ id: b.id, time: '', title: b.title }))}
            onOpen={onOpen} cap={ROWS_BEFORE_MORE} lead="format"
          />
        </div>
      )}

      {editable && (
        <button
          type="button" data-testid="add-slot" onClick={onAdd}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line/55 bg-surface/55 p-3 text-[13.5px] font-medium text-muted"
        >
          <PlusGlyph className="h-[17px] w-[17px] text-coral-800" />
          Plan a post for this day
        </button>
      )}

      {nudge && (
        // NEVER A CAVEAT. Round 1 headed this an amber "What we assumed" warning box; the same
        // information as an invitation reads as confidence and as a warning reads as an excuse.
        // It sits after the day's content for the same reason the thin-month line does — the
        // client reads their month first, and a receipt or a banner must never push it off the
        // fold (DESIGN.md → Don'ts).
        <button
          type="button" data-testid="assumption-nudge" onClick={nudge.onAnswer}
          className="mt-4 flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-coral-100 px-3.5 py-3 text-left text-[13.5px] leading-normal text-coral-800"
        >
          <span className="flex-1">{nudge.question}</span>
          <ChevronR className="h-4 w-4 flex-none" />
        </button>
      )}
      {footer}
    </div>
  );
}

/** A full draft card: what the day holds, and why. Nothing to operate — the sheet does that. */
function DraftCard({ beat, changed, onOpen }: { beat: DraftBeatView; changed: boolean; onOpen: () => void }) {
  const reason = rationaleFor(beat.evidence, beat.pillar);
  const experiment = slotLabel(beat.slotType);

  return (
    <button
      type="button" data-testid="draft-card" data-post-id={beat.id} data-changed={changed ? 'true' : undefined}
      onClick={onOpen}
      className={[
        'mb-2.5 block w-full rounded-[20px] px-3.5 pb-3.5 pt-[13px] text-left',
        changed
          // The one card that is not dashed, because it is the one that changed while you were
          // looking. A solid edge and a wash: both non-text uses of accent, nothing sits on them.
          ? 'border border-coral-600 bg-coral-100'
          : 'border border-dashed border-line/55 bg-surface',
      ].join(' ')}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <FormatTile format={beat.format} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-muted">{beat.pillar}</span>
        {experiment && (
          // §2.1, the ONE definition: a banner pill carrying the lightbulb AND the words. Not a
          // corner bulb (which stated nothing and took the time slot), and not a tooltip (a
          // marker that needs one has failed). The full reason is behind the sheet's insights
          // icon, where every other post's reasoning lives. It is a span, not a button: X4 cuts
          // both ways, and a thing that is not tappable must not look it.
          <span
            data-testid="experiment-pill"
            className="flex flex-none items-center gap-1 rounded-full bg-coral-100 px-2 py-1 text-[11px] font-bold text-coral-800"
          >
            <BulbGlyph className="h-3.5 w-3.5" />
            {experiment}
          </span>
        )}
        {changed && (
          <span data-testid="changed-badge" className="flex-none rounded-full bg-coral-650 px-2 py-1 text-[11px] font-bold text-white">
            New
          </span>
        )}
      </div>
      {/* CLAMPED. ivy-t's titles are 200-character input echoes, and an unclamped one turns a
          120px card into a 400px wall that pushes the day's second post off the fold. Two lines
          is the same budget the committed card's heading has. `break-words` covers the pasted
          URL that has no space to break at. */}
      <h4 className="mb-[5px] line-clamp-2 break-words text-[16.5px] font-semibold leading-[1.3] tracking-[-.02em] text-chrome">{beat.title}</h4>
      {reason && <p data-testid="card-reason" className="line-clamp-3 text-[13.5px] leading-normal text-muted">{reason}</p>}
    </button>
  );
}
