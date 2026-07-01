'use server';

import { and, eq } from 'drizzle-orm';
import { db, clientPlanningConfig } from '@sprigly/db';
import { revalidatePath } from 'next/cache';
import { ingestSales } from '@/lib/ingest/ingest-sales';
import { ingestIgPosts } from '@/lib/ingest/ingest-ig';

export type InputActionResult = { ok: boolean; message: string };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_COMPETITORS = 5;  // mirrors competitor-gather.ts MAX_COMPETITORS (Apify-runway cap)

function ctx(formData: FormData): { clientId: string; channel: string; month: string } {
  return {
    clientId: String(formData.get('clientId') ?? ''),
    channel:  String(formData.get('channel')  ?? ''),
    month:    String(formData.get('month')    ?? '').trim(),
  };
}

// ── Sales upload → Drive + catalogue rebuild ────────────────────────────────────
export async function uploadSales(formData: FormData): Promise<InputActionResult> {
  const { clientId, channel, month } = ctx(formData);
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };
  if (!MONTH_RE.test(month)) return { ok: false, message: `Pick a data month (YYYY-MM). Got "${month}".` };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file to upload.' };

  try {
    const csv = Buffer.from(await file.arrayBuffer());
    const r = await ingestSales(clientId, channel, month, csv);
    if (r.ok) revalidatePath(`/admin/clients/${clientId}`);
    return { ok: r.ok, message: r.message };
  } catch (err) {
    console.error('[uploadSales]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Sales upload failed.' };
  }
}

// ── IG fallback upload → Drive ──────────────────────────────────────────────────
export async function uploadIgPosts(formData: FormData): Promise<InputActionResult> {
  const { clientId, channel, month } = ctx(formData);
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };
  if (!MONTH_RE.test(month)) return { ok: false, message: `Pick a data month (YYYY-MM). Got "${month}".` };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a JSON file to upload.' };

  let json: unknown;
  try { json = JSON.parse(Buffer.from(await file.arrayBuffer()).toString('utf-8')); }
  catch { return { ok: false, message: 'That file is not valid JSON.' }; }

  try {
    const r = await ingestIgPosts(clientId, channel, month, json);
    if (r.ok) revalidatePath(`/admin/clients/${clientId}`);
    return { ok: r.ok, message: r.message };
  } catch (err) {
    console.error('[uploadIgPosts]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'IG upload failed.' };
  }
}

// ── Competitor list management (client_planning_config.competitors) ─────────────
async function loadCompetitors(clientId: string, channel: string): Promise<string[]> {
  const [row] = await db
    .select({ competitors: clientPlanningConfig.competitors })
    .from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, clientId), eq(clientPlanningConfig.channel, channel)))
    .limit(1);
  return (row?.competitors ?? []) as string[];
}

async function saveCompetitors(clientId: string, channel: string, competitors: string[]): Promise<void> {
  await db.insert(clientPlanningConfig)
    .values({ clientId, channel, competitors })
    .onConflictDoUpdate({
      target: [clientPlanningConfig.clientId, clientPlanningConfig.channel],
      set: { competitors, updatedAt: new Date() },
    });
}

/** Normalise an IG handle to the bare form the scrape URL needs (no @, no trailing slash). */
function normHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '').toLowerCase();
}

export async function addCompetitor(formData: FormData): Promise<InputActionResult> {
  const { clientId, channel } = ctx(formData);
  const handle = normHandle(String(formData.get('handle') ?? ''));
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };
  if (!handle) return { ok: false, message: 'Enter an Instagram handle.' };

  const current = await loadCompetitors(clientId, channel);
  if (current.map(normHandle).includes(handle)) return { ok: false, message: `@${handle} is already in the list.` };
  if (current.length >= MAX_COMPETITORS) {
    return { ok: false, message: `Max ${MAX_COMPETITORS} competitors — remove one before adding @${handle}.` };
  }
  await saveCompetitors(clientId, channel, [...current, handle]);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: `Added @${handle}.` };
}

export async function removeCompetitor(formData: FormData): Promise<InputActionResult> {
  const { clientId, channel } = ctx(formData);
  const handle = normHandle(String(formData.get('handle') ?? ''));
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };

  const current = await loadCompetitors(clientId, channel);
  const next = current.filter((h) => normHandle(h) !== handle);
  await saveCompetitors(clientId, channel, next);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: `Removed @${handle}.` };
}
