'use server';

import { db, promptTemplates } from '@sprigly/db';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function saveNewVersion(formData: FormData): Promise<void> {
  const templateId = formData.get('templateId') as string;
  const promptText = formData.get('promptText') as string;

  const rows = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.id, templateId))
    .limit(1);

  const source = rows[0];
  if (!source) throw new Error(`Template not found: ${templateId}`);

  const clientCondition = source.clientId
    ? eq(promptTemplates.clientId, source.clientId)
    : isNull(promptTemplates.clientId);

  const result = await db
    .select({ maxVersion: sql<number>`cast(max(version) as int)` })
    .from(promptTemplates)
    .where(
      and(
        clientCondition,
        eq(promptTemplates.workflowId, source.workflowId),
        eq(promptTemplates.stepName, source.stepName),
      ),
    );

  const newVersion = (result[0]?.maxVersion ?? 0) + 1;

  const [inserted] = await db
    .insert(promptTemplates)
    .values({
      clientId: source.clientId,
      workflowId: source.workflowId,
      stepName: source.stepName,
      promptText,
      version: newVersion,
    })
    .returning({ id: promptTemplates.id });

  revalidatePath('/admin/prompts');
  redirect(`/admin/prompts/${inserted!.id}`);
}
