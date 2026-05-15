'use client';

import { useState } from 'react';

const DEFAULT_CONDITIONS = JSON.stringify(
  [{ field: 'subject', op: 'startsWith', value: 'Brief:', caseSensitive: false }],
  null,
  2,
);

export function MatchConditionsSection() {
  const [matchAll, setMatchAll] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            name="matchAll"
            checked={matchAll}
            onChange={() => setMatchAll((v) => !v)}
            className="w-4 h-4 rounded border-gray-300"
          />
          Match every incoming email (no filtering)
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            name="isFallback"
            checked={isFallback}
            onChange={() => setIsFallback((v) => !v)}
            className="w-4 h-4 rounded border-gray-300"
          />
          Fallback only — run only if no other rule matched
        </label>
      </div>

      {matchAll ? (
        <p className="text-xs text-gray-400 border border-gray-100 rounded-md px-3 py-2 bg-gray-50">
          All emails routed to this workflow. Conditions are ignored.
        </p>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="matchConditionsJson">
            Trigger conditions <span className="text-gray-400 font-normal">(JSON array)</span>
          </label>
          <textarea
            id="matchConditionsJson"
            name="matchConditionsJson"
            rows={5}
            required
            defaultValue={DEFAULT_CONDITIONS}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
      )}

      {/* Always submit matchConditionsJson when match-all is active so the server action sees the field */}
      {matchAll && <input type="hidden" name="matchConditionsJson" value="[]" />}
    </div>
  );
}
