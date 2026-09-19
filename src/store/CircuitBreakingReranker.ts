import {
  isRerankerRuntimeFailureCategory,
  type RerankCandidate,
  type Reranker,
  type RerankerRuntimeFailureCategory,
  type RerankResult,
} from "./Reranker";

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 60_000;

export type RerankerFallbackCategory =
  | "circuit_open"
  | "probe_in_progress"
  | RerankerRuntimeFailureCategory;

interface CircuitBreakingRerankerOptions {
  now?: () => number;
}

/** A deterministic reranking failure containing no provider or request content. */
export class RerankerUnavailableError extends Error {
  /** Sanitized reason suitable for operational logs and metrics. */
  readonly category: RerankerFallbackCategory;

  constructor(category: RerankerFallbackCategory) {
    super(`Reranking unavailable: ${category}`);
    this.name = "RerankerUnavailableError";
    this.category = category;
  }
}

/** Maps any reranking failure to the fixed secret-safe fallback vocabulary. */
export function getRerankerFallbackCategory(error: unknown): RerankerFallbackCategory {
  if (error instanceof RerankerUnavailableError) {
    return error.category;
  }
  return "request_failed";
}

/** Protects one process-local Reranker with a fixed fail-open circuit policy. */
export class CircuitBreakingReranker implements Reranker {
  private consecutiveFailures = 0;
  private openUntil: number | undefined;
  private probeInFlight = false;
  private readonly now: () => number;

  constructor(
    private readonly reranker: Reranker,
    options: CircuitBreakingRerankerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Reranks candidates unless the provider circuit is paused or already probing.
   * @param query The exact Search Query.
   * @param candidates Search Candidates in Baseline Ranking order.
   * @returns The complete valid ranking returned by the wrapped Reranker.
   */
  async rerank(
    query: string,
    candidates: readonly RerankCandidate[],
  ): Promise<RerankResult> {
    const probing = this.beginRequest();

    try {
      const result = await this.reranker.rerank(query, candidates);
      this.consecutiveFailures = 0;
      this.openUntil = undefined;
      return result;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (probing || this.consecutiveFailures >= FAILURE_THRESHOLD) {
        this.openUntil = this.now() + OPEN_DURATION_MS;
      }
      throw new RerankerUnavailableError(toFallbackCategory(error));
    } finally {
      if (probing) {
        this.probeInFlight = false;
      }
    }
  }

  private beginRequest(): boolean {
    if (this.openUntil === undefined) {
      return false;
    }
    if (this.now() < this.openUntil) {
      throw new RerankerUnavailableError("circuit_open");
    }
    if (this.probeInFlight) {
      throw new RerankerUnavailableError("probe_in_progress");
    }
    this.probeInFlight = true;
    return true;
  }
}

function toFallbackCategory(error: unknown): RerankerFallbackCategory {
  if (hasFallbackCategory(error)) {
    return error.category;
  }
  return "request_failed";
}

function hasFallbackCategory(
  error: unknown,
): error is { category: RerankerFallbackCategory } {
  if (typeof error !== "object" || error === null || !("category" in error)) {
    return false;
  }
  return isRerankerRuntimeFailureCategory(error.category);
}
