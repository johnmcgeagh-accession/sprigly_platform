'use server';

import { db, triageConfigs, clients } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { TriageCategory, ReplyExample } from '@sprigly/engine';

export interface TriageConfigPayload {
  digestCadence: string;
  categories: TriageCategory[];
  voiceSample: string;
  replyExamples: ReplyExample[];
  additionalInstructions: string;
  verifiedDomain: string;
}

export async function upsertTriageConfig(
  clientId: string,
  data: TriageConfigPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const existing = await db
      .select({ id: triageConfigs.id })
      .from(triageConfigs)
      .where(eq(triageConfigs.clientId, clientId))
      .limit(1);

    const triageValues = {
      categories:              data.categories as unknown as Array<Record<string, unknown>>,
      voiceSample:             data.voiceSample,
      replyExamples:           data.replyExamples as unknown as Array<Record<string, unknown>>,
      additionalInstructions:  data.additionalInstructions.trim() || null,
      digestCadence:           data.digestCadence,
      updatedAt:               new Date(),
    };

    if (existing[0] !== undefined) {
      await db
        .update(triageConfigs)
        .set(triageValues)
        .where(eq(triageConfigs.id, existing[0].id));
    } else {
      await db.insert(triageConfigs).values({ clientId, ...triageValues });
    }

    await db
      .update(clients)
      .set({
        verifiedDomain: data.verifiedDomain.trim().toLowerCase() || null,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId));

    revalidatePath(`/admin/triage-config/${clientId}`);
    revalidatePath('/admin/triage-config');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
