import type { Document } from "@langchain/core/documents";
import type { DocumentStore } from "./DocumentStore";
import type { StoreSearchResult } from "./types";

const CHILD_LIMIT = 5;
const SIBLING_LIMIT = 2;

export class DocumentRetrieverService {
  private documentStore: DocumentStore;

  constructor(documentStore: DocumentStore) {
    this.documentStore = documentStore;
  }

  /**
   * Collects all related chunk IDs for a given initial hit.
   * Returns an object with url, hitId, relatedIds (Set), and score.
   */
  private async getRelatedChunkIds(
    library: string,
    version: string,
    doc: Document,
    siblingLimit = SIBLING_LIMIT,
    childLimit = CHILD_LIMIT,
  ): Promise<{
    url: string;
    hitId: string;
    relatedIds: Set<string>;
    score: number;
  }> {
    const id = doc.id as string;
    const url = doc.metadata.url as string;
    const score = doc.metadata.score as number;
    const relatedIds = new Set<string>();
    relatedIds.add(id);

    // Parent
    const parent = await this.documentStore.findParentChunk(library, version, id);
    if (parent) {
      relatedIds.add(parent.id as string);
    }

    // Preceding Siblings
    const precedingSiblings = await this.documentStore.findPrecedingSiblingChunks(
      library,
      version,
      id,
      siblingLimit,
    );
    for (const sib of precedingSiblings) {
      relatedIds.add(sib.id as string);
    }

    // Child Chunks
    const childChunks = await this.documentStore.findChildChunks(
      library,
      version,
      id,
      childLimit,
    );
    for (const child of childChunks) {
      relatedIds.add(child.id as string);
    }

    // Subsequent Siblings
    const subsequentSiblings = await this.documentStore.findSubsequentSiblingChunks(
      library,
      version,
      id,
      siblingLimit,
    );
    for (const sib of subsequentSiblings) {
      relatedIds.add(sib.id as string);
    }

    return { url, hitId: id, relatedIds, score };
  }

  /**
   * Groups related chunk info by URL, deduplicates IDs, and finds max score per URL.
   */
  private groupAndPrepareFetch(
    relatedInfos: Array<{
      url: string;
      hitId: string;
      relatedIds: Set<string>;
      score: number;
    }>,
  ): Map<string, { uniqueChunkIds: Set<string>; maxScore: number }> {
    const urlMap = new Map<string, { uniqueChunkIds: Set<string>; maxScore: number }>();
    for (const info of relatedInfos) {
      let entry = urlMap.get(info.url);
      if (!entry) {
        entry = { uniqueChunkIds: new Set(), maxScore: info.score };
        urlMap.set(info.url, entry);
      }
      for (const id of info.relatedIds) {
        entry.uniqueChunkIds.add(id);
      }
      if (info.score > entry.maxScore) {
        entry.maxScore = info.score;
      }
    }
    return urlMap;
  }

  /**
   * Finalizes the merged result for a URL group by fetching, sorting, and joining content.
   */
  private async finalizeResult(
    library: string,
    version: string,
    url: string,
    uniqueChunkIds: Set<string>,
    maxScore: number,
  ): Promise<StoreSearchResult> {
    const ids = Array.from(uniqueChunkIds);
    const docs = await this.documentStore.findChunksByIds(library, version, ids);
    // Already sorted by sort_order in findChunksByIds
    const content = docs.map((d) => d.pageContent).join("\n\n");

    // Extract mimeType from the first document's metadata (all chunks from same URL should have same MIME type)
    const mimeType =
      docs.length > 0 ? (docs[0].metadata.mimeType as string | undefined) : undefined;

    // TODO: Apply code block merging here if/when implemented
    return {
      url,
      content,
      score: maxScore,
      mimeType,
    };
  }

  /**
   * Searches for documents and expands the context around the matches.
   * @param library The library name.
   * @param version The library version.
   * @param query The search query.
   * @param version The library version (optional, defaults to searching documents without a version).
   * @param query The search query.
   * @param limit The optional limit for the initial search results.
   * @returns An array of strings representing the aggregated content of the retrieved chunks.
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

    // Step 1: Expand context for each initial hit (collect related chunk IDs)
    const relatedInfos = await Promise.all(
      initialResults.map((doc) =>
        this.getRelatedChunkIds(library, normalizedVersion, doc),
      ),
    );

    // Step 2: Group by URL, deduplicate, and find max score
    const urlMap = this.groupAndPrepareFetch(relatedInfos);

    // Step 3: For each URL group, fetch, sort, and format the merged result
    const results: StoreSearchResult[] = [];
    for (const [url, { uniqueChunkIds, maxScore }] of urlMap.entries()) {
      const result = await this.finalizeResult(
        library,
        normalizedVersion,
        url,
        uniqueChunkIds,
        maxScore,
      );
      results.push(result);
    }

    return results;
  }
}
