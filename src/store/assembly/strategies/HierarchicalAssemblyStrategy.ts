import type { AppConfig } from "../../../utils/config";
import { logger } from "../../../utils/logger";
import { MimeTypeUtils } from "../../../utils/mimeTypeUtils";
import type { DocumentStore } from "../../DocumentStore";
import type { DbPageChunk } from "../../types";
import type { ContentAssemblyStrategy } from "../types";

/** Positions of a run of chunks in a page, from `start` up to but not including `end`. */
interface ChunkRange {
  start: number;
  end: number;
}

/** Returns a chunk's path, or the root path when it has none. */
function pathOf(chunk: DbPageChunk): string[] {
  return chunk.metadata.path ?? [];
}

/** Returns whether `path` begins with every segment of `prefix`. */
function startsWithPath(path: string[], prefix: string[]): boolean {
  return (
    path.length >= prefix.length &&
    prefix.every((segment, index) => segment === path[index])
  );
}

/** Returns whether two paths have the same segments. */
function isSamePath(a: string[], b: string[]): boolean {
  return a.length === b.length && startsWithPath(a, b);
}

/** Returns whether a chunk opens a declaration such as a class or namespace. */
function isStructural(chunk: DbPageChunk): boolean {
  return chunk.metadata.types?.includes("structural") ?? false;
}

/**
 * Assembly strategy for structured content (source code, JSON, config files).
 *
 * Uses selective subtree reassembly: a single match brings the structure that contains
 * it, such as its class or JSON object, with the opening and closing chunks of the scopes
 * around it. Multiple matches within the same document bring the chunks at their common
 * ancestor path and the subtree of each match, avoiding inclusion of excessive unrelated
 * content. Simple concatenation leverages splitter concatenation guarantees.
 */
export class HierarchicalAssemblyStrategy implements ContentAssemblyStrategy {
  constructor(private config: AppConfig) {}

  /**
   * Determines if this strategy can handle the given content type.
   * Handles structured content like source code, JSON, configuration files.
   */
  canHandle(mimeType?: string): boolean {
    if (!mimeType) {
      return false;
    }
    // Source code content
    if (MimeTypeUtils.isSourceCode(mimeType)) {
      return true;
    }

    // JSON content
    if (MimeTypeUtils.isJson(mimeType)) {
      return true;
    }

    // Could add more structured content detection here if needed
    // (e.g., YAML, TOML, XML configuration files)

    return false;
  }
  /**
   * Selects the chunks to reassemble around the matches of each document.
   * For a single match: the subtree of its container plus the boundaries of the enclosing scopes.
   * For multiple matches in same document: finds common ancestor and reconstructs minimal subtree.
   */
  async selectChunks(
    library: string,
    version: string,
    initialChunks: DbPageChunk[],
    documentStore: DocumentStore,
  ): Promise<DbPageChunk[]> {
    if (initialChunks.length === 0) {
      return [];
    }

    try {
      // Group chunks by document URL
      const chunksByDocument = new Map<string, DbPageChunk[]>();
      for (const chunk of initialChunks) {
        const url = chunk.url;
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

          // IMPORTANT: Always include the original matched chunk first
          allChunkIds.add(matched.id);

          const pageChunks = await documentStore.findChunksByUrl(
            library,
            version,
            matched.url,
          );
          const matchIndex = pageChunks.findIndex((chunk) => chunk.id === matched.id);
          if (matchIndex === -1) continue;

          // The container to reconstruct: the JSON object or array holding the match,
          // or for code its structural ancestor (class / namespace, etc.)
          const containerIndex = MimeTypeUtils.isJson(matched.content_type ?? "")
            ? this.findJsonContainer(pageChunks, matchIndex)
            : this.findCodeContainer(pageChunks, matchIndex);

          // Add the container's full subtree, through its closing chunk, and open and
          // close the scopes that enclose it, without their other members
          const container = this.containerRange(pageChunks, containerIndex);
          for (const chunk of pageChunks.slice(container.start, container.end)) {
            allChunkIds.add(chunk.id);
          }
          for (const chunk of this.findEnclosingScopeBoundaries(
            pageChunks,
            container.start,
          )) {
            allChunkIds.add(chunk.id);
          }
        } else {
          // Multiple matches: use selective subtree reassembly
          // IMPORTANT: Always include all original matched chunks first
          for (const matched of documentChunks) {
            allChunkIds.add(matched.id);
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
  assembleContent(chunks: DbPageChunk[]): string {
    return chunks.map((chunk) => chunk.content).join("");
  }

  /**
   * Finds the code container to reconstruct for a single match: the innermost scope
   * around the match, the match's own included, whose opening chunk is structural (a
   * class, interface, enum or namespace). Without one, as for a match in a top-level
   * function, it is the top-level element named by the first path segment, otherwise
   * the match itself.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param matchIndex Position of the match.
   * @returns The position of the container's opening chunk.
   */
  private findCodeContainer(pageChunks: DbPageChunk[], matchIndex: number): number {
    const path = pathOf(pageChunks[matchIndex]);
    // Example: path ['applyMigrations','overallTransaction','<anonymous_arrow>'] has no
    // structural scope, so the whole top-level function 'applyMigrations' is reconstructed.
    let topLevel: number | undefined;
    for (let length = path.length; length > 0; length--) {
      const start = this.findScopeStart(pageChunks, matchIndex, path.slice(0, length));
      if (start === undefined) continue;
      if (isStructural(pageChunks[start])) return start;
      if (length === 1) topLevel = start;
    }
    return topLevel ?? matchIndex;
  }

  /**
   * Finds the JSON object or array to reconstruct for a single match: the one the match
   * opens, otherwise the one that contains it. Unlike code, a match is not promoted to
   * the top level, which in JSON is the whole document.
   *
   * The JSON splitter puts a key whose value is an object or array, the opening bracket
   * and the closing bracket at the key's path, the bracket in a chunk of its own. That
   * bracket chunk marks an object or array even when it is empty, and a primitive value
   * split into several chunks never has one.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param matchIndex Position of the match.
   * @returns The position of a chunk that opens the container.
   */
  private findJsonContainer(pageChunks: DbPageChunk[], matchIndex: number): number {
    const path = pathOf(pageChunks[matchIndex]);
    const own = this.containerRange(pageChunks, matchIndex);
    const opensContainer = pageChunks
      .slice(own.start, own.end)
      .some(
        (chunk) => isSamePath(pathOf(chunk), path) && /^[[{]$/.test(chunk.content.trim()),
      );
    if (opensContainer || path.length <= 1) {
      return matchIndex;
    }
    return this.findScopeStart(pageChunks, own.start, path.slice(0, -1)) ?? matchIndex;
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
    chunk: DbPageChunk,
    documentStore: DocumentStore,
  ): Promise<string[]> {
    const chainIds: string[] = [];
    const visited = new Set<string>();
    let currentChunk: DbPageChunk | null = chunk;
    const { maxParentChainDepth } = this.config.assembly; // Safety limit to prevent runaway loops
    let depth = 0;

    // Walk up parent chain until we reach the root
    while (currentChunk && depth < maxParentChainDepth) {
      const currentId = currentChunk.id;

      // Check for circular references
      if (visited.has(currentId)) {
        logger.warn(`Circular reference detected in parent chain for chunk ${currentId}`);
        break;
      }

      visited.add(currentId);
      chainIds.push(currentId);
      depth++;

      // Try normal parent lookup first
      let parentChunk = await documentStore.findParentChunk(library, version, currentId);

      // If no direct parent found, try gap-aware ancestor search
      if (!parentChunk) {
        parentChunk = await this.findAncestorWithGaps(
          library,
          version,
          currentChunk.url,
          currentChunk.metadata.path ?? [],
          documentStore,
        );
      }

      currentChunk = parentChunk;
    }

    if (depth >= maxParentChainDepth) {
      logger.warn(
        `Maximum parent chain depth (${maxParentChainDepth}) reached for chunk ${chunk.id}`,
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
    url: string,
    path: string[],
    documentStore: DocumentStore,
  ): Promise<DbPageChunk | null> {
    if (path.length <= 1) {
      return null; // Already at or near root
    }

    // Try progressively shorter path prefixes to find existing ancestors
    // Start from immediate parent and work backwards to root
    for (let pathLength = path.length - 1; pathLength > 0; pathLength--) {
      const ancestorPath = path.slice(0, pathLength);

      try {
        // Search for chunks that have this exact path in the same document
        const potentialAncestors = await this.findChunksByExactPath(
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
   * Finds the chunks of a document whose path equals the given path.
   */
  private async findChunksByExactPath(
    library: string,
    version: string,
    url: string,
    targetPath: string[],
    documentStore: DocumentStore,
  ): Promise<DbPageChunk[]> {
    try {
      const pageChunks = await documentStore.findChunksByUrl(library, version, url);
      return pageChunks.filter((chunk) => isSamePath(pathOf(chunk), targetPath));
    } catch (error) {
      logger.warn(`Error in findChunksByExactPath: ${error}`);
      return [];
    }
  }

  /**
   * Selects chunks for selective subtree reassembly when multiple matches exist in the same document.
   * Finds the common ancestor and reconstructs only the relevant subtrees.
   */
  private async selectSubtreeChunks(
    library: string,
    version: string,
    documentChunks: DbPageChunk[],
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

    const pageChunks = await documentStore.findChunksByUrl(
      library,
      version,
      documentChunks[0].url,
    );

    // Include the container chunks (opening/closing) at the common ancestor path
    for (const chunk of pageChunks) {
      if (isSamePath(pathOf(chunk), commonAncestorPath)) {
        chunkIds.add(chunk.id);
      }
    }

    // For each matched chunk, include its full subtree
    for (const matched of documentChunks) {
      const index = pageChunks.findIndex((chunk) => chunk.id === matched.id);
      if (index === -1) continue;
      const subtree = this.containerRange(pageChunks, index);
      for (const chunk of pageChunks.slice(subtree.start, subtree.end)) {
        chunkIds.add(chunk.id);
      }
    }

    return Array.from(chunkIds);
  }

  /**
   * Finds the common ancestor path from a list of chunks by finding the longest common prefix.
   */
  private findCommonAncestorPath(chunks: DbPageChunk[]): string[] {
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
   * Finds the chunks that open and close each scope enclosing a container, innermost
   * first and up to `assembly.maxParentChainDepth` scopes. A scope opens where the run
   * of chunks inside its path begins, so the members and statements between its
   * declaration and the container are left out. A scope with no chunk at its own path,
   * such as a level the splitter skipped, adds nothing.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param containerStart Position of the container's first chunk.
   * @returns The scopes' opening and closing chunks.
   */
  private findEnclosingScopeBoundaries(
    pageChunks: DbPageChunk[],
    containerStart: number,
  ): DbPageChunk[] {
    const path = pathOf(pageChunks[containerStart]);
    const { maxParentChainDepth } = this.config.assembly;
    const boundaries: DbPageChunk[] = [];
    let index = containerStart;
    for (
      let length = path.length - 1;
      length > 0 && path.length - length < maxParentChainDepth;
      length--
    ) {
      const start = this.findScopeStart(pageChunks, index, path.slice(0, length));
      if (start === undefined) continue;
      index = start;
      boundaries.push(
        ...this.scopeBoundaries(pageChunks, this.containerRange(pageChunks, start)),
      );
    }
    return boundaries;
  }

  /**
   * Finds where the scope with the given path opens, looking back from the chunk at
   * `index`: the first chunk of the run of chunks inside that path.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param index Position of a chunk inside the scope.
   * @param scopePath Path of the scope.
   * @returns The position of the scope's opening chunk, or undefined when the run does
   *   not begin with a chunk at the scope's own path.
   */
  private findScopeStart(
    pageChunks: DbPageChunk[],
    index: number,
    scopePath: string[],
  ): number | undefined {
    let start = index;
    while (start > 0 && startsWithPath(pathOf(pageChunks[start - 1]), scopePath)) {
      start--;
    }
    return isSamePath(pathOf(pageChunks[start]), scopePath) ? start : undefined;
  }

  /**
   * Returns the chunks that open and close a scope: those at the scope's own path before
   * its first nested member (a class declaration, or a JSON key and its bracket) and
   * after its last one (a closing brace). A scope without nested members has none.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param scope Range of the scope, as found by `containerRange`.
   */
  private scopeBoundaries(pageChunks: DbPageChunk[], scope: ChunkRange): DbPageChunk[] {
    // Every chunk in the range starts with the scope's path, so a longer path is nested
    const depth = pathOf(pageChunks[scope.start]).length;
    const isOwn = (index: number) => pathOf(pageChunks[index]).length === depth;
    let firstNested = scope.start;
    while (firstNested < scope.end && isOwn(firstNested)) {
      firstNested++;
    }
    if (firstNested === scope.end) {
      return [];
    }
    let lastNested = scope.end - 1;
    while (isOwn(lastNested)) {
      lastNested--;
    }
    return [
      ...pageChunks.slice(scope.start, firstNested),
      ...pageChunks.slice(lastNested + 1, scope.end),
    ];
  }

  /**
   * Finds the container that the chunk at `index` belongs to. The container opens with
   * the chunk and the chunks right before it that carry the same path (such as a JSON
   * key and its bracket), and holds the chunks right after it whose path starts with
   * that path. The run ends at the first chunk outside the container, so it holds the
   * nested members and the closing chunk, which repeats the container's path, but no
   * unrelated code. A chunk with an empty path is global code and contains nothing else.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param index Position of a chunk that opens the container.
   * @returns The container's range in `pageChunks`.
   */
  private containerRange(pageChunks: DbPageChunk[], index: number): ChunkRange {
    const rootPath = pathOf(pageChunks[index]);
    if (rootPath.length === 0) {
      return { start: index, end: index + 1 };
    }

    let start = index;
    while (start > 0 && isSamePath(pathOf(pageChunks[start - 1]), rootPath)) {
      start--;
    }
    let end = index + 1;
    while (end < pageChunks.length && startsWithPath(pathOf(pageChunks[end]), rootPath)) {
      end++;
    }
    return { start, end };
  }

  /**
   * Fallback selection method when parent chain walking fails.
   * Uses a simplified approach similar to MarkdownAssemblyStrategy but more conservative.
   */
  private async fallbackSelection(
    library: string,
    version: string,
    initialChunks: DbPageChunk[],
    documentStore: DocumentStore,
  ): Promise<DbPageChunk[]> {
    const chunkIds = new Set<string>();

    // Just include the initial chunks and their immediate parents/children
    for (const chunk of initialChunks) {
      const id = chunk.id;
      chunkIds.add(id);

      // Add parent for context
      const parent = await documentStore.findParentChunk(library, version, id);
      if (parent) {
        chunkIds.add(parent.id);
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
