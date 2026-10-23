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

/** Returns the longest path that every given path starts with. */
function commonPrefix(paths: string[][]): string[] {
  const [first = [], ...rest] = paths;
  let length = 0;
  while (length < first.length && rest.every((path) => path[length] === first[length])) {
    length++;
  }
  return first.slice(0, length);
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
 * around it. Multiple matches within the same document bring only their own subtrees,
 * inside the opening and closing chunks of their scopes, avoiding inclusion of excessive
 * unrelated content. Simple concatenation leverages splitter concatenation guarantees.
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
   * For multiple matches in same document: each match's subtree plus the boundaries of its scopes.
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
      for (const [url, documentChunks] of Array.from(chunksByDocument.entries())) {
        // IMPORTANT: Always include the original matched chunks first
        for (const matched of documentChunks) {
          allChunkIds.add(matched.id);
        }

        const pageChunks = await documentStore.findChunksByUrl(library, version, url);
        const matchedIds = new Set(documentChunks.map((matched) => matched.id));
        const matchIndices = pageChunks.flatMap((chunk, index) =>
          matchedIds.has(chunk.id) ? [index] : [],
        );
        if (matchIndices.length === 0) continue;

        const selected =
          documentChunks.length === 1
            ? this.selectAroundMatch(
                pageChunks,
                matchIndices[0],
                MimeTypeUtils.isJson(documentChunks[0].content_type ?? ""),
              )
            : this.selectAroundMatches(pageChunks, matchIndices);
        for (const chunk of selected) {
          allChunkIds.add(chunk.id);
        }
      }

      // Fetch all chunks in proper sort order
      const chunkIds = Array.from(allChunkIds);
      const chunks = await documentStore.findChunksByIds(library, version, chunkIds);

      return chunks;
    } catch (error) {
      // Fallback to simpler selection if loading the page fails
      logger.warn(
        `Hierarchical chunk selection failed, falling back to basic selection: ${error}`,
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
   * Selects the chunks around a single match: the subtree of its container (for code
   * its structural ancestor, such as its class; for JSON the object or array holding
   * it) and the opening and closing chunks of the scopes that enclose that container.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param matchIndex Position of the match.
   * @param isJson Whether the page is JSON.
   */
  private selectAroundMatch(
    pageChunks: DbPageChunk[],
    matchIndex: number,
    isJson: boolean,
  ): DbPageChunk[] {
    const containerIndex = isJson
      ? this.findJsonContainer(pageChunks, matchIndex)
      : this.findCodeContainer(pageChunks, matchIndex);
    return this.selectSubtree(pageChunks, containerIndex);
  }

  /**
   * Selects the chunks around several matches in one page: each match's subtree with
   * the opening and closing chunks of the scopes that enclose it, but none of their
   * other members. Within the scope that holds all matches, the chunks at that scope's
   * own path, such as fields or statements, are included as well.
   *
   * @param pageChunks All chunks of one page, in document order.
   * @param matchIndices Positions of the matches, in document order.
   */
  private selectAroundMatches(
    pageChunks: DbPageChunk[],
    matchIndices: number[],
  ): DbPageChunk[] {
    const selected = matchIndices.flatMap((index) =>
      this.selectSubtree(pageChunks, index),
    );

    const commonPath = commonPrefix(
      matchIndices.map((index) => pathOf(pageChunks[index])),
    );
    const commonScope =
      commonPath.length > 0
        ? this.findScopeStart(pageChunks, matchIndices[0], commonPath)
        : undefined;
    if (commonScope !== undefined) {
      const scope = this.containerRange(pageChunks, commonScope);
      for (const chunk of pageChunks.slice(scope.start, scope.end)) {
        if (isSamePath(pathOf(chunk), commonPath)) selected.push(chunk);
      }
    }
    return selected;
  }

  /**
   * Selects the subtree that the chunk at `index` opens, through its closing chunk, and
   * the opening and closing chunks of the scopes that enclose it. A chunk that opens
   * nothing, such as a field or statement that follows other members of its scope, comes
   * back on its own inside its scope's opening and closing chunks.
   */
  private selectSubtree(pageChunks: DbPageChunk[], index: number): DbPageChunk[] {
    if (!this.opensContainer(pageChunks, index)) {
      const scopeStart = this.findScopeStart(
        pageChunks,
        index,
        pathOf(pageChunks[index]),
      );
      const scope =
        scopeStart === undefined
          ? []
          : this.scopeBoundaries(pageChunks, this.containerRange(pageChunks, scopeStart));
      return [
        pageChunks[index],
        ...scope,
        ...this.findEnclosingScopeBoundaries(pageChunks, scopeStart ?? index),
      ];
    }

    const subtree = this.containerRange(pageChunks, index);
    return [
      ...pageChunks.slice(subtree.start, subtree.end),
      ...this.findEnclosingScopeBoundaries(pageChunks, subtree.start),
    ];
  }

  /**
   * Returns whether the chunk at `index` opens a container: no chunk nested deeper in its
   * path comes before it in the run of chunks inside that path. A field between two
   * methods carries its class's path but follows the first method, so it opens nothing.
   */
  private opensContainer(pageChunks: DbPageChunk[], index: number): boolean {
    const path = pathOf(pageChunks[index]);
    if (path.length === 0) {
      return true;
    }
    for (let previous = index - 1; previous >= 0; previous--) {
      const previousPath = pathOf(pageChunks[previous]);
      if (!startsWithPath(previousPath, path)) return true;
      if (previousPath.length > path.length) return false;
    }
    return true;
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
   * The JSON splitter puts a key whose value is an object or array at the key's path,
   * followed by a chunk at the same path that begins with the opening bracket: the
   * bracket alone, or, past `splitter.json.maxNestingDepth`, the whole value serialized
   * as text. That chunk marks an object or array even when it is empty. A primitive
   * value never begins with a bracket.
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
        (chunk) => isSamePath(pathOf(chunk), path) && /^[[{]/.test(chunk.content.trim()),
      );
    if (opensContainer || path.length <= 1) {
      return matchIndex;
    }
    return this.findScopeStart(pageChunks, own.start, path.slice(0, -1)) ?? matchIndex;
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
