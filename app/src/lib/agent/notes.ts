/**
 * agent/notes.ts — the notes lifecycle (plan_inputs, type 'note').
 *
 * Notes are inert until integrated. Lifecycle:
 *   active → integrated  (a proposal that consumed the note was approved+applied)
 *          → expired     (relevant_to passed without integration)
 *          → dismissed   (manual, from the notes panel)
 * add_note is a DIRECT write (capturing a note changes nothing to review). All
 * access is client-scoped.
 */
import { and, desc, eq, isNotNull, lt } from 'drizzle-orm';
import { db, planInputs } from '@sprigly/db';

export interface SaveNoteArgs {
  clientId: string;
  cycleId: string | null;
  content: string;
  source?: 'web' | 'voice';
  relevantFrom?: string | null;   // ISO date
  relevantTo?: string | null;     // ISO date
}

export async function saveNote(args: SaveNoteArgs): Promise<string> {
  const [row] = await db
    .insert(planInputs)
    .values({
      clientId: args.clientId,
      cycleId: args.cycleId,
      type: 'note',
      content: args.content,
      source: args.source ?? 'web',
      relevantFrom: args.relevantFrom ?? null,
      relevantTo: args.relevantTo ?? null,
      status: 'active',
    })
    .returning({ id: planInputs.id });
  return row!.id;
}

export interface NoteView {
  id: string;
  content: string;
  source: string;
  relevantFrom: string | null;
  relevantTo: string | null;
  createdAt: string;
}

/**
 * A note is relevant to a week when its window overlaps [weekStart, weekEnd].
 * Pure (ISO 'YYYY-MM-DD' compares lexically). A null bound is open-ended.
 * The weekly session's audit uses exactly this.
 */
export function isNoteInWindow(
  note: { relevantFrom: string | null; relevantTo: string | null },
  weekStart: string,
  weekEnd: string,
): boolean {
  const startsBeforeEnd = note.relevantFrom == null || note.relevantFrom <= weekEnd;
  const endsAfterStart = note.relevantTo == null || note.relevantTo >= weekStart;
  return startsBeforeEnd && endsAfterStart;
}

/** Lazily expire active notes whose relevance window has fully passed. Best-effort. */
export async function expireStaleNotes(clientId: string, today: string): Promise<void> {
  await db
    .update(planInputs)
    .set({ status: 'expired' })
    .where(and(
      eq(planInputs.clientId, clientId),
      eq(planInputs.type, 'note'),
      eq(planInputs.status, 'active'),
      isNotNull(planInputs.relevantTo),
      lt(planInputs.relevantTo, today),
    ));
}

/** Active notes for a client, newest first. Expires stale ones first. */
export async function listActiveNotes(clientId: string, today: string): Promise<NoteView[]> {
  await expireStaleNotes(clientId, today);
  const rows = await db
    .select({
      id: planInputs.id, content: planInputs.content, source: planInputs.source,
      relevantFrom: planInputs.relevantFrom, relevantTo: planInputs.relevantTo, createdAt: planInputs.createdAt,
    })
    .from(planInputs)
    .where(and(eq(planInputs.clientId, clientId), eq(planInputs.type, 'note'), eq(planInputs.status, 'active')))
    .orderBy(desc(planInputs.createdAt));
  return rows.map((r) => ({
    id: r.id, content: r.content, source: r.source,
    relevantFrom: r.relevantFrom, relevantTo: r.relevantTo, createdAt: r.createdAt.toISOString(),
  }));
}

/** Manually dismiss an active note. Idempotent — returns null if not active/owned. */
export async function dismissNote(clientId: string, id: string): Promise<NoteView | null> {
  const [row] = await db
    .update(planInputs)
    .set({ status: 'dismissed' })
    .where(and(eq(planInputs.id, id), eq(planInputs.clientId, clientId), eq(planInputs.status, 'active')))
    .returning({
      id: planInputs.id, content: planInputs.content, source: planInputs.source,
      relevantFrom: planInputs.relevantFrom, relevantTo: planInputs.relevantTo, createdAt: planInputs.createdAt,
    });
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

/** Mark a note integrated by an approved proposal (set from the approve path). */
export async function markNoteIntegrated(clientId: string, noteId: string, proposalId: string): Promise<void> {
  await db
    .update(planInputs)
    .set({ status: 'integrated', consumedByProposalId: proposalId })
    .where(and(eq(planInputs.id, noteId), eq(planInputs.clientId, clientId), eq(planInputs.type, 'note')));
}
