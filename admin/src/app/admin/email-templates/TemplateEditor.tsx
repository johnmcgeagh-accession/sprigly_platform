'use client';

import { useState, useTransition } from 'react';
import { BASE_QUESTIONS, MERGE_FIELDS, renderEmailTemplate, unknownMergeFields } from '@sprigly/engine';
import { publishTemplateVersion } from './actions';

export interface TemplateVersion {
  version:         number;
  isPublished:     boolean;
  subjectTemplate: string;
  bodyTemplate:    string;
  createdAt:       string;   // ISO
}

// A representative sample context for the merge-field preview.
const SAMPLE = {
  contactName:  'Sally',
  clientName:   'Ivy T',
  monthLabel:   'August 2026',
  cutoffDate:   '20 August',
  daysToCutoff: '6',
  intakeLink:   'https://app.sprigly.co.uk/p/tok?intake=1',
  appLink:      'https://app.sprigly.co.uk/p/tok',
  questionsBlock: BASE_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n'),
  beatsSummary: '',
} as const;
const LEAN_LINE_SAMPLE = "we've taken a look at last month's numbers. Here's where the data's pointing.\n\n";

export function TemplateEditor({ keyName, label, when, versions }: {
  keyName: string;
  label:   string;
  when:    string;
  versions: TemplateVersion[];
}) {
  const published = versions.find((v) => v.isPublished) ?? versions[0] ?? null;
  const [subject, setSubject] = useState(published?.subjectTemplate ?? '');
  const [body,    setBody]    = useState(published?.bodyTemplate ?? '');
  const [editing, setEditing] = useState(false);
  const [msg,     setMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startPublish] = useTransition();

  const unknown = unknownMergeFields(subject, body);
  const dirty = subject !== (published?.subjectTemplate ?? '') || body !== (published?.bodyTemplate ?? '');
  const canPublish = editing && dirty && unknown.length === 0 && subject.trim().length > 0 && body.trim().length > 0 && !pending;

  let previewBlank: { subject: string; body: string } | null = null;
  let previewFull:  { subject: string; body: string } | null = null;
  let renderError: string | null = null;
  try {
    previewBlank = renderEmailTemplate({ subjectTemplate: subject, bodyTemplate: body }, { ...SAMPLE, leanLine: '' });
    previewFull  = renderEmailTemplate({ subjectTemplate: subject, bodyTemplate: body }, { ...SAMPLE, leanLine: LEAN_LINE_SAMPLE });
  } catch (e) { renderError = e instanceof Error ? e.message : 'render error'; }

  const publish = () => {
    setMsg(null);
    startPublish(async () => {
      const r = await publishTemplateVersion({ key: keyName, subjectTemplate: subject, bodyTemplate: body });
      setMsg({ ok: r.ok, text: r.ok ? `Published v${r.version}.` : (r.error ?? 'Publish failed.') });
      if (r.ok) setEditing(false);
    });
  };
  const startEdit = () => { setSubject(published?.subjectTemplate ?? ''); setBody(published?.bodyTemplate ?? ''); setMsg(null); setEditing(true); };
  const cancel = () => { setSubject(published?.subjectTemplate ?? ''); setBody(published?.bodyTemplate ?? ''); setEditing(false); setMsg(null); };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 bg-gray-50 px-4 py-2.5 border-b border-gray-200">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-gray-900">{label}</span>
          <code className="text-xs text-gray-400">{keyName}</code>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{published ? `published v${published.version}` : 'not published'}</span>
          {!editing && <button data-testid="edit-btn" onClick={startEdit} className="text-xs font-medium text-blue-600 hover:text-blue-800">Edit</button>}
        </div>
      </div>

      <div className="px-4 py-3 text-sm">
        <p className="text-xs text-gray-400 mb-3">{when}</p>

        {!editing ? (
          published ? (
            <>
              <div className="mb-2"><div className="text-xs font-medium text-gray-500 mb-1">Subject</div><div className="font-mono text-[13px] text-gray-800">{published.subjectTemplate}</div></div>
              <div><div className="text-xs font-medium text-gray-500 mb-1">Body</div><pre className="font-mono text-[13px] text-gray-800 whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">{published.bodyTemplate}</pre></div>
            </>
          ) : <p className="text-amber-600 text-sm">No published template for this key.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ── editor ── */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject (new version)</label>
              <input data-testid="edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                className="w-full border border-gray-200 rounded px-2.5 py-1.5 font-mono text-[13px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">Body</label>
              <textarea data-testid="edit-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12}
                className="w-full border border-gray-200 rounded px-2.5 py-1.5 font-mono text-[13px] text-gray-900 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400" />

              {unknown.length > 0 && (
                <p data-testid="unknown-field-error" className="mt-2 text-xs text-red-600">
                  Unknown merge field(s): {unknown.map((f) => `{{${f}}}`).join(', ')} — fix before publishing.
                </p>
              )}

              <div className="mt-3 flex items-center gap-3">
                <button data-testid="publish-btn" disabled={!canPublish} onClick={publish}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                  {pending ? 'Publishing…' : 'Publish new version'}
                </button>
                <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
                {msg && <span className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
              </div>

              {/* merge-field reference — sourced from the renderer so it can't drift */}
              <div className="mt-4 border-t border-gray-100 pt-3">
                <div className="text-xs font-medium text-gray-500 mb-1">Merge fields</div>
                <dl className="grid grid-cols-1 gap-y-0.5 text-[11px]">
                  {Object.entries(MERGE_FIELDS).map(([f, desc]) => (
                    <div key={f} className="flex gap-2"><dt className="font-mono text-gray-700 flex-shrink-0">{`{{${f}}}`}</dt><dd className="text-gray-500">{desc}</dd></div>
                  ))}
                </dl>
              </div>
            </div>

            {/* ── preview ── */}
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Preview (sample context)</div>
              {renderError ? (
                <p data-testid="preview-error" className="text-xs text-red-600">Cannot preview: {renderError}</p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Subject</div>
                    <div className="font-mono text-[13px] text-gray-800">{previewBlank!.subject}</div>
                  </div>
                  <div data-testid="preview-leanline-blank">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Body — lean line BLANK</div>
                    <pre className="font-mono text-[13px] text-gray-800 whitespace-pre-wrap bg-white rounded p-3 border border-gray-200">{previewBlank!.body}</pre>
                  </div>
                  <div data-testid="preview-leanline-full">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Body — lean line POPULATED</div>
                    <pre className="font-mono text-[13px] text-gray-800 whitespace-pre-wrap bg-white rounded p-3 border border-gray-200">{previewFull!.body}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* version history */}
        {versions.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-2">
            <div className="text-xs font-medium text-gray-500 mb-1">Version history</div>
            <ul className="text-[11px] text-gray-500 space-y-0.5">
              {versions.slice().sort((a, b) => b.version - a.version).map((v) => (
                <li key={v.version} className="flex items-center gap-2">
                  <span className="font-mono">v{v.version}</span>
                  {v.isPublished && <span className="rounded bg-green-100 text-green-700 px-1.5">published</span>}
                  <span className="text-gray-400">{new Date(v.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
