import { URL } from "node:url";
import { CancellationError } from "../../pipeline/errors";
import type { Document, ProgressCallback } from "../../types";
import { logger } from "../../utils/logger";
import { type UrlNormalizerOptions, normalizeUrl } from "../../utils/url";
import type { ScraperOptions, ScraperProgress, ScraperStrategy } from "../types";

// Define defaults for optional options
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_CONCURRENCY = 3;

export type QueueItem = {
  url: string;
  depth: number;
};

export interface BaseScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
}

export abstract class BaseScraperStrategy implements ScraperStrategy {
  protected visited = new Set<string>();
  protected pageCount = 0;

  abstract canHandle(url: string): boolean;

  protected options: BaseScraperStrategyOptions;

  constructor(options: BaseScraperStrategyOptions = {}) {
    this.options = options;
  }

  /**
   * Process a single item from the queue.
   *
   * @returns A list of URLs to add to the queue
   */
  protected abstract processItem(
    item: QueueItem,
    options: ScraperOptions,
    progressCallback?: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal, // Add signal
  ): Promise<{
    document?: Document;
    links?: string[];
  }>;

  // Removed getProcessor method as processing is now handled by strategies using middleware pipelines

  protected async processBatch(
    batch: QueueItem[],
    baseUrl: URL,
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal, // Add signal
  ): Promise<QueueItem[]> {
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
          const result = await this.processItem(item, options, undefined, signal);

          if (result.document) {
            this.pageCount++;
            // Resolve defaults for logging and progress callback
            const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
            // maxDepth already resolved above
            logger.info(
              `🌐 Scraping page ${this.pageCount}/${maxPages} (depth ${item.depth}/${maxDepth}): ${item.url}`,
            );
            await progressCallback({
              pagesScraped: this.pageCount,
              maxPages: maxPages,
              currentUrl: item.url,
              depth: item.depth,
              maxDepth: maxDepth,
              document: result.document,
            });
          }

          const nextItems = result.links || [];
          return nextItems
            .map((value) => {
              try {
                const targetUrl = new URL(value, baseUrl);
                return {
                  url: targetUrl.href,
                  depth: item.depth + 1,
                } satisfies QueueItem;
              } catch (error) {
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
      }
    }

    return uniqueLinks;
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgress>,
    signal?: AbortSignal, // Add signal
  ): Promise<void> {
    this.visited.clear();
    this.pageCount = 0;

    const baseUrl = new URL(options.url);
    const queue = [{ url: options.url, depth: 0 } satisfies QueueItem];

    // Track values we've seen (either queued or visited)
    this.visited.add(normalizeUrl(options.url, this.options.urlNormalizerOptions));

    // Resolve optional values to defaults using temporary variables
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const maxConcurrency = options.maxConcurrency ?? DEFAULT_CONCURRENCY;

    while (queue.length > 0 && this.pageCount < maxPages) {
      // Use variable
      // Check for cancellation at the start of each loop iteration
      if (signal?.aborted) {
        logger.info("Scraping cancelled by signal.");
        throw new CancellationError("Scraping cancelled by signal");
      }

      const remainingPages = maxPages - this.pageCount; // Use variable
      if (remainingPages <= 0) {
        break;
      }

      const batchSize = Math.min(
        maxConcurrency, // Use variable
        remainingPages,
        queue.length,
      );

      const batch = queue.splice(0, batchSize);
      // Pass signal to processBatch
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
}
