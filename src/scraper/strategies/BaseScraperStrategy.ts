import { URL } from "node:url";
import { CancellationError } from "../../pipeline/errors";
import type { ProgressCallback } from "../../types";
import { DEFAULT_MAX_PAGES } from "../../utils/config";
import { logger } from "../../utils/logger";
import { normalizeUrl, type UrlNormalizerOptions } from "../../utils/url";
import { FetchStatus } from "../fetcher/types";
import type { PipelineResult } from "../pipelines/types";
import type {
  QueueItem,
  ScrapeResult,
  ScraperOptions,
  ScraperProgressEvent,
  ScraperStrategy,
} from "../types";
import { shouldIncludeUrl } from "../utils/patternMatcher";
import { isInScope } from "../utils/scope";

// Define defaults for optional options
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_CONCURRENCY = 3;

export interface BaseScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
}

/**
 * Result of processing a single queue item.
 * - processed: The processed content (when available)
 * - links: Discovered links for crawling (may exist without content, e.g., directories)
 * - status: The fetch status (SUCCESS, NOT_MODIFIED, NOT_FOUND)
 */
export interface ProcessItemResult {
  /** The URL of the content */
  url: string;
  /** The title of the page or document, extracted during processing */
  title?: string | null;
  /** The MIME type of the content being processed, if known */
  contentType?: string | null;
  /** The ETag header value from the HTTP response, if available, used for caching and change detection. */
  etag?: string | null;
  /** The Last-Modified header value, if available, used for caching and change detection. */
  lastModified?: string | null;
  /** The pipeline-processed content, including title, text content, links, errors, and chunks. This may be null if the content was not successfully processed (e.g., 404 or 304). */
  content?: PipelineResult;
  /** Extracted links from the content. This may be an empty array if no links were found or if the content was not processed. */
  links?: string[];
  /** Any non-critical errors encountered during processing. This may be an empty array if no errors were encountered or if the content was not processed. */
  status: FetchStatus;
}

export abstract class BaseScraperStrategy implements ScraperStrategy {
  /**
   * Set of normalized URLs that have been marked for processing.
   *
   * IMPORTANT: URLs are added to this set BEFORE they are actually processed, not after.
   * This prevents the same URL from being queued multiple times when discovered from different sources.
   *
   * Usage flow:
   * 1. Initial queue setup: Root URL and initialQueue items are added to visited
   * 2. During processing: When a page returns links, each link is checked against visited
   * 3. In processBatch deduplication: Only links NOT in visited are added to the queue AND to visited
   *
   * This approach ensures:
   * - No URL is processed more than once
   * - No URL appears in the queue multiple times
   * - Efficient deduplication across concurrent processing
   */
  protected visited = new Set<string>();
  protected pageCount = 0;
  protected totalDiscovered = 0; // Track total URLs discovered (unlimited)
  protected effectiveTotal = 0; // Track effective total (limited by maxPages)
  protected canonicalBaseUrl?: URL; // Final URL after initial redirect (depth 0)

  abstract canHandle(url: string): boolean;

  protected options: BaseScraperStrategyOptions;

  constructor(options: BaseScraperStrategyOptions = {}) {
    this.options = options;
  }

  /**
   * Determines if a URL should be processed based on scope and include/exclude patterns in ScraperOptions.
   * Scope is checked first, then patterns.
   */
  protected shouldProcessUrl(url: string, options: ScraperOptions): boolean {
    if (options.scope) {
      try {
        const base = this.canonicalBaseUrl ?? new URL(options.url);
        const target = new URL(url);
        if (!isInScope(base, target, options.scope)) return false;
      } catch {
        return false;
      }
    }
    return shouldIncludeUrl(url, options.includePatterns, options.excludePatterns);
  }

  /**
   * Process a single item from the queue.
   *
   * @returns Processed content, links, and metadata
   */
  protected abstract processItem(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult>;

  protected async processBatch(
    batch: QueueItem[],
    baseUrl: URL,
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal, // Add signal
  ): Promise<QueueItem[]> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const results = await Promise.all(
      batch.map(async (item) => {
        // Check signal before processing each item in the batch
        if (signal?.aborted) {
          throw new CancellationError("Scraping cancelled during batch processing");
        }
        // Resolve default for maxDepth check
        const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
        if (item.depth > maxDepth) {
          return [];
        }

        try {
          // Pass signal to processItem
          const result = await this.processItem(item, options, signal);

          // Only count items that represent tracked pages or have actual content
          // - Refresh operations (have pageId): Always count (they're tracked in DB)
          // - New files with content: Count (they're being indexed)
          // - Directory discovery (no pageId, no content): Don't count
          const shouldCount = item.pageId !== undefined || result.content !== undefined;

          let currentPageCount = this.pageCount;
          if (shouldCount) {
            currentPageCount = ++this.pageCount;

            // Log progress for all counted items
            logger.info(
              `🌐 Scraping page ${currentPageCount}/${this.effectiveTotal} (depth ${item.depth}/${maxDepth}): ${item.url}`,
            );
          }

          if (result.status === FetchStatus.NOT_MODIFIED) {
            // File/page hasn't changed, skip processing but count as processed
            logger.debug(`Page unchanged (304): ${item.url}`);
            if (shouldCount) {
              await progressCallback({
                pagesScraped: currentPageCount,
                totalPages: this.effectiveTotal,
                totalDiscovered: this.totalDiscovered,
                currentUrl: item.url,
                depth: item.depth,
                maxDepth: maxDepth,
                result: null,
                pageId: item.pageId,
              });
            }
            return [];
          }

          if (result.status === FetchStatus.NOT_FOUND) {
            // File/page was deleted, count as processed
            logger.debug(`Page deleted (404): ${item.url}`);
            if (shouldCount) {
              await progressCallback({
                pagesScraped: currentPageCount,
                totalPages: this.effectiveTotal,
                totalDiscovered: this.totalDiscovered,
                currentUrl: item.url,
                depth: item.depth,
                maxDepth: maxDepth,
                result: null,
                pageId: item.pageId,
                deleted: true,
              });
            }
            return [];
          }

          if (result.status !== FetchStatus.SUCCESS) {
            logger.error(`Unknown fetch status: ${result.status}`);
            return [];
          }

          // Handle successful processing - report result with content
          // Use the final URL from the result (which may differ due to redirects)
          const finalUrl = result.url || item.url;

          if (result.content) {
            await progressCallback({
              pagesScraped: currentPageCount,
              totalPages: this.effectiveTotal,
              totalDiscovered: this.totalDiscovered,
              currentUrl: finalUrl,
              depth: item.depth,
              maxDepth: maxDepth,
              result: {
                url: finalUrl,
                title: result.content.title?.trim() || result.title?.trim() || "",
                contentType: result.contentType || "",
                textContent: result.content.textContent || "",
                links: result.content.links || [],
                errors: result.content.errors || [],
                chunks: result.content.chunks || [],
                etag: result.etag || null,
                lastModified: result.lastModified || null,
              } satisfies ScrapeResult,
              pageId: item.pageId,
            });
          }

          // Extract discovered links - use the final URL as the base for resolving relative links
          const nextItems = result.links || [];
          const linkBaseUrl = finalUrl ? new URL(finalUrl) : baseUrl;

          return nextItems
            .map((value) => {
              try {
                const targetUrl = new URL(value, linkBaseUrl);
                // Filter using shouldProcessUrl
                if (!this.shouldProcessUrl(targetUrl.href, options)) {
                  return null;
                }
                return {
                  url: targetUrl.href,
                  depth: item.depth + 1,
                } satisfies QueueItem;
              } catch (_error) {
                // Invalid URL or path
                logger.warn(`❌ Invalid URL: ${value}`);
              }
              return null;
            })
            .filter((item) => item !== null);
        } catch (error) {
          if (options.ignoreErrors) {
            logger.error(`❌ Failed to process ${item.url}: ${error}`);
            return [];
          }
          throw error;
        }
      }),
    );

    // After all concurrent processing is done, deduplicate the results
    const allLinks = results.flat();
    const uniqueLinks: QueueItem[] = [];

    // Now perform deduplication once, after all parallel processing is complete
    for (const item of allLinks) {
      const normalizedUrl = normalizeUrl(item.url, this.options.urlNormalizerOptions);
      if (!this.visited.has(normalizedUrl)) {
        this.visited.add(normalizedUrl);
        uniqueLinks.push(item);

        // Always increment the unlimited counter
        this.totalDiscovered++;

        // Only increment effective total if we haven't exceeded maxPages
        if (this.effectiveTotal < maxPages) {
          this.effectiveTotal++;
        }
      }
    }

    return uniqueLinks;
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal, // Add signal
  ): Promise<void> {
    this.visited.clear();
    this.pageCount = 0;

    // Check if this is a refresh operation with pre-populated queue
    const initialQueue = options.initialQueue || [];
    const isRefreshMode = initialQueue.length > 0;

    // Set up base URL and queue
    this.canonicalBaseUrl = new URL(options.url);
    let baseUrl = this.canonicalBaseUrl;

    // Initialize queue: Start with root URL or use items from initialQueue (refresh mode)
    // The root URL is always processed (depth 0), but if it's in initialQueue, use that
    // version to preserve etag/pageId for conditional fetching
    const queue: QueueItem[] = [];
    const normalizedRootUrl = normalizeUrl(
      options.url,
      this.options.urlNormalizerOptions,
    );

    if (isRefreshMode) {
      logger.debug(
        `Starting refresh mode with ${initialQueue.length} pre-populated pages`,
      );

      // Add all items from initialQueue, using visited set to deduplicate
      for (const item of initialQueue) {
        const normalizedUrl = normalizeUrl(item.url, this.options.urlNormalizerOptions);
        if (!this.visited.has(normalizedUrl)) {
          this.visited.add(normalizedUrl);
          queue.push(item);
        }
      }
    }

    // If root URL wasn't in initialQueue, add it now at depth 0
    if (!this.visited.has(normalizedRootUrl)) {
      this.visited.add(normalizedRootUrl);
      queue.unshift({ url: options.url, depth: 0 } satisfies QueueItem);
    }

    // Initialize counters based on actual queue length after population
    this.totalDiscovered = queue.length;
    this.effectiveTotal = queue.length;

    // Resolve optional values to defaults using temporary variables
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const maxConcurrency = options.maxConcurrency ?? DEFAULT_CONCURRENCY;

    // Unified processing loop for both normal and refresh modes
    while (queue.length > 0 && this.pageCount < maxPages) {
      // Check for cancellation at the start of each loop iteration
      if (signal?.aborted) {
        logger.debug(`${isRefreshMode ? "Refresh" : "Scraping"} cancelled by signal.`);
        throw new CancellationError(
          `${isRefreshMode ? "Refresh" : "Scraping"} cancelled by signal`,
        );
      }

      const remainingPages = maxPages - this.pageCount;
      if (remainingPages <= 0) {
        break;
      }

      const batchSize = Math.min(maxConcurrency, remainingPages, queue.length);
      const batch = queue.splice(0, batchSize);

      // Always use latest canonical base (may have been updated after first fetch)
      baseUrl = this.canonicalBaseUrl ?? baseUrl;
      const newUrls = await this.processBatch(
        batch,
        baseUrl,
        options,
        progressCallback,
        signal,
      );

      queue.push(...newUrls);
    }
  }

  /**
   * Cleanup resources used by this strategy.
   * Default implementation does nothing - override in derived classes as needed.
   */
  async cleanup(): Promise<void> {
    // No-op by default
  }
}
