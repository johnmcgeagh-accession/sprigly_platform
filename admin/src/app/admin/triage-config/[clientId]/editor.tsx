'use client';

import { useState, useTransition } from 'react';
import { upsertTriageConfig } from './actions';
import type { TriageCategory, ReplyExample } from '@sprigly/engine';

// ── helpers ────────────────────────────────────────────────────────────────────

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'category'
  );
}

function uniqueKey(label: string, existingKeys: string[]): string {
  const base = slugify(label);
  if (!existingKeys.includes(base)) return base;
  let n = 2;
  while (existingKeys.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// tsconfig lib:["ES2022"] has no DOM — access .value via this workaround
function val(e: { currentTarget: unknown }): string {
  return (e.currentTarget as unknown as { value: string }).value;
}

// ── types ──────────────────────────────────────────────────────────────────────

type ActionType = 'draft_reply' | 'escalate' | 'label' | 'invoke_workflow';

interface CategoryState {
  key: string;
  label: string;
  description: string;
  actionType: ActionType;
  actionWorkflowId: string;
  graduationEligible: boolean;
  escalationReason: string;
  escalationContext: string;
}

interface ExampleState {
  inbound: string;
  reply: string;
  note: string;
}

function parseActionType(action: string): { actionType: ActionType; actionWorkflowId: string } {
  if (action.startsWith('invoke_workflow:')) {
    return { actionType: 'invoke_workflow', actionWorkflowId: action.slice('invoke_workflow:'.length) };
  }
  return { actionType: action as ActionType, actionWorkflowId: '' };
}

function toTriageCategory(c: CategoryState): TriageCategory {
  const action = (
    c.actionType === 'invoke_workflow' ? `invoke_workflow:${c.actionWorkflowId}` : c.actionType
  ) as TriageCategory['action'];

  return {
    key: c.key,
    label: c.label,
    description: c.description,
    action,
    graduationEligible: c.graduationEligible,
    ...(c.actionType === 'escalate' && c.escalationReason.trim() !== '' && {
      escalationReason: c.escalationReason,
    }),
    ...(c.actionType === 'escalate' && c.escalationContext.trim() !== '' && {
      escalationContext: c.escalationContext,
    }),
  };
}

// ── sub-components ─────────────────────────────────────────────────────────────

const inputCls =
  'border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 w-full';
const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

interface InvokeTarget { id: string; name: string }

function CategoryCard({
  cat,
  index,
  invokeTargets,
  onChange,
  onRemove,
}: {
  cat: CategoryState;
  index: number;
  invokeTargets: InvokeTarget[];
  onChange: (updated: CategoryState) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<CategoryState>) => onChange({ ...cat, ...patch });

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Label</label>
            <input
              className={inputCls}
              value={cat.label}
              onChange={(e) => set({ label: val(e) })}
              placeholder="e.g. Invoice Query"
            />
          </div>
          <div>
            <label className={labelCls}>
              Key{' '}
              <span className="text-gray-400 font-normal">— frozen at creation, never changes</span>
            </label>
            <input
              readOnly
              className={`${inputCls} bg-gray-50 font-mono text-xs text-gray-500 cursor-default`}
              value={cat.key}
              tabIndex={-1}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-5 text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
        >
          Remove
        </button>
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea
          className={inputCls}
          rows={2}
          value={cat.description}
          onChange={(e) => set({ description: val(e) })}
          placeholder="Describe what emails fall into this category"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Action</label>
          <select
            className={inputCls}
            value={cat.actionType}
            onChange={(e) => set({ actionType: val(e) as ActionType })}
          >
            <option value="draft_reply">Draft reply</option>
            <option value="escalate">Escalate</option>
            <option value="label">Label only</option>
            <option value="invoke_workflow">Invoke workflow</option>
          </select>
        </div>

        {cat.actionType === 'invoke_workflow' && (
          <div>
            <label className={labelCls}>Workflow</label>
            <select
              className={inputCls}
              value={cat.actionWorkflowId}
              onChange={(e) => set({ actionWorkflowId: val(e) })}
            >
              <option value="">— select —</option>
              {invokeTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2 self-end pb-2">
          <input
            id={`grad-${index}`}
            type="checkbox"
            className="w-4 h-4 rounded border-gray-300"
            checked={cat.graduationEligible}
            onChange={() => set({ graduationEligible: !cat.graduationEligible })}
          />
          <label htmlFor={`grad-${index}`} className="text-sm text-gray-700 cursor-pointer">
            Graduation eligible
          </label>
        </div>
      </div>

      {cat.actionType === 'escalate' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Escalation reason (shown to human)</label>
            <input
              className={inputCls}
              value={cat.escalationReason}
              onChange={(e) => set({ escalationReason: val(e) })}
              placeholder="e.g. Requires senior review"
            />
          </div>
          <div>
            <label className={labelCls}>Escalation context (guidance for escalation)</label>
            <input
              className={inputCls}
              value={cat.escalationContext}
              onChange={(e) => set({ escalationContext: val(e) })}
              placeholder="e.g. Check legal before responding"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExampleCard({
  ex,
  onChange,
  onRemove,
}: {
  ex: ExampleState;
  onChange: (updated: ExampleState) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<ExampleState>) => onChange({ ...ex, ...patch });

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Inbound email excerpt</label>
            <textarea
              className={inputCls}
              rows={3}
              value={ex.inbound}
              onChange={(e) => set({ inbound: val(e) })}
              placeholder="Paste a representative inbound email..."
            />
          </div>
          <div>
            <label className={labelCls}>Ideal reply</label>
            <textarea
              className={inputCls}
              rows={3}
              value={ex.reply}
              onChange={(e) => set({ reply: val(e) })}
              placeholder="The reply Sprigly should learn from..."
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-5 text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
        >
          Remove
        </button>
      </div>
      <div>
        <label className={labelCls}>Note (optional)</label>
        <input
          className={inputCls}
          value={ex.note}
          onChange={(e) => set({ note: val(e) })}
          placeholder="Why this reply is the right one..."
        />
      </div>
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────────

export interface InitialTriageConfig {
  digestCadence: string;
  categories: TriageCategory[];
  voiceSample: string;
  replyExamples: ReplyExample[];
  additionalInstructions: string;
  verifiedDomain: string;
}

interface Props {
  clientId: string;
  clientName: string;
  initial: InitialTriageConfig;
  invokeTargets: InvokeTarget[];
}

export function TriageConfigEditor({ clientId, clientName, initial, invokeTargets }: Props) {
  const [cadence, setCadence] = useState(initial.digestCadence);
  const [verifiedDomain, setVerifiedDomain] = useState(initial.verifiedDomain);
  const [voiceSample, setVoiceSample] = useState(initial.voiceSample);
  const [additionalInstructions, setAdditionalInstructions] = useState(
    initial.additionalInstructions,
  );

  const [categories, setCategories] = useState<CategoryState[]>(() =>
    initial.categories.map((c) => {
      const { actionType, actionWorkflowId } = parseActionType(c.action);
      return {
        key:                c.key,
        label:              c.label,
        description:        c.description,
        actionType,
        actionWorkflowId,
        graduationEligible: c.graduationEligible,
        escalationReason:   c.escalationReason ?? '',
        escalationContext:  c.escalationContext ?? '',
      };
    }),
  );

  const [examples, setExamples] = useState<ExampleState[]>(() =>
    initial.replyExamples.map((e) => ({
      inbound: e.inbound,
      reply:   e.reply,
      note:    e.note ?? '',
    })),
  );

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [isPending, startTransition] = useTransition();

  function addCategory() {
    const existingKeys = categories.map((c) => c.key);
    const key = uniqueKey('New Category', existingKeys);
    setCategories((prev) => [
      ...prev,
      {
        key,
        label:              'New Category',
        description:        '',
        actionType:         'draft_reply',
        actionWorkflowId:   '',
        graduationEligible: false,
        escalationReason:   '',
        escalationContext:  '',
      },
    ]);
  }

  function removeCategory(i: number) {
    setCategories((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateCategory(i: number, updated: CategoryState) {
    setCategories((prev) => prev.map((c, idx) => (idx === i ? updated : c)));
  }

  function addExample() {
    setExamples((prev) => [...prev, { inbound: '', reply: '', note: '' }]);
  }

  function removeExample(i: number) {
    setExamples((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateExample(i: number, updated: ExampleState) {
    setExamples((prev) => prev.map((e, idx) => (idx === i ? updated : e)));
  }

  function handleSave() {
    setSaveStatus('idle');
    setSaveError('');

    const builtCategories = categories.map(toTriageCategory);
    const builtExamples: ReplyExample[] = examples
      .filter((e) => e.inbound.trim() !== '' || e.reply.trim() !== '')
      .map((e) => ({
        inbound: e.inbound,
        reply:   e.reply,
        ...(e.note.trim() !== '' && { note: e.note }),
      }));

    startTransition(async () => {
      const result = await upsertTriageConfig(clientId, {
        digestCadence:          cadence,
        categories:             builtCategories,
        voiceSample,
        replyExamples:          builtExamples,
        additionalInstructions,
        verifiedDomain,
      });
      if (result.ok) {
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
        setSaveError(result.error);
      }
    });
  }

  const sectionCls = 'bg-white rounded-lg border border-gray-200 px-6 py-5';

  return (
    <div className="space-y-6">
      {/* Digest Cadence */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Digest cadence</h2>
        <div className="max-w-xs">
          <label className={labelCls}>Send digest</label>
          <select
            className={inputCls}
            value={cadence}
            onChange={(e) => setCadence(val(e))}
          >
            <option value="end_of_day">End of day (17:00 UTC)</option>
            <option value="twice_daily">Twice daily (09:00 &amp; 17:00 UTC)</option>
            <option value="end_of_week">End of week (Friday 17:00 UTC)</option>
          </select>
        </div>
      </div>

      {/* Verified domain */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Verified domain</h2>
        <p className="text-xs text-gray-400 mb-4">
          The client&apos;s own email domain (e.g. <code>acmecorp.com</code>). Used to gate delivery
          of workflow output: if the inbound sender&apos;s domain matches this, the brief goes back to
          that sender; otherwise it always goes to the client&apos;s on-file Gmail address. Leave
          blank to always deliver to the client.
        </p>
        <div className="max-w-xs">
          <label className={labelCls}>Domain (without @)</label>
          <input
            className={inputCls}
            value={verifiedDomain}
            onChange={(e) => setVerifiedDomain(val(e))}
            placeholder="acmecorp.com"
          />
        </div>
      </div>

      {/* Categories */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900">Categories</h2>
          <button
            type="button"
            onClick={addCategory}
            className="text-sm text-blue-600 hover:underline"
          >
            + Add category
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Each category has an immutable key generated from its label at creation time.
          Renaming the label does <strong>not</strong> change the key — the key is frozen forever.
        </p>
        {categories.length === 0 ? (
          <p className="text-sm text-gray-400">No categories yet.</p>
        ) : (
          <div className="space-y-3">
            {categories.map((cat, i) => (
              <CategoryCard
                key={cat.key}
                cat={cat}
                index={i}
                invokeTargets={invokeTargets}
                onChange={(updated) => updateCategory(i, updated)}
                onRemove={() => removeCategory(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Voice sample */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Voice sample</h2>
        <p className="text-xs text-gray-400 mb-4">
          A few sentences in {clientName}&apos;s writing style. Used to calibrate tone when drafting
          replies.
        </p>
        <textarea
          className={inputCls}
          rows={5}
          value={voiceSample}
          onChange={(e) => setVoiceSample(val(e))}
          placeholder="Paste a sample of how this client writes emails..."
        />
      </div>

      {/* Reply examples */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900">Reply examples</h2>
          <button
            type="button"
            onClick={addExample}
            className="text-sm text-blue-600 hover:underline"
          >
            + Add example
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Few-shot examples shown to the model. Good examples improve reply quality significantly.
        </p>
        {examples.length === 0 ? (
          <p className="text-sm text-gray-400">No examples yet.</p>
        ) : (
          <div className="space-y-3">
            {examples.map((ex, i) => (
              <ExampleCard
                key={i}
                ex={ex}
                onChange={(updated) => updateExample(i, updated)}
                onRemove={() => removeExample(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Additional instructions */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Additional instructions</h2>
        <p className="text-xs text-gray-400 mb-4">
          Free-form guidance appended to the triage prompt. Use this for edge cases not captured by
          categories or examples.
        </p>
        <textarea
          className={inputCls}
          rows={4}
          value={additionalInstructions}
          onChange={(e) => setAdditionalInstructions(val(e))}
          placeholder="Optional extra instructions..."
        />
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="px-6 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {saveStatus === 'saved' && (
          <span className="text-sm text-green-600">Saved successfully.</span>
        )}
        {saveStatus === 'error' && (
          <span className="text-sm text-red-600">Error: {saveError}</span>
        )}
      </div>
    </div>
  );
}
