'use client';

import { useState, useTransition } from 'react';
import { approveItem, rejectItem, modifyAndApprove } from './actions';

export interface ReviewItem {
  captureLogId: string;
  category: string;
  suggestedAction: string;
  subject: string;
  from: string;
  draftText: string | null;
  escalationReason: string | null;
}

interface ItemCardProps {
  item: ReviewItem;
  token: string;
  onDone: (id: string) => void;
}

function ItemCard({ item, token, onDone }: ItemCardProps) {
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(item.draftText ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEscalation = item.suggestedAction === 'escalate';

  function act(fn: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.error) {
        setError(result.error);
      } else {
        onDone(item.captureLogId);
      }
    });
  }

  return (
    <div className={`bg-white rounded-lg border px-6 py-5 ${isEscalation ? 'border-red-200' : 'border-gray-200'}`}>
      {isEscalation && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 mb-3">
          ACTION REQUIRED
        </span>
      )}

      <div className="mb-1">
        <span className="text-sm font-medium text-gray-900">{item.from}</span>
      </div>
      <div className="text-sm text-gray-600 mb-1">{item.subject}</div>
      <div className="text-xs text-gray-400 mb-4">
        Category: {item.category} · {item.suggestedAction.replace('_', ' ')}
      </div>

      {isEscalation && item.escalationReason && (
        <div className="text-sm text-gray-700 bg-red-50 border border-red-100 rounded p-3 mb-4 whitespace-pre-wrap">
          {item.escalationReason}
        </div>
      )}

      {!isEscalation && item.draftText && !editing && (
        <div className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded p-3 mb-4 whitespace-pre-wrap">
          {item.draftText}
        </div>
      )}

      {!isEscalation && editing && (
        <div className="mb-4">
          <textarea
            className="w-full text-sm border border-gray-200 rounded p-3 min-h-[120px] focus:outline-none focus:ring-1 focus:ring-gray-400"
            value={editedText}
            onChange={(e) => setEditedText((e.currentTarget as unknown as { value: string }).value)}
          />
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 mb-3">{error}</p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {isEscalation ? (
          <>
            <button
              disabled={isPending}
              onClick={() => act(() => approveItem(item.captureLogId, token))}
              className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
            >
              Mark handled
            </button>
            <button
              disabled={isPending}
              onClick={() => act(() => rejectItem(item.captureLogId, token))}
              className="px-4 py-2 rounded-md border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Dismiss
            </button>
          </>
        ) : editing ? (
          <>
            <button
              disabled={isPending || editedText.trim() === ''}
              onClick={() => act(() => modifyAndApprove(item.captureLogId, editedText, token))}
              className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
            >
              Approve edited draft
            </button>
            <button
              disabled={isPending}
              onClick={() => setEditing(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              disabled={isPending}
              onClick={() => act(() => approveItem(item.captureLogId, token))}
              className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
            >
              Approve
            </button>
            {item.draftText && (
              <button
                disabled={isPending}
                onClick={() => setEditing(true)}
                className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Edit then approve
              </button>
            )}
            <button
              disabled={isPending}
              onClick={() => act(() => rejectItem(item.captureLogId, token))}
              className="px-4 py-2 rounded-md border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface ReviewClientProps {
  token: string;
  items: ReviewItem[];
}

export function ReviewClient({ token, items: initialItems }: ReviewClientProps) {
  const [items, setItems] = useState(initialItems);

  function handleDone(captureLogId: string) {
    setItems((prev) => prev.filter((i) => i.captureLogId !== captureLogId));
  }

  const escalations = items.filter((i) => i.suggestedAction === 'escalate');
  const drafts = items.filter((i) => i.suggestedAction !== 'escalate');

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 text-sm">All items reviewed. Nothing left to action.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {escalations.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            Escalations — {escalations.length}
          </h2>
          <div className="space-y-4">
            {escalations.map((item) => (
              <ItemCard key={item.captureLogId} item={item} token={token} onDone={handleDone} />
            ))}
          </div>
        </section>
      )}
      {drafts.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            Draft replies — {drafts.length}
          </h2>
          <div className="space-y-4">
            {drafts.map((item) => (
              <ItemCard key={item.captureLogId} item={item} token={token} onDone={handleDone} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
