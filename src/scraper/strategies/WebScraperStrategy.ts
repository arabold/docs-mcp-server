import { logger } from "../../utils/logger";
import type { UrlNormalizerOptions } from "../../utils/url";
import { AutoDetectFetcher } from "../fetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem, ScraperOptions } from "../types";
import { BaseScraperStrategy, type ProcessItemResult } from "./BaseScraperStrategy";

export interface WebScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
  shouldFollowLink?: (baseUrl: URL, targetUrl: URL) => boolean;
}

export class WebScraperStrategy extends BaseScraperStrategy {
  private readonly fetcher = new AutoDetectFetcher();
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
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    const { url } = item;

    try {
      // Log when processing with ETag for conditional requests
      if (item.etag) {
        logger.debug(`Processing ${url} with stored ETag: ${item.etag}`);
      }

      // Define fetch options, passing signal, followRedirects, headers, and etag
      const fetchOptions = {
        signal,
        followRedirects: options.followRedirects,
        headers: options.headers, // Forward custom headers
        etag: item.etag, // Pass ETag for conditional requests
      };

      // Use AutoDetectFetcher which handles fallbacks automatically
      const rawContent: RawContent = await this.fetcher.fetch(url, fetchOptions);

      logger.debug(
        `Fetch result for ${url}: status=${rawContent.status}, etag=${rawContent.etag || "none"}`,
      );

      // Return the status directly - BaseScraperStrategy handles NOT_MODIFIED and NOT_FOUND
      // Use the final URL from rawContent.source (which may differ due to redirects)
      if (rawContent.status !== FetchStatus.SUCCESS) {
        logger.debug(`Skipping pipeline for ${url} due to status: ${rawContent.status}`);
        return { url: rawContent.source, links: [], status: rawContent.status };
      }

      // --- Start Pipeline Processing ---
      let processed: PipelineResult | undefined;
      for (const pipeline of this.pipelines) {
        const contentBuffer = Buffer.isBuffer(rawContent.content)
          ? rawContent.content
          : Buffer.from(rawContent.content);
        if (pipeline.canProcess(rawContent.mimeType || "text/plain", contentBuffer)) {
          logger.debug(
            `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${url})`,
          );
          processed = await pipeline.process(rawContent, options, this.fetcher);
          break;
        }
      }

      if (!processed) {
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for URL ${url}. Skipping processing.`,
        );
        return { url: rawContent.source, links: [], status: FetchStatus.SUCCESS };
      }

      // Log errors from pipeline
      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }

      // Check if content processing resulted in usable content
      if (!processed.textContent || !processed.textContent.trim()) {
        logger.warn(
          `⚠️  No processable content found for ${url} after pipeline execution.`,
        );
        return {
          url: rawContent.source,
          links: processed.links,
          status: FetchStatus.SUCCESS,
        };
      }

      // Update canonical base URL from the first page's final URL (after redirects)
      if (item.depth === 0) {
        this.canonicalBaseUrl = new URL(rawContent.source);
      }

      const filteredLinks =
        processed.links?.filter((link) => {
          try {
            const targetUrl = new URL(link);
            // Use the base class's shouldProcessUrl which handles scope + include/exclude patterns
            if (!this.shouldProcessUrl(targetUrl.href, options)) {
              return false;
            }
            // Apply optional custom filter function if provided
            if (this.shouldFollowLinkFn) {
              const baseUrl = this.canonicalBaseUrl ?? new URL(options.url);
              return this.shouldFollowLinkFn(baseUrl, targetUrl);
            }
            return true;
          } catch {
            return false;
          }
        }) ?? [];

      return {
        url: rawContent.source,
        etag: rawContent.etag,
        lastModified: rawContent.lastModified,
        contentType: processed.contentType || rawContent.mimeType,
        content: processed,
        links: filteredLinks,
        status: FetchStatus.SUCCESS,
      };
    } catch (error) {
      // Log fetch errors or pipeline execution errors (if run throws)
      logger.error(`❌ Failed processing page ${url}: ${error}`);
      throw error;
    }
  }

  /**
   * Cleanup resources used by this strategy, specifically the pipeline browser instances and fetcher.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled([
      ...this.pipelines.map((pipeline) => pipeline.close()),
      this.fetcher.close(),
    ]);
  }
}
