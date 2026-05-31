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

// TODO: consider a minimum score floor if low-quality matches become a problem.

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
}

/** Minimal embed interface — structurally compatible with EmbeddingClient. */
interface Embedder {
  embed(text: string): Promise<number[]>;
}

interface RawRow {
  id: string;
  content: string;
  summary: string | null;
  topic_id: string | null;
  source_type: string;
  score: string | number;
}

export async function retrieveChunks(
  args: RetrieveArgs,
  deps: { embeddingClient: Embedder },
): Promise<RetrievedChunk[]> {
  const { clientId, queryText, topicId = null, k = 6 } = args;
  const { embeddingClient } = deps;

  const queryEmbedding = await embeddingClient.embed(queryText);
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

  return rows.map((row) => ({
    id:         row.id,
    content:    row.content,
    summary:    row.summary,
    topicId:    row.topic_id,
    sourceType: row.source_type as KnowledgeSourceType,
    score:      typeof row.score === 'number' ? row.score : parseFloat(row.score as string),
  }));
}
