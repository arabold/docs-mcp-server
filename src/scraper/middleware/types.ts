import type * as cheerio from "cheerio";
import type { ContentFetcher } from "../fetcher/types";
import type { ScraperOptions } from "../types";

/**
 * Represents the context passed through the middleware pipeline.
 */
export interface MiddlewareContext {
  /** The title of the page or document, extracted during processing */
  title?: string;
  /** The MIME type of the content being processed. */
  contentType: string;
  /** The content being processed (always a string in middleware). */
  content: string;
  /** The original source URL of the content. */
  readonly source: string;
  /** Extracted links from the content. */
  links: string[];
  /** Errors encountered during processing. */
  errors: Error[];
  /** Job-specific options influencing processing. */
  readonly options: ScraperOptions;

  /** Optional Cheerio root object for HTML processing. */
  dom?: cheerio.CheerioAPI;

  /** Optional fetcher instance for resolving resources relative to the source. */
  fetcher?: ContentFetcher;
}

/**
 * Defines the interface for a middleware component.
 */
export interface ContentProcessorMiddleware {
  /**
   * Processes the middleware context asynchronously.
   * @param context The current middleware context.
   * @param next A function to call to pass control to the next middleware in the pipeline.
   */
  process(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
}
