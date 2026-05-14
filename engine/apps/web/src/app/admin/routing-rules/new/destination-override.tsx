'use client';

import { useState } from 'react';

const DEFAULT_DESTINATIONS = JSON.stringify(
  [{ destinationId: 'db-save-output', requireApproval: false, settings: { to: 'sender' } }],
  null,
  2,
);

export function DestinationOverride() {
  const [override, setOverride] = useState(false);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={override}
          onChange={() => setOverride((v) => !v)}
          className="w-4 h-4 rounded border-gray-300"
        />
        Override default destination
      </label>

      {!override && (
        <p className="text-xs text-gray-400">
          Uses the workflow&apos;s default destination. Most workflows reply to the sender.
        </p>
      )}

      {override && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="destinationsJson">
            Destinations <span className="text-gray-400 font-normal">(JSON array)</span>
          </label>
          <textarea
            id="destinationsJson"
            name="destinationsJson"
            rows={5}
            defaultValue={DEFAULT_DESTINATIONS}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
      )}

      {/* Always submit destinations — empty array when using default */}
      {!override && (
        <input type="hidden" name="destinationsJson" value="[]" />
      )}
    </div>
  );
}
