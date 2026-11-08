// ============================================================================
// Embedding failure on the agent path (plan AC 38).
// Hybrid retrieval wraps its work in safeGraphOperation, which turns any error
// into an empty result. The agent must not read that as "no articles": the
// server records the embedding failure, and the retrieval adapter throws this.
// ============================================================================

export class EmbeddingFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingFailure";
  }
}
