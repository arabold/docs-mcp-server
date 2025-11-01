import { logger } from "../../utils/logger";
import type { UrlNormalizerOptions } from "../../utils/url";
import { AutoDetectFetcher } from "../fetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem, ScraperOptions } from "../types";
import { isInScope } from "../utils/scope";
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
      // Define fetch options, passing signal, followRedirects, headers, and etag
      const fetchOptions = {
        signal,
        followRedirects: options.followRedirects,
        headers: options.headers, // Forward custom headers
        etag: item.etag, // Pass ETag for conditional requests
      };

      // Use AutoDetectFetcher which handles fallbacks automatically
      const rawContent: RawContent = await this.fetcher.fetch(url, fetchOptions);

      // Return the status directly - BaseScraperStrategy handles NOT_MODIFIED and NOT_FOUND
      if (rawContent.status !== FetchStatus.SUCCESS) {
        return { url, links: [], status: rawContent.status };
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
        return { url, links: [], status: FetchStatus.SUCCESS };
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
          url,
          links: processed.links,
          status: FetchStatus.SUCCESS,
        };
      }

      // Determine base for scope filtering:
      // For depth 0 (initial page) use the final fetched URL (rawContent.source) so protocol/host redirects don't drop links.
      // For deeper pages, use canonicalBaseUrl (set after first page) or fallback to original.
      const baseUrl =
        item.depth === 0
          ? new URL(rawContent.source)
          : (this.canonicalBaseUrl ?? new URL(options.url));

      const filteredLinks =
        processed.links?.filter((link) => {
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
        }) ?? [];

      return {
        url,
        etag: rawContent.etag,
        lastModified: rawContent.lastModified,
        contentType: rawContent.mimeType,
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
