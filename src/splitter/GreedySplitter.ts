import type { ContentChunk, DocumentSplitter, SectionContentType } from "./types";

/**
 * Takes small document chunks and greedily concatenates them into larger, more meaningful units
 * while preserving document structure and semantic boundaries.
 *
 * This approach improves embedding quality by:
 * - Maintaining context by keeping related content together
 * - Respecting natural document breaks at major section boundaries (H1/H2)
 * - Ensuring chunks are large enough to capture meaningful relationships
 * - Preventing chunks from becoming too large for effective embedding
 */
export class GreedySplitter implements DocumentSplitter {
  private baseSplitter: DocumentSplitter;
  private minChunkSize: number;
  private preferredChunkSize: number;

  /**
   * Combines a base document splitter with size constraints to produce optimally-sized chunks.
   * The base splitter handles the initial semantic splitting, while this class handles
   * the concatenation strategy.
   */
  constructor(
    baseSplitter: DocumentSplitter,
    minChunkSize: number,
    preferredChunkSize: number,
  ) {
    this.baseSplitter = baseSplitter;
    this.minChunkSize = minChunkSize;
    this.preferredChunkSize = preferredChunkSize;
  }

  /**
   * Uses a greedy concatenation strategy to build optimally-sized chunks. Small chunks
   * are combined until they reach the minimum size, but splits are preserved at major
   * section boundaries to maintain document structure. This balances the need for
   * context with semantic coherence.
   */
  async splitText(markdown: string, contentType?: string): Promise<ContentChunk[]> {
    const initialChunks = await this.baseSplitter.splitText(markdown, contentType);
    const concatenatedChunks: ContentChunk[] = [];
    let currentChunk: ContentChunk | null = null;

    for (const nextChunk of initialChunks) {
      if (currentChunk) {
        if (this.wouldExceedMaxSize(currentChunk, nextChunk)) {
          concatenatedChunks.push(currentChunk);
          currentChunk = this.cloneChunk(nextChunk);
          continue;
        }
        if (
          currentChunk.content.length >= this.minChunkSize &&
          this.startsNewMajorSection(nextChunk)
        ) {
          concatenatedChunks.push(currentChunk);
          currentChunk = this.cloneChunk(nextChunk);
          continue;
        }
        currentChunk.content += `${currentChunk.content.endsWith("\n") ? "" : "\n"}${nextChunk.content}`;
        currentChunk.section = this.mergeSectionInfo(currentChunk, nextChunk);
        currentChunk.types = this.mergeTypes(currentChunk.types, nextChunk.types);
      } else {
        currentChunk = this.cloneChunk(nextChunk);
      }
    }

    if (currentChunk) {
      concatenatedChunks.push(currentChunk);
    }

    return concatenatedChunks;
  }

  private cloneChunk(chunk: ContentChunk): ContentChunk {
    return {
      types: [...chunk.types],
      content: chunk.content,
      section: {
        level: chunk.section.level,
        path: [...chunk.section.path],
      },
    };
  }

  /**
   * H1 and H2 headings represent major conceptual breaks in the document.
   * Preserving these splits helps maintain the document's logical structure.
   */
  private startsNewMajorSection(chunk: ContentChunk): boolean {
    return chunk.section.level === 1 || chunk.section.level === 2;
  }

  /**
   * Size limit check to ensure chunks remain within embedding model constraints.
   * Essential for maintaining consistent embedding quality and avoiding truncation.
   */
  private wouldExceedMaxSize(
    currentChunk: ContentChunk | null,
    nextChunk: ContentChunk,
  ): boolean {
    if (!currentChunk) {
      return false;
    }
    return (
      currentChunk.content.length + nextChunk.content.length > this.preferredChunkSize
    );
  }

  /**
   * Checks if one path is a prefix of another path, indicating a parent-child relationship
   */
  private isPathIncluded(parentPath: string[], childPath: string[]): boolean {
    if (parentPath.length >= childPath.length) return false;
    return parentPath.every((part, i) => part === childPath[i]);
  }

  /**
   * Merges section metadata when concatenating chunks, following these rules:
   * 1. Level: Always uses the lowest (most general) level between chunks
   * 2. Path selection:
   *    - For parent-child relationships (one path includes the other), uses the child's path
   *    - For siblings/unrelated sections, uses the common parent path
   *    - If no common path exists, uses the root path ([])
   */
  private mergeSectionInfo(
    currentChunk: ContentChunk,
    nextChunk: ContentChunk,
  ): ContentChunk["section"] {
    // Always use the lowest level
    const level = Math.min(currentChunk.section.level, nextChunk.section.level);

    // If sections are exactly equal, preserve all metadata
    if (
      currentChunk.section.level === nextChunk.section.level &&
      currentChunk.section.path.length === nextChunk.section.path.length &&
      currentChunk.section.path.every((p, i) => p === nextChunk.section.path[i])
    ) {
      return currentChunk.section;
    }

    // Check if one path includes the other
    if (this.isPathIncluded(currentChunk.section.path, nextChunk.section.path)) {
      return {
        path: nextChunk.section.path,
        level,
      };
    }

    if (this.isPathIncluded(nextChunk.section.path, currentChunk.section.path)) {
      return {
        path: currentChunk.section.path,
        level,
      };
    }

    // Find common parent path
    const commonPath = this.findCommonPrefix(
      currentChunk.section.path,
      nextChunk.section.path,
    );

    return {
      path: commonPath,
      level,
    };
  }

  private mergeTypes(
    currentTypes: SectionContentType[],
    nextTypes: SectionContentType[],
  ): SectionContentType[] {
    return [...new Set([...currentTypes, ...nextTypes])];
  }

  /**
   * Returns longest common prefix between two paths
   */
  private findCommonPrefix(path1: string[], path2: string[]): string[] {
    const common: string[] = [];
    for (let i = 0; i < Math.min(path1.length, path2.length); i++) {
      if (path1[i] === path2[i]) {
        common.push(path1[i]);
      } else {
        break;
      }
    }
    return common;
  }
}
