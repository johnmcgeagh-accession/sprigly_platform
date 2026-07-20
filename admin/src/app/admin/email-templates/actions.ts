'use server';

import { and, desc, eq } from 'drizzle-orm';
import { db, emailTemplates, type EmailTemplateKey } from '@sprigly/db';
import { unknownMergeFields } from '@sprigly/engine';
import { revalidatePath } from 'next/cache';

const KEYS: EmailTemplateKey[] = ['ask', 'ask_drafted', 'nudge', 'last_call', 'plan_ready'];

export interface PublishResult { ok: boolean; error?: string; version?: number }

/**
 * Publish a NEW version of a template key. GLOBAL-ONLY (no client_id — the editor never grows
 * per-client capability). Never mutates an existing row: inserts version = max+1 and flips
 * is_published in ONE transaction, unpublishing the current published row FIRST so the partial
 * unique index (one published per key) never sees two published at once. Fail-loud: an unknown
 * merge field is rejected before any write.
 */
export async function publishTemplateVersion(input: { key: string; subjectTemplate: string; bodyTemplate: string }): Promise<PublishResult> {
  const key = input.key as EmailTemplateKey;
  const subjectTemplate = input.subjectTemplate ?? '';
  const bodyTemplate = input.bodyTemplate ?? '';

  if (!KEYS.includes(key)) return { ok: false, error: `Unknown template key "${input.key}".` };
  if (!subjectTemplate.trim() || !bodyTemplate.trim()) return { ok: false, error: 'Subject and body are both required.' };

  const unknown = unknownMergeFields(subjectTemplate, bodyTemplate);
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown merge field(s): ${unknown.map((f) => `{{${f}}}`).join(', ')}. Fix before publishing.` };
  }

  try {
    const version = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ v: emailTemplates.version })
        .from(emailTemplates)
        .where(eq(emailTemplates.key, key))
        .orderBy(desc(emailTemplates.version))
        .limit(1);
      const nextVersion = (latest?.v ?? 0) + 1;
      // Unpublish the current published row FIRST (partial unique = one published per key).
      await tx.update(emailTemplates).set({ isPublished: false }).where(and(eq(emailTemplates.key, key), eq(emailTemplates.isPublished, true)));
      await tx.insert(emailTemplates).values({ key, version: nextVersion, subjectTemplate, bodyTemplate, isPublished: true });
      return nextVersion;
    });
    revalidatePath('/admin/email-templates');
    return { ok: true, version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Publish failed.' };
  }
}
