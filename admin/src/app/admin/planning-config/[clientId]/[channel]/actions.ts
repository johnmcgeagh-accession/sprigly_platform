'use server';

import { db, clientPlanningConfig } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { Pillar, Cadence, RecurringSeries, PostingTimes } from '@sprigly/engine';

export interface PlanningConfigPayload {
  pillars: Pillar[];
  competitors: string[];
  cadence: Cadence;
  recurringSeries: RecurringSeries[];
  postingTimes: PostingTimes;
  categories: string[];
}

export async function upsertPlanningConfig(
  clientId: string,
  channel: string,
  data: PlanningConfigPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { cadence } = data;

  if (
    !Number.isFinite(cadence.postsPerMonthMin) ||
    !Number.isFinite(cadence.postsPerMonthMax) ||
    !Number.isFinite(cadence.minPerWeek) ||
    !Number.isFinite(cadence.maxPerWeek)
  ) {
    return { ok: false, error: 'All cadence fields must be numbers.' };
  }
  if (cadence.postsPerMonthMin < 0 || cadence.maxPerWeek < 0) {
    return { ok: false, error: 'Cadence values must be non-negative.' };
  }
  if (cadence.postsPerMonthMin > cadence.postsPerMonthMax) {
    return { ok: false, error: 'Posts/month min must be ≤ max.' };
  }
  if (cadence.minPerWeek > cadence.maxPerWeek) {
    return { ok: false, error: 'Min posts/week must be ≤ max posts/week.' };
  }

  try {
    const existing = await db
      .select({ id: clientPlanningConfig.id })
      .from(clientPlanningConfig)
      .where(
        and(
          eq(clientPlanningConfig.clientId, clientId),
          eq(clientPlanningConfig.channel, channel),
        ),
      )
      .limit(1);

    const row = {
      pillars:         data.pillars         as unknown as Array<Record<string, unknown>>,
      competitors:     data.competitors,
      cadence:         data.cadence         as unknown as Record<string, number>,
      recurringSeries: data.recurringSeries as unknown as Array<Record<string, unknown>>,
      postingTimes:    data.postingTimes    as unknown as Record<string, string>,
      categories:      data.categories,
      updatedAt:       new Date(),
    };

    if (existing[0] !== undefined) {
      await db
        .update(clientPlanningConfig)
        .set(row)
        .where(eq(clientPlanningConfig.id, existing[0].id));
    } else {
      await db.insert(clientPlanningConfig).values({ clientId, channel, ...row });
    }

    revalidatePath(`/admin/planning-config/${clientId}/${channel}`);
    revalidatePath('/admin/planning-config');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
