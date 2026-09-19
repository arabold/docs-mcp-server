/** Secret-safe runtime failure categories shared by all Reranker adapters. */
export const RERANKER_RUNTIME_FAILURE_CATEGORIES = [
  "invalid_response",
  "provider_error",
  "request_failed",
  "timeout",
] as const;

/** A normalized runtime failure category that contains no provider content. */
export type RerankerRuntimeFailureCategory =
  (typeof RERANKER_RUNTIME_FAILURE_CATEGORIES)[number];

/** Tests whether a value belongs to the fixed runtime failure vocabulary. */
export function isRerankerRuntimeFailureCategory(
  value: unknown,
): value is RerankerRuntimeFailureCategory {
  return RERANKER_RUNTIME_FAILURE_CATEGORIES.some((category) => category === value);
}

/** A Search Candidate identified by its stable Baseline Ranking index. */
export interface RerankCandidate {
  /** Zero-based position in the Baseline Ranking. */
  index: number;
  /** Raw Search Candidate content before Context Assembly. */
  content: string;
  /** Source URL used to correlate secret-safe evaluation evidence. */
  sourceUrl?: string;
}

/** A provider-neutral relevance score for one Search Candidate. */
export interface RerankScore {
  /** Stable index of the scored Search Candidate. */
  index: number;
  /** Relevance score assigned by the Reranker. */
  score: number;
}

/** Provider-neutral result of scoring a complete Search Candidate set. */
export interface RerankResult {
  /** Complete candidate-to-score mapping. */
  scores: RerankScore[];
  /** Provider-reported processed-token count, when available. */
  usageTokens?: number;
}

/** Reranks raw Search Candidates without exposing provider-specific details. */
export interface Reranker {
  /**
   * Scores Search Candidates for the exact user Search Query.
   * @param query The user's Search Query.
   * @param candidates Raw Search Candidates with stable Baseline Ranking indices.
   * @returns Provider-neutral candidate scores and optional usage metadata.
   */
  rerank(query: string, candidates: readonly RerankCandidate[]): Promise<RerankResult>;
}
