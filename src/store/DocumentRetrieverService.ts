import type { AppConfig } from "../utils/config";
import { MimeTypeUtils } from "../utils/mimeTypeUtils";
import { parseUrl, sectionQueryBase, sectionSlug } from "../utils/sections";
import { createContentAssemblyStrategy } from "./assembly/ContentAssemblyStrategyFactory";
import {
  addUsageContext,
  focusMarkdownPassage,
  requestedApiNames,
} from "./assembly/markdownPassage";
import type { DocumentStore } from "./DocumentStore";
import {
  type DbChunkRank,
  type DbPageChunk,
  normalizeVersionLabel,
  type StoreSearchResult,
} from "./types";

const USAGE_CHUNK_RADIUS = 8;

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
    const normalizedVersion = normalizeVersionLabel(version);

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
    const results: Array<StoreSearchResult & { priority: number }> = [];
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
          query,
        );
        results.push(result);
      }
    }

    // Sort all results by score descending
    // This ensures that if a highly relevant chunk was split from a less relevant one,
    // the highly relevant one appears first in the final list.
    results.sort(
      (a, b) => b.priority - a.priority || (b.score ?? 0) - (a.score ?? 0),
    );

    const seen = new Set<string>();
    return results.flatMap(({ priority: _priority, ...result }) => {
      const page = sectionQueryBase(result.url) ?? result.url;
      const key = JSON.stringify([page, result.content]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [result];
    });
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
    query: string,
  ): Promise<StoreSearchResult & { priority: number }> {
    const best = initialChunks.reduce((current, candidate) => {
      const difference =
        (candidate.documentationPriority ?? 0) - (current.documentationPriority ?? 0);
      return (difference || candidate.score - current.score) > 0 ? candidate : current;
    });
    const mimeType = best.content_type ?? undefined;
    const sourceMimeType = best.source_content_type ?? undefined;
    const contentUrl = best.content_url ?? undefined;

    // Create appropriate assembly strategy based on content type
    const strategy = createContentAssemblyStrategy(mimeType, this.config);

    // Use strategy to select and assemble chunks
    const selectedChunks = await strategy.selectChunks(
      library,
      version,
      initialChunks,
      this.documentStore,
    );

    const assembled = strategy.assembleContent(selectedChunks);
    const headingHint = best.metadata.path?.at(-1);
    const passage =
      mimeType && MimeTypeUtils.isMarkdown(mimeType)
        ? focusMarkdownPassage(
            assembled,
            query,
            this.config.splitter.maxChunkSize,
            headingHint,
          )
        : { content: assembled };
    const heading = passage.heading ?? headingHint;
    const sectionUrl = await this.findSectionUrl(
      library,
      version,
      url,
      heading,
      selectedChunks,
    );
    const content =
      mimeType && MimeTypeUtils.isMarkdown(mimeType)
        ? await this.withUsageContext(library, version, best, query, passage.content)
        : passage.content;

    return {
      url,
      contentUrl,
      sectionUrl,
      content,
      score: best.score,
      mimeType,
      sourceMimeType,
      priority: best.documentationPriority ?? 0,
    };
  }

  private async withUsageContext(
    library: string,
    version: string,
    best: DbPageChunk,
    query: string,
    passage: string,
  ): Promise<string> {
    const pathname = parseUrl(best.url)?.pathname ?? "";
    const pageName =
      pathname.split("/").filter(Boolean).at(-1)?.replace(/\.(?:html?|mdx?)$/i, "") ??
      "";
    const title = best.title?.split(/\s+(?:[|–—]|::)\s+/)[0] ?? "";
    const names = requestedApiNames(query, title, pageName);
    const cliPath = pathname.split("/reference/cli/")[1];
    const cliCommand = cliPath?.split("/").filter(Boolean).join(" ");
    const queryWords = ` ${query.toLowerCase().trim().replace(/[^\w-]+/g, " ")} `;
    const command =
      cliCommand && queryWords.includes(` ${cliCommand} `) ? cliCommand : undefined;
    if (!names.length && !command) return passage;

    const first = Math.max(0, best.sort_order - USAGE_CHUNK_RADIUS);
    const chunks = await this.documentStore.findChunksByUrl(library, version, best.url, {
      first,
      last: best.sort_order + USAGE_CHUNK_RADIUS,
    });
    const pageStart =
      first !== 0
        ? await this.documentStore.findChunksByUrl(library, version, best.url, {
            first: 0,
            last: 0,
          })
        : [];
    const nearby = [...pageStart, ...chunks].map((chunk) => chunk.content).join("\n\n");
    return addUsageContext(
      passage,
      nearby,
      query,
      { names, command },
      this.config.splitter.maxChunkSize,
    );
  }

  private async findSectionUrl(
    library: string,
    version: string,
    url: string,
    heading: string | undefined,
    chunks: DbPageChunk[],
  ): Promise<string | undefined> {
    const slug = sectionSlug(heading ?? "");
    if (slug) {
      const recorded = new Set(
        chunks
          .filter((chunk) => sectionSlug(chunk.metadata.path?.at(-1) ?? "") === slug)
          .map((chunk) => chunk.metadata.sectionTarget)
          .filter(Boolean),
      );
      if (recorded.size === 1) return [...recorded][0];
    }

    const base = sectionQueryBase(url);
    const parsed = parseUrl(base ?? url);
    if (!parsed || parsed.hash || parsed.search || !/^https?:$/.test(parsed.protocol)) {
      return undefined;
    }
    if (slug) {
      parsed.searchParams.set("id", slug);
      const candidates = await this.documentStore.findPageUrls(library, version, [
        parsed.href,
      ]);
      if (candidates.length > 0) return parsed.href;
    }
    if (!base) return undefined;
    const [page] = await this.documentStore.findPageUrls(library, version, [base]);
    return page;
  }

  /**
   * Clusters chunks based on their sort_order distance.
   * Chunks within maxChunkDistance of each other are grouped together.
   *
   * @param chunks The list of chunks to cluster (must be from the same URL).
   * @returns An array of chunk clusters, where each cluster is an array of chunks.
   */
  private clusterChunksByDistance(
    chunks: (DbPageChunk & DbChunkRank)[],
  ): (DbPageChunk & DbChunkRank)[][] {
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return [chunks];

    // Sort chunks by sort_order, then by id for deterministic stability
    const sortedChunks = [...chunks].sort((a, b) => {
      const diff = a.sort_order - b.sort_order;
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const clusters: (DbPageChunk & DbChunkRank)[][] = [];
    let currentCluster: (DbPageChunk & DbChunkRank)[] = [sortedChunks[0]];
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
