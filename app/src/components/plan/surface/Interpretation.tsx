'use client';

/**
 * Interpretation.tsx — what the client is agreeing to, itemised.
 *
 * ── The thing this replaces ──────────────────────────────────────────────────────────
 *
 * The voice sheet used to close on send, and the agent's changes landed as pending PROPOSALS
 * with a toast telling the client to go and approve them in Approvals. Approvals is a desktop
 * view. On a phone it does not exist. So the north-star gesture — say a sentence, watch the
 * month change — ended with a message pointing at a screen the client could not reach, and the
 * changes sat unapplied.
 *
 * The ruling: proposals die as a concept on mobile. Consent happens once, here, in the sheet
 * they are already looking at, before anything is written to their plan.
 *
 * ── Why the INTERPRETATION and not the transcript ────────────────────────────────────
 *
 * Three things could be shown after somebody speaks, and only one of them is worth agreeing to:
 *
 *   the transcript      what they said. They know. It asks them to check our HEARING.
 *   the intent          `{action:'move_post', postId:'…'}`. A fact about our datastore.
 *   the interpretation  "Move 'Fragrance Note Deep Dive: Summer' → Wed 12 Aug".
 *
 * Only the third is checkable. It names the post they will recognise and the date it will land
 * on, so a misheard word shows up as a wrong title rather than as a surprise next week.
 *
 * ── The derivation rule ──────────────────────────────────────────────────────────────
 *
 * Every line is BUILT here, from the resolved fields on the item — never a sentence the model
 * wrote. `verb` comes from the action, the title is the post's own, the date is formatted by
 * this surface from an ISO string. This is the rationale-evidence rule applied to consent: the
 * client approves the change, not a claim about the change.
 *
 * It is also why this file, and not the server, owns the words: the same structured item has to
 * be renderable in the same register as the decomposer rollup and the diff receipts, and that
 * register lives on the client.
 */
import React from 'react';
import type { InterpretedItem } from '@/lib/agent/types';
import { AgentDots } from './AgentVoice';
import { SprigMarkV2 } from './icons';

/** 'YYYY-MM-DD' → 'Wed 12 Aug'. The surface owns its own date rendering. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${day} ${d.getDate()} ${month}`;
}

const FORMAT_WORD: Record<string, string> = { reel: 'reel', carousel: 'carousel', single: 'single image', email: 'email' };

/**
 * One line, computed. Returned as parts rather than a string so the title can be quoted and
 * the destination emphasised without the caller parsing prose back apart.
 */
export interface Line { verb: string; title: string | null; tail: string | null }

export function lineFor(item: Extract<InterpretedItem, { kind: 'change' }>): Line {
  const fmt = item.format ? FORMAT_WORD[item.format] ?? item.format : null;
  switch (item.action) {
    case 'move':
      // BOTH dates (F3a). The source is the resolved answer to a relative reference —
      // "Friday's post" resolves to a real Friday, and this line is where a wrong resolution
      // becomes visible and discardable BEFORE it applies. Omitting the source made the one
      // field the client most needs to check invisible.
      return {
        verb: 'Move', title: item.title,
        tail: item.toDate
          ? `${item.fromDate ? `${shortDate(item.fromDate)} ` : ''}→ ${shortDate(item.toDate)}`
          : item.fromDate ? shortDate(item.fromDate) : null,
      };
    case 'add':
      // No subject stated → the line names what it can, which is the format and the day. It
      // never invents a topic to fill the gap.
      return {
        verb: fmt ? `Add a ${fmt}` : 'Add a post',
        title: item.title,
        tail: item.toDate ? shortDate(item.toDate) : null,
      };
    case 'remove':
      return { verb: 'Remove', title: item.title, tail: item.fromDate ? shortDate(item.fromDate) : null };
    case 'rewrite':
      return { verb: 'Rewrite the caption for', title: item.title, tail: item.fromDate ? shortDate(item.fromDate) : null };
    case 'format':
      return { verb: 'Change', title: item.title, tail: fmt ? `to a ${fmt}` : null };
    case 'hook':
      return { verb: 'Generate hooks for', title: item.title, tail: item.fromDate ? shortDate(item.fromDate) : null };
    case 'refine':
      return { verb: `Refine the ${item.target ?? 'caption'} for`, title: item.title, tail: item.fromDate ? shortDate(item.fromDate) : null };
    default:
      return { verb: 'Change', title: item.title, tail: null };
  }
}

/**
 * Where an interpretation turn stands in its life. `open` is the only actionable state.
 *
 * `superseded` (C3): the client corrected this change before applying it, so a NEWER
 * interpretation below replaces it and this one's proposals have been rejected. It stays
 * VISIBLE — the thread is the record of what was said — and stops being applicable, because
 * two versions of one change must never both be.
 */
export type InterpretationStatus = 'open' | 'applying' | 'resolved' | 'discarded' | 'superseded';

/**
 * ── THE INTERPRETATION, AS A TURN (the conversation sheet) ───────────────────────────
 *
 * The consent moment is no longer a phase that REPLACES the sheet's body — it is one turn of
 * the thread, in the agent's register, with its actions inline. The client reads it where the
 * conversation happened, answers a question by just talking (the composer never unmounted), and
 * Apply/Discard live on the turn they act on. The dead-end — a full-screen consent state with
 * no way to reply — is gone by construction.
 *
 * Everything about the DERIVATION is unchanged: every line is built from the resolved fields
 * on the item (lineFor), never a sentence the model wrote.
 *
 * `live` gates the aria-live region: only the NEWEST turn of a thread announces. A history of
 * ten status regions would re-announce the whole conversation at every render.
 */
export function InterpretationTurn({
  items, status, busy, live = false, onApply, onDiscard, onDropItem,
}: {
  items: readonly InterpretedItem[];
  status: InterpretationStatus;
  /** A write is in flight somewhere. The actions are inert. */
  busy?: boolean | undefined;
  live?: boolean | undefined;
  onApply?: (() => void) | undefined;
  onDiscard?: (() => void) | undefined;
  /** Per-item discard. Cheap because a change IS a proposal row, and dropping one is a reject. */
  onDropItem?: ((proposalId: string) => void) | undefined;
}) {
  const changes = items.filter((i): i is Extract<InterpretedItem, { kind: 'change' }> => i.kind === 'change');
  const applicable = status === 'open' && changes.length > 0 && !!onApply;

  return (
    <div
      data-testid="interpretation" data-status={status}
      {...(live ? { role: 'status' as const, 'aria-live': 'polite' as const } : {})}
      aria-label="What we understood"
      className="mr-8 rounded-[14px] border-l-[3px] border-coral-700 bg-coral-100 px-3 py-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <SprigMarkV2 aria-hidden="true" className="h-[15px] w-[15px] flex-none text-coral-700" />
        <span className="text-[11px] font-bold uppercase tracking-[.1em] text-coral-800">
          Here’s what I understood
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item, i) => {
          if (item.kind === 'idea') {
            return (
              <li key={`idea-${i}`} data-testid="interp-idea" className="text-[14.5px] leading-[1.45] text-coral-800">
                <span className="font-semibold">Saved to your ideas</span>
                <span className="text-coral-700"> — couldn’t place a date.</span>
                <span className="mt-0.5 block">“{item.text}”</span>
              </li>
            );
          }
          if (item.kind === 'unresolved') {
            return (
              <li key={`un-${i}`} data-testid="interp-unresolved" className="text-[14.5px] leading-[1.45] text-coral-800">
                {item.question}
              </li>
            );
          }
          const { verb, title, tail } = lineFor(item);
          return (
            <li key={item.proposalId} data-testid="interp-change" data-proposal-id={item.proposalId}
              className="flex items-start gap-2 text-[14.5px] leading-[1.45] text-coral-800">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{verb}</span>
                {title ? <span> “{title}”</span> : null}
                {tail ? <span className="font-semibold"> {tail}</span> : null}
              </span>
              {onDropItem && status === 'open' && (
                <button
                  type="button" data-testid="interp-drop" disabled={busy}
                  aria-label={`Leave out: ${verb}${title ? ` ${title}` : ''}`}
                  onClick={() => onDropItem(item.proposalId)}
                  // 44px of hit area around a small glyph — visually inert, thumb-sized.
                  className="-my-2 -mr-1 flex h-11 w-11 flex-none items-center justify-center text-coral-700 disabled:opacity-40"
                >
                  <span aria-hidden="true" className="text-[17px] leading-none">×</span>
                </button>
              )}
            </li>
          );
        })}
        {!items.length && (
          <li data-testid="interp-empty" className="text-[14.5px] leading-[1.45] text-coral-800">
            I didn’t catch anything to change there. Try again, or type it.
          </li>
        )}
      </ul>

      {/*
        APPLY. Not "Approve" — the word is fenced out of this flow (terminology.fence.test.ts).
        Approve is what you do to somebody else's work before they proceed; this is the client's
        own plan and the button is the moment it changes.

        ABSENT, not disabled, when nothing is applicable — and absent once the turn resolved:
        a receipt does not need a second Apply. The one working indicator during the apply is
        the dots (spec: no secondary status bars).
      */}
      {status === 'applying' && (
        <div className="mt-2.5 flex items-center gap-2">
          <AgentDots />
          <span className="text-[12.5px] font-semibold text-coral-800">Applying</span>
        </div>
      )}
      {status === 'discarded' && (
        <p data-testid="interp-discarded" className="mt-2 text-[12.5px] font-semibold text-coral-700">
          Discarded — nothing changed.
        </p>
      )}
      {status === 'superseded' && (
        <p data-testid="interp-superseded" className="mt-2 text-[12.5px] font-semibold text-coral-700">
          Replaced by what you said next.
        </p>
      )}
      {applicable && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button" data-testid="interp-discard" disabled={busy} onClick={onDiscard}
            className="min-h-[44px] flex-none rounded-[12px] bg-surface px-4 text-[13.5px] font-semibold text-chrome ring-1 ring-inset ring-line/55 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button" data-testid="interp-apply" disabled={busy} onClick={onApply}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] bg-coral-650 text-[14px] font-bold text-white disabled:bg-line-soft disabled:text-muted"
          >
            {`Apply ${changes.length === 1 ? 'this change' : `these ${changes.length} changes`}`}
          </button>
        </div>
      )}
    </div>
  );
}
