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
 * THE ACTION ROW IS THREE EQUAL BUTTONS, glyph and label on one line, at stock-iOS weight — see
 * `ActionBtn` for the three attempts it took and why Delete is a tint rather than a block.
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
import { FormatTile, InfoGlyph, CopyGlyph, PencilGlyph, CalGlyph, SparkleGlyph, BinGlyph, SendGlyph, FORMAT_WORD } from './icons';
import { cardText, realCaption } from './card-text';
import { dayTitle } from './dates';
import { isPostOnTheWay, isBanked, ON_THE_WAY_LABEL, ON_THE_WAY_BODY, BANKED_LABEL, BANKED_TEASER } from '@/lib/generation-state';
import { Sheet } from './Sheet';
import { Panel, type PanelChrome } from './Panel';
import { ChevronL } from './icons';
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

/**
 * What a tab shows. The caption goes through `realCaption`, so a row still holding
 * `DRAFT_PLACEHOLDER_CAPTION` reads as EMPTY here exactly as it does on the card — the sheet
 * asking `!!post.caption` instead is what let a placeholder pose as content (see card-text.ts).
 */
const fieldOf = (post: PlanPost, tab: Tab): string =>
  (tab === 'caption' ? realCaption(post) : tab === 'hook' ? post.hook : post.script) ?? '';

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
  post, data, rationale, onClose, onMove, onDelete, chrome,
}: {
  post: PlanPost | null;
  data: PlanData;
  /** "Why this one is here", when the post carries evidence for it. Empty → no toggle at all:
   *  an insights button that opens nothing is worse than no button. */
  rationale: string;
  onClose: () => void;
  onMove: () => void;
  onDelete: () => void;
  /** `panel` places this inline in the desktop day column instead of over the surface.
   *  Everything below the frame is identical — see Panel.tsx. */
  chrome: PanelChrome;
}) {
  const [tab, setTab] = useState<Tab>('caption');
  const [insights, setInsights] = useState(false);
  const [shaping, setShaping] = useState(false);
  const [instruction, setInstruction] = useState('');
  /**
   * MANUAL EDITING (F6). The pencil swaps the read-only field for a plain textarea IN PLACE —
   * same sheet, no modal-on-modal — and Save goes through the exact update path typing in the
   * old editor used (`saveCaption`/`saveHook`/`saveScript` → PATCH /api/posts/:id → patchPost's
   * caption_saved/hook_saved/script_saved ledger rows, actor 'client' via the session). Cancel
   * throws the draft away and the field is byte-identical. A refused save KEEPS the textarea
   * and the words — losing a hand-typed caption to a network error is the one loss the toast
   * cannot undo.
   */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
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
    setEditing(false);
    setDraft('');
    setSaving(false);
    setFormatNote('');
    setPendingFormat(null);
    setScriptLen(post.scriptLengthSeconds ?? 30);
  }

  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 1600); return () => clearTimeout(t); }, [copied]);

  if (!post) return null;

  const { heading } = cardText(post);
  // X2c: banked is its OWN state and outranks "on its way" — nothing is being written.
  const banked = isBanked(post);
  const onWay = isPostOnTheWay(post);
  const written = !!(realCaption(post) || post.hook || post.script);
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

  /** Begin editing the open tab's field, seeded with what is there. */
  const startEdit = () => { setDraft(fieldOf(post, openTab)); setEditing(true); };
  /** Save through the existing per-field path. Success exits; a refusal keeps the words. */
  const saveEdit = async () => {
    const save = openTab === 'caption' ? data.saveCaption : openTab === 'hook' ? data.saveHook : data.saveScript;
    setSaving(true);
    try { if (await save(post.id, draft)) { setEditing(false); setDraft(''); } }
    finally { setSaving(false); }
  };
  const cancelEdit = () => { setEditing(false); setDraft(''); };

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

  const Frame = chrome === 'panel' ? Panel : Sheet;

  return (
    <Frame open label={heading} testid="detail-sheet" onClose={onClose}>
      <>
        {/* THE WAY BACK, and it only exists in panel chrome. A SHEET has the grabber and the
            scrim; a panel replaces the day column outright, so without this the client opens a
            post and the day's other posts are simply gone with no control that says otherwise.
            It names the DAY rather than saying "Back": a direction tells you which way, a day
            tells you where you land — and it is the same string the day header carries. */}
        {chrome === 'panel' && (
          <button
            type="button" data-testid="detail-back" onClick={onClose}
            className="flex min-h-[44px] flex-none items-center gap-1.5 border-b border-line/30 px-3 text-left text-[13.5px] font-semibold text-muted transition-colors duration-100 hover:text-chrome"
          >
            <ChevronL className="h-[15px] w-[15px]" />
            {dayTitle(post.date)}
          </button>
        )}

        <div className="flex-none border-b border-line/30 px-[18px] pb-3.5 pt-1.5">
          <div className="flex items-start gap-3">
            <FormatTile format={post.format} large />
            <div className="min-w-0 flex-1">
              <h2 className="mb-1 break-words text-[20px] font-bold leading-[1.25] tracking-[-.025em] text-chrome">{heading}</h2>
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

        {written && !onWay && !banked && tabs.length > 1 && !shaping && !editing && (
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
                What should be different? We’ll keep the date and the pillar exactly as they are.
              </p>
              <textarea
                data-testid="shape-input" autoFocus value={instruction} onChange={(e) => setInstruction(e.target.value)}
                placeholder="Warmer, and mention the relaunch earlier"
                className="mt-3 min-h-[120px] w-full rounded-[14px] border border-line/55 bg-surface p-3.5 text-[16.5px] leading-[1.45] text-chrome outline-none placeholder:text-muted"
              />

              {/* THE FORMAT CONTROL LIVES HERE NOW — third placement, and the operator's ruling.
                  A format change is a SHAPING decision with consequences: it can strand a hook
                  and a script, and it changes what the checklist is for. Sitting always-visible
                  under the header it read as a display toggle, one tap from a client who was
                  looking at their caption. Inside Shape it is in the deliberate flow, beside the
                  field where the client is already saying what they want different, and its
                  consequence note has room to be read before anything is sent. */}
              {editable && (
                <div className="mt-5">
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted">Format</h3>
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
            </>
          ) : banked ? (
            /* THE CAP'S OWN STATE (X2c). The stored message names the reset date, and the
               instruction we are holding is shown BACK to the client — between them they say
               what will happen and when, which is the whole difference from a promise. */
            <div data-testid="detail-banked" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
              <p className="text-[15px] font-semibold text-chrome">{BANKED_LABEL}</p>
              <p className="mt-1.5 text-[13.5px] leading-normal text-muted">{post.generationError || BANKED_TEASER}</p>
              {post.pendingInstruction && (
                <p data-testid="banked-instruction" className="mt-2.5 text-[13.5px] leading-normal text-chrome">
                  “{post.pendingInstruction}”
                </p>
              )}
            </div>
          ) : onWay ? (
            <div data-testid="detail-on-the-way" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
              <p className="text-[15px] font-semibold text-chrome">{ON_THE_WAY_LABEL}</p>
              <p className="mt-1.5 text-[13.5px] leading-normal text-muted">{ON_THE_WAY_BODY}</p>
            </div>
          ) : busy || generatingField ? (
            // ROUND 6, P11 — the words being rewritten say so, in place, for as long as it takes.
            // Before this the old text simply sat there and the client tapped Shape twice.
            <Skeleton />
          ) : editing ? (
            // F6 — the field, editable IN PLACE. A plain textarea where the words were: same
            // sheet, no modal-on-modal, and the footer below swaps to Save / Cancel.
            <textarea
              data-testid="edit-input" autoFocus value={draft} disabled={saving}
              aria-label={`Edit the ${openTab}`}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[220px] w-full rounded-[14px] border border-line/55 bg-surface p-3.5 text-[16.5px] leading-[1.45] text-chrome outline-none"
            />
          ) : body ? (
            <>
              <div className="mb-1.5 flex justify-end gap-1.5">
                {/* F6 — the pencil. Editing an existing field by hand is free, unlike Shape,
                    and it was the one thing the tabs could not do. */}
                {editable && !onWay && (
                  <button
                    type="button" data-testid="edit-field" onClick={startEdit}
                    aria-label={`Edit the ${openTab}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-line-soft text-chrome"
                  >
                    <PencilGlyph className="h-[17px] w-[17px]" />
                  </button>
                )}
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
          {post.steps.length > 0 && !shaping && !editing && (
            <TaskList
              steps={post.steps} date={post.date} editable={editable}
              onToggle={(stepId, done) => void data.toggleStep(post.id, stepId, done)}
            />
          )}
        </div>

        {editing ? (
          // F6 — Save through the existing update path; Cancel discards and the field is
          // byte-identical. Save is disabled while unchanged: a write that writes nothing is
          // a ledger row about nothing.
          <div className="flex flex-none gap-2 border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-3">
            <button
              type="button" data-testid="edit-save"
              disabled={saving || draft === body} onClick={() => void saveEdit()}
              className="flex min-h-[56px] flex-1 items-center justify-center rounded-2xl bg-coral-650 text-[15.5px] font-bold text-white shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)] disabled:bg-line-soft disabled:text-muted disabled:shadow-none"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {/* QUIET NEUTRAL, never red (X1) — same ruling as Shape's cancel. */}
            <button
              type="button" data-testid="edit-cancel" onClick={cancelEdit} disabled={saving}
              className="flex min-h-[56px] w-[88px] flex-none items-center justify-center rounded-2xl bg-surface text-[15px] font-semibold text-muted ring-1 ring-inset ring-line/55"
            >
              Cancel
            </button>
          </div>
        ) : shaping ? (
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
            <ActionBtn testid="act-move" label="Move" onClick={onMove}><CalGlyph className="h-[17px] w-[17px] [stroke-width:1.5]" /></ActionBtn>
            {/* Shape is absent when the OPEN TAB has nothing to rewrite — a rewrite of an empty
                field is not a cheaper version of writing it, it is a paid no-op, and the tab
                already offers the action that does write it. */}
            {!!body && !onWay && (
              <ActionBtn testid="act-shape" label="Shape" disabled={busy} onClick={() => setShaping(true)}>
                <SparkleGlyph className="h-[17px] w-[17px] [stroke-width:1.5]" />
              </ActionBtn>
            )}
            <ActionBtn testid="act-delete" label="Delete" destructive onClick={onDelete}>
              <BinGlyph className="h-[17px] w-[17px] [stroke-width:1.5]" />
            </ActionBtn>
          </div>
        ) : null}
      </>
    </Frame>
  );
}

/**
 * One of the three. Equal width, glyph and label on ONE line, and a real pressed state.
 *
 * ── Attempt two (round 7, fix 5) ─────────────────────────────────────────────────────
 *
 * Round 5 stacked a 20px glyph over a 12px label at 68px; round 6 took it to 56px and the
 * operator still read it as heavy. The reference given was a stock iOS action row, and the three
 * things that make one are: the glyph and the label sit on a LINE rather than a stack, the glyph
 * is THIN, and the fill is QUIET. So: 44px, a 17px glyph at 1.5 stroke, a 15px label beside it,
 * and a tinted fill instead of a ring.
 *
 * DELETE KEEPS ITS OWN COLOUR, on a tint rather than a block. Round-4 S1 ruled that a
 * destructive action must not have to be inferred from the colour of its text, and round 5.1
 * upheld it against V1 — so this is a refinement of that ruling and not a reversal: the action is
 * still marked by its FILL, its COLOUR and its GLYPH together, which is three channels, and none
 * of them is text colour alone. What changes is that a solid saturated block is no longer the
 * loudest object on a sheet whose common action is "read the caption, maybe move it" — which was
 * V1's observation, and it is right once the other two buttons go quiet.
 *
 * If the operator wants the solid block back it is the one `destructive` branch below.
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
        'flex min-h-[44px] flex-1 flex-row items-center justify-center gap-1.5 rounded-[12px] px-2 transition-colors duration-100',
        destructive
          // `danger` on its own 10% tint over surface — the destructive action is carried by the
          // fill, the colour AND the bin, so nothing about it has to be inferred (S1).
          ? 'bg-danger/10 text-danger active:bg-danger/[.18]'
          : 'bg-line-soft text-chrome active:bg-line/25',
        disabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      {children}
      <span className="text-[15px] font-medium tracking-[-.01em]">{label}</span>
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

  /**
   * ── ON A REEL, BOTH TABS ARE THE SAME ACT (C4) ─────────────────────────────────────
   *
   * A reel's hook and script are one coherent pair written by one model call from the caption
   * (`script.ts`). The Hook tab used to offer "Write the hook", which reached the standalone
   * hook job — so a reel could be handed a hook a later script had never seen, and the two
   * disagreed on screen. `/api/plan/hooks` now redirects a reel to the combined job; this copy
   * stops the button promising less than it does.
   */
  const reelPair = post.format === 'reel';
  // Both fields are built around the caption. A placeholder is not a caption, and generating
  // from one writes a hook and a script about our own scaffolding sentence.
  const needsCaption = (tab === 'script' || reelPair) && !realCaption(post);
  const why = reelPair
    ? 'A reel’s hook and script are written together, so they say the same thing. Nothing is wrong with this one.'
    : tab === 'hook'
      ? 'This one was written before hooks, or its format changed. Nothing is wrong with it.'
      : 'This one has no script yet — either its format changed, or it was written before scripts.';

  return (
    <div data-testid="empty-field" className="rounded-2xl border border-line/30 bg-line-soft px-4 py-5">
      <p className="text-[15px] font-semibold text-chrome">No {tab} yet</p>
      <p className="mt-1.5 text-[13.5px] leading-normal text-muted">{needsCaption
        // CAPTION ABSENT → REFUSED, not generated. Nothing here writes a caption first; the
        // routes 422 `caption_required` and this is that refusal in words.
        ? 'The hook and the script are built around the caption, so that has to come first.'
        : why}</p>

      {/* The length belongs to the pair, so it is offered on either tab of a reel. */}
      {editable && !needsCaption && (tab === 'script' || reelPair) && (
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
          onClick={tab === 'hook' && !reelPair ? onGenerateHook : onGenerateScript}
          className="mt-3.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[14px] bg-coral-650 text-[15px] font-bold text-white"
        >
          <SparkleGlyph className="h-[17px] w-[17px]" />
          {reelPair || tab === 'script' ? 'Write the hook and script' : 'Write the hook'}
        </button>
      )}
    </div>
  );
}
