/**
 * Common configuration options for content splitters
 */
export interface ContentSplitterOptions {
  /** Target characters per chunk: content is split to stay within it */
  chunkSize: number;
  /**
   * Hard limit on characters per chunk. A unit the splitter avoids cutting,
   * such as a fenced code block, stays whole up to this size even when it is
   * larger than `chunkSize`. Defaults to `chunkSize`, and is never below it.
   */
  maxChunkSize?: number;
  /**
   * When a fenced code block larger than `maxChunkSize` has to be cut, close
   * and reopen the fence in each piece so every chunk stays balanced, as the
   * Markdown code splitter does. Off by default: the pieces are then cut at
   * line boundaries with nothing added, so the chunks join back to the input.
   */
  rewrapFences?: boolean;
}

/**
 * Core interface for content splitters
 */
export interface ContentSplitter {
  /** Split content into chunks respecting size constraints */
  split(content: string): Promise<string[]>;
}
