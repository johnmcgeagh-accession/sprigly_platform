'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from './usePlanData';
import { ringOf } from '@/lib/checklist';
import { ChecklistItem, ProgressRing, monthDayLabel } from './pieces';
import { FormatIcon, FORMAT_LABEL, RevertIcon, TrashIcon, SparkIcon, CheckIcon } from './icons';

const SHAPES = [['Make it softer', 'make it softer'], ['Make it shorter', 'make it shorter'], ['Warmer tone', 'warmer tone']] as const;

/** The editor body shared by the desktop drawer and the mobile sheet. Caption save,
 *  Revert, delete, checklist (tick / add / generate), and async "Shape this post". */
export function PostEditor({ post, data, onClose }: { post: PlanPost; data: PlanData; onClose: () => void }) {
  const [caption, setCaption] = useState(post.caption);
  const [hook, setHook] = useState(post.hook ?? '');
  const [shapeText, setShapeText] = useState('');
  const [adding, setAdding] = useState(false);
  const lastId = useRef(post.id);

  // Reset the textarea when the selected post changes or its caption is replaced
  // (e.g. a shape job landed) — but not on every keystroke.
  useEffect(() => {
    if (lastId.current !== post.id) { lastId.current = post.id; setCaption(post.caption); setHook(post.hook ?? ''); setShapeText(''); }
  }, [post.id, post.caption, post.hook]);
  useEffect(() => { setCaption(post.caption); }, [post.caption]);
  useEffect(() => { setHook(post.hook ?? ''); }, [post.hook]);

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

  const submitShape = (instruction: string) => { if (!instruction.trim()) return; void data.shape(post.id, instruction); setShapeText(''); };

  return (
    <div className="flex-1 overflow-y-auto px-[30px] pb-10 pt-[26px]" data-testid="post-editor">
      {/* header */}
      <div className="mb-[22px] mt-1.5 flex flex-wrap items-center gap-[11px]">
        <span className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-line-soft px-[11px] py-[7px] text-[13px] font-extrabold text-slate-700">
          <FormatIcon format={post.format} className="h-[15px] w-[15px] text-coral" />{FORMAT_LABEL[post.format]}
        </span>
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

      {/* hook (reels + carousels) — above the caption */}
      {showHook && (
        <div className="mb-[22px]" data-testid="hook-section">
          <div className="mb-[9px] flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-700">Hook</span>
            {!data.readOnly && (
              <button data-testid="generate-hooks" onClick={() => data.generateHooks(post.id)} disabled={hookGenerating}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-coral px-3 py-1.5 text-[12px] font-extrabold text-coral-on-tint disabled:opacity-50">
                <SparkIcon className="h-3.5 w-3.5" />{hookGenerating ? 'Generating…' : '✨ Generate hooks'}
              </button>
            )}
          </div>
          <input
            data-testid="editor-hook" value={hook} onChange={(e) => setHook(e.target.value)} readOnly={data.readOnly}
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
              <span className="text-[11.5px] font-bold text-muted">Tap one to use it:</span>
              {hookCandidates.map((c, i) => (
                <button key={i} data-testid="hook-candidate" onClick={() => { setHook(c); data.clearHookCandidates(post.id); }}
                  className="rounded-xl border border-line bg-line-soft px-3.5 py-2.5 text-left text-[14px] leading-snug text-slate-700 hover:border-coral hover:bg-coral-tint">{c}</button>
              ))}
            </div>
          )}
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
                className="mt-0.5 self-start rounded-full border border-dashed border-coral px-3.5 py-2 text-[12.5px] font-extrabold text-slate-700 disabled:opacity-50">+ Add step</button>
            : <button data-testid="editor-generate" onClick={() => data.generateChecklist(post.id)}
                className="mt-0.5 self-start rounded-full border border-dashed border-coral px-3.5 py-2 text-[12.5px] font-extrabold text-slate-700">✨ Build checklist</button>
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
