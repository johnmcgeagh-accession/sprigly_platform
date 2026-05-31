'use server';

import { db, promptTemplates, clientConfigs, workflowRuns } from '@sprigly/db';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { ingestSource } from '@sprigly/knowledge';

export async function updateStepModel(formData: FormData): Promise<void> {
  const clientId = formData.get('clientId') as string;
  const workflowId = formData.get('workflowId') as string;
  const stepName = formData.get('stepName') as string;
  const model = formData.get('model') as string;

  const rows = await db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, clientId))
    .limit(1);

  const current = rows[0]?.settings ?? {};
  const stepModels = (current['stepModels'] ?? {}) as Record<string, Record<string, string>>;
  stepModels[workflowId] = { ...(stepModels[workflowId] ?? {}), [stepName]: model };

  await db
    .update(clientConfigs)
    .set({ settings: { ...current, stepModels } })
    .where(eq(clientConfigs.clientId, clientId));

  revalidatePath(`/admin/clients/${clientId}`);
}

export async function approveQaDraft(formData: FormData): Promise<void> {
  const runId    = formData.get('runId') as string;
  const finalText = formData.get('finalText') as string;

  if (!runId || !finalText.trim()) return;

  const rows = await db
    .select({ clientId: workflowRuns.clientId, output: workflowRuns.output })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);

  const run = rows[0];
  if (run === undefined) return;

  const output = run.output as { feedbackIngestedAt?: string; draftText?: string } | null;

  // Idempotency guard — whichever path (send-detection or admin) fires first wins.
  if (output?.feedbackIngestedAt !== undefined) return;

  if (typeof output?.draftText === 'string' && output.draftText !== finalText) {
    console.log(
      `[qa-feedback] admin approve run=${runId} ` +
      `original=${output.draftText.length}chars final=${finalText.length}chars`,
    );
  }

  const model          = createModelClientFromEnv();
  const embeddingClient = createEmbeddingClientFromEnv();

  await ingestSource(
    run.clientId,
    { sourceType: 'approved_draft', text: finalText, ref: runId },
    { db, model, embeddingClient, labelModel: 'haiku' },
  );

  await db
    .update(workflowRuns)
    .set({
      output: sql`COALESCE(${workflowRuns.output}, '{}'::jsonb) || ${JSON.stringify({ feedbackIngestedAt: new Date().toISOString() })}::jsonb`,
    })
    .where(eq(workflowRuns.id, runId));

  revalidatePath(`/admin/clients/${run.clientId}`);
}

export async function customisePrompt(formData: FormData): Promise<void> {
  const clientId = formData.get('clientId') as string;
  const workflowId = formData.get('workflowId') as string;
  const stepName = formData.get('stepName') as string;

  // Find the shared default to copy text from
  const sharedRows = await db
    .select({ id: promptTemplates.id, version: promptTemplates.version, promptText: promptTemplates.promptText })
    .from(promptTemplates)
    .where(
      and(
        isNull(promptTemplates.clientId),
        eq(promptTemplates.workflowId, workflowId),
        eq(promptTemplates.stepName, stepName),
      ),
    )
    .orderBy(desc(promptTemplates.version))
    .limit(1);

  const sharedDefault = sharedRows[0];
  const promptText = sharedDefault?.promptText ?? '';

  // Check no client-specific row already exists
  const existingRows = await db
    .select({ id: promptTemplates.id })
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.clientId, clientId),
        eq(promptTemplates.workflowId, workflowId),
        eq(promptTemplates.stepName, stepName),
      ),
    )
    .limit(1);

  if (existingRows[0] !== undefined) {
    redirect(`/admin/prompts/${existingRows[0].id}`);
  }

  const [newRow] = await db
    .insert(promptTemplates)
    .values({
      clientId,
      workflowId,
      stepName,
      promptText,
      version: 1,
      copiedFromTemplateId: sharedDefault?.id ?? null,
      copiedFromVersion: sharedDefault?.version ?? null,
    })
    .returning({ id: promptTemplates.id });

  revalidatePath(`/admin/clients/${clientId}`);

  if (newRow) {
    redirect(`/admin/prompts/${newRow.id}`);
  }
}
