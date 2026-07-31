'use client';

/**
 * rows.tsx — the compact row, and the one list that renders it.
 *
 * Two surfaces need the same row for the same reason. The day view uses it at three posts and
 * above (the density rule, §9.1), and the month view's tap summary uses it at any count (round 6,
 * P6). They were about to be written twice, and a row written twice is a row that drifts — one of
 * them ends up carrying the pillar back, which is precisely the thing the density rule removed.
 *
 * THE ROW IS TIME · TITLE · CHEVRON, and deliberately not the format icon or the pillar. A row
 * carrying time + icon + pillar + title leaves roughly 150px of a 350px line for the title, which
 * truncates every real one to uselessness — ivy-t's include 200-character input echoes. Time and
 * title answer *what is happening, and when*; everything else is one tap away.
 *
 * The month summary is the one exception, and it is a deliberate one: it carries the format icon
 * INSTEAD of the time, because a summary row under a calendar is answering "what is on this day",
 * not "when today happens" — the day is the thing you just tapped, and its posts' times are the
 * detail. The operator's note asked for icon + title, and that is the reading it comes from.
 */
import React, { useState } from 'react';
import type { PlanPost } from '@/lib/types';
import { FormatTile, ChevronR } from './icons';
import { isPostOnTheWay, isBanked, ON_THE_WAY_ARIA } from '@/lib/generation-state';
import { cardText } from './card-text';
import { dayTitle } from './dates';

/** Rows shown before "＋N more". Four, per the density rule. */
export const ROWS_BEFORE_MORE = 4;

/** What a day's post count means for how it is drawn. One definition, both surfaces. */
export type Density = 'empty' | 'cards' | 'rows';
export function densityOf(count: number): Density {
  if (count === 0) return 'empty';
  return count <= 2 ? 'cards' : 'rows';
}

export interface RowItem {
  id: string;
  /** Left column: the posting time, or nothing. */
  time?: string | undefined;
  title: string;
  /** Shown instead of the time when the surface leads with format (the month summary). */
  format?: string | undefined;
  onWay?: boolean | undefined;
  /** Waiting for the monthly change allowance to refresh (X2c). */
  banked?: boolean | undefined;
}

export function rowsFromPosts(posts: PlanPost[], timeOf: (p: PlanPost) => string): RowItem[] {
  return posts.map((p) => ({
    id: p.id,
    time: timeOf(p),
    title: cardText(p).heading,
    // THE POST'S REAL FORMAT (F7a). This was never set, so every format-led row — the month
    // view's day summary — fell through `format ?? 'single'` and drew the single-image tile
    // for reels and carousels alike. One derivation: the same `post.format` the detail sheet
    // and the day cards already read.
    format: p.format,
    // X2c: a banked post is NOT on its way — it shows no in-flight marker in the month
    // summary either, because nothing is in flight.
    onWay: isPostOnTheWay(p),
    banked: isBanked(p),
  }));
}

/**
 * What the tapped day holds, under the month grid (round 6, P6).
 *
 * Deliberately BRIEF. This is a glance, not the day view: a heading, one row per post, and no
 * add slot, no beats, no "outside this month" — those all belong to the day, and the day is one
 * tap away on the nav pill. An empty day says so in one line rather than offering a control,
 * because a client tapping around a calendar to see its shape has not asked to create anything.
 */
export function MonthDaySummary({
  date, items, onOpen, noun = 'post', empty = 'Nothing planned',
}: {
  date: string;
  items: RowItem[];
  onOpen: (id: string) => void;
  /** 'planned post' on a draft month. The word "beat" appears on no client surface (§7), and
   *  a draft month's items are planned posts rather than posts. */
  noun?: string;
  empty?: string;
}) {
  return (
    <section data-testid="month-summary" data-date={date} className="pt-4">
      <div className="mb-2 flex items-baseline gap-2.5">
        {/* h2, not h3: the heading ladder is h1 month → h2 day → h3 section → h4 card, and this
            IS the day, seen from the month view. h3 here skipped a level. */}
        <h2 className="text-[15px] font-semibold tracking-[-.01em] text-chrome">{dayTitle(date)}</h2>
        <span className="flex-1" />
        <span className="text-[12.5px] font-semibold tabular-nums text-muted">
          {items.length === 0 ? empty : `${items.length} ${noun}${items.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {items.length > 0 && <CompactRows items={items} onOpen={onOpen} testid="summary-row" lead="format" />}
    </section>
  );
}

export function CompactRows({
  items, onOpen, testid = 'post-row', lead = 'time', cap,
}: {
  items: RowItem[];
  onOpen: (id: string) => void;
  testid?: string;
  /** Which column leads the row — the time, or the format tile. */
  lead?: 'time' | 'format';
  /** Show at most this many, then "＋N more" expanding in place. Absent → show them all. */
  cap?: number | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = cap === undefined ? 0 : Math.max(0, items.length - cap);
  const shown = expanded || hidden === 0 ? items : items.slice(0, cap);

  return (
    <div data-testid="row-list" className="overflow-hidden rounded-[20px] border border-line/30 bg-surface shadow-card">
      {shown.map((it) => (
        <button
          key={it.id} type="button" data-testid={testid} data-post-id={it.id} onClick={() => onOpen(it.id)}
          className="flex min-h-[56px] w-full items-center gap-2.5 px-[13px] py-2.5 text-left transition-colors duration-100 active:bg-line-soft [&+&]:border-t [&+&]:border-line/30"
        >
          {lead === 'format'
            ? <FormatTile format={it.format ?? 'single'} />
            : <span className="w-[42px] flex-none text-[12.5px] font-semibold tabular-nums text-muted">{it.time}</span>}
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-chrome">{it.title}</span>
          {it.onWay && (
            // One dot on a compact row rather than three — the row has no space for an
            // ellipsis — pulsing on the same rhythm as the card's (round 7, fix 6).
            <span data-testid="row-on-the-way" aria-label={ON_THE_WAY_ARIA}
              className="h-[5px] w-[5px] flex-none rounded-full bg-coral-600 motion-safe:animate-dot-pulse" />
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
