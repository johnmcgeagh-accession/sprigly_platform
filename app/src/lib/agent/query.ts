/**
 * agent/query.ts — the "query" intent answerer.
 *
 * Combines two grounded sources: the client's knowledge bank (pgvector retrieval,
 * k=6, cosine-similarity floor so a sparse bank doesn't feed noise) AND a
 * structured read of the current cycle (posts this week / next week, status
 * counts). Answers with Haiku. Empty knowledge is handled gracefully — the plan
 * state alone still answers "what's scheduled this week?".
 */
import type { ModelClient } from '@sprigly/model-client';
import type { EmbeddingClient } from '@sprigly/embedding-client';
import type { AuditLogger } from '@sprigly/audit';
import { retrieveChunks } from '@sprigly/knowledge';
import { AGENT_MODEL } from './model';
import { readCycleState } from './cycle-state';

/** Cosine-similarity floor for retrieved chunks (0..1). Drops weak matches. */
export const QUERY_MIN_SCORE = 0.5;
export const QUERY_K = 6;

export const QUERY_SYSTEM_PROMPT = `You are a clothing brand's content-plan assistant answering the client's question. Use ONLY the provided plan state and knowledge context. Rules:
- If the answer is in the context, answer directly and concisely (UK English).
- If the question is about the schedule, use the plan state.
- If the question needs brand knowledge that isn't in the context, say you don't have that on file rather than guessing.
- Never invent posts, dates, products, or policies. No preamble.
- DATES. The plan state opens with today's date and gives every post its ISO date ('YYYY-MM-DD'). A date is PAST only if its ISO date is EARLIER than today's; today itself and everything after it is not past. Never call a date past unless the plan state marked it '[past — read-only]'. Do NOT reason about month names — compare the ISO dates. If you are about to say a date has passed, check that comparison first.
- THE PLAN'S EXTENT IS THE CALENDAR WINDOW IT STATES, NOT ITS LAST POST. The plan state names the dates this plan covers. A month whose last post is the 28th still runs to the end of that month, and the dates after the last post are EMPTY, not outside the plan. Never say the plan "runs up to" the last scheduled post, and never tell the client a date inside the window is unavailable.`;

export interface AnswerQueryArgs {
  clientId: string;
  cycleId: string;
  question: string;
  today: Date;
}

export interface AnswerQueryDeps {
  model: ModelClient;
  embeddingClient: EmbeddingClient;
  /** The cost ledger. Optional: the fixtures call this with a fake model and no database.
   *  `clientId` rides in on `args`, so unlike the parser this needs no companion field. */
  audit?: AuditLogger;
}

export async function answerQuery(args: AnswerQueryArgs, deps: AnswerQueryDeps): Promise<string> {
  const cycleState = await readCycleState(args.clientId, args.cycleId, args.today);

  let knowledge = '(no matching knowledge on file)';
  try {
    const chunks = await retrieveChunks(
      { clientId: args.clientId, queryText: args.question, k: QUERY_K, minScore: QUERY_MIN_SCORE },
      // The embed is the THIRD billable call on a query turn; passing the auditor here is what
      // puts it on the ledger beside the parse and the answer.
      { embeddingClient: deps.embeddingClient, audit: deps.audit },
    );
    if (chunks.length) {
      knowledge = chunks.map((c, i) => `[${i + 1}]${c.summary ? ` ${c.summary}\n` : '\n'}${c.content}`).join('\n\n---\n\n');
    }
  } catch {
    // Retrieval failure (e.g. no embeddings configured) must not fail the answer —
    // fall back to plan state only.
    knowledge = '(knowledge lookup unavailable)';
  }

  const userMessage = `PLAN STATE:
${cycleState.summary}

KNOWLEDGE CONTEXT:
${knowledge}

QUESTION:
${args.question}`;

  const res = await deps.model.complete({
    model: AGENT_MODEL,
    system: QUERY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 600,
    temperature: 0,
  });

  // A "query" turn spends THREE times: the parse (upstream, in the turn loop), the Titan embed
  // inside retrieveChunks above, and this answer call. All three now reach the ledger.
  if (deps.audit) {
    try {
      await deps.audit.logModelCall({
        clientId: args.clientId,
        modelId: res.modelId, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        action: 'plan-agent:answer-query',
        metadata: {
          cycleId: args.cycleId,
          // Whether retrieval contributed. A query answered from plan state alone is a different
          // cost shape from one that pulled six chunks in, and the row should say which.
          knowledgeUsed: knowledge !== '(no matching knowledge on file)' && knowledge !== '(knowledge lookup unavailable)',
          ...(res.cacheReadTokens !== undefined ? { cacheReadTokens: res.cacheReadTokens } : {}),
          ...(res.cacheWriteTokens !== undefined ? { cacheWriteTokens: res.cacheWriteTokens } : {}),
        },
      });
    } catch { /* auditing must never change the answer */ }
  }

  return res.content.trim();
}
