/**
 * Web scraper strategy that normalizes URLs, fetches content with automatic
 * fetcher selection, and routes content through pipelines. Requires resolved
 * configuration from the entrypoint to avoid implicit config loading.
 */
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import type { UrlNormalizerOptions } from "../../utils/url";
import { AutoDetectFetcher } from "../fetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem, ScraperOptions } from "../types";
import { BaseScraperStrategy, type ProcessItemResult } from "./BaseScraperStrategy";
import { LocalFileStrategy } from "./LocalFileStrategy";

export interface WebScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
  shouldFollowLink?: (baseUrl: URL, targetUrl: URL) => boolean;
}

export class WebScraperStrategy extends BaseScraperStrategy {
  private readonly fetcher: AutoDetectFetcher;
  private readonly shouldFollowLinkFn?: (baseUrl: URL, targetUrl: URL) => boolean;
  private readonly pipelines: ContentPipeline[];
  private readonly localFileStrategy: LocalFileStrategy;
  private tempFiles: string[] = [];

  constructor(config: AppConfig, options: WebScraperStrategyOptions = {}) {
    super(config, { urlNormalizerOptions: options.urlNormalizerOptions });
    this.shouldFollowLinkFn = options.shouldFollowLink;
    this.fetcher = new AutoDetectFetcher(config.scraper);
    this.pipelines = PipelineFactory.createStandardPipelines(config);
    this.localFileStrategy = new LocalFileStrategy(config);
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

      // Check for Archive Root URL (only if depth 0)
      if (item.depth === 0) {
        const isArchive = /\.(zip|tar|gz|tgz)$/i.test(new URL(url).pathname);
        if (isArchive) {
          return this.processRootArchive(item, options, signal);
        }
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
        // If content type is unsupported (e.g. binary/archive encountered during crawl), we just skip
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

            // Check for archive links during crawl - ignore them
            if (/\.(zip|tar|gz|tgz)$/i.test(targetUrl.pathname)) {
              return false;
            }

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

  private async processRootArchive(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    logger.info(`📦 Downloading root archive: ${item.url}`);

    // We need to stream the download to a temp file
    // Since fetcher.fetch returns a buffer (usually), we might want to bypass it or use it if small enough?
    // But archives can be huge. fetcher.fetch currently loads into memory.
    // For now, let's assume we can use fetcher but warn about memory, OR implement stream download here.
    // Our fetcher abstraction returns RawContent with Buffer.
    // If we want to stream, we might need to access the underlying axios/fetch stream.
    // `AutoDetectFetcher` doesn't expose stream easily.
    // Ideally we refactor fetcher to support streams, but that's out of scope.
    // So we will use fetcher and write buffer to temp file.
    // LIMITATION: Large archives will hit memory limits.

    const rawContent = await this.fetcher.fetch(item.url, {
      signal,
      headers: options.headers,
    });

    if (rawContent.status !== FetchStatus.SUCCESS) {
      return { url: rawContent.source, links: [], status: rawContent.status };
    }

    const buffer = Buffer.isBuffer(rawContent.content)
      ? rawContent.content
      : Buffer.from(rawContent.content);

    const tempDir = os.tmpdir();
    const tempFile = path.join(
      tempDir,
      `scraper-${Date.now()}-${path.basename(new URL(item.url).pathname)}`,
    );

    // Track file immediately so we can clean it up if write fails or later
    this.tempFiles.push(tempFile);

    await fsPromises.writeFile(tempFile, buffer);

    // Delegate to LocalFileStrategy
    const localUrl = `file://${tempFile}`;
    const localItem = { ...item, url: localUrl };

    const result = await this.localFileStrategy.processItem(localItem, options, signal);

    // We need to fix up the links to point back to something meaningful?
    // If we process a zip, we get file:///tmp/.../file.txt
    // These links are only useful if we continue to treat them as local files for this session.
    // But `WebScraper` expects http links usually?
    // Actually, if we return file:// links, the queue might try to fetch them.
    // `WebScraperStrategy` handles http/https. `LocalFileStrategy` handles file://.
    // If we return file:// links, the scraper will need to route them to `LocalFileStrategy`.
    // The `ScraperService` uses `ScraperRegistry` to pick strategy.
    // So file:// links will work!

    return {
      ...result,
      url: item.url, // Keep original URL as the source of this item
      // links are file://...
    };
  }

  /**
   * Cleanup resources used by this strategy, specifically the pipeline browser instances and fetcher.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled([
      ...this.pipelines.map((pipeline) => pipeline.close()),
      this.localFileStrategy.cleanup(),
      this.fetcher.close(),
      ...this.tempFiles.map((file) => fsPromises.unlink(file).catch(() => {})),
    ]);
  }
}
