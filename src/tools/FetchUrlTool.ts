import type {
  ContentFetcher,
  FileFetcher,
  HttpFetcher,
  RawContent,
} from "../scraper/fetcher";
import { ContentProcessingPipeline } from "../scraper/middleware/ContentProcessorPipeline";
import {
  HtmlMetadataExtractorMiddleware,
  HtmlSanitizerMiddleware,
  HtmlSelectProcessorMiddleware, // Import the new middleware
  HtmlToMarkdownMiddleware,
  MarkdownMetadataExtractorMiddleware,
} from "../scraper/middleware/components";
import type { ContentProcessingContext } from "../scraper/middleware/types";
import type { ScraperOptions } from "../scraper/types";
import { ScraperError } from "../utils/errors";
import { logger } from "../utils/logger";
import { ToolError } from "./errors";

export interface FetchUrlToolOptions {
  /**
   * The URL to fetch and convert to markdown.
   * Must be a valid HTTP/HTTPS URL or file:// URL.
   */
  url: string;

  /**
   * Whether to follow HTTP redirects.
   * @default true
   */
  followRedirects?: boolean;

  /**
   * Determines the HTML processing strategy.
   * - 'fetch': Use a simple DOM parser (faster, less JS support).
   * - 'playwright': Use a headless browser (slower, full JS support).
   * - 'auto': Automatically select the best strategy (currently defaults to 'playwright').
   * @default 'auto'
   */
  scrapeMode?: "fetch" | "playwright" | "auto";
}

/**
 * Tool for fetching a single URL and converting its content to Markdown.
 * Unlike scrape_docs, this tool only processes one page without crawling
 * or storing the content.
 *
 * Supports both HTTP/HTTPS URLs and local file URLs (file://).
 */
export class FetchUrlTool {
  /**
   * Collection of fetchers that will be tried in order for a given URL.
   */
  private readonly fetchers: ContentFetcher[];

  constructor(httpFetcher: HttpFetcher, fileFetcher: FileFetcher) {
    // Removed processor dependency
    this.fetchers = [httpFetcher, fileFetcher];
  }

  /**
   * Fetches content from a URL and converts it to Markdown.
   * Supports both HTTP/HTTPS URLs and local file URLs (file://).
   * @returns The processed Markdown content
   * @throws {ToolError} If fetching or processing fails
   */
  async execute(options: FetchUrlToolOptions): Promise<string> {
    const { url, scrapeMode = "auto" } = options; // Destructure scrapeMode with default

    // Check all fetchers first (helpful for testing and future extensions)
    const canFetchResults = this.fetchers.map((f) => f.canFetch(url));

    // Find an appropriate fetcher for this URL
    const fetcherIndex = canFetchResults.findIndex((result) => result === true);
    if (fetcherIndex === -1) {
      throw new ToolError(
        `Invalid URL: ${url}. Must be an HTTP/HTTPS URL or a file:// URL.`,
        this.constructor.name,
      );
    }

    const fetcher = this.fetchers[fetcherIndex];

    try {
      // Fetch the content
      logger.info(`📡 Fetching ${url}...`);
      const rawContent: RawContent = await fetcher.fetch(url, {
        followRedirects: options.followRedirects ?? true,
        maxRetries: 3, // Keep retries for fetching
      });

      // --- Start Middleware Pipeline ---
      logger.info("🔄 Processing content...");
      const initialContext: ContentProcessingContext = {
        content: rawContent.content,
        contentType: rawContent.mimeType,
        source: rawContent.source,
        metadata: {},
        links: [], // Links not needed for this tool's output
        errors: [],
        fetcher,
        // Create a minimal ScraperOptions object for the context
        options: {
          url: url, // Use the input URL
          library: "", // Not applicable for this tool
          version: "", // Use empty string instead of undefined
          // Default other options as needed by middleware
          maxDepth: 0,
          maxPages: 1,
          maxConcurrency: 1,
          scope: "subpages", // Default, though not used for single page fetch
          followRedirects: options.followRedirects ?? true,
          excludeSelectors: undefined, // Not currently configurable via this tool
          ignoreErrors: false,
          scrapeMode: scrapeMode, // Pass the scrapeMode
        } satisfies ScraperOptions,
      };

      let pipeline: ContentProcessingPipeline;
      if (initialContext.contentType.startsWith("text/html")) {
        // Updated HTML pipeline for FetchUrlTool
        pipeline = new ContentProcessingPipeline([
          new HtmlSelectProcessorMiddleware(), // Use the selector middleware
          new HtmlMetadataExtractorMiddleware(), // Keep for potential future use, though title isn't returned
          // No Link Extractor needed
          new HtmlSanitizerMiddleware(), // Use default selectors
          new HtmlToMarkdownMiddleware(),
        ]);
      } else if (
        initialContext.contentType === "text/markdown" ||
        initialContext.contentType === "text/plain"
      ) {
        pipeline = new ContentProcessingPipeline([
          new MarkdownMetadataExtractorMiddleware(), // Extract title (though not used)
          // No further processing needed for Markdown/Plain text for this tool
        ]);
      } else {
        // If content type is not HTML or Markdown/Plain, return raw content as string
        logger.warn(
          `Unsupported content type "${initialContext.contentType}" for ${url}. Returning raw content.`,
        );
        const contentString =
          typeof rawContent.content === "string"
            ? rawContent.content
            : Buffer.from(rawContent.content).toString("utf-8");
        return contentString;
      }

      const finalContext = await pipeline.run(initialContext);
      // --- End Middleware Pipeline ---

      // Log any processing errors
      for (const err of finalContext.errors) {
        logger.warn(`Processing error for ${url}: ${err.message}`);
      }

      if (typeof finalContext.content !== "string" || !finalContext.content.trim()) {
        throw new ToolError(
          `Processing resulted in empty content for ${url}`,
          this.constructor.name,
        );
      }

      logger.info(`✅ Successfully processed ${url}`);
      return finalContext.content; // Return the final processed content string
    } catch (error) {
      // Handle fetch errors and pipeline errors
      if (error instanceof ScraperError || error instanceof ToolError) {
        throw new ToolError(
          `Failed to fetch or process URL: ${error.message}`,
          this.constructor.name,
        );
      }
      throw new ToolError(
        `Failed to fetch or process URL: ${error instanceof Error ? error.message : String(error)}`,
        this.constructor.name,
      );
    }
  }
}
