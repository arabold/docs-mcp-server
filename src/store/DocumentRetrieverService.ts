import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { createContentAssemblyStrategy } from "./assembly/ContentAssemblyStrategyFactory";
import {
  getRerankerFallbackCategory,
  type RerankerFallbackCategory,
} from "./CircuitBreakingReranker";
import type { DocumentStore } from "./DocumentStore";
import type { Reranker } from "./Reranker";
import type { DbChunkRank, DbPageChunk, StoreSearchResult } from "./types";

type RankedCandidate = DbPageChunk & DbChunkRank & { baselineIndex?: number };

interface RerankerOperation {
  candidateCount: number;
  elapsedTimeMs: number;
  fallbackCategory: RerankerFallbackCategory | "none";
  outcome: "fallback" | "success";
  usageTokens: number | null;
}

export class DocumentRetrieverService {
  private documentStore: DocumentStore;
  private config: AppConfig;
  private reranker?: Reranker;

  constructor(documentStore: DocumentStore, config: AppConfig, reranker?: Reranker) {
    this.documentStore = documentStore;
    this.config = config;
    this.reranker = reranker;
  }

  /**
   * Searches for documents and expands the context around the matches using content-type-aware strategies.
   * @param library The library name.
   * @param version The library version.
   * @param query The search query.
   * @param limit The optional limit for the initial search results.
   * @returns An array of search results with content assembled according to content type.
   */
  async search(
    library: string,
    version: string | null | undefined,
    query: string,
    limit?: number,
  ): Promise<StoreSearchResult[]> {
    // Normalize version: null/undefined becomes empty string, then lowercase
    const normalizedVersion = (version ?? "").toLowerCase();

    const userLimit = limit ?? 10;
    const activeReranker = this.config.search.reranker.enabled && this.reranker;
    const retrievalLimit = activeReranker
      ? Math.max(userLimit, this.config.search.reranker.candidateLimit)
      : userLimit;
    const initialResults = await this.documentStore.findByContent(
      library,
      normalizedVersion,
      query,
      retrievalLimit,
    );

    if (initialResults.length === 0) {
      return [];
    }

    let rankedCandidates: RankedCandidate[] = initialResults;
    let rerankerOperation: RerankerOperation | undefined;
    if (activeReranker) {
      const rerankerStartedAt = Date.now();
      try {
        const rerankResult = await activeReranker.rerank(
          query,
          initialResults.map((candidate, index) => ({
            index,
            content: candidate.content,
            sourceUrl: candidate.url,
          })),
        );
        rankedCandidates = rerankResult.scores
          .map(({ index, score }) => ({
            ...initialResults[index],
            score,
            baselineIndex: index,
          }))
          .sort(
            (first, second) =>
              second.score - first.score || first.baselineIndex - second.baselineIndex,
          )
          .slice(0, userLimit);
        rerankerOperation = {
          candidateCount: initialResults.length,
          elapsedTimeMs: Date.now() - rerankerStartedAt,
          fallbackCategory: "none",
          outcome: "success",
          usageTokens: rerankResult.usageTokens ?? null,
        };
      } catch (error) {
        const baselineResults =
          retrievalLimit === userLimit
            ? initialResults
            : await this.documentStore.findByContent(
                library,
                normalizedVersion,
                query,
                userLimit,
              );
        rankedCandidates = baselineResults.slice(0, userLimit);
        rerankerOperation = {
          candidateCount: initialResults.length,
          elapsedTimeMs: Date.now() - rerankerStartedAt,
          fallbackCategory: getRerankerFallbackCategory(error),
          outcome: "fallback",
          usageTokens: null,
        };
      }
    }

    // Group initial results by URL
    const resultsByUrl = this.groupResultsByUrl(rankedCandidates);

    // Process each URL group with appropriate strategy
    const results: { result: StoreSearchResult; baselineIndex: number }[] = [];
    for (const [url, urlResults] of resultsByUrl.entries()) {
      // Cluster chunks based on distance
      const clusters = this.clusterChunksByDistance(urlResults);

      // Process each cluster as a separate result
      for (const cluster of clusters) {
        const result = await this.processUrlGroup(
          library,
          normalizedVersion,
          url,
          cluster,
        );
        const explicitBaselineIndex = cluster.reduce<number | undefined>(
          (bestIndex, candidate) =>
            candidate.baselineIndex !== undefined &&
            (bestIndex === undefined || candidate.baselineIndex < bestIndex)
              ? candidate.baselineIndex
              : bestIndex,
          undefined,
        );
        results.push({
          result,
          baselineIndex: explicitBaselineIndex ?? results.length,
        });
      }
    }

    // Sort all results by score descending
    // This ensures that if a highly relevant chunk was split from a less relevant one,
    // the highly relevant one appears first in the final list.
    const assembledResults = results
      .sort(
        (first, second) =>
          (second.result.score ?? 0) - (first.result.score ?? 0) ||
          first.baselineIndex - second.baselineIndex,
      )
      .map(({ result }) => result);

    if (rerankerOperation) {
      this.logRerankerOperation(rerankerOperation, assembledResults.length);
    }

    return assembledResults;
  }

  private logRerankerOperation(
    operation: RerankerOperation,
    returnedCount: number,
  ): void {
    const safeMetadata = JSON.stringify({
      provider: this.config.search.reranker.provider,
      model: this.config.search.reranker.model,
      candidateCount: operation.candidateCount,
      elapsedTimeMs: operation.elapsedTimeMs,
      outcome: operation.outcome,
      returnedCount,
      usageTokens: operation.usageTokens,
      fallbackCategory: operation.fallbackCategory,
    });
    if (operation.outcome === "success") {
      logger.debug(`Reranker operation ${safeMetadata}`);
      return;
    }
    logger.warn(`⚠️  Reranker fallback ${safeMetadata}`);
  }

  /**
   * Groups search results by URL.
   */
  private groupResultsByUrl(results: RankedCandidate[]): Map<string, RankedCandidate[]> {
    const resultsByUrl = new Map<string, RankedCandidate[]>();

    for (const result of results) {
      const url = result.url;
      if (!resultsByUrl.has(url)) {
        resultsByUrl.set(url, []);
      }
      const urlResults = resultsByUrl.get(url);
      if (urlResults) {
        urlResults.push(result);
      }
    }

    return resultsByUrl;
  }

  /**
   * Processes a group of search results from the same URL using appropriate strategy.
   */
  private async processUrlGroup(
    library: string,
    version: string,
    url: string,
    initialChunks: RankedCandidate[],
  ): Promise<StoreSearchResult> {
    // Extract processed and source MIME types from page-level fields.
    // Convert null to undefined for consistency.
    const mimeType =
      initialChunks.length > 0 ? (initialChunks[0].content_type ?? undefined) : undefined;
    const sourceMimeType =
      initialChunks.length > 0
        ? (initialChunks[0].source_content_type ?? undefined)
        : undefined;

    // Find the maximum score from the initial results
    const maxScore = Math.max(...initialChunks.map((chunk) => chunk.score));

    // Create appropriate assembly strategy based on content type
    const strategy = createContentAssemblyStrategy(mimeType, this.config);

    // Use strategy to select and assemble chunks
    const selectedChunks = await strategy.selectChunks(
      library,
      version,
      initialChunks,
      this.documentStore,
    );

    const content = strategy.assembleContent(selectedChunks);

    return {
      url,
      content,
      score: maxScore,
      mimeType,
      sourceMimeType,
    };
  }

  /**
   * Clusters chunks based on their sort_order distance.
   * Chunks within maxChunkDistance of each other are grouped together.
   *
   * @param chunks The list of chunks to cluster (must be from the same URL).
   * @returns An array of chunk clusters, where each cluster is an array of chunks.
   */
  private clusterChunksByDistance(chunks: RankedCandidate[]): RankedCandidate[][] {
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return [chunks];

    // Sort chunks by sort_order, then by id for deterministic stability
    const sortedChunks = [...chunks].sort((a, b) => {
      const diff = a.sort_order - b.sort_order;
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const clusters: RankedCandidate[][] = [];
    let currentCluster: RankedCandidate[] = [sortedChunks[0]];
    // Ensure maxChunkDistance is non-negative
    const maxChunkDistance = Math.max(0, this.config.assembly.maxChunkDistance);

    for (let i = 1; i < sortedChunks.length; i++) {
      const currentChunk = sortedChunks[i];
      const previousChunk = sortedChunks[i - 1];

      // Check distance between current and previous chunk
      const distance = currentChunk.sort_order - previousChunk.sort_order;

      if (distance <= maxChunkDistance) {
        // Close enough - add to current cluster
        currentCluster.push(currentChunk);
      } else {
        // Too far - start new cluster
        clusters.push(currentCluster);
        currentCluster = [currentChunk];
      }
    }

    // Add the last cluster
    clusters.push(currentCluster);

    return clusters;
  }
}
