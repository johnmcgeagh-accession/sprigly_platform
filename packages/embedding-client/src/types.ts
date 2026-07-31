/**
 * Single source of truth for the embedding vector dimension.
 * Matches the `vector(1024)` column in migration 0022_question_answerer_knowledge.
 * Change this constant — and re-run the migration — if you switch to a different
 * embedding model with different output dimensions.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * An embedding, plus what the provider says it charged for.
 *
 * Titan returns `inputTextTokenCount` on every response and this codebase threw it away, which
 * is why a query embed could be logged only as "it happened" rather than as a cost. `modelId`
 * rides along because the caller doing the logging (retrieval) does not otherwise know which
 * model answered, and a cost row that cannot name its model cannot be priced.
 */
export interface EmbedUsage {
  embedding:   number[];
  inputTokens: number;
  modelId:     string;
}

export interface EmbeddingClient {
  /**
   * Embed a single string. Returns a float array of length `dimensions`.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Embed a single string AND report the provider's usage for it.
   *
   * Optional so that the fakes and stubs scattered through the test suites keep satisfying this
   * interface. A caller that needs to bill for the call should prefer this and fall back to
   * `embed` — and when it falls back it must log NOTHING, because the only honest alternative
   * to a real token count is no row at all, never an estimated one.
   */
  embedWithUsage?(text: string): Promise<EmbedUsage>;

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
