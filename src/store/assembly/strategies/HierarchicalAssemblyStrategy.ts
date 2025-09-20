import type { Document } from "@langchain/core/documents";
import { logger } from "../../../utils/logger";
import { MimeTypeUtils } from "../../../utils/mimeTypeUtils";
import type { DocumentStore } from "../../DocumentStore";
import type { ContentAssemblyStrategy } from "../types";

/**
 * Assembly strategy for structured content (source code, JSON, config files).
 *
 * Uses selective subtree reassembly: for single matches, walks up the complete parent
 * hierarchy to the root. For multiple matches within the same document, finds the common
 * ancestor and reconstructs only the relevant subtrees, avoiding inclusion of excessive
 * unrelated content. Simple concatenation leverages splitter concatenation guarantees.
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
   * Selects chunks using selective subtree reassembly for multiple matches within documents.
   * For single matches: uses existing parent chain logic.
   * For multiple matches in same document: finds common ancestor and reconstructs minimal subtree.
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
      // Group chunks by document URL
      const chunksByDocument = new Map<string, Document[]>();
      for (const chunk of initialChunks) {
        const url = chunk.metadata.url as string;
        if (!chunksByDocument.has(url)) {
          chunksByDocument.set(url, []);
        }
        chunksByDocument.get(url)?.push(chunk);
      }

      const allChunkIds = new Set<string>();

      // Process each document group
      for (const [_url, documentChunks] of Array.from(chunksByDocument.entries())) {
        if (documentChunks.length === 1) {
          // Single match: reconstruct complete structural subtree containing the match
          const matched = documentChunks[0];

          // Find nearest structural ancestor (class / interface / enum / namespace, etc.)
          const structuralAncestor =
            (await this.findStructuralAncestor(
              library,
              version,
              matched,
              documentStore,
            )) ?? matched;

          // If no structural ancestor was found (e.g. we matched a deeply nested anonymous or inner function),
          // attempt to promote to the top-level container represented by the first path element.
          // Example: path ['applyMigrations','overallTransaction','overallTransaction','<anonymous_arrow>']
          // We want to reconstruct the whole top-level function 'applyMigrations', not just the arrow body.
          let promotedAncestor = structuralAncestor;
          try {
            const path = (matched.metadata.path as string[]) || [];
            if (promotedAncestor === matched && path.length > 0) {
              const topLevelPath = [path[0]];
              const containerIds = await this.findContainerChunks(
                library,
                version,
                matched,
                topLevelPath,
                documentStore,
              );
              if (containerIds.length > 0) {
                const topChunks = await documentStore.findChunksByIds(library, version, [
                  containerIds[0],
                ]);
                if (topChunks.length > 0) {
                  promotedAncestor = topChunks[0];
                }
              }
            }
          } catch (e) {
            logger.warn(
              `Top-level function promotion failed for chunk ${matched.id}: ${e}`,
            );
          }

          // IMPORTANT: Always include the original matched chunk first
          allChunkIds.add(matched.id as string);

          // Use promoted ancestor (may still be the original matched chunk if promotion not applicable)
          const ancestorParentChain = await this.walkToRoot(
            library,
            version,
            promotedAncestor,
            documentStore,
          );
          for (const id of ancestorParentChain) {
            allChunkIds.add(id);
          }

          // Add full subtree of the structural ancestor (ensures full class / container reconstruction)
          const subtreeIds = await this.findSubtreeChunks(
            library,
            version,
            promotedAncestor,
            documentStore,
          );
          for (const id of subtreeIds) {
            allChunkIds.add(id);
          }
        } else {
          // Multiple matches: use selective subtree reassembly
          // IMPORTANT: Always include all original matched chunks first
          for (const matched of documentChunks) {
            allChunkIds.add(matched.id as string);
          }

          const subtreeIds = await this.selectSubtreeChunks(
            library,
            version,
            documentChunks,
            documentStore,
          );
          for (const id of subtreeIds) {
            allChunkIds.add(id);
          }
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
  assembleContent(chunks: Document[], debug = false): string {
    if (debug) {
      return chunks
        .map(
          (chunk) =>
            `=== #${chunk.id} ${chunk.metadata.path?.join("/")} [${chunk.metadata.level}] ===\n` +
            chunk.pageContent,
        )
        .join("");
    }
    // Production/default: simple concatenation leveraging splitter guarantees.
    return chunks.map((chunk) => chunk.pageContent).join("");
  }

  /**
   * Walks up the parent hierarchy from a chunk to collect the complete parent chain.
   * Includes the chunk itself and every parent until reaching the root.
   * Protected against circular references and infinite loops.
   *
   * Handles hierarchical gaps by attempting to find ancestors at progressively shorter
   * path lengths when direct parent lookup fails (e.g., when intermediate chunks
   * have been merged or are missing).
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
        // Try normal parent lookup first
        const parentChunk = await documentStore.findParentChunk(
          library,
          version,
          currentId,
        );

        if (parentChunk) {
          currentChunk = parentChunk;
        } else {
          // If normal parent lookup fails, try to find ancestors with gaps
          currentChunk = await this.findAncestorWithGaps(
            library,
            version,
            currentChunk.metadata as any,
            documentStore,
          );
        }
      } catch (error) {
        // If standard lookup fails, try gap-aware ancestor search
        try {
          const currentMetadata = currentChunk?.metadata as any;
          if (currentMetadata) {
            currentChunk = await this.findAncestorWithGaps(
              library,
              version,
              currentMetadata,
              documentStore,
            );
          } else {
            currentChunk = null;
          }
        } catch (gapError) {
          logger.warn(
            `Parent lookup failed for chunk ${currentId}: ${error}. Gap search also failed: ${gapError}`,
          );
          break;
        }
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
   * Attempts to find ancestors when there are gaps in the hierarchy.
   * Tries progressively shorter path prefixes to find existing ancestor chunks.
   */
  private async findAncestorWithGaps(
    library: string,
    version: string,
    metadata: { url: string; path?: string[] },
    documentStore: DocumentStore,
  ): Promise<Document | null> {
    const path = metadata.path || [];
    const url = metadata.url;

    if (path.length <= 1) {
      return null; // Already at or near root
    }

    // Try progressively shorter path prefixes to find existing ancestors
    // Start from immediate parent and work backwards to root
    for (let pathLength = path.length - 1; pathLength > 0; pathLength--) {
      const ancestorPath = path.slice(0, pathLength);

      try {
        // Search for chunks that have this exact path in the same document
        const potentialAncestors = await this.findChunksByPathPrefix(
          library,
          version,
          url,
          ancestorPath,
          documentStore,
        );

        if (potentialAncestors.length > 0) {
          // Return the first matching ancestor found
          return potentialAncestors[0];
        }
      } catch (error) {
        logger.debug(
          `Failed to find ancestor with path ${ancestorPath.join("/")}: ${error}`,
        );
        // Continue trying shorter paths
      }
    }

    return null; // No ancestors found
  }

  /**
   * Finds chunks that have an exact path match or are prefixes of the given path.
   * This is a more flexible version of findChunksByPath that can handle gaps.
   */
  private async findChunksByPathPrefix(
    library: string,
    version: string,
    url: string,
    targetPath: string[],
    documentStore: DocumentStore,
  ): Promise<Document[]> {
    try {
      // Get all chunks from the same document URL
      const allChunks = await documentStore.findChunksByUrl(library, version, url);

      if (allChunks.length === 0) {
        return [];
      }

      const matchingChunks = allChunks.filter((chunk) => {
        const chunkPath = (chunk.metadata.path as string[]) || [];
        const chunkUrl = chunk.metadata.url as string;

        // Must be in the same document
        if (chunkUrl !== url) return false;

        // Path must match exactly
        if (chunkPath.length !== targetPath.length) return false;

        // All path elements must match
        return chunkPath.every((part, index) => part === targetPath[index]);
      });

      return matchingChunks;
    } catch (error) {
      logger.warn(`Error in findChunksByPathPrefix: ${error}`);
      return [];
    }
  }

  /**
   * Finds the nearest structural ancestor (types includes "structural") for a chunk.
   * If none exists (e.g. the matched chunk itself is structural or at top), returns null.
   */
  private async findStructuralAncestor(
    library: string,
    version: string,
    chunk: Document,
    documentStore: DocumentStore,
  ): Promise<Document | null> {
    let current: Document | null = chunk;

    // If current is structural already, return it
    const isStructural = (c: Document | null) =>
      !!c && Array.isArray(c.metadata?.types) && c.metadata.types.includes("structural");

    if (isStructural(current)) {
      return current;
    }

    // Walk up until we find a structural ancestor
    while (true) {
      const parent = await documentStore.findParentChunk(
        library,
        version,
        current.id as string,
      );
      if (!parent) {
        return null;
      }
      if (isStructural(parent)) {
        return parent;
      }
      current = parent;
    }
  }

  /**
   * Selects chunks for selective subtree reassembly when multiple matches exist in the same document.
   * Finds the common ancestor and reconstructs only the relevant subtrees.
   */
  private async selectSubtreeChunks(
    library: string,
    version: string,
    documentChunks: Document[],
    documentStore: DocumentStore,
  ): Promise<string[]> {
    const chunkIds = new Set<string>();

    // Find common ancestor path
    const commonAncestorPath = this.findCommonAncestorPath(documentChunks);

    if (commonAncestorPath.length === 0) {
      // No common ancestor found, fall back to individual parent chains
      logger.warn(
        "No common ancestor found for multiple matches, using individual parent chains",
      );
      for (const chunk of documentChunks) {
        const parentChain = await this.walkToRoot(library, version, chunk, documentStore);
        for (const id of parentChain) {
          chunkIds.add(id);
        }
      }
      return Array.from(chunkIds);
    }

    // Find container chunks (opening/closing) for the common ancestor
    const containerIds = await this.findContainerChunks(
      library,
      version,
      documentChunks[0], // Use first chunk to get document URL
      commonAncestorPath,
      documentStore,
    );
    for (const id of containerIds) {
      chunkIds.add(id);
    }

    // For each matched chunk, include its full subtree
    for (const chunk of documentChunks) {
      const subtreeIds = await this.findSubtreeChunks(
        library,
        version,
        chunk,
        documentStore,
      );
      for (const id of subtreeIds) {
        chunkIds.add(id);
      }
    }

    return Array.from(chunkIds);
  }

  /**
   * Finds the common ancestor path from a list of chunks by finding the longest common prefix.
   */
  private findCommonAncestorPath(chunks: Document[]): string[] {
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return (chunks[0].metadata.path as string[]) ?? [];

    const paths = chunks.map((chunk) => (chunk.metadata.path as string[]) ?? []);

    if (paths.length === 0) return [];

    // Find the longest common prefix
    const minLength = Math.min(...paths.map((path) => path.length));
    const commonPrefix: string[] = [];

    for (let i = 0; i < minLength; i++) {
      const currentElement = paths[0][i];
      if (paths.every((path) => path[i] === currentElement)) {
        commonPrefix.push(currentElement);
      } else {
        break;
      }
    }

    return commonPrefix;
  }

  /**
   * Finds the container chunks (opening/closing) for a given ancestor path.
   */
  private async findContainerChunks(
    library: string,
    version: string,
    referenceChunk: Document,
    ancestorPath: string[],
    documentStore: DocumentStore,
  ): Promise<string[]> {
    const containerIds: string[] = [];

    // Try to find the opening chunk for this ancestor path
    try {
      // Query for chunks with the exact ancestor path
      const ancestorChunks = await this.findChunksByPath(
        library,
        version,
        referenceChunk.metadata.url as string,
        ancestorPath,
        documentStore,
      );

      for (const chunk of ancestorChunks) {
        containerIds.push(chunk.id as string);
      }
    } catch (error) {
      logger.warn(
        `Failed to find container chunks for path ${ancestorPath.join("/")}: ${error}`,
      );
    }

    return containerIds;
  }

  /**
   * Finds all chunks for a given path within a document.
   * Uses existing DocumentStore methods to locate chunks by path.
   */
  private async findChunksByPath(
    library: string,
    version: string,
    url: string,
    path: string[],
    documentStore: DocumentStore,
  ): Promise<Document[]> {
    const chunks: Document[] = [];

    try {
      // For root path, we need to find chunks with empty path or minimal path
      if (path.length === 0) {
        // This is tricky - we need to find root-level chunks
        // For now, we'll return empty and let the caller handle it
        logger.debug("Root path requested - no chunks found");
        return chunks;
      }

      // Try to find chunks that have this exact path
      // We'll use a different approach - search for chunks that could be at this path level
      // This is a simplified implementation that works with the existing DocumentStore methods

      // For container chunks, we typically want the "opening" chunk
      // We'll try to find a chunk that has this path as its direct path
      const allChunks = await documentStore.findByContent(library, version, "", 1000); // Get some chunks

      for (const chunk of allChunks) {
        const chunkPath = (chunk.metadata.path as string[]) ?? [];
        if (
          chunkPath.length === path.length &&
          chunkPath.every((part, index) => part === path[index]) &&
          chunk.metadata.url === url
        ) {
          chunks.push(chunk);
        }
      }

      logger.debug(`Found ${chunks.length} chunks for path: ${path.join("/")}`);
    } catch (error) {
      logger.warn(`Error finding chunks for path ${path.join("/")}: ${error}`);
    }

    return chunks;
  }

  /**
   * Finds all chunks in the subtree rooted at the given chunk.
   */
  private async findSubtreeChunks(
    library: string,
    version: string,
    rootChunk: Document,
    documentStore: DocumentStore,
  ): Promise<string[]> {
    const subtreeIds: string[] = [];
    const visited = new Set<string>();
    const queue: Document[] = [rootChunk];

    while (queue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: this is safe due to the while condition
      const currentChunk = queue.shift()!;
      const currentId = currentChunk.id as string;

      if (visited.has(currentId)) continue;
      visited.add(currentId);
      subtreeIds.push(currentId);

      // Add all children to the queue
      try {
        const children = await documentStore.findChildChunks(
          library,
          version,
          currentId,
          1000,
        ); // Large limit
        queue.push(...children);
      } catch (error) {
        logger.warn(`Failed to find children for chunk ${currentId}: ${error}`);
      }
    }

    return subtreeIds;
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
