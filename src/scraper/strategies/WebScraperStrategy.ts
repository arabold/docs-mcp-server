import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import type { UrlNormalizerOptions } from "../../utils/url";
import { HttpFetcher } from "../fetcher";
import type { RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, ProcessedContent } from "../pipelines/types";
import type { ScraperOptions, ScraperProgress } from "../types";
import { isInScope } from "../utils/scope";
import { BaseScraperStrategy, type QueueItem } from "./BaseScraperStrategy";

export interface WebScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
  shouldFollowLink?: (baseUrl: URL, targetUrl: URL) => boolean;
}

export class WebScraperStrategy extends BaseScraperStrategy {
  private readonly httpFetcher = new HttpFetcher();
  private readonly shouldFollowLinkFn?: (baseUrl: URL, targetUrl: URL) => boolean;
  private readonly pipelines: ContentPipeline[];

  constructor(options: WebScraperStrategyOptions = {}) {
    super({ urlNormalizerOptions: options.urlNormalizerOptions });
    this.shouldFollowLinkFn = options.shouldFollowLink;
    this.pipelines = PipelineFactory.createStandardPipelines();
  }

  canHandle(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
      return false;
    }
  }

  // Removed custom isInScope logic; using shared scope utility for consistent behavior

  /**
   * Processes a single queue item by fetching its content and processing it through pipelines.
   * @param item - The queue item to process.
   * @param options - Scraper options including headers for HTTP requests.
   * @param _progressCallback - Optional progress callback (not used here).
   * @param signal - Optional abort signal for request cancellation.
   * @returns An object containing the processed document and extracted links.
   */
  protected override async processItem(
    item: QueueItem,
    options: ScraperOptions,
    _progressCallback?: ProgressCallback<ScraperProgress>, // Base class passes it, but not used here
    signal?: AbortSignal, // Add signal
  ): Promise<{ document?: Document; links?: string[]; finalUrl?: string }> {
    const { url } = item;

    try {
      // Define fetch options, passing signal, followRedirects, and headers
      const fetchOptions = {
        signal,
        followRedirects: options.followRedirects,
        headers: options.headers, // Forward custom headers
      };

      // Pass options to fetcher
      const rawContent: RawContent = await this.httpFetcher.fetch(url, fetchOptions);

      // --- Start Pipeline Processing ---
      let processed: ProcessedContent | undefined;
      for (const pipeline of this.pipelines) {
        if (pipeline.canProcess(rawContent)) {
          processed = await pipeline.process(rawContent, options, this.httpFetcher);
          break;
        }
      }

      if (!processed) {
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for URL ${url}. Skipping processing.`,
        );
        return { document: undefined, links: [] };
      }

      // Log errors from pipeline
      for (const err of processed.errors) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }

      // Check if content processing resulted in usable content
      if (!processed.textContent || !processed.textContent.trim()) {
        logger.warn(
          `⚠️  No processable content found for ${url} after pipeline execution.`,
        );
        return { document: undefined, links: processed.links };
      }

      // Determine base for scope filtering:
      // For depth 0 (initial page) use the final fetched URL (rawContent.source) so protocol/host redirects don't drop links.
      // For deeper pages, use canonicalBaseUrl (set after first page) or fallback to original.
      const baseUrl =
        item.depth === 0
          ? new URL(rawContent.source)
          : (this.canonicalBaseUrl ?? new URL(options.url));

      const filteredLinks = processed.links.filter((link) => {
        try {
          const targetUrl = new URL(link);
          const scope = options.scope || "subpages";
          return (
            isInScope(baseUrl, targetUrl, scope) &&
            (!this.shouldFollowLinkFn || this.shouldFollowLinkFn(baseUrl, targetUrl))
          );
        } catch {
          return false;
        }
      });

      return {
        document: {
          content: processed.textContent,
          metadata: {
            url,
            title:
              typeof processed.metadata.title === "string"
                ? processed.metadata.title
                : "Untitled",
            library: options.library,
            version: options.version,
            ...processed.metadata,
          },
        } satisfies Document,
        links: filteredLinks,
        finalUrl: rawContent.source,
      };
    } catch (error) {
      // Log fetch errors or pipeline execution errors (if run throws)
      logger.error(`❌ Failed processing page ${url}: ${error}`);
      throw error;
    }
  }

  /**
   * Overrides the base scrape method to ensure the Playwright browser is closed
   * after the scraping process completes or errors out.
   */
  override async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      // Call the base class scrape method
      await super.scrape(options, progressCallback, signal);
    } finally {
      // Close all pipelines that support cleanup
      await Promise.all(
        this.pipelines.map(async (pipeline) => {
          if ("close" in pipeline && typeof pipeline.close === "function") {
            await pipeline.close();
          }
        }),
      );
    }
  }
}
