import { sql as pgClient, serializeVector } from '@sprigly/db';
import type { KnowledgeSourceType } from '@sprigly/db';

// serializeVector produces '[x,y,...]' — the PostgreSQL vector literal format.
// ::vector cast tells the planner this is a vector operand so the HNSW index
// on (embedding vector_cosine_ops) is eligible for the ANN scan.
//
// Multi-tenant post-filter problem: a plain ANN scan builds its candidate set
// before applying WHERE client_id = $x / status = 'active'. On a shared table
// a small tenant can exhaust the ef_search window and return < k rows even
// though more matches exist. pgvector ≥ 0.8 solves this with iterative_scan:
// the index keeps fetching candidates until k rows survive the filters.
// SET LOCAL scopes both GUCs to the transaction only — no global state leak.

export interface RetrievedChunk {
  id: string;
  content: string;
  summary: string | null;
  topicId: string | null;
  sourceType: KnowledgeSourceType;
  score: number;
}

export interface RetrieveArgs {
  clientId: string;
  queryText: string;
  topicId?: string | null;
  k?: number;
  /** Minimum cosine-similarity score (0..1) a chunk must clear to be returned.
   *  Omit to keep every top-k row (legacy behaviour); set e.g. 0.5 to drop
   *  weak matches so a sparse knowledge bank doesn't feed noise into a prompt. */
  minScore?: number;
}

/** Minimal embed interface — structurally compatible with EmbeddingClient. */
interface Embedder {
  embed(text: string): Promise<number[]>;
  /** Optional, and preferred when present: the same embed, carrying what the provider billed. */
  embedWithUsage?(text: string): Promise<{ embedding: number[]; inputTokens: number; modelId: string }>;
}

/**
 * Minimal cost-ledger interface — structurally compatible with @sprigly/audit's AuditLogger,
 * declared locally for the same reason `Embedder` is: this package should not grow a dependency
 * to describe a shape it only ever calls one method on. `packages/engine/src/types.ts` declares
 * the same interface the same way.
 */
interface CostLedger {
  logModelCall(params: {
    clientId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    action?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

interface RawRow {
  id: string;
  content: string;
  summary: string | null;
  topic_id: string | null;
  source_type: string;
  score: string | number;
}

/**
 * THE THIRD BILLABLE CALL ON A QUERY TURN.
 *
 * A client asking their plan a question spends three times: the parse, the answer, and this
 * embedding of the question. The first two reached the cost ledger; this one did not, because
 * nothing in this package accepted an auditor — so a query turn's cost was systematically
 * under-reported by exactly one call, every time.
 *
 * The auditor is optional and injected, the same shape the engine's classify/extract guards use:
 * supply `audit` and the call is billed, omit it and nothing changes. Retrieval is also called
 * from ingestion and CLI paths that have no client session to attribute a cost to, and those
 * should stay silent rather than write mis-attributed rows.
 *
 * Two conditions must BOTH hold before a row is written, and neither is negotiable: an auditor
 * was supplied, and the embedder actually reported its token count. A client without
 * `embedWithUsage` gets no row at all — the only honest alternative to a real count is silence,
 * never an estimate. Failing to write is never allowed to fail the retrieval.
 */
async function embedAndBill(
  embeddingClient: Embedder,
  queryText: string,
  clientId: string,
  audit: CostLedger | undefined,
): Promise<number[]> {
  if (!audit || !embeddingClient.embedWithUsage) {
    return embeddingClient.embed(queryText);
  }
  const usage = await embeddingClient.embedWithUsage(queryText);
  try {
    await audit.logModelCall({
      clientId,
      modelId:      usage.modelId,
      inputTokens:  usage.inputTokens,
      outputTokens: 0,              // an embedding returns a vector, not tokens
      action:       'plan-agent:query-embed',
      metadata:     { queryChars: queryText.length },
    });
  } catch { /* auditing must never change the answer */ }
  return usage.embedding;
}

export async function retrieveChunks(
  args: RetrieveArgs,
  deps: { embeddingClient: Embedder; audit?: CostLedger | undefined },
): Promise<RetrievedChunk[]> {
  const { clientId, queryText, topicId = null, k = 6, minScore } = args;
  const { embeddingClient } = deps;

  const queryEmbedding = await embedAndBill(embeddingClient, queryText, clientId, deps.audit);
  const vecStr = serializeVector(queryEmbedding);

  const rows = await pgClient.begin(async (trx) => {
    await trx`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`;
    await trx`SET LOCAL hnsw.ef_search = 100`;
    return trx<RawRow[]>`
      SELECT id, content, summary, topic_id, source_type,
             1 - (embedding <=> ${vecStr}::vector) AS score
        FROM knowledge_chunks
       WHERE client_id  = ${clientId}::uuid
         AND status     = 'active'
         AND (${topicId}::uuid IS NULL OR topic_id = ${topicId}::uuid)
       ORDER BY embedding <=> ${vecStr}::vector
       LIMIT ${k}
    `;
  });

  const chunks = rows.map((row) => ({
    id:         row.id,
    content:    row.content,
    summary:    row.summary,
    topicId:    row.topic_id,
    sourceType: row.source_type as KnowledgeSourceType,
    score:      typeof row.score === 'number' ? row.score : parseFloat(row.score as string),
  }));

  return minScore === undefined ? chunks : chunks.filter((c) => c.score >= minScore);
}
