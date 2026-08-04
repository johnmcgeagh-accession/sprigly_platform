'use client';

/**
 * AddSheet.tsx — what the add slot opens now. (round 6, P1)
 *
 * The slot used to create an empty post and leave the client looking at it. On the phone that
 * reads as a bug: you tap "Plan a post for this day" and get a blank card called *Untitled*, with
 * no indication that anything is meant to happen next. The ruling is that the slot opens a
 * shaping sheet and the post is created SHAPED.
 *
 * Two fields, both of them decisions the client already has in mind when they tap:
 *
 *   FORMAT   the same segmented control as the detail sheet, because choosing a format and
 *            changing one are the same decision at two moments (§4.1).
 *   SUBJECT  one line, free text, and genuinely optional — the label says so. With it, a
 *            committed month starts writing the caption immediately and a draft month names the
 *            beat after what it is rather than after its pillar. Without it, the slot is created
 *            and nothing is written, which is the old behaviour reached deliberately.
 *
 * ── The pillar, and why it is here on a draft month only ─────────────────────────────
 *
 * `addBeat` refuses a beat whose pillar is not in the client's configured vocabulary — a free-text
 * pillar would poison the weights the assembler reads. So the draft variant has to ask, and it
 * asks with a native `<select>`: seven pillars (ivy-t's count) is a list, not a segmented control,
 * and the platform's own picker is the one control that is already scrollable, keyboard-operable
 * and familiar. A committed post has no such requirement — `addGeneratingPost` files it under
 * "New idea" — so that variant does not ask a question it would only be inventing an answer to.
 */
import React, { useState } from 'react';
import type { PostFormat } from '@/lib/types';
import { Sheet } from './Sheet';
import { Panel, type Chrome } from './Panel';
import { FormatControl } from './FormatControl';
import { ChevronL } from './icons';
import { dayTitle } from './dates';

export interface AddSpec {
  format: PostFormat;
  /** '' when they did not say. Never invented. */
  subject: string;
  /** Draft months only — the client's own vocabulary, checked server-side regardless. */
  pillar?: string | undefined;
}

export function AddSheet({
  open, date, pillars, busy, onClose, onSubmit, chrome = 'sheet',
}: {
  open: boolean;
  date: string;
  /**
   * WHICH FRAME. `sheet` on a phone; `panel` on desktop, where it takes the DAY COLUMN's slot.
   *
   * It had no such prop and was hardcoded to `Sheet`, so on desktop it rendered as the phone's
   * bottom sheet across the whole window — at 2560 that is a 2524px subject field and an
   * "Add it" bar the width of the screen. `overlays` is the one slot both shells share, and a
   * component that does not opt into a frame gets the phone's by default.
   *
   * The day column is the right slot rather than a centred modal, and the reason is the same
   * one D3 gave for the detail panel: this form is a DRILL-DOWN OF THE DAY. It is opened from
   * the day's own add slot, its heading names that day, and every field on it is scoped to it.
   * A modal is for a decision that interrupts the plan (the approval, which spends money); this
   * is the plan being worked on.
   */
  chrome?: Chrome;
  /** The client's configured pillars on a DRAFT month; null on a committed one. */
  pillars: string[] | null;
  busy: boolean;
  onClose: () => void;
  /** Resolves TRUE when the post was created. False keeps the sheet, the format and the
   *  subject — a refused write must not also discard what the client typed. */
  onSubmit: (spec: AddSpec) => Promise<boolean>;
}) {
  const [format, setFormat] = useState<PostFormat>('single');
  const [subject, setSubject] = useState('');
  const [pillar, setPillar] = useState(pillars?.[0] ?? '');

  // Re-seed on each open: a subject typed for last Tuesday must not follow you to Thursday.
  const [seeded, setSeeded] = useState<string | null>(null);
  if (open && seeded !== date) {
    setSeeded(date);
    setFormat('single');
    setSubject('');
    setPillar(pillars?.[0] ?? '');
  }

  if (!open) return null;

  const panel = chrome === 'panel';
  const Frame = panel ? Panel : Sheet;

  const submit = async () => {
    if (busy) return;
    const ok = await onSubmit(pillars ? { format, subject: subject.trim(), pillar } : { format, subject: subject.trim() });
    if (ok) onClose();
  };

  return (
    <Frame open={open} label={`Plan a post for ${dayTitle(date)}`} testid="add-sheet" onClose={onClose}>
      <>
        {/* THE WAY BACK, and it is not decoration. A panel replaces the day column outright, so
            without this the client taps "Plan a post" and the day's other posts are simply gone
            with no control that says otherwise. Verbatim the rule DetailSheet's panel branch
            follows, down to naming the DAY rather than saying "Back": a direction tells you
            which way, a day tells you where you land. A sheet needs none of it — it has a scrim
            and a grabber, and the day is still behind it. */}
        {panel && (
          <button
            type="button" data-testid="add-back" onClick={onClose}
            className="flex min-h-[44px] flex-none items-center gap-1.5 border-b border-line/30 px-3 text-left text-[13.5px] font-semibold text-muted transition-colors duration-100 hover:text-chrome"
          >
            <ChevronL className="h-[15px] w-[15px]" />
            {dayTitle(date)}
          </button>
        )}

        <div className="flex-none border-b border-line/30 px-[18px] pb-3.5 pt-1.5">
          <h2 className="mb-1 text-[20px] font-bold tracking-[-.025em] text-chrome">Plan a post</h2>
          <p className="text-[13.5px] font-medium text-muted">{dayTitle(date)}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-[18px] pb-4 pt-4 [scrollbar-width:none]">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted">Format</h3>
          <FormatControl value={format} onChange={setFormat} disabled={busy} testid="add-format" />

          {pillars && pillars.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[.1em] text-muted">Pillar</h3>
              <select
                data-testid="add-pillar" value={pillar} disabled={busy}
                onChange={(e) => setPillar(e.target.value)}
                aria-label="Pillar"
                className="min-h-[48px] w-full rounded-[14px] border border-line/55 bg-surface px-3.5 text-[15px] text-chrome outline-none"
              >
                {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </>
          )}

          <h3 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[.1em] text-muted">
            What is it? <span className="font-semibold normal-case tracking-normal text-muted">— optional</span>
          </h3>
          <textarea
            data-testid="add-subject" value={subject} disabled={busy}
            onChange={(e) => setSubject(e.target.value)}
            /* A worked example of the SHAPE, naming nobody's catalogue — the third place the
               Earl of East candle was rendering on every tenant's surface. */
            placeholder="A restock, an event, a story you want told"
            className="min-h-[96px] w-full rounded-[14px] border border-line/55 bg-surface p-3.5 text-[16.5px] leading-[1.45] text-chrome outline-none placeholder:text-muted"
          />
          <p className="mt-2 text-[12.5px] leading-normal text-muted">
            {pillars
              ? 'Say what it should be about and we’ll name the slot. Leave it blank and we’ll hold the space.'
              : 'Say what it should be about and we’ll start writing the caption. Leave it blank and we’ll hold the space.'}
          </p>
        </div>

        {/* `pb-[26px]` on the sheet is the home-indicator inset; a panel sits in a column and
            has no such edge to clear. And the button is sized to its CONTENT in a panel: a
            full-width bar is a phone affordance, where it is the thumb's target and the last
            thing on the screen. In a column it is one control among several. */}
        <div className={`flex flex-none gap-2 border-t border-line/30 bg-surface px-[18px] pt-3 ${panel ? 'pb-4' : 'pb-[26px]'}`}>
          <button
            type="button" data-testid="add-confirm" onClick={() => void submit()} disabled={busy}
            className={`flex min-h-[50px] items-center justify-center rounded-[14px] bg-coral-650 text-[15px] font-bold text-white shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)] disabled:bg-line-soft disabled:text-muted disabled:shadow-none ${panel ? 'px-6' : 'flex-1'}`}
          >
            {busy ? 'Adding…' : 'Add it'}
          </button>
        </div>
      </>
    </Frame>
  );
}
