/**
 * agent/notes.ts — add_note is a DIRECT write, not a proposal.
 *
 * Notes are inert by design: capturing one changes nothing about the plan, so
 * there's nothing to review. Review happens later, when a note is integrated. We
 * insert straight into plan_inputs (type 'note', status 'active') with an optional
 * relevance window.
 */
import { db, planInputs } from '@sprigly/db';

export interface SaveNoteArgs {
  clientId: string;
  cycleId: string | null;
  content: string;
  relevantFrom?: string | null;   // ISO date
  relevantTo?: string | null;     // ISO date
}

/** Insert a note into plan_inputs. Client-scoped; returns the new id. */
export async function saveNote(args: SaveNoteArgs): Promise<string> {
  const [row] = await db
    .insert(planInputs)
    .values({
      clientId: args.clientId,
      cycleId: args.cycleId,
      type: 'note',
      content: args.content,
      relevantFrom: args.relevantFrom ?? null,
      relevantTo: args.relevantTo ?? null,
      status: 'active',
    })
    .returning({ id: planInputs.id });
  return row!.id;
}
