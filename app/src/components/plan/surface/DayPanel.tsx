'use client';

/**
 * DayPanel.tsx — the selected day, alone.
 *
 * Spec §9.1. One day at a time: the strip selects, this renders that day and nothing else.
 * There is no week feed, no scroll-spy, no `data-day` anchors and no jump-to-day — all of it
 * deleted with the reversal in §1.4, which is a simplification and not a loss.
 *
 * ── The density rule, and why it is a rule ───────────────────────────────────────────
 *
 * 390px minus 20px gutters leaves 350px, and a full card is 120–150px tall.
 *
 *   0     day header + one add slot
 *   1–2   full cards: format icon, pillar, time, title, caption excerpt
 *   3–4   ONE grouped list of compact rows: time · title · chevron
 *   5+    the same rows, first four, then "＋N more" expanding in place
 *
 * Compact rows deliberately DROP the format icon and the pillar. A row carrying time + icon +
 * pillar + title leaves roughly 150px for the title, which truncates every real one to
 * uselessness — ivy-t's include 200-character input echoes. Time and title answer *what is
 * happening, and when*; everything else is one tap away.
 *
 * The three-plus case is real: Earl of East's October holds two posts on 1 October; ivy-t's
 * August holds three on 3 August and three on 1 August.
 *
 * Ordering within a day is `(scheduled_date, position)` — the order the readers already return.
 * `position` is the tiebreak `reorderWithinDay` writes, and this is the first surface that
 * makes it visible.
 */
import React, { useState } from 'react';
import type { PlanPost, PlanBeat } from '@/lib/types';
import { FormatTile, PlusGlyph, ChevronR } from './icons';
import { dayTitle } from './dates';
import { isOnTheWay, ON_THE_WAY_LABEL, ON_THE_WAY_TEASER, ON_THE_WAY_ARIA } from '@/lib/generation-state';
import { cardText } from './card-text';
import { WeatherHeaderBadge } from '../pieces';
import { BeatMarker, beatFlashText } from '../BeatMarker';
import type { WeatherDay } from '@/lib/weather';

/** Rows shown before "＋N more". Four, per the density rule. */
const ROWS_BEFORE_MORE = 4;

export function DayPanel({
  date, today, posts, beats, canAdd, onOpen, onAdd, onBeat, outside, timeOf, weather,
}: {
  date: string;
  today: string;
  /** The day's posts, already ordered. */
  posts: PlanPost[];
  beats: PlanBeat[];
  canAdd: boolean;
  onOpen: (postId: string) => void;
  onAdd: () => void;
  onBeat: (text: string) => void;
  /** Posts dated in a month no cycle plans — rendered once, at the foot, so a cross-month
   *  move can never make a post silently vanish. */
  outside: PlanPost[];
  timeOf: (p: PlanPost) => string;
  /** The day's forecast, when there is one. Pure decoration, carried over from the shipped
   *  weather overlay — the redesign never asked for it to go, and the day header is where it
   *  already lived. Absent on any failure, and the header renders identically without it. */
  weather?: WeatherDay | undefined;
}) {
  const heading = date === today ? `Today · ${dayTitle(date)}` : dayTitle(date);
  const count = posts.length;

  return (
    <div data-testid="day-panel" data-date={date} className="flex-1 overflow-y-auto px-5 pb-[104px] pt-4 [scrollbar-width:none]">
      <div className="mb-3.5 flex items-baseline gap-2.5">
        <h2 data-testid="day-title" className="text-[22px] font-bold tracking-[-.02em] text-chrome">{heading}</h2>
        <span className="flex-1" />
        <WeatherHeaderBadge day={weather} />
        <span data-testid="day-count" className="text-[12.5px] font-semibold tabular-nums text-muted">
          {count === 0 ? 'Nothing planned' : `${count} post${count === 1 ? '' : 's'}`}
        </span>
      </div>

      {count > 0 && count <= 2 && posts.map((p) => (
        <PostCard key={p.id} post={p} time={timeOf(p)} onOpen={() => onOpen(p.id)} />
      ))}
      {count >= 3 && <RowList posts={posts} onOpen={onOpen} timeOf={timeOf} />}

      {canAdd && (
        <button
          type="button" data-testid="add-slot" onClick={onAdd}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line/55 bg-surface/55 p-3 text-[13.5px] font-medium text-muted"
        >
          <PlusGlyph className="h-[17px] w-[17px] text-coral-800" />
          Plan a post for this day
        </button>
      )}

      {beats.length > 0 && (
        <div className="mt-3 flex flex-col gap-1" data-testid="day-beats">
          {beats.map((b, i) => <BeatMarker key={`beat-${i}`} beat={b} onClick={() => onBeat(beatFlashText(b))} />)}
        </div>
      )}

      {outside.length > 0 && (
        <section data-testid="outside-month" className="pt-6">
          <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-[.1em] text-muted">Outside this month</h3>
          {outside.map((p) => <PostCard key={p.id} post={p} time={timeOf(p)} onOpen={() => onOpen(p.id)} />)}
        </section>
      )}
    </div>
  );
}

/** A full card: what the day holds, at a glance, with nothing to operate.
 *  Copy is NOT here — it lives in the detail sheet's tabs, beside the words it copies.
 *  A card is a thing you read (spec §4, D1). */
function PostCard({ post, time, onOpen }: { post: PlanPost; time: string; onOpen: () => void }) {
  const onWay = isOnTheWay(post.status);
  const { heading, source, teaser } = cardText(post);
  return (
    <button
      type="button" data-testid="post-card" data-post-id={post.id} onClick={onOpen}
      className="mb-2.5 block w-full rounded-[20px] border border-line/30 bg-surface px-3.5 pb-3.5 pt-[13px] text-left shadow-card"
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <FormatTile format={post.format} />
        <span className="min-w-0 truncate text-[12.5px] font-medium text-muted">{post.pillar}</span>
        {time && <span className="ml-auto flex-none text-[12.5px] font-semibold tabular-nums text-muted">{time}</span>}
      </div>
      <h4 className="mb-[5px] text-[16.5px] font-semibold leading-[1.3] tracking-[-.02em] text-chrome">
        {source === 'none' ? <span className="font-medium italic text-muted">Untitled</span> : heading}
      </h4>
      {onWay ? (
        <>
          <p className="text-[13.5px] leading-normal text-muted">{ON_THE_WAY_TEASER}</p>
          <div className="mt-2.5 flex items-center gap-2">
            {/* Work in flight: vivid, quiet, no red, nothing asked of the client. The three
                dots are a non-text use of accent-600 at graduated opacity — the state is
                carried by the words beside them, not by the colour. */}
            <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
              <i className="block h-[5px] w-[5px] rounded-full bg-coral-600 opacity-30" />
              <i className="block h-[5px] w-[5px] rounded-full bg-coral-600 opacity-60" />
              <i className="block h-[5px] w-[5px] rounded-full bg-coral-600" />
            </span>
            <span data-testid="on-the-way" aria-label={ON_THE_WAY_ARIA} className="text-[12.5px] font-semibold text-muted">
              {ON_THE_WAY_LABEL}
            </span>
          </div>
        </>
      ) : teaser ? (
        <p data-testid="card-teaser" className="line-clamp-2 text-[13.5px] leading-normal text-muted">{teaser}</p>
      ) : source === 'none' ? (
        <p className="text-[13.5px] leading-normal text-muted">Nothing written here yet.</p>
      ) : null}
    </button>
  );
}

/** Three or more posts: one grouped list of compact rows. */
function RowList({ posts, onOpen, timeOf }: { posts: PlanPost[]; onOpen: (id: string) => void; timeOf: (p: PlanPost) => string }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, posts.length - ROWS_BEFORE_MORE);
  const shown = expanded || hidden === 0 ? posts : posts.slice(0, ROWS_BEFORE_MORE);

  return (
    <div data-testid="row-list" className="mb-2.5 overflow-hidden rounded-[20px] border border-line/30 bg-surface shadow-card">
      {shown.map((p) => (
        <button
          key={p.id} type="button" data-testid="post-row" data-post-id={p.id} onClick={() => onOpen(p.id)}
          className="flex min-h-[58px] w-full items-center gap-2.5 px-[13px] py-3 text-left [&+&]:border-t [&+&]:border-line/30"
        >
          <span className="w-[42px] flex-none text-[12.5px] font-semibold tabular-nums text-muted">{timeOf(p)}</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-chrome">{cardText(p).heading}</span>
          {isOnTheWay(p.status) && (
            <span data-testid="row-on-the-way" aria-label={ON_THE_WAY_ARIA}
              className="h-[5px] w-[5px] flex-none rounded-full bg-coral-600" />
          )}
          <ChevronR className="h-4 w-4 flex-none text-muted" />
        </button>
      ))}
      {hidden > 0 && !expanded && (
        <button
          type="button" data-testid="show-more" onClick={() => setExpanded(true)}
          className="flex min-h-[44px] w-full items-center justify-center border-t border-line/30 text-[13px] font-semibold text-coral-800"
        >
          ＋{hidden} more
        </button>
      )}
    </div>
  );
}
