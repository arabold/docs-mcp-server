import type { AppConfig } from "../utils/config";
import { createContentAssemblyStrategy } from "./assembly/ContentAssemblyStrategyFactory";
import type { DocumentStore } from "./DocumentStore";
import type { DbChunkRank, DbPageChunk, StoreSearchResult } from "./types";

export class DocumentRetrieverService {
  private documentStore: DocumentStore;
  private config: AppConfig;

  constructor(documentStore: DocumentStore, config: AppConfig) {
    this.documentStore = documentStore;
    this.config = config;
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

    const initialResults = await this.documentStore.findByContent(
      library,
      normalizedVersion,
      query,
      limit ?? 10,
    );

    if (initialResults.length === 0) {
      return [];
    }

    // Group initial results by URL
    const resultsByUrl = this.groupResultsByUrl(initialResults);

    // Process each URL group with appropriate strategy
    const results: StoreSearchResult[] = [];
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
        results.push(result);
      }
    }

    // Sort all results by score descending
    // This ensures that if a highly relevant chunk was split from a less relevant one,
    // the highly relevant one appears first in the final list.
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return results;
  }

  /**
   * Groups search results by URL.
   */
  private groupResultsByUrl(
    results: (DbPageChunk & DbChunkRank)[],
  ): Map<string, (DbPageChunk & DbChunkRank)[]> {
    const resultsByUrl = new Map<string, (DbPageChunk & DbChunkRank)[]>();

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
    initialChunks: (DbPageChunk & DbChunkRank)[],
  ): Promise<StoreSearchResult> {
    // Extract mimeType from the first document's content_type (page-level field)
    // Convert null to undefined for consistency
    const mimeType = initialChunks.length > 0 ? initialChunks[0].content_type : undefined;

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
    };
  }

  /**
   * Clusters chunks based on their sort_order distance.
   * Chunks within maxChunkDistance of each other are grouped together.
   */
  private clusterChunksByDistance(
    chunks: (DbPageChunk & DbChunkRank)[],
  ): (DbPageChunk & DbChunkRank)[][] {
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return [chunks];

    // Sort chunks by sort_order
    const sortedChunks = [...chunks].sort((a, b) => a.sort_order - b.sort_order);
    const clusters: (DbPageChunk & DbChunkRank)[][] = [];
    let currentCluster: (DbPageChunk & DbChunkRank)[] = [sortedChunks[0]];
    const { maxChunkDistance } = this.config.assembly;

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
