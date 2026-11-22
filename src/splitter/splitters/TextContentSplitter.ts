import { logger } from "../../utils/logger";
import { MinimumChunkSizeError } from "../errors";
import { type FenceOpener, FenceTracker, parseFenceOpener } from "./fenceState";
import type { ContentSplitter, ContentSplitterOptions } from "./types";

/**
 * Splits text content using a hierarchical approach:
 * 1. Try splitting by paragraphs (double newlines)
 * 2. If chunks still too large, split by single newlines and merge them back
 *    up to the chunk size
 * 3. Split only the lines that are still too large, at word boundaries
 *
 * Text is split to stay within `chunkSize`. Across all strategies the splitter
 * also preserves fenced code block balance: a chunk never ends inside an open
 * ``` or ~~~ fence. A fenced block stays whole up to `maxChunkSize`, even when
 * that is larger than `chunkSize`. A block larger than `maxChunkSize` is cut at
 * line boundaries. With `rewrapFences`, each piece is closed and reopened with
 * the block's own opener line, the same way the Markdown code splitter re-wraps
 * a long code block; without it, nothing is added and the chunks join back to
 * the input. No chunk exceeds `maxChunkSize`, because an oversized chunk cannot
 * be embedded.
 */
export class TextContentSplitter implements ContentSplitter {
  private readonly maxChunkSize: number;

  constructor(private options: ContentSplitterOptions) {
    this.maxChunkSize = Math.max(options.maxChunkSize ?? 0, options.chunkSize);
  }

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
    const paragraphChunks = this.mergeForFenceBalance(this.splitByParagraphs(content));
    if (this.areChunksValid(paragraphChunks)) {
      // No merging for paragraph chunks; they are already semantically separated
      return paragraphChunks;
    }

    // Then by lines. A fenced block comes back as one unit, and only the units
    // still too large are split further, so one oversized block or line
    // leaves the rest of the document at line granularity.
    const lineUnits = this.mergeForFenceBalance(this.splitByLines(content));
    const units = lineUnits.flatMap((unit) => this.fitUnit(unit));
    return this.mergeChunks(units);
  }

  /**
   * Returns a line unit whole when it fits, or the pieces it is cut into. A
   * unit is either one fenced block, which may use up to `maxChunkSize`, or
   * one line with no fence in it, which is held to `chunkSize`.
   */
  private fitUnit(unit: string): string[] {
    if (unit.length <= this.options.chunkSize) {
      return [unit];
    }
    const firstLineEnd = unit.indexOf("\n");
    const opener =
      firstLineEnd === -1 ? null : parseFenceOpener(unit.slice(0, firstLineEnd));
    if (opener === null) {
      return this.splitLongLine(unit, this.options.chunkSize);
    }
    if (unit.length <= this.maxChunkSize) {
      return [unit];
    }
    return this.splitFencedBlock(unit, unit.slice(0, firstLineEnd + 1), opener);
  }

  /**
   * Walks `chunks` left to right and merges adjacent chunks whenever the running
   * buffer ends inside an open fenced code block. Guarantees that every emitted
   * chunk has balanced fences, except a trailing fence the input never closes.
   * The chunks must be consecutive pieces of one text, joined without a separator.
   */
  private mergeForFenceBalance(chunks: string[]): string[] {
    const result: string[] = [];
    const fences = new FenceTracker();
    let buffer = "";

    for (const chunk of chunks) {
      buffer += chunk;
      fences.feed(chunk);
      if (!fences.isOpen()) {
        result.push(buffer);
        buffer = "";
      }
    }

    if (buffer) {
      // No closing fence in the rest of the input — emit the dangling buffer as
      // one unit. `fitUnit` cuts it down when it is too large.
      result.push(buffer);
    }

    return result;
  }

  /**
   * Cuts a fenced block larger than `maxChunkSize` into pieces within it. With
   * `rewrapFences` each piece is wrapped in the block's own fences; otherwise
   * the pieces are plain cuts that join back to the block.
   */
  private splitFencedBlock(
    unit: string,
    openerLine: string,
    opener: FenceOpener,
  ): string[] {
    const closerLine = `${opener.prefix}${opener.delimiter.repeat(opener.length)}\n`;
    // Leaves room for the opener, the closer, and the newline a piece cut
    // in the middle of a line needs before its closer.
    const room = this.maxChunkSize - openerLine.length - closerLine.length - 1;
    if (!this.options.rewrapFences || room <= 0) {
      // Without re-wrapping, or when the opener line alone leaves no room for
      // code, plain cuts are the only way to stay within the limit.
      return this.packLines(unit, this.maxChunkSize);
    }

    // The body packed into pieces that leave room for the fences. The block's
    // own closer is the last line when the fence is closed, and stays where it is.
    const pieces = this.packLines(unit.slice(openerLine.length), room);

    logger.debug(
      `Split a ${unit.length}-char fenced block into ${pieces.length} chunks of at most ${this.maxChunkSize} chars`,
    );

    // Every piece opens with the block's opener line, and every piece but the
    // last closes the fence. A piece cut from the middle of a line ends without
    // a newline, so the closer goes on a line of its own.
    return pieces.map((piece, index) => {
      if (index === pieces.length - 1) return `${openerLine}${piece}`;
      const close = piece.endsWith("\n") ? closerLine : `\n${closerLine}`;
      return `${openerLine}${piece}${close}`;
    });
  }

  /**
   * Cuts text at line boundaries into pieces of at most `limit` characters,
   * cutting a longer line with `splitLongLine`. The pieces join back to the text.
   */
  private packLines(text: string, limit: number): string[] {
    const lines = this.splitByLines(text).flatMap((line) =>
      line.length <= limit ? [line] : this.splitLongLine(line, limit),
    );
    return this.mergeChunks(lines, limit);
  }

  /**
   * Cuts a line into pieces of at most `limit` characters, preferring the last
   * whitespace before the limit. The pieces join back to the line.
   */
  private splitLongLine(line: string, limit: number): string[] {
    const pieces: string[] = [];
    let rest = line;
    while (rest.length > limit) {
      const window = rest.slice(0, limit);
      const lastSpace = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
      const cut = lastSpace > 0 ? lastSpace + 1 : limit;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) pieces.push(rest);
    return pieces;
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
   * Attempts to merge small chunks with previous chunks to minimize fragmentation.
   * Only merges if the combined size is within `limit`, which defaults to `chunkSize`.
   * The chunks are joined as they are, since each keeps its own newlines.
   */
  protected mergeChunks(chunks: string[], limit = this.options.chunkSize): string[] {
    const mergedChunks: string[] = [];
    let currentChunk: string | null = null;

    for (const chunk of chunks) {
      if (currentChunk === null) {
        currentChunk = chunk;
        continue;
      }

      const currentChunkSize = this.getChunkSize(currentChunk);
      const nextChunkSize = this.getChunkSize(chunk);

      if (currentChunkSize + nextChunkSize <= limit) {
        // Merge chunks
        currentChunk = `${currentChunk}${chunk}`;
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
