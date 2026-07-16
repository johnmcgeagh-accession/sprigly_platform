'use client';

// CycleConfig — the per-channel config half moved out of ContentCycleOpsPanel: delivery surface,
// AI-change limit + override, posts per week, and the competitor list. MOVED verbatim — each
// control keeps its exact handler and gate. Rendered inside the (collapsed) Settings section,
// alongside ContentCycleSettingsForm.

import { useState, useTransition } from 'react';
import { setDeliverySurface, setAiChangeLimit, liftAiLimit, clearAiLimitOverride, setPostsPerWeek, type ActionResult } from './actions';
import { addCompetitor, removeCompetitor, type InputActionResult } from './input-actions';
import { formatDateTime } from '@/lib/format-date';

const fmtDate = formatDateTime;

interface Props {
  clientId:                   string;
  channel:                    string;
  dataMonth:                  string;
  deliverySurface:            'app' | 'sheet' | 'both';
  aiChangeLimit:              number;
  aiChangeLimitOverrideUntil: string | null;
  postsPerWeek:               number | null;
  competitors:                string[];
}

export function CycleConfig({
  clientId, channel, dataMonth,
  deliverySurface, aiChangeLimit, aiChangeLimitOverrideUntil, postsPerWeek, competitors,
}: Props) {
  const [aiLimitInput, setAiLimitInput] = useState(String(aiChangeLimit));
  const [ppwInput,     setPpwInput]     = useState(postsPerWeek != null ? String(postsPerWeek) : '');
  const [compHandle,   setCompHandle]   = useState('');
  const [actionError,  setActionError]  = useState<string | null>(null);
  const [note,         setNote]         = useState<string | null>(null);
  const [isPending,    startTransition] = useTransition();

  const overrideActive = aiChangeLimitOverrideUntil != null && new Date(aiChangeLimitOverrideUntil).getTime() > Date.now();
  const overCap = competitors.length > 5;

  function callTrigger(action: (fd: FormData) => Promise<ActionResult>, extraFields?: Record<string, string>) {
    setActionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('clientId',  clientId);
      fd.set('channel',   channel);
      fd.set('dataMonth', dataMonth);
      if (extraFields) Object.entries(extraFields).forEach(([k, v]) => fd.set(k, v));
      const result = await action(fd);
      if (!result.ok) setActionError(result.message ?? 'An error occurred.');
    });
  }

  const runComp = (action: (fd: FormData) => Promise<InputActionResult>, handle: string, after?: () => void) => {
    setNote(null); setActionError(null);
    startTransition(async () => {
      const fd = new FormData(); fd.set('clientId', clientId); fd.set('channel', channel); fd.set('handle', handle);
      const r = await action(fd);
      if (r.ok) { setNote(r.message); after?.(); } else setActionError(r.message);
    });
  };
  const doAdd    = () => { if (!compHandle.trim()) return; runComp(addCompetitor, compHandle, () => setCompHandle('')); };
  const doRemove = (h: string) => runComp(removeCompetitor, h);

  return (
    <div className="mt-6 pt-5 border-t border-gray-100 space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Delivery, limits &amp; competitors</h3>

      {/* Delivery surface preference */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-600 w-40 shrink-0">Delivery email links to</span>
        <select
          defaultValue={deliverySurface}
          disabled={isPending}
          onChange={(e) => callTrigger(setDeliverySurface, { surface: (e.target as unknown as { value: string }).value })}
          className="border border-gray-300 rounded px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="both">App + workbook (both)</option>
          <option value="app">App only</option>
          <option value="sheet">Workbook only</option>
        </select>
      </div>

      {/* AI-change limit */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="font-medium text-gray-600 w-40 shrink-0">AI-change limit / month</span>
        <input
          type="number" min={0} step={1}
          value={aiLimitInput}
          disabled={isPending}
          onChange={(e) => setAiLimitInput((e.target as unknown as { value: string }).value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-24 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={isPending || aiLimitInput.trim() === '' || aiLimitInput === String(aiChangeLimit)}
          onClick={() => callTrigger(setAiChangeLimit, { limit: aiLimitInput.trim() })}
          className="px-2.5 py-1 text-xs font-medium bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
        <span className="text-xs text-gray-400">rewrites/regen only — structural edits are always free</span>
      </div>

      {/* Override */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="font-medium text-gray-600 w-40 shrink-0">Override</span>
        {overrideActive ? (
          <>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
              Unlimited until {fmtDate(aiChangeLimitOverrideUntil!)}
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => callTrigger(clearAiLimitOverride)}
              className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
            >
              Clear override
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-400">Limit in force.</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => callTrigger(liftAiLimit)}
              className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Lift limit for 30 days
            </button>
          </>
        )}
      </div>

      {/* Posts per week */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="font-medium text-gray-600 w-40 shrink-0">Posts per week</span>
        <input
          type="number" min={1} max={14} step={1}
          value={ppwInput}
          placeholder="auto"
          disabled={isPending}
          onChange={(e) => setPpwInput((e.target as unknown as { value: string }).value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-24 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={isPending || ppwInput === (postsPerWeek != null ? String(postsPerWeek) : '')}
          onClick={() => callTrigger(setPostsPerWeek, { postsPerWeek: ppwInput.trim() })}
          className="px-2.5 py-1 text-xs font-medium bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
        <span className="text-xs text-gray-400">blank = derive from history/config (unchanged)</span>
      </div>

      {/* Competitor list */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600 w-40 shrink-0">Competitors</span>
          <span className="text-xs text-gray-400">{competitors.length}/5 scraped{overCap ? '' : ' — the gather scrapes at most 5'}</span>
        </div>
        {overCap && (
          <div className="ml-40 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            {competitors.length} configured — only the first 5 are scraped. Trim to your top 5 (remove {competitors.length - 5}).
          </div>
        )}
        <div className="ml-40 flex flex-wrap gap-1.5">
          {competitors.length === 0 && <span className="text-xs text-gray-400">None yet.</span>}
          {competitors.map((h, i) => (
            <span key={h} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${i < 5 ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-700 line-through'}`}>
              @{h}
              <button type="button" disabled={isPending} onClick={() => doRemove(h)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${h}`}>✕</button>
            </span>
          ))}
        </div>
        <div className="ml-40 flex items-center gap-2">
          <input type="text" value={compHandle} placeholder="@handle" disabled={isPending || competitors.length >= 5}
            onChange={(e) => setCompHandle((e.target as unknown as { value: string }).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doAdd(); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-48 disabled:opacity-50" />
          <button type="button" disabled={isPending || !compHandle.trim() || competitors.length >= 5} onClick={doAdd}
            className="px-2.5 py-1 text-xs font-medium bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed">
            Add
          </button>
          {competitors.length >= 5 && <span className="text-xs text-gray-400">Max 5 — remove one to add another.</span>}
        </div>
      </div>

      {note && (
        <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-bold">✓</span><span>{note}</span>
          <button type="button" onClick={() => setNote(null)} className="ml-auto shrink-0 text-green-500 hover:text-green-700 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}
      {actionError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-bold">!</span><span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}
