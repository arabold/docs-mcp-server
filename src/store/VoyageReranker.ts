import type {
  RerankCandidate,
  Reranker,
  RerankerRuntimeFailureCategory,
  RerankResult,
  RerankScore,
} from "./Reranker";

const VOYAGE_RERANK_ENDPOINT = "https://api.voyageai.com/v1/rerank";

interface VoyageRerankerOptions {
  apiKey: string;
  model: string;
  requestTimeoutMs: number;
}

/** A sanitized Voyage adapter failure that excludes request and response content. */
export class VoyageRerankerError extends Error {
  /** Sanitized failure category without provider response details. */
  readonly category: RerankerRuntimeFailureCategory;

  constructor(reason: RerankerRuntimeFailureCategory) {
    super(`Voyage reranking failed: ${reason}`);
    this.name = "VoyageRerankerError";
    this.category = reason;
  }
}

/** Reranks Search Candidates through Voyage's official HTTP endpoint. */
export class VoyageReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly requestTimeoutMs: number;

  constructor(options: VoyageRerankerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  /**
   * Scores every Search Candidate for the exact Search Query.
   * @param query The exact user Search Query.
   * @param candidates Raw Search Candidates in Baseline Ranking order.
   * @returns A complete provider-neutral score mapping and optional usage count.
   */
  async rerank(
    query: string,
    candidates: readonly RerankCandidate[],
  ): Promise<RerankResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(VOYAGE_RERANK_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: candidates.map((candidate) => candidate.content),
          return_documents: false,
          truncation: false,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new VoyageRerankerError("provider_error");
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new VoyageRerankerError("invalid_response");
      }

      return mapVoyageResponse(payload, candidates);
    } catch (error) {
      if (error instanceof VoyageRerankerError) {
        throw error;
      }
      if (abortController.signal.aborted) {
        throw new VoyageRerankerError("timeout");
      }
      throw new VoyageRerankerError("request_failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function mapVoyageResponse(
  payload: unknown,
  candidates: readonly RerankCandidate[],
): RerankResult {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new VoyageRerankerError("invalid_response");
  }
  if (payload.data.length !== candidates.length) {
    throw new VoyageRerankerError("invalid_response");
  }

  const seenIndices = new Set<number>();
  const scores: RerankScore[] = [];
  for (const item of payload.data) {
    if (!isRecord(item)) {
      throw new VoyageRerankerError("invalid_response");
    }
    const providerIndex = item.index;
    const score = item.relevance_score;
    if (
      typeof providerIndex !== "number" ||
      !Number.isInteger(providerIndex) ||
      providerIndex < 0 ||
      providerIndex >= candidates.length ||
      seenIndices.has(providerIndex) ||
      typeof score !== "number" ||
      !Number.isFinite(score)
    ) {
      throw new VoyageRerankerError("invalid_response");
    }
    seenIndices.add(providerIndex);
    scores.push({ index: candidates[providerIndex].index, score });
  }

  const totalTokens =
    isRecord(payload.usage) &&
    typeof payload.usage.total_tokens === "number" &&
    Number.isInteger(payload.usage.total_tokens) &&
    payload.usage.total_tokens >= 0
      ? payload.usage.total_tokens
      : undefined;

  return {
    scores,
    ...(totalTokens === undefined ? {} : { usageTokens: totalTokens }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
