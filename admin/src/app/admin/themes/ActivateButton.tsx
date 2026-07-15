'use client';

import { useState, useTransition } from 'react';
import { activateTheme } from './actions';

/** One-click Activate for a theme. Surfaces the contrast-gate error inline when activation is
 *  blocked (e.g. a theme whose tint/text pairing fails AA). Disabled for the already-active theme. */
export function ActivateButton({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (active) {
    return <span className="inline-flex items-center rounded-md bg-green-100 px-3 py-1.5 text-sm font-semibold text-green-800">● Active</span>;
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        disabled={pending}
        onClick={() => { setError(null); start(async () => { const r = await activateTheme(id); if (!r.ok) setError(r.error ?? 'Failed.'); }); }}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? 'Activating…' : 'Activate'}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </div>
  );
}
