'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanPost } from '@/lib/types';
import type { PlanData, ShapeTarget } from './usePlanData';
import { ringOf } from '@/lib/checklist';
import { ChecklistItem, monthDayLabel } from './pieces';
import { FormatIcon, FORMAT_LABEL, RevertIcon, TrashIcon, SparkIcon } from './icons';
import { FormatDropdown, DateField, prettyDate } from './pickers';
import { useAutosave } from './useAutosave';
import { DISABLED_PRIMARY, SegmentedControl } from './primitives';

/** One shared secondary-action treatment for the editor's generate/add buttons:
 *  solid slate (#334155) fill, white glyph/text, no dashed border, same pill radius
 *  as the other buttons. White-on-slate is 10.35:1 (comfortably AA) — the FAB
 *  precedent, not the banned white-on-coral. The dashed style is retained ONLY for
 *  "empty slot" affordances (calendar add-pills), never for a button. Disabled = the
 *  shared neutral treatment (§25), not washed-out opacity. */
const SECONDARY_BTN =
  `inline-flex flex-none items-center gap-1.5 rounded-full bg-slate-700 px-3.5 py-2 text-[12.5px] font-extrabold text-white ${DISABLED_PRIMARY}`;

/** The editor body shared by the desktop drawer and the mobile sheet. Caption save,
 *  Revert, delete, checklist (tick / add / generate), and async "Shape this post". */
export function PostEditor({ post, data, onClose }: { post: PlanPost; data: PlanData; onClose: () => void }) {
  const [caption, setCaption] = useState(post.caption);
  const [hook, setHook] = useState(post.hook ?? '');
  const [script, setScript] = useState(post.script ?? '');
  const [len, setLen] = useState(post.scriptLengthSeconds ?? 30);
  const [shapeText, setShapeText] = useState('');
  const [shapeTarget, setShapeTarget] = useState<ShapeTarget>('caption');
  const [adding, setAdding] = useState(false);
  const [pendingFormat, setPendingFormat] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastId = useRef(post.id);

  // Format change: PATCH the format (format_changed ledger), then reconcile the checklist —
  // silently regenerate when there's no progress to lose; else ask (keep / replace). Email
  // has no template, so regenerate clears it.
  const changeFormat = async (fmt: string) => {
    if (fmt === post.format || !data.canEdit(post.date)) return;
    const doneCount = post.steps.filter((s) => s.done).length;
    await data.changeFormat(post.id, fmt);
    if (fmt === 'email' || post.steps.length === 0 || doneCount === 0) {
      await data.regenerateChecklist(post.id);
    } else {
      setPendingFormat(fmt);
    }
  };

  // Reset the textarea when the selected post changes or its caption is replaced
  // (e.g. a shape job landed) — but not on every keystroke.
  useEffect(() => {
    if (lastId.current !== post.id) { lastId.current = post.id; setCaption(post.caption); setHook(post.hook ?? ''); setScript(post.script ?? ''); setLen(post.scriptLengthSeconds ?? 30); setPendingFormat(null); setShapeText(''); setConfirmDelete(false); }
  }, [post.id, post.caption, post.hook, post.script, post.scriptLengthSeconds]);
  useEffect(() => { setCaption(post.caption); }, [post.caption]);
  useEffect(() => { setHook(post.hook ?? ''); }, [post.hook]);
  useEffect(() => { setScript(post.script ?? ''); }, [post.script]);

  // Autosave: caption / typed hook / script all persist on blur + ~1.5s idle (one
  // ledger row per settled edit). Candidate picks persist immediately (below) and mark
  // the hook autosave baseline so the debounce doesn't save it a second time.
  // DATE POLICY: this post is editable iff its date is today-onward (London). Past posts
  // render read-only; future/today posts are editable in ANY of the client's months.
  const editable = data.canEdit(post.date);
  const capAuto = useAutosave(caption, post.caption, useCallback((v: string) => data.saveCaption(post.id, v), [data, post.id]), editable);
  const hookAuto = useAutosave(hook, post.hook ?? '', useCallback((v: string) => data.saveHook(post.id, v), [data, post.id]), editable);
  const scriptAuto = useAutosave(script, post.script ?? '', useCallback((v: string) => data.saveScript(post.id, v), [data, post.id]), editable);

  const ring = ringOf(post.steps);
  const shaping = data.shapingIds.has(post.id);
  const isEmail = post.format === 'email';
  // Hooks: reels + carousels only (product decision).
  const showHook = post.format === 'reel' || post.format === 'carousel';
  const hookCandidates = data.hookCandidates.get(post.id) ?? [];
  const hookGenerating = data.hookGenerating.has(post.id);
  const hookErr = data.hookError.get(post.id);
  // Scripts: reels only.
  const showScript = post.format === 'reel';
  const scriptGenerating = data.scriptGenerating.has(post.id);
  const scriptErr = data.scriptError.get(post.id);

  // Shape targets (§26): the caption always, plus any hook/script that exists for this
  // format. The control only shows when there's more than one; if the selected target
  // stops applying (format change, field cleared), fall back to the caption default.
  const hookAvail = showHook && !!post.hook;
  const scriptAvail = showScript && !!post.script;
  const shapeTargets: ShapeTarget[] = ['caption', ...(hookAvail ? (['hook'] as const) : []), ...(scriptAvail ? (['script'] as const) : [])];
  useEffect(() => {
    if ((shapeTarget === 'hook' && !hookAvail) || (shapeTarget === 'script' && !scriptAvail)) setShapeTarget('caption');
  }, [hookAvail, scriptAvail, shapeTarget]);

  const submitShape = (instruction: string) => { if (!instruction.trim()) return; void data.shape(post.id, instruction, shapeTarget); setShapeText(''); };

  return (
    <div className="flex-1 overflow-y-auto px-[30px] pb-10 pt-[26px]" data-testid="post-editor">
      {/* header — pr-12 reserves the drawer/sheet ✕ (absolute, top-right) its own slot so
          Revert can't slide under it; the format/date/badges wrap before Revert clips. */}
      <div className="mb-[22px] mt-1.5 flex flex-wrap items-center gap-[11px] pr-12">
        {!editable ? (
          <span className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-line-soft px-[11px] py-[7px] text-[13px] font-extrabold text-slate-700">
            <FormatIcon format={post.format} className="h-[15px] w-[15px] text-coral" />{FORMAT_LABEL[post.format]}
          </span>
        ) : (
          <FormatDropdown value={post.format} onChange={(v) => void changeFormat(v)} />
        )}
        <span className="font-serif text-[17px] text-slate-700">{monthDayLabel(post.date)}</span>
        {post.status === 'new'
          ? <span className="rounded-[5px] border border-coral px-[5px] py-px text-[9.5px] font-extrabold tracking-[.06em] text-slate-700">NEW</span>
          : post.status === 'edited' && <span className="rounded-[5px] border border-line px-[5px] py-px text-[9.5px] font-extrabold tracking-[.06em] text-slate-600">EDITED</span>}
        {!!editable && (
          <button data-testid="editor-revert" onClick={() => data.revert(post.id)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13.5px] font-bold text-slate-600 hover:bg-line-soft hover:text-slate-700">
            <RevertIcon className="h-[15px] w-[15px]" />Revert
          </button>
        )}
      </div>

      {/* format change with progress to lose → keep or replace the checklist */}
      {pendingFormat && (
        <div data-testid="format-confirm" role="dialog" aria-label="Replace the checklist?"
          className="mb-[22px] rounded-2xl border border-line bg-line-soft p-4">
          <p className="mb-3 text-[13.5px] font-semibold text-slate-700">
            Switched to {FORMAT_LABEL[pendingFormat as keyof typeof FORMAT_LABEL]}. Keep your existing checklist, or replace it with the {FORMAT_LABEL[pendingFormat as keyof typeof FORMAT_LABEL]} template?
          </p>
          <div className="flex gap-2.5">
            <button data-testid="format-replace" onClick={async () => { const p = pendingFormat; setPendingFormat(null); if (p) await data.regenerateChecklist(post.id); }}
              className="rounded-[11px] bg-coral-cta px-4 py-2 text-[13px] font-extrabold text-white">Replace checklist</button>
            <button data-testid="format-keep" onClick={() => setPendingFormat(null)}
              className="rounded-[11px] border border-line bg-surface px-4 py-2 text-[13px] font-bold text-slate-600 hover:border-line">Keep existing steps</button>
          </div>
        </div>
      )}

      {/* a hook/script value exists but is hidden for this format — reassure it's retained */}
      {((post.hook && !showHook) || (post.script && !showScript)) && (
        <div data-testid="hidden-fields-note" className="mb-4 rounded-lg bg-line-soft px-3 py-2 text-[12px] font-semibold text-muted">
          Your saved {post.hook && !showHook ? 'hook' : ''}{post.hook && !showHook && post.script && !showScript ? ' and ' : ''}{post.script && !showScript ? 'script' : ''} {post.hook && !showHook && post.script && !showScript ? 'are' : 'is'} hidden for {FORMAT_LABEL[post.format]}. Kept if you switch back.
        </div>
      )}

      {/* hook (reels + carousels) — above the caption */}
      {showHook && (
        <div className="mb-[22px]" data-testid="hook-section">
          <div className="mb-[9px] flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Hook</span>
            {!!editable && (
              <button data-testid="generate-hooks" onClick={() => data.generateHooks(post.id)} disabled={hookGenerating}
                className={SECONDARY_BTN}>
                <SparkIcon className="h-3.5 w-3.5" />{hookGenerating ? 'Generating…' : post.hook ? 'Regenerate hooks' : 'Generate hooks'}
              </button>
            )}
          </div>
          <input
            data-testid="editor-hook" aria-label="Hook" value={hook} onChange={(e) => setHook(e.target.value)} onBlur={hookAuto.flush} readOnly={!editable}
            placeholder="The line that stops the scroll. Write one or generate options."
            className="w-full rounded-xl border border-line p-3 text-[15px] text-slate-700 outline-none focus:border-coral disabled:opacity-60"
          />
          {hookErr && (
            <div data-testid="hook-error" role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
              {hookErr} <button onClick={() => data.generateHooks(post.id)} className="font-extrabold underline">Retry</button>
            </div>
          )}
          {hookCandidates.length > 0 && (
            <div data-testid="hook-candidates" className="mt-2.5 flex flex-col gap-2">
              <span className="text-[11.5px] font-bold text-muted">Tap one to use it. It saves straight away:</span>
              {hookCandidates.map((c, i) => (
                <button key={i} data-testid="hook-candidate" onClick={() => { setHook(c); data.clearHookCandidates(post.id); data.saveHook(post.id, c); hookAuto.markSaved(c); }}
                  className="rounded-xl border border-line bg-line-soft px-3.5 py-2.5 text-left text-[14px] leading-snug text-slate-700 hover:border-coral hover:bg-coral-tint">{c}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* caption — autosaves on blur + idle (no Save button) */}
      <span className="mb-[9px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Caption</span>
      <textarea
        data-testid="editor-caption" value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={capAuto.flush}
        readOnly={!editable}
        placeholder="Draft idea. Tell Sprigly what this post should be about and it’ll write the caption."
        className="min-h-[200px] w-full resize-y rounded-2xl border border-line p-4 text-[15.5px] leading-relaxed text-slate-700 outline-none focus:border-coral"
      />

      {/* script (reels) — needs a hook + caption first. Generate lives on the header row
          (right-aligned, matching Hook); the length picker stays below. Autosaves. */}
      {showScript && (
        <div className="mt-[26px]" data-testid="script-section">
          <div className="mb-[9px] flex items-center justify-between gap-3">
            <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Script</span>
            {!!editable && post.hook && (
              <button data-testid="generate-script" onClick={() => data.generateScript(post.id, len)} disabled={scriptGenerating || !caption.trim()}
                className={SECONDARY_BTN}>
                <SparkIcon className="h-3.5 w-3.5" />{scriptGenerating ? 'Writing…' : post.script ? 'Regenerate script' : 'Generate script'}
              </button>
            )}
          </div>
          {!post.hook ? (
            <div className="rounded-xl border border-dashed border-line p-3.5 text-[13.5px] text-muted" data-testid="script-needs-hook">
              Add or generate a <b className="font-bold text-slate-700">hook</b> first. The script opens on it.
            </div>
          ) : (
            <>
              <div className="mb-2.5 flex items-center gap-2" data-testid="script-length">
                <span className="mr-1 text-[11.5px] font-bold text-muted">Length</span>
                {[15, 30, 60, 90].map((s) => (
                  <button key={s} data-testid={`length-${s}`} onClick={() => setLen(s)} aria-pressed={len === s}
                    className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${len === s ? 'bg-slate-700 text-white' : 'border border-line text-slate-600 hover:bg-line-soft'}`}>{s}s</button>
                ))}
              </div>
              {scriptErr && (
                <div data-testid="script-error" role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
                  {scriptErr} <button onClick={() => data.generateScript(post.id, len)} className="font-extrabold underline">Retry</button>
                </div>
              )}
              {post.script && (
                <textarea
                  data-testid="editor-script" aria-label="Script" value={script} onChange={(e) => setScript(e.target.value)} onBlur={scriptAuto.flush} readOnly={!editable}
                  className="mt-2.5 min-h-[170px] w-full resize-y rounded-2xl border border-line p-4 text-[14px] leading-relaxed text-slate-700 outline-none focus:border-coral disabled:opacity-60"
                />
              )}
            </>
          )}
        </div>
      )}

      {/* when — a branded calendar popover; the keyboard-accessible alternative to
          drag-reschedule. Selecting a date PATCHes immediately (ledgered). */}
      <div className="mt-[22px]">
        <span className="mb-[9px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Scheduled date</span>
        {!editable
          ? <div className="inline-block rounded-[13px] border border-line bg-line-soft px-[15px] py-3 text-[14.5px] font-semibold text-slate-700">{prettyDate(post.date)}</div>
          : <DateField value={post.date} today={data.today} onSelect={(iso) => data.reschedule(post.id, iso)} />}
      </div>

      {/* Media section intentionally omitted — returns if/when publishing lands. */}

      {/* checklist — add/build button lives on the header row (matches Hook/Script) */}
      <div className="mt-[22px] flex items-center justify-between gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">
          Checklist {ring.total > 0 && <span className="ml-1.5 text-[11px] font-extrabold normal-case tracking-normal text-slate-700">{ring.done}/{ring.total} done</span>}
        </span>
        {!!editable && !isEmail && (
          post.steps.length > 0
            ? <button data-testid="editor-add-step" onClick={() => { setAdding(true); data.addStep(post.id, { label: 'Get approval', leadDays: 1 }).finally(() => setAdding(false)); }} disabled={adding}
                className={SECONDARY_BTN}>+ Add step</button>
            : <button data-testid="editor-generate" onClick={() => data.generateChecklist(post.id)}
                className={SECONDARY_BTN}><SparkIcon className="h-3.5 w-3.5" />Build checklist</button>
        )}
      </div>
      <div data-testid="editor-checklist" className="mt-2 flex flex-col gap-2">
        {post.steps.length > 0
          ? post.steps.map((s) => (
            <ChecklistItem key={s.id} step={s} scheduledDate={post.date} today={data.today}
              onToggle={!editable ? undefined : () => data.toggleStep(post.id, s.id, !s.done)}
              onRename={!editable ? undefined : (label) => data.renameStep(post.id, s.id, label)} />
          ))
          : <div className="py-1 text-[13.5px] text-muted">{isEmail ? 'No checklist for this format.' : 'No steps yet. Build a checklist from the type, or add one.'}</div>}
      </div>

      {/* shape this post (async) */}
      {!!editable && (
        <div className="mt-[26px]">
          <span className="mb-[9px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Shape this post</span>
          {/* target control — only when there's more than one field to refine (§26) */}
          {shapeTargets.length > 1 && (
            <div className="mb-2.5" data-testid="shape-target">
              <SegmentedControl<ShapeTarget> value={shapeTarget} label="What to refine" onChange={setShapeTarget}
                options={shapeTargets.map((t) => ({ value: t, label: t === 'caption' ? 'Caption' : t === 'hook' ? 'Hook' : 'Script' }))} />
            </div>
          )}
          <div className="flex gap-2.5">
            <input
              data-testid="shape-input" value={shapeText} disabled={shaping}
              onChange={(e) => setShapeText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitShape(shapeText); }}
              placeholder={shapeTarget === 'hook' ? 'Punchier · shorter · reword the opening…' : shapeTarget === 'script' ? 'Punchier · tighten the middle · rework the CTA…' : 'Make it softer · shorter · warmer · more about the product…'}
              aria-label={`Refine the ${shapeTarget}`}
              className="flex-1 rounded-[13px] border border-line px-[15px] py-3 text-[14.5px] text-slate-700 outline-none focus:border-coral disabled:opacity-60"
            />
            <button data-testid="shape-go" disabled={shaping} onClick={() => submitShape(shapeText)} aria-label="Shape this post"
              className={`flex w-[50px] flex-none items-center justify-center rounded-[13px] bg-coral-tint text-coral ${DISABLED_PRIMARY}`}>
              <SparkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {data.shapeErrors.get(post.id) ? (
            <div data-testid="shape-error" role="alert" className="mt-3.5 flex items-center gap-3 text-[12.5px] leading-relaxed text-danger">
              <span>{data.shapeErrors.get(post.id)}</span>
              <button data-testid="shape-retry" onClick={() => data.retryShape(post.id)} className="font-extrabold text-slate-700 underline">Retry</button>
            </div>
          ) : (
            <p data-testid="shape-note" className="mt-3.5 text-[12.5px] leading-relaxed text-muted">
              {shaping
                ? `Sprigly is ${shapeTarget === 'caption' ? 'rewriting' : 'refining'} this in your voice. It’ll appear here when it’s ready.`
                : shapeTarget === 'caption'
                  ? 'Sprigly rewrites it in your voice and checks it before it lands. Revert always returns to the original.'
                  : `Sprigly refines the ${shapeTarget} with the lightest touch and keeps the rest. Revert always returns to the original.`}
            </p>
          )}
        </div>
      )}

      {/* delete — pinned at the very bottom, full width. Conventional destructive
          treatment (John's pick B): white fill, danger #B23A2E border + text (5.94:1);
          coral is never used for destructive. Two-step confirm — never a single tap. */}
      {!!editable && (
        <div className="mt-9" data-testid="delete-section">
          {confirmDelete ? (
            <div data-testid="delete-confirm" role="dialog" aria-label="Delete this post?"
              className="rounded-2xl border border-line bg-line-soft p-4">
              <p className="mb-3 text-[13.5px] font-semibold text-slate-700">Delete this post? This can’t be undone.</p>
              <div className="flex gap-2.5">
                <button data-testid="delete-confirm-yes" onClick={() => { data.removePost(post.id); onClose(); }}
                  className="inline-flex items-center gap-2 rounded-[13px] bg-danger px-5 py-3 text-[14px] font-extrabold text-white">
                  <TrashIcon className="h-4 w-4" />Delete post
                </button>
                <button data-testid="delete-cancel" onClick={() => setConfirmDelete(false)}
                  className="rounded-[13px] border border-line bg-surface px-5 py-3 text-[14px] font-bold text-slate-600 hover:border-line">Cancel</button>
              </div>
            </div>
          ) : (
            <button data-testid="editor-delete" onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-danger bg-surface px-5 py-3.5 text-[14.5px] font-extrabold text-danger hover:bg-danger/10">
              <TrashIcon className="h-[17px] w-[17px]" />Delete post
            </button>
          )}
        </div>
      )}
    </div>
  );
}
