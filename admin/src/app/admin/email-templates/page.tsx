export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { db, emailTemplates } from '@sprigly/db';
import { eq, and, desc } from 'drizzle-orm';

// Read-only view of the platform-level email templates (intake-capture Build 2). Editing is a
// later build — this page just makes the copy VISIBLE outside code. Templates are global (no
// per-client forks); the PUBLISHED version per key is what actually sends.

const KEYS = [
  { key: 'ask',        label: 'Ask',        when: 'On the reminder day (schedule.day), if no intake has landed yet.' },
  { key: 'nudge',      label: 'Nudge',      when: 'At cutoff − 3 days (skipped when the window is under 5 days).' },
  { key: 'last_call',  label: 'Last Call',  when: 'At cutoff − 1 day (the eve of the run).' },
  { key: 'plan_ready', label: 'Plan Ready', when: 'When the plan has been generated (the pinned app-ready notification).' },
] as const;

const MERGE_FIELDS = [
  'contactName', 'clientName', 'monthLabel', 'cutoffDate', 'daysToCutoff',
  'intakeLink', 'appLink', 'questionsBlock', 'leanLine', 'beatsSummary',
];

async function getPublished(key: string) {
  const [row] = await db
    .select({ version: emailTemplates.version, subjectTemplate: emailTemplates.subjectTemplate, bodyTemplate: emailTemplates.bodyTemplate })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.isPublished, true)))
    .orderBy(desc(emailTemplates.version))
    .limit(1);
  return row ?? null;
}

export default async function EmailTemplatesPage() {
  const rows = await Promise.all(KEYS.map(async (k) => ({ ...k, tpl: await getPublished(k.key) })));

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Client Emails</h1>
      <p className="text-sm text-gray-500 mb-2">
        Platform-level email templates for the intake-capture reminder sequence and the plan-ready
        notification. Global (no per-client versions); the published version per key is the one that
        sends. Read-only — editing lands in a later build.
      </p>
      <p className="text-xs text-gray-400 mb-6">
        All sends are currently pinned to the internal test inbox (no client-facing email yet).
        Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join('  ')}
      </p>

      <div className="space-y-6">
        {rows.map((r) => (
          <div key={r.key} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 bg-gray-50 px-4 py-2.5 border-b border-gray-200">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-gray-900">{r.label}</span>
                <code className="text-xs text-gray-400">{r.key}</code>
              </div>
              <span className="text-xs text-gray-500">
                {r.tpl ? `published v${r.tpl.version}` : 'not published'}
              </span>
            </div>
            <div className="px-4 py-3 text-sm">
              <p className="text-xs text-gray-400 mb-3">{r.when}</p>
              {r.tpl ? (
                <>
                  <div className="mb-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Subject</div>
                    <div className="font-mono text-[13px] text-gray-800">{r.tpl.subjectTemplate}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">Body</div>
                    <pre className="font-mono text-[13px] text-gray-800 whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">{r.tpl.bodyTemplate}</pre>
                  </div>
                </>
              ) : (
                <p className="text-sm text-amber-600">No published template for this key — sends will be skipped.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
