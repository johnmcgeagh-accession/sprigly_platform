'use server';

import { db, routingRules } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createRoutingRule(formData: FormData): Promise<void> {
  const clientId = formData.get('clientId') as string;
  const source = formData.get('source') as string;
  const workflowId = formData.get('workflowId') as string;
  const matchAll = formData.get('matchAll');
  const matchConditionsJson = formData.get('matchConditionsJson') as string;
  const destinationsJson = formData.get('destinationsJson') as string;
  const priority = formData.get('priority') as string;
  const enabled = formData.get('enabled');
  const isFallback = formData.get('isFallback');

  let matchConditions: Array<Record<string, unknown>>;
  let destinations: Array<Record<string, unknown>>;

  if (matchAll === 'on') {
    matchConditions = [];
  } else {
    try {
      matchConditions = JSON.parse(matchConditionsJson) as Array<Record<string, unknown>>;
    } catch {
      throw new Error('Invalid JSON in match conditions');
    }
  }

  try {
    destinations = JSON.parse(destinationsJson) as Array<Record<string, unknown>>;
  } catch {
    throw new Error('Invalid JSON in destinations');
  }

  await db.insert(routingRules).values({
    clientId,
    source,
    workflowId,
    matchConditions,
    destinations,
    priority: Number(priority) || 0,
    enabled: enabled === 'on',
    isFallback: isFallback === 'on',
    clientConfigId: null,
  });

  revalidatePath('/admin/routing-rules');
  redirect('/admin/routing-rules');
}

export async function toggleEnabled(formData: FormData): Promise<void> {
  const id = formData.get('id') as string;
  const enabled = formData.get('enabled') as string;

  await db
    .update(routingRules)
    .set({ enabled: enabled === 'true' })
    .where(eq(routingRules.id, id));

  revalidatePath('/admin/routing-rules');
  revalidatePath(`/admin/routing-rules/${id}`);
}

export async function deleteRoutingRule(formData: FormData): Promise<void> {
  const id = formData.get('id') as string;

  await db.delete(routingRules).where(eq(routingRules.id, id));

  revalidatePath('/admin/routing-rules');
  redirect('/admin/routing-rules');
}
