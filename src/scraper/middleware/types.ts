import type { DOMWindow } from "jsdom";
import type { ContentFetcher } from "../fetcher/types";
import type { ScraperOptions } from "../types";

/**
 * Represents the context passed through the content processing middleware pipeline.
 */
export interface ContentProcessingContext {
  /** The content being processed (can be Buffer initially, then string). */
  content: string | Buffer;
  /** The MIME type of the content (e.g., 'text/html', 'text/markdown'). */
  contentType: string;
  /** The original source URL of the content. */
  readonly source: string;
  /** Extracted metadata (e.g., title). */
  metadata: Record<string, unknown>;
  /** Extracted links from the content. */
  links: string[];
  /** Errors encountered during processing. */
  errors: Error[];
  /** Job-specific options influencing processing. */
  readonly options: ScraperOptions;

  /** Optional JSDOM window object for HTML processing. */
  dom?: DOMWindow;

  /** Optional fetcher instance for resolving resources relative to the source. */
  fetcher?: ContentFetcher;
}

/**
 * Defines the interface for a content processing middleware component.
 */
export interface ContentProcessorMiddleware {
  /**
   * Processes the content context asynchronously.
   * @param context The current processing context.
   * @param next A function to call to pass control to the next middleware in the pipeline.
   */
  process(context: ContentProcessingContext, next: () => Promise<void>): Promise<void>;
}
