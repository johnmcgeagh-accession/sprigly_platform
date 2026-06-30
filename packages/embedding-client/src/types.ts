/**
 * Single source of truth for the embedding vector dimension.
 * Matches the `vector(1024)` column in migration 0022_question_answerer_knowledge.
 * Change this constant — and re-run the migration — if you switch to a different
 * embedding model with different output dimensions.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingClient {
  /**
   * Embed a single string. Returns a float array of length `dimensions`.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple strings. Implementations must fan out with bounded
   * concurrency — do not serialise or hammer the API unbounded.
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * The output dimension of this client. Must equal EMBEDDING_DIMENSIONS.
   * Asserted at factory construction so a model/provider swap fails loudly.
   */
  readonly dimensions: number;
}
