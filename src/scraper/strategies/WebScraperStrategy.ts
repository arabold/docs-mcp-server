import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import type { UrlNormalizerOptions } from "../../utils/url";
import { hasSameDomain, hasSameHostname, isSubpath } from "../../utils/url";
import { HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { ContentProcessingPipeline } from "../middleware/ContentProcessorPipeline";
// Import new and updated middleware from index
import {
  HtmlLinkExtractorMiddleware,
  HtmlMetadataExtractorMiddleware,
  HtmlSanitizerMiddleware,
  HtmlSelectProcessorMiddleware, // Import the new middleware
  HtmlToMarkdownMiddleware,
  MarkdownLinkExtractorMiddleware,
  MarkdownMetadataExtractorMiddleware,
} from "../middleware/components";
import type { ContentProcessingContext } from "../middleware/types";
import type { ScraperOptions, ScraperProgress } from "../types";
import { BaseScraperStrategy, type QueueItem } from "./BaseScraperStrategy";

export interface WebScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
  shouldFollowLink?: (baseUrl: URL, targetUrl: URL) => boolean;
}

export class WebScraperStrategy extends BaseScraperStrategy {
  private readonly httpFetcher = new HttpFetcher();
  private readonly shouldFollowLinkFn?: (baseUrl: URL, targetUrl: URL) => boolean;

  constructor(options: WebScraperStrategyOptions = {}) {
    super({ urlNormalizerOptions: options.urlNormalizerOptions });
    this.shouldFollowLinkFn = options.shouldFollowLink;
  }

  canHandle(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * Determines if a target URL should be followed based on the scope setting.
   */
  private isInScope(
    baseUrl: URL,
    targetUrl: URL,
    scope: "subpages" | "hostname" | "domain",
  ): boolean {
    try {
      // First check if the URLs are on the same domain or hostname
      if (scope === "domain") {
        return hasSameDomain(baseUrl, targetUrl);
      }
      if (scope === "hostname") {
        return hasSameHostname(baseUrl, targetUrl);
      }
      // 'subpages' (default)
      return hasSameHostname(baseUrl, targetUrl) && isSubpath(baseUrl, targetUrl);
    } catch {
      return false;
    }
  }

  protected async processItem(
    item: QueueItem,
    options: ScraperOptions,
    _progressCallback?: ProgressCallback<ScraperProgress>, // Base class passes it, but not used here
    signal?: AbortSignal, // Add signal
  ): Promise<{ document?: Document; links?: string[] }> {
    const { url } = item;

    try {
      // Define fetch options, passing both signal and followRedirects
      const fetchOptions = {
        signal,
        followRedirects: options.followRedirects,
      };

      // Pass options to fetcher
      const rawContent: RawContent = await this.httpFetcher.fetch(url, fetchOptions);

      // --- Start Middleware Pipeline ---
      const initialContext: ContentProcessingContext = {
        content: rawContent.content,
        contentType: rawContent.mimeType,
        source: rawContent.source, // Use the final source URL after redirects
        metadata: {},
        links: [],
        errors: [],
        options,
        fetcher: this.httpFetcher,
      };

      let pipeline: ContentProcessingPipeline;
      if (initialContext.contentType.startsWith("text/html")) {
        // Updated HTML pipeline order
        pipeline = new ContentProcessingPipeline([
          new HtmlSelectProcessorMiddleware(), // Use the smart processor
          new HtmlMetadataExtractorMiddleware(),
          new HtmlLinkExtractorMiddleware(), // Extract links before cleaning
          new HtmlSanitizerMiddleware(),
          new HtmlToMarkdownMiddleware(),
        ]);
      } else if (
        initialContext.contentType === "text/markdown" ||
        initialContext.contentType === "text/plain" // Treat plain text as markdown
      ) {
        pipeline = new ContentProcessingPipeline([
          new MarkdownMetadataExtractorMiddleware(),
          new MarkdownLinkExtractorMiddleware(), // Placeholder for now
        ]);
      } else {
        // Unsupported content type, treat as error or skip
        logger.warn(
          `Unsupported content type "${initialContext.contentType}" for URL ${url}. Skipping processing.`,
        );
        // Return empty result, allowing crawl to potentially continue if links were somehow extracted elsewhere
        return { document: undefined, links: [] };
      }

      const finalContext = await pipeline.run(initialContext);
      // --- End Middleware Pipeline ---

      // Log errors from pipeline
      for (const err of finalContext.errors) {
        logger.warn(`Processing error for ${url}: ${err.message}`);
      }

      // Check if content processing resulted in usable content
      if (typeof finalContext.content !== "string" || !finalContext.content.trim()) {
        logger.warn(`No processable content found for ${url} after pipeline execution.`);
        // Return empty but allow crawl to continue based on extracted links
        return { document: undefined, links: finalContext.links };
      }

      // Filter extracted links based on scope and custom filter
      const baseUrl = new URL(options.url); // Use the original base URL for scope calculation
      const filteredLinks = finalContext.links.filter((link) => {
        try {
          const targetUrl = new URL(link); // Links should be absolute now
          const scope = options.scope || "subpages";
          return (
            this.isInScope(baseUrl, targetUrl, scope) &&
            (!this.shouldFollowLinkFn || this.shouldFollowLinkFn(baseUrl, targetUrl))
          );
        } catch {
          return false; // Ignore invalid URLs
        }
      });

      return {
        document: {
          content: finalContext.content, // Final processed content (Markdown)
          metadata: {
            url: finalContext.source, // URL after redirects
            // Ensure title is a string, default to "Untitled"
            title:
              typeof finalContext.metadata.title === "string"
                ? finalContext.metadata.title
                : "Untitled",
            library: options.library,
            version: options.version,
            // Add other metadata from context if needed
          },
        } satisfies Document,
        links: filteredLinks, // Use the filtered links
      };
    } catch (error) {
      // Log fetch errors or pipeline execution errors (if run throws)
      logger.error(`Failed processing page ${url}: ${error}`);
      throw error;
    }
  }
}
