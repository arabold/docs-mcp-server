import type { AppConfig } from "../../../utils/config";
import { MimeTypeUtils } from "../../../utils/mimeTypeUtils";
import type { DocumentStore } from "../../DocumentStore";
import type { DbPageChunk } from "../../types";
import type { ContentAssemblyStrategy } from "../types";

/**
 * Assembly strategy that preserves the current behavior for markdown and text content.
 *
 * Uses broad context expansion (parents, siblings, children) and simple "\n\n" joining.
 * This strategy is optimized for prose content where broader context enhances understanding.
 */
export class MarkdownAssemblyStrategy implements ContentAssemblyStrategy {
  constructor(private config: AppConfig) {}

  /**
   * Determines if this strategy can handle the given content type.
   * Handles markdown, HTML, plain text, and serves as fallback for unknown types.
   */
  canHandle(mimeType?: string): boolean {
    // Handle undefined/unknown MIME types as fallback
    if (!mimeType) {
      return true;
    }

    // First, check if it's a structured type that should be handled by HierarchicalAssemblyStrategy
    if (MimeTypeUtils.isSourceCode(mimeType) || MimeTypeUtils.isJson(mimeType)) {
      return false;
    }

    // Handle markdown content
    if (MimeTypeUtils.isMarkdown(mimeType)) {
      return true;
    }

    // Handle HTML content
    if (MimeTypeUtils.isHtml(mimeType)) {
      return true;
    }

    // Handle plain text content
    if (MimeTypeUtils.isText(mimeType)) {
      return true;
    }

    // Accept as fallback for truly unknown types
    return true;
  }

  /**
   * Selects chunks using the current context expansion logic.
   * This replicates the existing behavior from DocumentRetrieverService.getRelatedChunkIds().
   */
  async selectChunks(
    library: string,
    version: string,
    initialChunks: DbPageChunk[],
    documentStore: DocumentStore,
  ): Promise<DbPageChunk[]> {
    const allChunkIds = new Set<string>();

    // Process all initial chunks in parallel to gather related chunk IDs
    const relatedIdsPromises = initialChunks.map((doc) =>
      this.getRelatedChunkIds(library, version, doc, documentStore),
    );

    const relatedIdsResults = await Promise.all(relatedIdsPromises);

    // Add all related IDs to the set (automatically deduplicates)
    for (const relatedIds of relatedIdsResults) {
      for (const id of relatedIds) {
        allChunkIds.add(id);
      }
    }

    // Fetch all chunks and return them in sort_order
    const chunkIds = Array.from(allChunkIds);
    const chunks = await documentStore.findChunksByIds(library, version, chunkIds);

    return chunks; // Already sorted by sort_order in findChunksByIds
  }

  /**
   * Assembles chunks using simple "\n\n" joining (current behavior).
   */
  assembleContent(chunks: DbPageChunk[]): string {
    return chunks.map((chunk) => chunk.content).join("\n\n");
  }

  /**
   * Collects related chunk IDs for a single chunk using current context expansion logic.
   * This is a direct port of the logic from DocumentRetrieverService.getRelatedChunkIds().
   */
  private async getRelatedChunkIds(
    library: string,
    version: string,
    doc: DbPageChunk,
    documentStore: DocumentStore,
  ): Promise<Set<string>> {
    const id = doc.id;
    const relatedIds = new Set<string>();
    const { childLimit, precedingSiblingsLimit, subsequentSiblingsLimit } =
      this.config.assembly;

    // Add the original chunk
    relatedIds.add(id);

    // Parent
    const parent = await documentStore.findParentChunk(library, version, id);
    if (parent) {
      relatedIds.add(parent.id);
    }

    // Preceding Siblings
    const precedingSiblings = await documentStore.findPrecedingSiblingChunks(
      library,
      version,
      id,
      precedingSiblingsLimit,
    );
    for (const sib of precedingSiblings) {
      relatedIds.add(sib.id);
    }

    // Child Chunks
    const childChunks = await documentStore.findChildChunks(
      library,
      version,
      id,
      childLimit,
    );
    for (const child of childChunks) {
      relatedIds.add(child.id);
    }

    // Subsequent Siblings
    const subsequentSiblings = await documentStore.findSubsequentSiblingChunks(
      library,
      version,
      id,
      subsequentSiblingsLimit,
    );
    for (const sib of subsequentSiblings) {
      relatedIds.add(sib.id);
    }

    return relatedIds;
  }
}
