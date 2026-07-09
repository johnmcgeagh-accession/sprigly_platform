'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from './usePlanData';
import { ringOf } from '@/lib/checklist';
import { ChecklistItem, ProgressRing, monthDayLabel } from './pieces';
import { FormatIcon, FORMAT_LABEL, RevertIcon, TrashIcon, SparkIcon, CheckIcon } from './icons';

const SHAPES = [['Make it softer', 'make it softer'], ['Make it shorter', 'make it shorter'], ['Warmer tone', 'warmer tone']] as const;

/** One shared secondary-action treatment for the editor's generate/add buttons:
 *  solid slate (#334155) fill, white glyph/text, no dashed border, same pill radius
 *  as the other buttons. White-on-slate is 10.35:1 (comfortably AA) — the FAB
 *  precedent, not the banned white-on-coral. The dashed style is retained ONLY for
 *  "empty slot" affordances (calendar add-pills), never for a button. */
const SECONDARY_BTN =
  'inline-flex items-center gap-1.5 self-start rounded-full bg-slate-700 px-3.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-50';

/** The editor body shared by the desktop drawer and the mobile sheet. Caption save,
 *  Revert, delete, checklist (tick / add / generate), and async "Shape this post". */
export function PostEditor({ post, data, onClose }: { post: PlanPost; data: PlanData; onClose: () => void }) {
  const [caption, setCaption] = useState(post.caption);
  const [hook, setHook] = useState(post.hook ?? '');
  const [script, setScript] = useState(post.script ?? '');
  const [len, setLen] = useState(post.scriptLengthSeconds ?? 30);
  const [shapeText, setShapeText] = useState('');
  const [adding, setAdding] = useState(false);
  const [pendingFormat, setPendingFormat] = useState<string | null>(null);
  const lastId = useRef(post.id);

  // Format change: PATCH the format (format_changed ledger), then reconcile the checklist —
  // silently regenerate when there's no progress to lose; else ask (keep / replace). Email
  // has no template, so regenerate clears it.
  const changeFormat = async (fmt: string) => {
    if (fmt === post.format || data.readOnly) return;
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
    if (lastId.current !== post.id) { lastId.current = post.id; setCaption(post.caption); setHook(post.hook ?? ''); setScript(post.script ?? ''); setLen(post.scriptLengthSeconds ?? 30); setPendingFormat(null); setShapeText(''); }
  }, [post.id, post.caption, post.hook, post.script, post.scriptLengthSeconds]);
  useEffect(() => { setCaption(post.caption); }, [post.caption]);
  useEffect(() => { setHook(post.hook ?? ''); }, [post.hook]);
  useEffect(() => { setScript(post.script ?? ''); }, [post.script]);

  const ring = ringOf(post.steps);
  const dirty = caption !== post.caption;
  const hookDirty = hook !== (post.hook ?? '');
  const shaping = data.shapingIds.has(post.id);
  const stateLabel = post.status === 'new' ? 'New idea' : post.status === 'edited' ? 'Edited' : 'Draft';
  const isEmail = post.format === 'email';
  // Hooks: reels + carousels only (product decision).
  const showHook = post.format === 'reel' || post.format === 'carousel';
  const hookCandidates = data.hookCandidates.get(post.id) ?? [];
  const hookGenerating = data.hookGenerating.has(post.id);
  const hookErr = data.hookError.get(post.id);
  // Scripts: reels only.
  const showScript = post.format === 'reel';
  const scriptDirty = script !== (post.script ?? '');
  const scriptGenerating = data.scriptGenerating.has(post.id);
  const scriptErr = data.scriptError.get(post.id);

  const submitShape = (instruction: string) => { if (!instruction.trim()) return; void data.shape(post.id, instruction); setShapeText(''); };

  return (
    <div className="flex-1 overflow-y-auto px-[30px] pb-10 pt-[26px]" data-testid="post-editor">
      {/* header */}
      <div className="mb-[22px] mt-1.5 flex flex-wrap items-center gap-[11px]">
        {data.readOnly ? (
          <span className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-line-soft px-[11px] py-[7px] text-[13px] font-extrabold text-slate-700">
            <FormatIcon format={post.format} className="h-[15px] w-[15px] text-coral" />{FORMAT_LABEL[post.format]}
          </span>
        ) : (
          <span className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-line-soft px-[11px] py-[6px] text-[13px] font-extrabold text-slate-700">
            <FormatIcon format={post.format} className="h-[15px] w-[15px] text-coral" />
            <select data-testid="format-select" aria-label="Post format" value={post.format} onChange={(e) => void changeFormat(e.target.value)}
              className="cursor-pointer appearance-none bg-transparent pr-1 font-extrabold text-slate-700 outline-none focus-visible:underline">
              <option value="reel">Reel</option>
              <option value="carousel">Carousel</option>
              <option value="single">Single image</option>
              <option value="email">Email</option>
            </select>
          </span>
        )}
        <span className="text-[13.5px] font-bold text-muted">{stateLabel}</span>
        <span className="font-serif text-[17px] text-slate-700">{monthDayLabel(post.date)}</span>
        {post.status === 'new'
          ? <span className="rounded-[5px] border border-coral px-[5px] py-px text-[9.5px] font-extrabold tracking-[.06em] text-slate-700">NEW</span>
          : post.status === 'edited' && <span className="rounded-[5px] border border-line px-[5px] py-px text-[9.5px] font-extrabold tracking-[.06em] text-slate-600">EDITED</span>}
        {!data.readOnly && (
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
              className="rounded-[11px] border border-line bg-surface px-4 py-2 text-[13px] font-bold text-slate-600 hover:border-[#DED9D3]">Keep existing steps</button>
          </div>
        </div>
      )}

      {/* a hook/script value exists but is hidden for this format — reassure it's retained */}
      {((post.hook && !showHook) || (post.script && !showScript)) && (
        <div data-testid="hidden-fields-note" className="mb-4 rounded-lg bg-line-soft px-3 py-2 text-[12px] font-semibold text-muted">
          Your saved {post.hook && !showHook ? 'hook' : ''}{post.hook && !showHook && post.script && !showScript ? ' and ' : ''}{post.script && !showScript ? 'script' : ''} {post.hook && !showHook && post.script && !showScript ? 'are' : 'is'} hidden for {FORMAT_LABEL[post.format]} — kept if you switch back.
        </div>
      )}

      {/* hook (reels + carousels) — above the caption */}
      {showHook && (
        <div className="mb-[22px]" data-testid="hook-section">
          <div className="mb-[9px] flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Hook</span>
            {!data.readOnly && (
              <button data-testid="generate-hooks" onClick={() => data.generateHooks(post.id)} disabled={hookGenerating}
                className={SECONDARY_BTN}>
                <SparkIcon className="h-3.5 w-3.5" />{hookGenerating ? 'Generating…' : post.hook ? 'Regenerate hooks' : 'Generate hooks'}
              </button>
            )}
          </div>
          <input
            data-testid="editor-hook" aria-label="Hook" value={hook} onChange={(e) => setHook(e.target.value)} readOnly={data.readOnly}
            placeholder="The line that stops the scroll — write one or generate options."
            className="w-full rounded-xl border border-line p-3 text-[15px] text-slate-700 outline-none focus:border-coral disabled:opacity-60"
          />
          {hookErr && (
            <div data-testid="hook-error" role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
              {hookErr} <button onClick={() => data.generateHooks(post.id)} className="font-extrabold underline">Retry</button>
            </div>
          )}
          {hookCandidates.length > 0 && (
            <div data-testid="hook-candidates" className="mt-2.5 flex flex-col gap-2">
              <span className="text-[11.5px] font-bold text-muted">Tap one to use it — it saves straight away:</span>
              {hookCandidates.map((c, i) => (
                <button key={i} data-testid="hook-candidate" onClick={() => { setHook(c); data.clearHookCandidates(post.id); data.saveHook(post.id, c); }}
                  className="rounded-xl border border-line bg-line-soft px-3.5 py-2.5 text-left text-[14px] leading-snug text-slate-700 hover:border-coral hover:bg-coral-tint">{c}</button>
              ))}
            </div>
          )}
          {/* Manual typing keeps the explicit-save path (a pick autosaves, so this is
              only reachable after an edit to the field — hookDirty is false after a pick). */}
          {!data.readOnly && hookDirty && (
            <button data-testid="hook-save" onClick={() => data.saveHook(post.id, hook)}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-[11px] bg-coral-cta px-4 py-2 text-[13px] font-extrabold text-white">
              <CheckIcon className="h-3.5 w-3.5" />Save hook
            </button>
          )}
        </div>
      )}

      {/* caption */}
      <span className="mb-[9px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Caption</span>
      <textarea
        data-testid="editor-caption" value={caption} onChange={(e) => setCaption(e.target.value)}
        readOnly={data.readOnly}
        placeholder="Draft idea — tell Sprigly what this post should be about and it’ll write the caption."
        className="min-h-[200px] w-full resize-y rounded-2xl border border-line p-4 text-[15.5px] leading-relaxed text-slate-700 outline-none focus:border-coral"
      />
      <div className="mt-3.5 flex items-center justify-between">
        <button data-testid="editor-save" disabled={!dirty || data.readOnly} onClick={() => data.saveCaption(post.id, caption)}
          className="inline-flex items-center gap-2 rounded-[13px] bg-coral px-5 py-3 text-[14.5px] font-extrabold text-white shadow-coral disabled:opacity-50 disabled:shadow-none">
          <CheckIcon className="h-4 w-4" />Save caption
        </button>
        {!data.readOnly && (
          <button data-testid="editor-remove" onClick={() => { data.removePost(post.id); onClose(); }}
            className="inline-flex items-center gap-1.5 p-2 text-[13.5px] font-bold text-danger hover:underline">
            <TrashIcon className="h-[15px] w-[15px]" />Remove post
          </button>
        )}
      </div>

      {/* script (reels) — needs a hook + caption first */}
      {showScript && (
        <div className="mt-[26px]" data-testid="script-section">
          <span className="mb-[9px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Script</span>
          {!post.hook ? (
            <div className="rounded-xl border border-dashed border-line p-3.5 text-[13.5px] text-muted" data-testid="script-needs-hook">
              Add or generate a <b className="font-bold text-slate-700">hook</b> first — the script opens on it.
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
              {!data.readOnly && (
                <button data-testid="generate-script" onClick={() => data.generateScript(post.id, len)} disabled={scriptGenerating || !caption.trim()}
                  className={SECONDARY_BTN}>
                  <SparkIcon className="h-3.5 w-3.5" />{scriptGenerating ? 'Writing…' : post.script ? 'Regenerate script' : 'Generate script'}
                </button>
              )}
              {scriptErr && (
                <div data-testid="script-error" role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
                  {scriptErr} <button onClick={() => data.generateScript(post.id, len)} className="font-extrabold underline">Retry</button>
                </div>
              )}
              {post.script && (
                <>
                  <textarea
                    data-testid="editor-script" aria-label="Script" value={script} onChange={(e) => setScript(e.target.value)} readOnly={data.readOnly}
                    className="mt-2.5 min-h-[170px] w-full resize-y rounded-2xl border border-line p-4 text-[14px] leading-relaxed text-slate-700 outline-none focus:border-coral disabled:opacity-60"
                  />
                  {!data.readOnly && scriptDirty && (
                    <button data-testid="script-save" onClick={() => data.saveScript(post.id, script)}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-[11px] bg-coral-cta px-4 py-2 text-[13px] font-extrabold text-white">
                      <CheckIcon className="h-3.5 w-3.5" />Save script
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* when — the keyboard-accessible alternative to drag-reschedule */}
      <label className="mt-[22px] block">
        <span className="mb-[9px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Scheduled date</span>
        <input
          type="date" data-testid="editor-date" value={post.date} disabled={data.readOnly}
          aria-label="Scheduled date"
          onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) data.reschedule(post.id, e.target.value); }}
          className="rounded-[13px] border border-line px-[15px] py-3 text-[14.5px] text-slate-700 outline-none focus:border-coral disabled:opacity-60"
        />
      </label>

      {/* media placeholder (upload out of scope this stage) */}
      <div data-testid="media-placeholder" className="mb-1.5 mt-[22px] flex min-h-[92px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[#E1DCD6] bg-[#FAF9F7] text-[13.5px] font-semibold text-muted">
        <FormatIcon format={post.format} className="h-[18px] w-[18px] opacity-60" />
        <span>{post.format === 'reel' ? 'Video preview — coming soon.' : 'Media — drop an image (coming soon).'}</span>
      </div>

      {/* checklist */}
      <span className="mt-[22px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">
        Checklist {ring.total > 0 && <span className="ml-1.5 text-[11px] font-extrabold normal-case tracking-normal text-slate-700">{ring.done}/{ring.total} done</span>}
      </span>
      <div data-testid="editor-checklist" className="mt-0.5 flex flex-col gap-2">
        {post.steps.length > 0
          ? post.steps.map((s) => (
            <ChecklistItem key={s.id} step={s} scheduledDate={post.date} today={data.today}
              onToggle={data.readOnly ? undefined : () => data.toggleStep(post.id, s.id, !s.done)} />
          ))
          : <div className="py-1 text-[13.5px] text-muted">{isEmail ? 'No checklist for this format.' : 'No steps yet — build a checklist from the type, or add one.'}</div>}

        {!data.readOnly && !isEmail && (
          post.steps.length > 0
            ? <button data-testid="editor-add-step" onClick={() => { setAdding(true); data.addStep(post.id, { label: 'Get approval', leadDays: 1 }).finally(() => setAdding(false)); }} disabled={adding}
                className={`mt-0.5 ${SECONDARY_BTN}`}>+ Add step</button>
            : <button data-testid="editor-generate" onClick={() => data.generateChecklist(post.id)}
                className={`mt-0.5 ${SECONDARY_BTN}`}><SparkIcon className="h-3.5 w-3.5" />Build checklist</button>
        )}
      </div>

      {/* shape this post (async) */}
      {!data.readOnly && (
        <div className="mt-[26px]">
          <span className="mb-[9px] block text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Shape this post</span>
          <div className="flex gap-2.5">
            <input
              data-testid="shape-input" value={shapeText} disabled={shaping}
              onChange={(e) => setShapeText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitShape(shapeText || 'warmer tone'); }}
              placeholder="Make it softer · shorter · warmer · more about the fabric…"
              className="flex-1 rounded-[13px] border border-line px-[15px] py-3 text-[14.5px] text-slate-700 outline-none focus:border-coral disabled:opacity-60"
            />
            <button data-testid="shape-go" disabled={shaping} onClick={() => submitShape(shapeText || 'warmer tone')} aria-label="Shape this post"
              className="flex w-[50px] flex-none items-center justify-center rounded-[13px] bg-coral-tint text-coral disabled:opacity-50">
              <SparkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SHAPES.map(([label, instr]) => (
              <button key={instr} disabled={shaping} onClick={() => submitShape(instr)}
                className="rounded-full border border-line bg-surface px-[15px] py-2 text-[13px] font-bold text-slate-700 shadow-card hover:border-[#DED9D3] disabled:opacity-50">{label}</button>
            ))}
          </div>
          {data.shapeErrors.get(post.id) ? (
            <div data-testid="shape-error" role="alert" className="mt-3.5 flex items-center gap-3 text-[12.5px] leading-relaxed text-danger">
              <span>{data.shapeErrors.get(post.id)}</span>
              <button data-testid="shape-retry" onClick={() => data.retryShape(post.id)} className="font-extrabold text-slate-700 underline">Retry</button>
            </div>
          ) : (
            <p data-testid="shape-note" className="mt-3.5 text-[12.5px] leading-relaxed text-muted">
              {shaping
                ? 'Sprigly is rewriting this in your voice — it’ll appear here when it’s ready.'
                : 'Sprigly rewrites it in your voice and checks it before it lands. Revert always returns to the original.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
