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
}

/**
 * Core interface for content splitters
 */
export interface ContentSplitter {
  /** Split content into chunks respecting size constraints */
  split(content: string): Promise<string[]>;
}
