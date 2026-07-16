'use client';

// CycleInputs — the manual input uploads moved out of ContentCycleOpsPanel's InputsAndCompetitors:
// sales CSV, IG posts JSON, and the upload data month. MOVED verbatim — same handlers, same gates.
// (The competitor list moved to CycleConfig; the IG-input-status readout was deleted — it is
// mirrored by the card's Grounding row.)

import { useState, useTransition } from 'react';
import { uploadSales, uploadIgPosts, type InputActionResult } from './input-actions';

interface Props {
  clientId:  string;
  channel:   string;
  dataMonth: string;
}

export function CycleInputs({ clientId, channel, dataMonth }: Props) {
  const [month, setMonth]         = useState(dataMonth);
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [igFile, setIgFile]       = useState<File | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [busy, startT]  = useTransition();

  const run = (action: (fd: FormData) => Promise<InputActionResult>, fd: FormData) => {
    setNote(null); setErr(null);
    startT(async () => {
      const r = await action(fd);
      if (r.ok) setNote(r.message); else setErr(r.message);
    });
  };
  const base = () => { const fd = new FormData(); fd.set('clientId', clientId); fd.set('channel', channel); return fd; };

  const doSales = () => {
    if (!salesFile) { setErr('Choose a CSV file first.'); return; }
    const fd = base(); fd.set('month', month); fd.set('file', salesFile); run(uploadSales, fd);
  };
  const doIg = () => {
    if (!igFile) { setErr('Choose a JSON file first.'); return; }
    const fd = base(); fd.set('month', month); fd.set('file', igFile); run(uploadIgPosts, fd);
  };

  return (
    <div className="space-y-4">
      {/* Data month for uploads */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-600 w-32 shrink-0">Upload data month</span>
        <input type="month" value={month} disabled={busy}
          onChange={(e) => setMonth((e.target as unknown as { value: string }).value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-50" />
        <span className="text-xs text-gray-400">files land as <span className="font-mono">sales-{month}.csv</span> / <span className="font-mono">instagram-posts-{month}.json</span></span>
      </div>

      {/* Sales upload */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="font-medium text-gray-600 w-32 shrink-0">Sales CSV</span>
        <input type="file" accept=".csv,text/csv" disabled={busy}
          onChange={(e) => setSalesFile((e.target as unknown as { files: ArrayLike<File> | null }).files?.[0] ?? null)}
          className="text-xs" />
        <button type="button" disabled={busy || !salesFile} onClick={doSales}
          className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          Upload &amp; rebuild catalogue
        </button>
        <span className="text-xs text-gray-400">Shopify &quot;Sales by product&quot; — writes Drive + rebuilds catalogue</span>
      </div>

      {/* IG fallback upload */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="font-medium text-gray-600 w-32 shrink-0">IG posts JSON</span>
        <input type="file" accept=".json,application/json" disabled={busy}
          onChange={(e) => setIgFile((e.target as unknown as { files: ArrayLike<File> | null }).files?.[0] ?? null)}
          className="text-xs" />
        <button type="button" disabled={busy || !igFile} onClick={doIg}
          className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          Upload IG fallback
        </button>
        <span className="text-xs text-gray-400">array of {'{ timestamp, caption?, likesCount, commentsCount }'} — planning reads it</span>
      </div>

      {note && (
        <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-bold">✓</span><span>{note}</span>
          <button type="button" onClick={() => setNote(null)} className="ml-auto shrink-0 text-green-500 hover:text-green-700 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}
      {err && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-bold">!</span><span>{err}</span>
          <button type="button" onClick={() => setErr(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}
