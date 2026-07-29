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
import { FormatControl } from './FormatControl';
import { dayTitle } from './dates';

export interface AddSpec {
  format: PostFormat;
  /** '' when they did not say. Never invented. */
  subject: string;
  /** Draft months only — the client's own vocabulary, checked server-side regardless. */
  pillar?: string | undefined;
}

export function AddSheet({
  open, date, pillars, busy, onClose, onSubmit,
}: {
  open: boolean;
  date: string;
  /** The client's configured pillars on a DRAFT month; null on a committed one. */
  pillars: string[] | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (spec: AddSpec) => void;
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

  const submit = () => {
    if (busy) return;
    onSubmit(pillars ? { format, subject: subject.trim(), pillar } : { format, subject: subject.trim() });
  };

  return (
    <Sheet open={open} label={`Plan a post for ${dayTitle(date)}`} testid="add-sheet" onClose={onClose}>
      <>
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
            What is it? <span className="font-semibold normal-case tracking-normal text-muted/80">— optional</span>
          </h3>
          <textarea
            data-testid="add-subject" value={subject} disabled={busy}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="The Wilderness candle, back in stock"
            className="min-h-[96px] w-full rounded-[14px] border border-line/55 bg-surface p-3.5 text-[16.5px] leading-[1.45] text-chrome outline-none placeholder:text-muted/70"
          />
          <p className="mt-2 text-[12.5px] leading-normal text-muted">
            {pillars
              ? 'Say what it should be about and we’ll name the slot. Leave it blank and we’ll hold the space.'
              : 'Say what it should be about and we’ll start writing the caption. Leave it blank and we’ll hold the space.'}
          </p>
        </div>

        <div className="flex flex-none gap-2 border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-3">
          <button
            type="button" data-testid="add-confirm" onClick={submit} disabled={busy}
            className="flex min-h-[50px] flex-1 items-center justify-center rounded-[14px] bg-coral-650 text-[15px] font-bold text-white shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)] disabled:bg-line-soft disabled:text-muted disabled:shadow-none"
          >
            {busy ? 'Adding…' : 'Add it'}
          </button>
        </div>
      </>
    </Sheet>
  );
}
