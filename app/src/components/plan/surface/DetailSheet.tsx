'use client';

/**
 * DetailSheet.tsx — the post, its words, and the three things you can do to it.
 *
 * Spec §4. The structure is header → tabs → body → action row, and each part answers a
 * decision that was made more than once:
 *
 * COPY LIVES ONLY HERE, PER TAB. Round 3 also put a copy button on the committed card; round 4
 * took it back off. Copy belongs beside the words it copies, on the tab that names the field —
 * a card is a thing you read, not a thing you operate.
 *
 * REASONING SITS BEHIND THE INSIGHTS TOGGLE. One tap reveals it ABOVE the tabs. It is not in
 * the way of the words the client came for, and it is one tap from every post rather than a
 * paragraph on every card. Per-post assumptions are gone entirely — an assumption is a property
 * of the month, and belongs in the month's framing once rather than on ten sheets.
 *
 * THE ACTION ROW IS THREE EQUAL BUTTONS, icon with the label BELOW. Round 3 shipped these
 * icon-only and recorded labels as "the designated cheap reversal"; round 4 exercised it. Delete
 * is a solid `danger` fill with white icon and label (5.94:1) — a destructive action should not
 * have to be inferred from the colour of its text.
 *
 * SHAPE REPLACES THE FOOTER WHOLESALE. Not relabelled: a button must never change meaning
 * mid-flow, which is exactly what round 4's "Cancel" sitting in the Shape slot did. The cancel
 * beside the submit is a QUIET NEUTRAL and never red (round-5.1 X1) — one screen earlier a red
 * button of the same family destroys the post, and a cancel is the opposite of a delete.
 * `danger` is Delete's monopoly here.
 *
 * THE PLANNED-POST VARIANT HAS NO TABS. There is nothing written yet, so the sheet says so
 * rather than showing three empty ones, and Shape is absent because there is nothing to rewrite.
 */
import React, { useEffect, useState } from 'react';
import type { PlanPost } from '@/lib/types';
import type { PlanData, ShapeTarget } from '../usePlanData';
import { FormatTile, InfoGlyph, CopyGlyph, CalGlyph, SparkleGlyph, BinGlyph, SendGlyph } from './icons';
import { cardText } from './card-text';
import { dayTitle } from './dates';
import { isOnTheWay, ON_THE_WAY_LABEL, ON_THE_WAY_BODY } from '@/lib/generation-state';
import { Sheet } from './Sheet';

type Tab = ShapeTarget;
const TABS: { key: Tab; label: string }[] = [
  { key: 'caption', label: 'Caption' },
  { key: 'hook', label: 'Hook' },
  { key: 'script', label: 'Script' },
];

const fieldOf = (post: PlanPost, tab: Tab): string =>
  (tab === 'caption' ? post.caption : tab === 'hook' ? post.hook : post.script) ?? '';

export function DetailSheet({
  post, data, rationale, onClose, onMove, onDelete,
}: {
  post: PlanPost | null;
  data: PlanData;
  /** "Why this one is here", when the post carries evidence for it. Empty → no toggle at all:
   *  an insights button that opens nothing is worse than no button. */
  rationale: string;
  onClose: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<Tab>('caption');
  const [insights, setInsights] = useState(false);
  const [shaping, setShaping] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [copied, setCopied] = useState<Tab | null>(null);

  // A new post is a new sheet: never inherit the last one's tab, its open insights, or —
  // above all — a half-typed instruction meant for a different post.
  const [openedId, setOpenedId] = useState<string | null>(null);
  if (post && openedId !== post.id) {
    setOpenedId(post.id);
    setTab('caption');
    setInsights(false);
    setShaping(false);
    setInstruction('');
  }

  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 1600); return () => clearTimeout(t); }, [copied]);

  if (!post) return null;

  const { heading } = cardText(post);
  const onWay = isOnTheWay(post.status);
  const written = !!(post.caption || post.hook || post.script);
  const editable = data.canEdit(post.date);
  const body = fieldOf(post, tab);
  const busy = data.shapingIds.has(post.id);

  const copy = async () => {
    try { await navigator.clipboard.writeText(body); setCopied(tab); }
    catch { data.flash('Couldn’t copy that. Select the text and copy it yourself.'); }
  };

  const submitShape = () => {
    if (!instruction.trim()) return;
    void data.shape(post.id, instruction.trim(), tab);
    setShaping(false);
    setInstruction('');
  };

  return (
    <Sheet open label={heading} testid="detail-sheet" onClose={onClose}>
      <>
        <div className="flex-none border-b border-line/30 px-[18px] pb-3.5 pt-1.5">
          <div className="flex items-start gap-3">
            <FormatTile format={post.format} large />
            <div className="min-w-0 flex-1">
              <h2 className="mb-1 text-[20px] font-bold leading-[1.25] tracking-[-.025em] text-chrome">{heading}</h2>
              <p data-testid="detail-meta" className="text-[13.5px] font-medium text-muted">
                {[dayTitle(post.date), post.postingTime, post.pillar].filter(Boolean).join(' · ')}
              </p>
            </div>
            {rationale && (
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

        {insights && rationale && (
          <div data-testid="insights" className="flex-none px-[18px] pt-3">
            <div className="rounded-2xl border border-coral-600/45 bg-coral-100 px-3.5 py-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[.1em] text-coral-800">Why this one is here</h3>
              <p className="mt-1.5 text-[13.5px] leading-normal text-coral-800">{rationale}</p>
            </div>
          </div>
        )}

        {written && !onWay && (
          <div role="tablist" aria-label="Post fields" className="flex flex-none gap-1 px-[18px] pt-3">
            {TABS.map(({ key, label }) => {
              const empty = !fieldOf(post, key);
              return (
                <button
                  key={key} type="button" role="tab" aria-selected={tab === key} disabled={empty}
                  data-testid={`tab-${key}`} onClick={() => setTab(key)}
                  className={[
                    'min-h-[40px] flex-1 rounded-[14px] text-[13.5px] font-semibold',
                    tab === key ? 'bg-chrome text-white' : 'bg-line-soft text-muted',
                    empty ? 'opacity-40' : '',
                  ].join(' ')}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-[18px] pb-4 pt-3 [scrollbar-width:none]">
          {shaping ? (
            <>
              <p className="text-[13.5px] leading-normal text-muted">
                What should be different? We’ll keep the date, the format and the pillar exactly as they are.
              </p>
              <textarea
                data-testid="shape-input" autoFocus value={instruction} onChange={(e) => setInstruction(e.target.value)}
                placeholder="Warmer, and mention the relaunch earlier"
                className="mt-3 min-h-[120px] w-full rounded-[14px] border border-line/55 bg-surface p-3.5 text-[16.5px] leading-[1.45] text-chrome outline-none placeholder:text-muted/70"
              />
            </>
          ) : onWay ? (
            <div data-testid="detail-on-the-way" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
              <p className="text-[15px] font-semibold text-chrome">{ON_THE_WAY_LABEL}</p>
              <p className="mt-1.5 text-[13.5px] leading-normal text-muted">{ON_THE_WAY_BODY}</p>
            </div>
          ) : written ? (
            <>
              <div className="mb-1.5 flex justify-end">
                <button
                  type="button" data-testid="copy-field" onClick={() => void copy()}
                  aria-label={`Copy the ${tab}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-line-soft text-chrome"
                >
                  <CopyGlyph className="h-[17px] w-[17px]" />
                </button>
              </div>
              {copied === tab && <p data-testid="copied" role="status" className="mb-1.5 text-right text-[12.5px] font-semibold text-coral-800">Copied</p>}
              <p data-testid="field-body" className="whitespace-pre-wrap text-[15px] leading-[1.62] text-chrome">{body}</p>
            </>
          ) : (
            // The planned-post variant: no tabs, and a sentence instead of three empty ones.
            <div data-testid="not-written-yet" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
              <p className="text-[15px] font-semibold text-chrome">Nothing written yet</p>
              <p className="mt-1.5 text-[13.5px] leading-normal text-muted">
                This slot is held for you. The words arrive when the month is generated.
              </p>
            </div>
          )}
        </div>

        {shaping ? (
          <div className="flex flex-none gap-2 border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-3">
            <button
              type="button" data-testid="shape-submit" aria-label="Send this instruction"
              disabled={!instruction.trim()} onClick={submitShape}
              className="flex min-h-[56px] flex-1 items-center justify-center rounded-2xl bg-coral-650 text-white shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)] disabled:bg-line-soft disabled:text-muted disabled:shadow-none"
            >
              <SendGlyph className="h-[26px] w-[26px] [stroke-width:2.2]" />
            </button>
            {/* QUIET NEUTRAL, never red (X1). danger is Delete's monopoly on this surface. */}
            <button
              type="button" data-testid="shape-cancel" onClick={() => { setShaping(false); setInstruction(''); }}
              className="flex min-h-[56px] w-[88px] flex-none items-center justify-center rounded-2xl bg-surface text-[15px] font-semibold text-muted ring-1 ring-inset ring-line/55"
            >
              Cancel
            </button>
          </div>
        ) : editable ? (
          <div className="flex flex-none gap-2 border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-3">
            <ActionBtn testid="act-move" label="Move" onClick={onMove}><CalGlyph className="h-5 w-5" /></ActionBtn>
            {/* Shape is absent when there is nothing to rewrite — a rewrite of an empty field
                is not a cheaper version of writing it, it is a paid no-op. */}
            {written && !onWay && (
              <ActionBtn testid="act-shape" label="Shape" disabled={busy} onClick={() => setShaping(true)}>
                <SparkleGlyph className="h-5 w-5" />
              </ActionBtn>
            )}
            <ActionBtn testid="act-delete" label="Delete" destructive onClick={onDelete}>
              <BinGlyph className="h-5 w-5" />
            </ActionBtn>
          </div>
        ) : null}
      </>
    </Sheet>
  );
}

/** One of the three. Equal width, icon over label, and a real pressed state so it reads as a
 *  button rather than as an icon somebody made tappable. 68px clears every touch floor. */
function ActionBtn({
  testid, label, onClick, children, destructive, disabled,
}: {
  testid: string; label: string; onClick: () => void; children: React.ReactNode;
  destructive?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button" data-testid={testid} onClick={onClick} disabled={disabled}
      className={[
        'flex min-h-[68px] flex-1 flex-col items-center justify-center gap-[3px] rounded-2xl px-1 py-2 transition-colors duration-100',
        destructive
          // White on danger is 5.94:1. The only saturated fill on the surface, on the only
          // action that destroys something.
          ? 'bg-danger text-white active:bg-danger/[.86]'
          : 'bg-surface text-chrome ring-1 ring-inset ring-line/55 active:bg-line-soft active:ring-line',
        disabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      {children}
      <span className="text-[12.5px] font-semibold tracking-[-.01em]">{label}</span>
    </button>
  );
}
