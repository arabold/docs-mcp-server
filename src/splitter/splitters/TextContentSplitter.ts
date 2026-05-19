import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { logger } from "../../utils/logger";
import { MinimumChunkSizeError } from "../errors";
import { hasOpenFenceAtEnd } from "./fenceState";
import type { ContentSplitter, ContentSplitterOptions } from "./types";

/**
 * Splits text content using a hierarchical approach:
 * 1. Try splitting by paragraphs (double newlines)
 * 2. If chunks still too large, split by single newlines
 * 3. Finally, use word boundaries via LangChain's splitter
 *
 * Across all strategies the splitter preserves fenced code block balance: if
 * splitting would leave a chunk ending inside an open ``` or ~~~ fence, that
 * chunk is merged with the following chunk until the fence closes. When this
 * merging forces a chunk past `chunkSize`, the splitter accepts the oversize
 * chunk and emits a warning rather than break the fence.
 */
export class TextContentSplitter implements ContentSplitter {
  constructor(private options: ContentSplitterOptions) {}

  /**
   * Splits text content into chunks while trying to preserve semantic boundaries.
   * Prefers paragraph breaks, then line breaks, finally falling back to word boundaries.
   * Always preserves formatting - trimming should be done by higher-level splitters if needed.
   */
  async split(content: string): Promise<string[]> {
    if (content.length <= this.options.chunkSize) {
      return [content];
    }

    // Check for unsplittable content (e.g., a single word longer than chunkSize)
    const words = content.split(/\s+/);
    const longestWord = words.reduce((max: string, word: string) =>
      word.length > max.length ? word : max,
    );
    if (longestWord.length > this.options.chunkSize) {
      throw new MinimumChunkSizeError(longestWord.length, this.options.chunkSize);
    }

    // First try splitting by paragraphs (double newlines)
    const paragraphChunks = this.mergeForFenceBalance(
      this.splitByParagraphs(content),
      "",
    );
    if (this.areChunksValid(paragraphChunks)) {
      // No merging for paragraph chunks; they are already semantically separated
      return paragraphChunks;
    }

    // If that doesn't work, try splitting by single newlines
    const lineChunks = this.mergeForFenceBalance(this.splitByLines(content), "");
    if (this.areChunksValid(lineChunks)) {
      return this.mergeChunks(lineChunks, ""); // No separator needed - newlines are preserved in chunks
    }

    // Finally, fall back to word-based splitting using LangChain. Re-merge for
    // fence balance after word splitting, then collapse small chunks. Any chunk
    // still over `chunkSize` after this step is an oversize-for-fence-balance
    // case — emit it and warn rather than break the fence.
    const wordChunks = this.mergeForFenceBalance(await this.splitByWords(content), " ");
    const merged = this.mergeChunks(wordChunks, " ");
    this.warnOversize(merged);
    return merged;
  }

  /**
   * Walks `chunks` left to right and merges adjacent chunks whenever the running
   * buffer ends inside an open fenced code block. Guarantees that every emitted
   * chunk has balanced fences (i.e. `hasOpenFenceAtEnd` returns false).
   */
  private mergeForFenceBalance(chunks: string[], separator: string): string[] {
    const result: string[] = [];
    let buffer = "";

    for (const chunk of chunks) {
      buffer = buffer ? `${buffer}${separator}${chunk}` : chunk;
      if (!hasOpenFenceAtEnd(buffer)) {
        result.push(buffer);
        buffer = "";
      }
    }

    if (buffer) {
      // No closing fence in the rest of the input — emit the dangling buffer as
      // a single chunk. The fence balance check downstream will catch this and
      // it will surface in logs as an oversize-chunk warning if applicable.
      result.push(buffer);
    }

    return result;
  }

  private warnOversize(chunks: string[]): void {
    for (const chunk of chunks) {
      if (chunk.length > this.options.chunkSize) {
        logger.warn(
          `⚠ TextContentSplitter emitted oversize chunk to preserve fence balance: ${chunk.length} > ${this.options.chunkSize}`,
        );
      }
    }
  }

  /**
   * Checks if all chunks are within the maximum size limit
   */
  private areChunksValid(chunks: string[]): boolean {
    return chunks.every((chunk) => chunk.length <= this.options.chunkSize);
  }

  /**
   * Splits text into chunks by paragraph boundaries (double newlines)
   * Preserves all formatting and whitespace including the paragraph separators
   */
  private splitByParagraphs(text: string): string[] {
    const chunks: string[] = [];
    let startPos = 0;

    // Find all paragraph boundaries
    const paragraphRegex = /\n\s*\n/g;
    let match = paragraphRegex.exec(text);

    while (match !== null) {
      // Include the paragraph separator in the current chunk
      const endPos = match.index + match[0].length;
      const chunk = text.slice(startPos, endPos);
      if (chunk.length > 2) {
        chunks.push(chunk);
      }
      startPos = endPos;
      match = paragraphRegex.exec(text);
    }

    // Add the remaining text
    if (startPos < text.length) {
      const remainingChunk = text.slice(startPos);
      if (remainingChunk.length > 2) {
        chunks.push(remainingChunk);
      }
    }

    return chunks.filter(Boolean);
  }

  /**
   * Splits text into chunks by line boundaries
   * Preserves all formatting and whitespace, including newlines at the end of each line
   */
  private splitByLines(text: string): string[] {
    const chunks: string[] = [];
    let startPos = 0;

    // Find all line boundaries
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        // Include the newline in the current chunk
        const chunk = text.slice(startPos, i + 1);
        chunks.push(chunk);
        startPos = i + 1;
      }
    }

    // Add the remaining text (if any) without a trailing newline
    if (startPos < text.length) {
      chunks.push(text.slice(startPos));
    }

    return chunks;
  }

  /**
   * Uses LangChain's recursive splitter for word-based splitting as a last resort
   */
  private async splitByWords(text: string): Promise<string[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.options.chunkSize,
      chunkOverlap: 0,
    });

    const chunks = await splitter.splitText(text);
    return chunks;
  }

  /**
   * Attempts to merge small chunks with previous chunks to minimize fragmentation.
   * Only merges if combined size is within maxChunkSize.
   */
  protected mergeChunks(chunks: string[], separator: string): string[] {
    const mergedChunks: string[] = [];
    let currentChunk: string | null = null;

    for (const chunk of chunks) {
      if (currentChunk === null) {
        currentChunk = chunk;
        continue;
      }

      const currentChunkSize = this.getChunkSize(currentChunk);
      const nextChunkSize = this.getChunkSize(chunk);

      if (currentChunkSize + nextChunkSize + separator.length <= this.options.chunkSize) {
        // Merge chunks
        currentChunk = `${currentChunk}${separator}${chunk}`;
      } else {
        // Add the current chunk to the result and start a new one
        mergedChunks.push(currentChunk);
        currentChunk = chunk;
      }
    }

    if (currentChunk) {
      mergedChunks.push(currentChunk);
    }

    return mergedChunks;
  }

  protected getChunkSize(chunk: string): number {
    return chunk.length;
  }

  protected wrap(content: string): string {
    return content;
  }
}
