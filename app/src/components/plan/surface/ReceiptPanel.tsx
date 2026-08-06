'use client';

/**
 * ReceiptPanel.tsx — what the chip expands into. (mockup 08)
 *
 * Two receipts, one panel, because they are the same record at two sizes:
 *
 *   a single instruction  the client's words, then one line per delta.
 *   a pasted brief        one line per SEGMENT, each applied line expandable to its own diff and
 *                         each idea line carrying the rescue tap.
 *
 * Real clients paste briefs rather than sentences — Sally's August brief was ~700 words holding
 * fourteen separate instructions — so the second case is the normal one, not the exotic one.
 *
 * IT REPLACES THE VIEW rather than stacking over it. Not a sheet: a sheet implies a task to
 * finish and a way out that has to be found, and this is a thing to read. The nav pill stays
 * live underneath, so leaving is the same gesture as changing view.
 *
 * NOTHING IS SILENTLY DEMOTED. A segment that only reached the ideas list says so on its own
 * line, in its own words, with a one-tap way into the month. The copy for a `couldnt_apply`
 * admits what happened rather than calling it a filing the client asked for — that silent
 * demotion cost a client their Meadow launch twice.
 */
import React, { useState } from 'react';
import type { DraftReceipt, BriefItem } from '../DraftPlanView';
import { ChevronD, ChevronR, CheckGlyph } from './icons';
// The same stripper the thread renders the agent's prose through (agent-prose.ts). Shared so a
// `**bold**` marker cannot survive in one surface and not the other.
import { stripMarkdown } from './agent-prose';
import { rollupHeadline, countItems } from './receipt-summary';
import { evergreenCopy } from '@/lib/receipt-copy';
import { scrollPad } from './frame';

export function ReceiptPanel({
  receipt, monthName, editable, rescuing, onRescue, onClear,
}: {
  receipt: DraftReceipt;
  monthName: string;
  editable: boolean;
  rescuing: boolean;
  onRescue: (planInputId: string) => void;
  onClear: () => void;
}) {
  return (
    // The fifth scrolling panel, and the one that had the pill's reservation written out as a
    // literal instead of taking it from `scrollPad`. Routed through the same function so the
    // inset arithmetic reaches it too — identical output today at a zero inset, correct on the
    // day `viewport-fit=cover` is enabled. It still passes 'mobile' unconditionally, which is
    // the PRE-EXISTING behaviour of the literal it replaces: this panel takes no `frame` prop,
    // so on the desktop draft surface it reserves 104px it does not need. That is a separate
    // and much smaller defect (dead space, not hidden content) and is deliberately left alone
    // here rather than threaded through two call sites on a surface this fix was not about.
    <div data-testid="receipt-panel" className={`flex-1 overflow-y-auto px-5 pt-4 [scrollbar-width:none] ${scrollPad('mobile')}`}>
      {receipt.items ? (
        <Rollup receipt={receipt} items={receipt.items} editable={editable} rescuing={rescuing} onRescue={onRescue} />
      ) : (
        <Single receipt={receipt} monthName={monthName} editable={editable} rescuing={rescuing} onRescue={onRescue} />
      )}

      {/* Clearing, as a quiet text action rather than a ✕ on the chip. */}
      <button
        type="button" data-testid="clear-summary" onClick={onClear}
        className="mt-6 min-h-[44px] w-full text-[13.5px] font-semibold text-muted"
      >
        Clear this summary
      </button>
      <p className="mt-1 text-center text-[12.5px] leading-normal text-muted">
        The marks on what changed stay either way.
      </p>
    </div>
  );
}

/** One instruction, and the deltas it produced. */
function Single({
  receipt, monthName, editable, rescuing, onRescue,
}: {
  receipt: DraftReceipt; monthName: string; editable: boolean; rescuing: boolean; onRescue: (id: string) => void;
}) {
  const evergreen = receipt.scope === 'evergreen';
  /**
   * AN ANSWER IS NOT A CHANGE, AND MUST NOT WEAR ITS CHROME.
   *
   * A question receipt has always been persisted here — it carries `changedIds: []` precisely
   * because nothing changed — and it has always rendered under *"What changed"* with a tick
   * beside every line. That was survivable while the lines were a terse read-back of the beats.
   * It is not survivable now the lines are the agent's prose: a paragraph explaining that four
   * of next week's five posts have no captions yet, ticked off as though we had just written
   * them, tells the client the opposite of what it says.
   *
   * So the question scope gets its own heading and no glyph. It keeps the quoted question above
   * it, which is what makes the panel readable as a Q and an A rather than a log.
   */
  const answered = receipt.scope === 'question';
  const copy = evergreenCopy(receipt.reason, monthName);
  return (
    <>
      <h2 className="mb-2 text-[20px] font-bold tracking-[-.025em] text-chrome">
        {evergreen ? copy.heading
          : answered ? 'You asked'
          : 'What changed'}
      </h2>
      <p data-testid="receipt-source" className="mb-3 break-words text-[13.5px] italic leading-normal text-muted">“{receipt.sourceText}”</p>

      {answered ? (
        <div data-testid="receipt-answer" className="flex flex-col gap-2">
          {receipt.lines.map((line) => (
            <p key={line} className="text-[15px] leading-[1.5] text-chrome">{stripMarkdown(line)}</p>
          ))}
        </div>
      ) : evergreen ? (
        // Every word of this — and whether the rescue tap appears below — comes from
        // `evergreenCopy`, so the chip, this panel and the legacy view cannot drift apart.
        <p className="text-[15px] leading-[1.5] text-chrome">{copy.body}</p>
      ) : receipt.lines.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {receipt.lines.map((line) => (
            <li key={line} data-testid="receipt-line" className="flex gap-2.5 text-[15px] leading-[1.45] text-chrome">
              <CheckGlyph className="mt-1 h-[15px] w-[15px] flex-none text-coral-800" />
              <span className="min-w-0 flex-1">{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[15px] leading-[1.5] text-chrome">Nothing needed changing.</p>
      )}

      {receipt.note && <p className="mt-3 text-[13.5px] leading-normal text-muted">{receipt.note}</p>}
      {/* THE RESCUE TAP IS WITHHELD ON A SUSPECTED MISREAD, and that is not a copy decision.
          `addBacklogItemToMonth` re-routes the filed row as kind:'event' with its first 80
          characters as the SUBJECT, displacing the weakest beat to make room — so on "can you
          move one of the posts to the next available empty day?" the one button we offer would
          create a post titled with the instruction and evict a real one. */}
      {evergreen && copy.rescue && receipt.planInputId && editable && (
        <RescueBtn busy={rescuing} onClick={() => onRescue(receipt.planInputId!)} />
      )}
    </>
  );
}

/** A pasted brief: one line per segment. */
function Rollup({
  receipt, items, editable, rescuing, onRescue,
}: {
  receipt: DraftReceipt; items: BriefItem[]; editable: boolean; rescuing: boolean; onRescue: (id: string) => void;
}) {
  const parts = countItems(items);
  return (
    <>
      <h2 className="mb-1 text-[20px] font-bold tracking-[-.025em] text-chrome">{rollupHeadline(receipt)}</h2>
      <p data-testid="rollup-counts" className="mb-4 text-[13.5px] font-semibold tabular-nums text-muted">
        {parts.map((p) => `${p.count} ${p.word}`).join(' · ')}
      </p>

      <ul className="flex flex-col">
        {items.map((item, i) => <Item key={i} item={item} editable={editable} rescuing={rescuing} onRescue={onRescue} />)}
      </ul>

      {receipt.discardedCount ? (
        <p className="mt-3 text-[12.5px] leading-normal text-muted">
          {receipt.discardedCount} more {receipt.discardedCount === 1 ? 'line' : 'lines'} didn’t say anything we could act on.
        </p>
      ) : null}
    </>
  );
}

function Item({
  item, editable, rescuing, onRescue,
}: {
  item: BriefItem; editable: boolean; rescuing: boolean; onRescue: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const applied = item.outcome === 'applied';

  return (
    <li data-testid="brief-item" data-outcome={item.outcome} className="border-t border-line/30 py-3 first:border-t-0 first:pt-0">
      <div className="flex gap-2.5">
        {/* The mark is a SHAPE as well as a colour: a tick for applied, a ring for kept. */}
        <span aria-hidden="true" className="mt-[3px] flex h-[15px] w-[15px] flex-none items-center justify-center">
          {applied
            ? <CheckGlyph className="h-[15px] w-[15px] text-coral-800" />
            : <span className="block h-[9px] w-[9px] rounded-full ring-[1.5px] ring-inset ring-muted" />}
        </span>
        {/* 15px leading, per round 4's note on this panel: the segment is the thing to find,
            and its machinery sits under it at 12.5px uppercase — a distinct role rather than a
            smaller version of the same one. */}
        {/* WRAPS rather than truncating: a client has to recognise their own instruction to
            judge what we did with it, and half of it is not enough. `break-words` for the one
            segment that is a URL with nowhere to break. */}
        <span className="min-w-0 flex-1 break-words text-[15px] font-medium leading-[1.4] text-chrome">{item.span}</span>
      </div>

      {applied && item.lines.length > 0 && (
        <div className="ml-[25px] mt-1.5">
          <button
            type="button" data-testid="item-diff-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            className="flex min-h-[40px] items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.1em] text-muted"
          >
            {open ? <ChevronD className="h-3.5 w-3.5" /> : <ChevronR className="h-3.5 w-3.5" />}
            What changed
          </button>
          {open && (
            <ul data-testid="item-diff" className="flex flex-col gap-1.5 pb-1">
              {item.lines.map((line) => (
                <li key={line} className="text-[13.5px] leading-[1.4] text-chrome">{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {item.deferredCount ? (
        <p className="ml-[25px] mt-1.5 text-[12.5px] leading-normal text-muted">
          {item.deferredCount} saved for next month.
        </p>
      ) : null}
      {item.note && !applied && (
        <p className="ml-[25px] mt-1.5 text-[12.5px] leading-normal text-muted">{item.note}</p>
      )}

      {(item.outcome === 'idea' || item.outcome === 'couldnt_apply' || item.outcome === 'nothing_to_do') && item.planInputId && editable && (
        <div className="ml-[25px]">
          <RescueBtn busy={rescuing} onClick={() => onRescue(item.planInputId!)} />
        </div>
      )}
    </li>
  );
}

/** Build C's one-tap rescue, finally on the surface that needed it. The server op shipped and
 *  the control did not, so every evergreen receipt pointed at an ideas list with no way back. */
function RescueBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button" data-testid="add-to-this-month" disabled={busy} onClick={onClick}
      className="mt-2 min-h-[44px] rounded-[14px] bg-coral-100 px-3.5 text-[13.5px] font-bold text-coral-800 disabled:opacity-50"
    >
      {busy ? 'Adding…' : 'Add to this month'}
    </button>
  );
}
