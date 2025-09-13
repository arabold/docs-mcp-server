import type { Document } from "@langchain/core/documents";
import { logger } from "../../../utils/logger";
import { MimeTypeUtils } from "../../../utils/mimeTypeUtils";
import type { DocumentStore } from "../../DocumentStore";
import type { ContentAssemblyStrategy } from "../types";

/**
 * Assembly strategy for structured content (source code, JSON, config files).
 *
 * Uses a conservative approach: for each matched chunk, walks up the complete parent
 * hierarchy to the root. This provides hierarchical context for LLMs without attempting
 * complex reconstruction. Simple concatenation leverages splitter concatenation guarantees.
 */
export class HierarchicalAssemblyStrategy implements ContentAssemblyStrategy {
  /**
   * Determines if this strategy can handle the given content type.
   * Handles structured content like source code, JSON, configuration files.
   */
  canHandle(contentType: string): boolean {
    // Source code content
    if (MimeTypeUtils.isSourceCode(contentType)) {
      return true;
    }

    // JSON content
    if (MimeTypeUtils.isJson(contentType)) {
      return true;
    }

    // Could add more structured content detection here if needed
    // (e.g., YAML, TOML, XML configuration files)

    return false;
  }
  /**
   * Selects chunks by including each match plus its complete parent hierarchy.
   * This provides hierarchical context without attempting complex reconstruction.
   */
  async selectChunks(
    library: string,
    version: string,
    initialChunks: Document[],
    documentStore: DocumentStore,
  ): Promise<Document[]> {
    if (initialChunks.length === 0) {
      return [];
    }

    try {
      const allChunkIds = new Set<string>();

      // For each matched chunk, collect itself + complete parent chain
      for (const chunk of initialChunks) {
        const parentChain = await this.walkToRoot(library, version, chunk, documentStore);
        for (const id of parentChain) {
          allChunkIds.add(id);
        }
      }

      // Fetch all chunks in proper sort order
      const chunkIds = Array.from(allChunkIds);
      const chunks = await documentStore.findChunksByIds(library, version, chunkIds);

      return chunks;
    } catch (error) {
      // Fallback to simpler selection if parent chain walking fails
      logger.warn(
        `Hierarchical parent chain walking failed, falling back to basic selection: ${error}`,
      );
      return this.fallbackSelection(library, version, initialChunks, documentStore);
    }
  }

  /**
   * Assembles chunks using simple concatenation.
   * Relies on splitter concatenation guarantees - chunks are designed to join seamlessly.
   */
  assembleContent(chunks: Document[]): string {
    return chunks.map((chunk) => chunk.pageContent).join("");
  }

  /**
   * Walks up the parent hierarchy from a chunk to collect the complete parent chain.
   * Includes the chunk itself and every parent until reaching the root.
   * Protected against circular references and infinite loops.
   */
  private async walkToRoot(
    library: string,
    version: string,
    chunk: Document,
    documentStore: DocumentStore,
  ): Promise<string[]> {
    const chainIds: string[] = [];
    const visited = new Set<string>();
    let currentChunk: Document | null = chunk;
    const maxDepth = 50; // Safety limit to prevent runaway loops
    let depth = 0;

    // Walk up parent chain until we reach the root
    while (currentChunk && depth < maxDepth) {
      const currentId = currentChunk.id as string;

      // Check for circular references
      if (visited.has(currentId)) {
        logger.warn(`Circular reference detected in parent chain for chunk ${currentId}`);
        break;
      }

      visited.add(currentId);
      chainIds.push(currentId);
      depth++;

      try {
        currentChunk = await documentStore.findParentChunk(library, version, currentId);
      } catch (error) {
        // If we can't find parent, stop the chain walk
        logger.warn(`Failed to find parent for chunk ${currentId}: ${error}`);
        break;
      }
    }

    if (depth >= maxDepth) {
      logger.warn(
        `Maximum parent chain depth (${maxDepth}) reached for chunk ${chunk.id}`,
      );
    }

    return chainIds;
  }

  /**
   * Fallback selection method when parent chain walking fails.
   * Uses a simplified approach similar to MarkdownAssemblyStrategy but more conservative.
   */
  private async fallbackSelection(
    library: string,
    version: string,
    initialChunks: Document[],
    documentStore: DocumentStore,
  ): Promise<Document[]> {
    const chunkIds = new Set<string>();

    // Just include the initial chunks and their immediate parents/children
    for (const chunk of initialChunks) {
      const id = chunk.id as string;
      chunkIds.add(id);

      // Add parent for context
      try {
        const parent = await documentStore.findParentChunk(library, version, id);
        if (parent) {
          chunkIds.add(parent.id as string);
        }
      } catch (error) {
        logger.warn(`Failed to find parent for chunk ${id}: ${error}`);
      }

      // Add direct children (limited)
      try {
        const children = await documentStore.findChildChunks(library, version, id, 3);
        for (const child of children) {
          chunkIds.add(child.id as string);
        }
      } catch (error) {
        logger.warn(`Failed to find children for chunk ${id}: ${error}`);
      }
    }

    const chunks = await documentStore.findChunksByIds(
      library,
      version,
      Array.from(chunkIds),
    );

    return chunks;
  }
}
