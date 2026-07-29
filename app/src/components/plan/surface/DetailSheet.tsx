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
import { FormatTile, InfoGlyph, CopyGlyph, CalGlyph, SparkleGlyph, BinGlyph, SendGlyph, FORMAT_WORD } from './icons';
import { cardText } from './card-text';
import { dayTitle } from './dates';
import { isOnTheWay, ON_THE_WAY_LABEL, ON_THE_WAY_BODY } from '@/lib/generation-state';
import { Sheet } from './Sheet';
import { FormatControl } from './FormatControl';
import { Skeleton } from './Skeleton';
import { TaskList } from './TaskList';
import { formatChangeNote, formatNeedsHook, formatNeedsScript } from './format-change';
import type { PostFormat } from '@/lib/types';

type Tab = ShapeTarget;
const TABS: { key: Tab; label: string }[] = [
  { key: 'caption', label: 'Caption' },
  { key: 'hook', label: 'Hook' },
  { key: 'script', label: 'Script' },
];

const fieldOf = (post: PlanPost, tab: Tab): string =>
  (tab === 'caption' ? post.caption : tab === 'hook' ? post.hook : post.script) ?? '';

/**
 * Which tabs this format HAS, as opposed to which ones happen to be filled (round 6, P3).
 *
 * A single post has no hook and no script, and it never will — the endpoints refuse both. Round 5
 * rendered all three tabs and disabled the empty ones, which meant a single post showed two
 * permanently dead controls and a carousel with no hook yet looked identical to one that can
 * never have a caption. Absent is a different fact from empty, and only one of them is worth a
 * tab.
 */
const tabsFor = (format: string): { key: Tab; label: string }[] =>
  TABS.filter(({ key }) =>
    key === 'caption' || (key === 'hook' && formatNeedsHook(format)) || (key === 'script' && formatNeedsScript(format)));

/** Script lengths the generator accepts. The picker is compact because the choice is rare. */
const SCRIPT_LENGTHS = [15, 30, 60, 90] as const;

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
  const [formatNote, setFormatNote] = useState('');
  /** Set when a format change left completed checklist steps to decide about. */
  const [pendingFormat, setPendingFormat] = useState<string | null>(null);
  const [scriptLen, setScriptLen] = useState(30);

  // A new post is a new sheet: never inherit the last one's tab, its open insights, or —
  // above all — a half-typed instruction meant for a different post.
  const [openedId, setOpenedId] = useState<string | null>(null);
  if (post && openedId !== post.id) {
    setOpenedId(post.id);
    setTab('caption');
    setInsights(false);
    setShaping(false);
    setInstruction('');
    setFormatNote('');
    setPendingFormat(null);
    setScriptLen(post.scriptLengthSeconds ?? 30);
  }

  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 1600); return () => clearTimeout(t); }, [copied]);

  if (!post) return null;

  const { heading } = cardText(post);
  const onWay = isOnTheWay(post.status);
  const written = !!(post.caption || post.hook || post.script);
  const editable = data.canEdit(post.date);
  const body = fieldOf(post, tab);
  const busy = data.shapingIds.has(post.id);
  const tabs = tabsFor(post.format);
  // A tab can vanish under you: turn a reel into a single post while the Script tab is open and
  // the tab it names no longer exists. Fall back to the caption rather than rendering nothing.
  const openTab: Tab = tabs.some((t) => t.key === tab) ? tab : 'caption';

  const copy = async () => {
    try { await navigator.clipboard.writeText(fieldOf(post, openTab)); setCopied(openTab); }
    catch { data.flash('Couldn’t copy that. Select the text and copy it yourself.'); }
  };

  const submitShape = () => {
    if (!instruction.trim()) return;
    void data.shape(post.id, instruction.trim(), openTab);
    setShaping(false);
    setInstruction('');
  };

  /**
   * Change the format, then reconcile the two things that follow it.
   *
   * The checklist rule is `PostEditor`'s, unchanged: regenerate silently when there is no
   * progress to lose, and ASK when there is — replacing a checklist somebody has been ticking is
   * not a side effect of choosing a format.
   *
   * The hook and script are NOT touched by the mutation (see format-change.ts), so the note says
   * what is actually true rather than claiming a cleanup that did not happen.
   */
  const changeFormat = async (fmt: PostFormat) => {
    if (fmt === post.format || !editable) return;
    const doneCount = post.steps.filter((s) => s.done).length;
    setFormatNote(formatChangeNote(fmt, { hook: !!post.hook, script: !!post.script }));
    await data.changeFormat(post.id, fmt);
    if (post.steps.length === 0 || doneCount === 0) await data.regenerateChecklist(post.id);
    else setPendingFormat(fmt);
  };

  const hookCandidates = data.hookCandidates.get(post.id) ?? [];
  const generatingField =
    (openTab === 'hook' && data.hookGenerating.has(post.id)) ||
    (openTab === 'script' && data.scriptGenerating.has(post.id));
  const fieldError =
    openTab === 'hook' ? data.hookError.get(post.id)
    : openTab === 'script' ? data.scriptError.get(post.id)
    : data.shapeErrors.get(post.id);

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

        {/* ROUND 6, P2 — the format control, back. It sits under the header rather than in it:
            the header answers "which post is this", and this changes the post. */}
        {editable && !onWay && (
          <div className="flex-none px-[18px] pt-3">
            <FormatControl value={post.format} onChange={(f) => void changeFormat(f)} disabled={busy} />
            {formatNote && (
              <p data-testid="format-note" role="status" className="mt-2 text-[12.5px] leading-normal text-muted">{formatNote}</p>
            )}
            {pendingFormat && (
              <div data-testid="checklist-choice" className="mt-2.5 rounded-[14px] border border-line/55 bg-line-soft p-3">
                <p className="text-[13px] leading-normal text-chrome">
                  You’ve ticked steps on this post’s checklist. Keep them, or start the {FORMAT_WORD[pendingFormat]?.toLowerCase()} checklist instead?
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" data-testid="checklist-replace"
                    onClick={() => { setPendingFormat(null); void data.regenerateChecklist(post.id); }}
                    className="min-h-[40px] flex-1 rounded-[11px] bg-coral-650 px-3 text-[13px] font-bold text-white">
                    Start the new one
                  </button>
                  <button type="button" data-testid="checklist-keep" onClick={() => setPendingFormat(null)}
                    className="min-h-[40px] flex-1 rounded-[11px] bg-surface px-3 text-[13px] font-semibold text-muted ring-1 ring-inset ring-line/55">
                    Keep mine
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {written && !onWay && tabs.length > 1 && (
          <div role="tablist" aria-label="Post fields" className="flex flex-none gap-1 px-[18px] pt-3">
            {tabs.map(({ key, label }) => (
              // NOT disabled when empty any more (round 6, P3). An empty tab that this format
              // genuinely has is a tab with something to offer — see EmptyField below.
              <button
                key={key} type="button" role="tab" aria-selected={openTab === key}
                data-testid={`tab-${key}`} onClick={() => setTab(key)}
                className={[
                  'min-h-[40px] flex-1 rounded-[14px] text-[13.5px] font-semibold',
                  openTab === key ? 'bg-chrome text-white' : 'bg-line-soft text-muted',
                  fieldOf(post, key) ? '' : 'italic',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
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
          ) : busy || generatingField ? (
            // ROUND 6, P11 — the words being rewritten say so, in place, for as long as it takes.
            // Before this the old text simply sat there and the client tapped Shape twice.
            <Skeleton />
          ) : body ? (
            <>
              <div className="mb-1.5 flex justify-end">
                <button
                  type="button" data-testid="copy-field" onClick={() => void copy()}
                  aria-label={`Copy the ${openTab}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-line-soft text-chrome"
                >
                  <CopyGlyph className="h-[17px] w-[17px]" />
                </button>
              </div>
              {copied === openTab && <p data-testid="copied" role="status" className="mb-1.5 text-right text-[12.5px] font-semibold text-coral-800">Copied</p>}
              <p data-testid="field-body" className="whitespace-pre-wrap text-[15px] leading-[1.62] text-chrome">{body}</p>
            </>
          ) : written ? (
            // ROUND 6, P3 — a field this format HAS but has not got. Absent ≠ broken: say why it
            // can be empty, and offer the action rather than greying the tab out.
            <EmptyField
              tab={openTab} post={post} editable={editable} length={scriptLen} onLength={setScriptLen}
              candidates={hookCandidates}
              onGenerateHook={() => void data.generateHooks(post.id)}
              onPickHook={(h) => { data.clearHookCandidates(post.id); void data.saveHook(post.id, h); }}
              onGenerateScript={() => void data.generateScript(post.id, scriptLen)}
            />
          ) : (
            // The planned-post variant: no tabs, and a sentence instead of three empty ones.
            <div data-testid="not-written-yet" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
              <p className="text-[15px] font-semibold text-chrome">Nothing written yet</p>
              <p className="mt-1.5 text-[13.5px] leading-normal text-muted">
                This slot is held for you. The words arrive when the month is generated.
              </p>
            </div>
          )}

          {fieldError && !shaping && (
            <p data-testid="field-error" role="alert" className="mt-3 text-[13px] font-semibold text-chrome">{fieldError}</p>
          )}

          {/* ROUND 6, P9 — the post's own tasks, where the post is. They existed on the row and
              were visible only in a view that groups every post's tasks by due date. */}
          {post.steps.length > 0 && !shaping && (
            <TaskList
              steps={post.steps} date={post.date} editable={editable}
              onToggle={(stepId, done) => void data.toggleStep(post.id, stepId, done)}
            />
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
            <ActionBtn testid="act-move" label="Move" onClick={onMove}><CalGlyph className="h-[19px] w-[19px]" /></ActionBtn>
            {/* Shape is absent when the OPEN TAB has nothing to rewrite — a rewrite of an empty
                field is not a cheaper version of writing it, it is a paid no-op, and the tab
                already offers the action that does write it. */}
            {!!body && !onWay && (
              <ActionBtn testid="act-shape" label="Shape" disabled={busy} onClick={() => setShaping(true)}>
                <SparkleGlyph className="h-[19px] w-[19px]" />
              </ActionBtn>
            )}
            <ActionBtn testid="act-delete" label="Delete" destructive onClick={onDelete}>
              <BinGlyph className="h-[19px] w-[19px]" />
            </ActionBtn>
          </div>
        ) : null}
      </>
    </Sheet>
  );
}

/**
 * One of the three. Equal width, icon over label, and a real pressed state so it reads as a
 * button rather than as an icon somebody made tappable.
 *
 * ROUND 6, P12: 56px, not 68px. The structure, the labels and Delete's fill are round 4's and
 * are unchanged — what the phone reported was scale. A 68px slab with a 20px glyph is the height
 * of a list row, and three of them across the foot of a sheet read as a toolbar bolted on rather
 * than as the sheet's own controls. 56px with a 19px glyph is iOS weight and still eleven pixels
 * over the touch floor.
 */
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
        'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[14px] px-1 py-1.5 transition-colors duration-100',
        destructive
          // White on danger is 5.94:1. The only saturated fill on the surface, on the only
          // action that destroys something.
          ? 'bg-danger text-white active:bg-danger/[.86]'
          : 'bg-surface text-chrome ring-1 ring-inset ring-line/55 active:bg-line-soft active:ring-line',
        disabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      {children}
      <span className="text-[12px] font-semibold tracking-[-.01em]">{label}</span>
    </button>
  );
}

/**
 * A field this format has, and has not got. (round 6, P3)
 *
 * The three ways a carousel ends up with no hook are all ordinary: it took the classic generation
 * path before hooks existed, its generation failed, or its format changed after it was written.
 * None of them is a broken post, and a greyed-out tab said "broken" without saying anything else.
 *
 * The offer is absent where the endpoint would refuse — a script needs a caption first, and
 * `/api/plan/script` 422s without one. An offer that 422s is worse than no offer, so that case
 * gets the sentence and no button.
 */
function EmptyField({
  tab, post, editable, length, onLength, candidates, onGenerateHook, onPickHook, onGenerateScript,
}: {
  tab: Tab;
  post: PlanPost;
  editable: boolean;
  length: number;
  onLength: (n: number) => void;
  candidates: string[];
  onGenerateHook: () => void;
  onPickHook: (hook: string) => void;
  onGenerateScript: () => void;
}) {
  // Hook candidates are three options, not a result — the endpoint returns them for a choice.
  if (tab === 'hook' && candidates.length > 0) {
    return (
      <div data-testid="hook-candidates">
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted">Pick one</h3>
        <div className="flex flex-col gap-2">
          {candidates.map((c, i) => (
            <button
              key={i} type="button" data-testid="hook-candidate" onClick={() => onPickHook(c)}
              className="min-h-[56px] rounded-[14px] bg-surface px-3.5 py-3 text-left text-[15px] leading-[1.45] text-chrome ring-1 ring-inset ring-line/55 active:bg-line-soft"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const needsCaption = tab === 'script' && !post.caption.trim();
  const why = tab === 'hook'
    ? 'This one was written before hooks, or its format changed. Nothing is wrong with it.'
    : 'This one has no script yet — either its format changed, or it was written before scripts.';

  return (
    <div data-testid="empty-field" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
      <p className="text-[15px] font-semibold text-chrome">No {tab} yet</p>
      <p className="mt-1.5 text-[13.5px] leading-normal text-muted">{needsCaption
        ? 'The hook and the script are built around the caption, so that has to come first.'
        : why}</p>

      {editable && !needsCaption && tab === 'script' && (
        <div data-testid="script-length" className="mt-3.5 flex items-center gap-1.5">
          <span className="mr-0.5 text-[12.5px] font-semibold text-muted">Length</span>
          {SCRIPT_LENGTHS.map((s) => (
            <button
              key={s} type="button" data-testid={`length-${s}`} aria-pressed={length === s} onClick={() => onLength(s)}
              className={`min-h-[40px] rounded-full px-3 text-[12.5px] tabular-nums ${length === s ? 'bg-coral-650 font-bold text-white' : 'bg-surface font-semibold text-chrome ring-1 ring-inset ring-line/55'}`}
            >
              {s}s
            </button>
          ))}
        </div>
      )}

      {editable && !needsCaption && (
        <button
          type="button" data-testid={`generate-${tab}`}
          onClick={tab === 'hook' ? onGenerateHook : onGenerateScript}
          className="mt-3.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[14px] bg-coral-650 text-[15px] font-bold text-white"
        >
          <SparkleGlyph className="h-[17px] w-[17px]" />
          {tab === 'hook' ? 'Write the hook' : 'Write the hook and script'}
        </button>
      )}
    </div>
  );
}
