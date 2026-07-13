export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { db, emailTemplates } from '@sprigly/db';
import { desc } from 'drizzle-orm';
import { TemplateEditor, type TemplateVersion } from './TemplateEditor';

// The four global template keys + when each fires. GLOBAL-ONLY by construction (no client_id);
// the editor never grows per-client capability.
const KEYS = [
  { key: 'ask',        label: 'Ask',        when: 'On the reminder day (schedule.day), if no intake has landed yet.' },
  { key: 'nudge',      label: 'Nudge',      when: 'At cutoff − 3 days (skipped when the window is under 5 days).' },
  { key: 'last_call',  label: 'Last Call',  when: 'At cutoff − 1 day (the eve of the run).' },
  { key: 'plan_ready', label: 'Plan Ready', when: 'When the plan has generated (the pinned app-ready notification).' },
] as const;

export default async function EmailTemplatesPage() {
  const rows = await db
    .select({
      key: emailTemplates.key, version: emailTemplates.version, isPublished: emailTemplates.isPublished,
      subjectTemplate: emailTemplates.subjectTemplate, bodyTemplate: emailTemplates.bodyTemplate, createdAt: emailTemplates.createdAt,
    })
    .from(emailTemplates)
    .orderBy(desc(emailTemplates.version));

  const byKey = new Map<string, TemplateVersion[]>();
  for (const r of rows) {
    const arr = byKey.get(r.key) ?? [];
    arr.push({ version: r.version, isPublished: r.isPublished, subjectTemplate: r.subjectTemplate, bodyTemplate: r.bodyTemplate, createdAt: r.createdAt.toISOString() });
    byKey.set(r.key, arr);
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Client Emails</h1>
      <p className="text-sm text-gray-500 mb-1">
        Platform-level, GLOBAL email templates (no per-client versions). The published version per key
        is the one that sends. Editing drafts a NEW version and publishes it atomically — existing
        versions are never mutated.
      </p>
      <p className="text-xs text-gray-400 mb-6">All sends are pinned to the internal test inbox (no client-facing email yet).</p>

      <div className="space-y-6">
        {KEYS.map((k) => (
          <TemplateEditor key={k.key} keyName={k.key} label={k.label} when={k.when} versions={byKey.get(k.key) ?? []} />
        ))}
      </div>
    </div>
  );
}
