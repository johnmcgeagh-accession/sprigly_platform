/**
 * agent/conversation.ts — conversation + message persistence.
 *
 * A conversation groups a client's messages with the agent's replies. Created on
 * the first message of a turn; reused across turns via a conversationId the client
 * echoes back. All access is scoped to the session's clientId — a forged
 * conversationId belonging to another client is never reused (a fresh one is made).
 */
import { and, eq } from 'drizzle-orm';
import { db, conversations, agentMessages } from '@sprigly/db';

/** Return an owned conversation id, creating one if none was passed or the passed
 *  one isn't this client's. `cycleId` seeds a new conversation's cycle binding. */
export async function ensureConversation(
  clientId: string,
  cycleId: string | null,
  conversationId?: string,
): Promise<string> {
  if (conversationId) {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.clientId, clientId)))
      .limit(1);
    if (row) return row.id;
  }
  const [created] = await db
    .insert(conversations)
    .values({ clientId, cycleId })
    .returning({ id: conversations.id });
  return created!.id;
}

export interface AppendMessageArgs {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'web' | 'voice';
  metadata?: Record<string, unknown>;
}

/** Append a message and bump the conversation's last_message_at. Returns the id. */
export async function appendMessage(args: AppendMessageArgs): Promise<string> {
  const [created] = await db
    .insert(agentMessages)
    .values({
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      source: args.source ?? 'web',
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    })
    .returning({ id: agentMessages.id });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, args.conversationId));
  return created!.id;
}
