import path from "node:path";
import { URL } from "node:url";
import { CancellationError } from "../../pipeline/errors";
import type { ProgressCallback } from "../../types";
import { fileUrlToPathLoose } from "../../utils/accessPolicy";
import type { AppConfig } from "../../utils/config";
import { ScraperError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { normalizeUrl, type UrlNormalizerOptions } from "../../utils/url";
import { FetchStatus } from "../fetcher/types";
import type { PipelineResult } from "../pipelines/types";
import {
  PageOutcome,
  type QueueItem,
  type ScrapeResult,
  type ScraperOptions,
  type ScraperProgressEvent,
  type ScraperStrategy,
} from "../types";
import { isLlmsTxtUrl } from "../utils/llmsTxtParser";
import { shouldIncludeUrl } from "../utils/patternMatcher";
import { isInScope } from "../utils/scope";

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
  /** Where the content was retrieved from, when that differs from `url`. */
  contentUrl?: string;
  /** The title of the page or document, extracted during processing */
  title?: string | null;
  /** Original MIME type of the fetched resource, if known */
  sourceContentType?: string | null;
  /** MIME type of the stored content after pipeline processing, if known */
  contentType?: string | null;
  /** The ETag header value from the HTTP response, if available, used for caching and change detection. */
  etag?: string | null;
  /** The Last-Modified header value, if available, used for caching and change detection. */
  lastModified?: string | null;
  /** The pipeline-processed content, including title, text content, links, errors, and chunks. This may be null if the content was not successfully processed (e.g., 404 or 304). */
  content?: PipelineResult;
  /** Extracted links from the content. This may be an empty array if no links were found or if the content was not processed. */
  links?: string[];
  /** Fully formed queue items discovered outside normal link extraction. */
  queueItems?: QueueItem[];
  /** Internal-only allowlist roots to carry to discovered queue items. */
  internalAllowedFileRoots?: string[];
  /**
   * True when this item is a container rather than a page — a directory listing
   * or archive that yields links but is not itself indexable.
   *
   * Declared rather than inferred: a container must never be written to the
   * index as an empty page, and deducing that from a missing content type made
   * the rule depend on a field set for unrelated reasons.
   */
  isContainer?: boolean;
  /**
   * True when the pipeline raised errors while producing no content.
   *
   * Distinguishes "this page is empty" from "we failed to read this page", which
   * decides whether the response validator may be stored.
   */
  pipelineFailed?: boolean;
  /** Any non-critical errors encountered during processing. This may be an empty array if no errors were encountered or if the content was not processed. */
  status: FetchStatus;
}

class FailureThresholdExceededError extends ScraperError {}

export abstract class BaseScraperStrategy implements ScraperStrategy {
  private static readonly FAILURE_RATE_MIN_SAMPLE = 10;

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
  /** Items dequeued and given an outcome. Converges on {@link effectiveTotal}. */
  protected pageCount = 0;
  /** Processed items that produced stored content. Bounded by `maxPages`. */
  protected pagesIndexed = 0;
  protected totalDiscovered = 0; // URLs admitted to the queue (unlimited)
  /** URLs admitted to the queue, clamped at where the crawl will stop. */
  protected effectiveTotal = 0;
  protected canonicalBaseUrl?: URL; // Final URL after initial redirect (depth 0)
  protected completedChildPageAttempts = 0;
  protected failedChildPages = 0;

  /**
   * The point at which the crawl stops, expressed in processed items.
   *
   * `maxPages` bounds indexed pages, so reaching it takes `maxPages` successes
   * plus however many items produced nothing along the way. Clamping the
   * denominator flat at `maxPages` would put it below the numerator; this keeps
   * the two able to meet.
   *
   * @param options Scraper options supplying the effective page limit.
   * @returns The processed-item budget.
   */
  private processingBudget(options: ScraperOptions): number {
    const maxPages = options.maxPages ?? this.config.scraper.maxPages;
    // Items that produced nothing push the stopping point further out. Derived
    // rather than stored: every processed item is either indexed or it is not.
    return maxPages + (this.pageCount - this.pagesIndexed);
  }

  /**
   * Raises the denominator to match a budget that just grew.
   *
   * Called when an item produces no content, which pushes the stopping point one
   * item further out. Never lowers it: the queue may already hold more.
   *
   * @param options Scraper options supplying the effective page limit.
   */
  protected retuneEffectiveTotal(options: ScraperOptions): void {
    const capped = Math.min(this.totalDiscovered, this.processingBudget(options));
    if (capped > this.effectiveTotal) {
      this.effectiveTotal = capped;
    }
  }

  abstract canHandle(url: string): boolean;

  protected options: BaseScraperStrategyOptions;
  protected config: AppConfig;

  constructor(config: AppConfig, options: BaseScraperStrategyOptions = {}) {
    this.config = config;
    this.options = options;
  }

  /**
   * Resolves the URL a page is recorded under.
   *
   * The base implementation records the URL exactly as it resolved. Trimming a
   * trailing slash or an index file is an HTTP convention — it rests on a server
   * returning the same bytes either way — and that is false for the URL spaces
   * other strategies work in: `file:///docs/index.html` and a GitHub blob path
   * both name a file, and the trimmed form addresses nothing. Strategies whose
   * URLs follow web conventions override this.
   *
   * @param url The URL the content resolved to.
   * @param _scrapeOptions Options, used by overrides.
   * @returns The URL to record the page under.
   */
  protected canonicalizeStoredUrl(url: string, _scrapeOptions: ScraperOptions): string {
    return url;
  }

  protected getUrlNormalizerOptions(scrapeOptions: ScraperOptions): UrlNormalizerOptions {
    // Hash-routed sites opt out of the whole rewrite, not just of hash removal.
    // There the fragment names the route, so `/docs/#/guide` and `/docs#/guide`
    // are different pages and trimming the slash ahead of the fragment invents a
    // URL the site does not serve. Expressed here rather than at the call sites
    // so a page's identity and its dedup key cannot disagree.
    if (scrapeOptions.preserveHashes) {
      return {
        ...this.options.urlNormalizerOptions,
        removeHash: false,
        removeTrailingSlash: false,
        removeIndex: false,
      };
    }
    return {
      ...this.options.urlNormalizerOptions,
      removeHash: this.options.urlNormalizerOptions?.removeHash ?? true,
    };
  }

  /**
   * Determines if a URL should be processed based on scope and include/exclude patterns in ScraperOptions.
   * Scope is checked first, then patterns.
   *
   * `internalAllowedFileRoots` opts a queue item out of the protocol-strict
   * scope check: when a web URL has been accepted as an archive root and the
   * archive expands into `file://` members, those members are continuations of
   * the same accepted scrape and should not be rejected because they crossed
   * from `https:` to `file:`. The bypass is intentionally narrow — the
   * `file://` target must resolve inside one of the internal roots — so
   * arbitrary links injected into archive content cannot escape the archive
   * sandbox via this path. Downstream `resolveFileAccess` enforces the same
   * rule, but rejecting early here keeps unrelated `file://` URLs out of the
   * crawl queue entirely.
   */
  protected shouldProcessUrl(
    url: string,
    options: ScraperOptions,
    context: { internalAllowedFileRoots?: string[] } = {},
  ): boolean {
    if (isLlmsTxtUrl(url)) {
      return false;
    }

    const isInternalArchiveMember =
      url.startsWith("file://") &&
      isFileUrlInsideRoots(url, context.internalAllowedFileRoots);

    if (!isInternalArchiveMember) {
      const scope = options.scope ?? "subpages";
      try {
        const base = this.canonicalBaseUrl ?? new URL(options.url);
        const target = new URL(url);
        if (!isInScope(base, target, scope)) return false;
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

  private shouldCountTowardFailureThreshold(
    item: QueueItem,
    options: ScraperOptions,
    result?: ProcessItemResult,
  ): boolean {
    // An llms.txt index is a discovery hint, not a list of pages the user asked
    // for. Its dead entries must not push the scrape past the failure threshold
    // — that would abort the scrape by the back door, which is exactly what
    // treating those 404s as non-fatal is meant to prevent.
    if (item.fromLlmsTxt) {
      return false;
    }
    return !this.isRequestedRoot(item, options) && !this.isRefreshDeletion(item, result);
  }

  /**
   * True only for the URL the user actually requested.
   *
   * Identified by URL rather than `depth === 0`: llms.txt seeds are queued at
   * depth 0 so their own links get a fresh depth budget, and a refresh rebuilds
   * its queue from stored pages that carry neither the seed marker nor a
   * meaningful root depth.
   */
  protected isRequestedRoot(item: QueueItem, options: ScraperOptions): boolean {
    const normalizerOptions = this.getUrlNormalizerOptions(options);
    return (
      normalizeUrl(item.url, normalizerOptions) ===
      normalizeUrl(options.url, normalizerOptions)
    );
  }

  private isRefreshDeletion(item: QueueItem, result?: ProcessItemResult): boolean {
    return item.pageId !== undefined && result?.status === FetchStatus.NOT_FOUND;
  }

  private recordChildPageCompletion(
    item: QueueItem,
    options: ScraperOptions,
    result?: ProcessItemResult,
  ): void {
    if (!this.shouldCountTowardFailureThreshold(item, options, result)) {
      return;
    }

    this.completedChildPageAttempts++;
  }

  private recordChildPageFailure(item: QueueItem, options: ScraperOptions): void {
    if (!this.shouldCountTowardFailureThreshold(item, options)) {
      return;
    }

    this.completedChildPageAttempts++;
    this.failedChildPages++;
  }

  private ensureFailureRateWithinThreshold(): void {
    if (
      this.completedChildPageAttempts < BaseScraperStrategy.FAILURE_RATE_MIN_SAMPLE ||
      this.completedChildPageAttempts === 0
    ) {
      return;
    }

    const failureRate = this.failedChildPages / this.completedChildPageAttempts;
    const threshold = this.config.scraper.abortOnFailureRate;

    if (failureRate > threshold) {
      throw new FailureThresholdExceededError(
        `Scrape aborted after ${this.failedChildPages}/${this.completedChildPageAttempts} child pages failed (${failureRate.toFixed(2)} > ${threshold.toFixed(2)})`,
        false,
      );
    }
  }

  protected async processBatch(
    batch: QueueItem[],
    baseUrl: URL,
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal, // Add signal
  ): Promise<QueueItem[]> {
    let batchAbortError: FailureThresholdExceededError | null = null;

    const ensureFailureRateWithinThreshold = (): void => {
      try {
        this.ensureFailureRateWithinThreshold();
      } catch (error) {
        if (error instanceof FailureThresholdExceededError) {
          batchAbortError ??= error;
        }
        throw error;
      }
    };

    const throwIfBatchAborted = (): void => {
      if (batchAbortError) {
        throw batchAbortError;
      }
      if (signal?.aborted) {
        throw new CancellationError("Scraping cancelled during batch processing");
      }
    };

    const results = await Promise.all(
      batch.map(async (item) => {
        // Check signal before processing each item in the batch
        throwIfBatchAborted();
        // Resolved for the progress log and the enqueue-time depth filter below.
        // Items are no longer dropped here: every queued item reaches an outcome,
        // which is what lets the processed count converge on the queued total.
        const maxDepth = options.maxDepth ?? this.config.scraper.maxDepth;

        // Every dequeued item reaches exactly one outcome and advances the
        // processed count once, which is what makes it converge on the queued
        // total. Only `Stored` additionally advances the indexed count.
        //
        // Declared outside the try so the failure path reports through it too:
        // the counter protocol has one implementation, not two.
        const report = async (
          outcome: PageOutcome,
          extra: Partial<
            Pick<ScraperProgressEvent, "currentUrl" | "result" | "emptyPage" | "deleted">
          > = {},
        ): Promise<void> => {
          const pagesScraped = ++this.pageCount;
          if (outcome === PageOutcome.Stored) {
            this.pagesIndexed++;
          } else {
            this.retuneEffectiveTotal(options);
          }

          logger.info(
            `🌐 Scraping page ${pagesScraped}/${this.effectiveTotal} (depth ${item.depth}/${maxDepth}): ${item.url}`,
          );

          await progressCallback({
            pagesScraped,
            totalPages: this.effectiveTotal,
            totalDiscovered: this.totalDiscovered,
            pagesIndexed: this.pagesIndexed,
            currentUrl: item.url,
            depth: item.depth,
            maxDepth,
            outcome,
            result: null,
            pageId: item.pageId,
            ...extra,
          });
        };

        try {
          // Pass signal to processItem
          const result = await this.processItem(item, options, signal);
          throwIfBatchAborted();

          if (result.status === FetchStatus.NOT_MODIFIED) {
            // File/page hasn't changed, skip processing but count as processed
            logger.debug(`Page unchanged (304): ${item.url}`);
            await report(PageOutcome.Unchanged);
            this.recordChildPageCompletion(item, options, result);
            ensureFailureRateWithinThreshold();
            throwIfBatchAborted();
            return result.queueItems ?? [];
          }

          if (result.status === FetchStatus.NOT_FOUND) {
            const isRefreshDeletion = this.isRefreshDeletion(item, result);
            const fallbackQueueItems = result.queueItems ?? [];
            const hasNewFallbackQueueItem = fallbackQueueItems.some(
              (queueItem) =>
                !this.visited.has(
                  normalizeUrl(queueItem.url, this.getUrlNormalizerOptions(options)),
                ),
            );

            // Only the user's actual requested root should be fatal on 404 — an
            // llms.txt-seeded depth-0 item is just one of several discovery seeds
            // and a dead entry there shouldn't abort a scrape whose real root URL
            // resolved fine (see llmstxt-discovery spec: llms.txt link failures
            // are not supposed to fail the overall scrape).
            if (
              this.isRequestedRoot(item, options) &&
              !isRefreshDeletion &&
              !hasNewFallbackQueueItem
            ) {
              throw new ScraperError(`Root page not found: ${item.url}`, false);
            }

            if (!isRefreshDeletion) {
              this.recordChildPageFailure(item, options);
              ensureFailureRateWithinThreshold();
            }

            throwIfBatchAborted();

            // File/page was deleted, count as processed
            logger.debug(`Page deleted (404): ${item.url}`);
            await report(PageOutcome.Absent, isRefreshDeletion ? { deleted: true } : {});
            return fallbackQueueItems;
          }

          if (result.status === FetchStatus.SKIPPED) {
            // The resource was fetched but nothing can read its content type, so
            // the body was abandoned at the headers. This is neither a success nor
            // a failure: no page is stored, and the child-page failure rate is left
            // untouched so an asset-heavy site cannot trip abortOnFailureRate.
            // Only the user's actual requested root is fatal, matching the 404
            // branch above. An llms.txt seed is one of several discovery seeds,
            // and a refresh replays stored pages at their stored depth — neither
            // should abort a scrape whose real root resolved fine.
            if (item.depth === 0 && !item.fromLlmsTxt && item.pageId === undefined) {
              // Name the type: the user picked this URL, and "some content type"
              // does not tell them whether they mistyped it or asked for a format
              // this server cannot read.
              const contentType = result.sourceContentType ?? "unknown content type";
              throw new ScraperError(
                `Cannot process ${contentType} at ${item.url}: no pipeline can read it`,
                false,
              );
            }
            logger.debug(`Skipped (unprocessable content): ${item.url}`);
            await report(PageOutcome.Skipped);
            return result.queueItems ?? [];
          }

          if (result.status !== FetchStatus.SUCCESS) {
            // Unreachable while FetchStatus has only the four handled members, but
            // reporting here keeps "every dequeued item reaches exactly one
            // outcome" true by construction rather than by enumeration.
            logger.error(`❌ Unknown fetch status: ${result.status}`);
            await report(PageOutcome.Failed);
            return [];
          }

          // Handle successful processing - report result with content
          // Use the final URL from the result (which may differ due to redirects)
          //
          // Canonicalised so that spellings differing only by a trailing slash or
          // a fragment resolve to one page. Two routes to the same document —
          // `/config/` from a crawl and `/config.md` from an llms.txt index —
          // otherwise land as separate rows and split a page in two.
          const finalUrl = this.canonicalizeStoredUrl(result.url || item.url, options);

          // Register the resolved identity so the other route to this page is
          // recognised as already seen. The identity is only known after the
          // response, which is why it cannot be settled when the URL is queued.
          this.visited.add(normalizeUrl(finalUrl, this.getUrlNormalizerOptions(options)));

          // A result carrying no text is not a stored page. `WebScraperStrategy`
          // already gates on this, but the local-file and GitHub processors pass
          // their pipeline result through unconditionally, so an empty file would
          // otherwise report Stored, inflate the indexed count and consume the
          // page budget for a document the store then drops for having no chunks.
          const producedContent = !!result.content?.textContent?.trim();
          if (result.content && producedContent) {
            await report(PageOutcome.Stored, {
              currentUrl: finalUrl,
              result: {
                url: finalUrl,
                contentUrl: result.contentUrl,
                title: result.content.title?.trim() || result.title?.trim() || "",
                sourceContentType: result.sourceContentType || result.contentType || "",
                contentType: result.contentType || "",
                textContent: result.content.textContent || "",
                links: result.content.links || [],
                errors: result.content.errors || [],
                chunks: result.content.chunks || [],
                etag: result.etag || null,
                lastModified: result.lastModified || null,
              } satisfies ScrapeResult,
            });
            throwIfBatchAborted();
          } else {
            // Fetched successfully but produced nothing to store: a directory
            // listing, or a page whose pipeline extracted no text. Either way the
            // item was processed, so it is reported rather than advancing the
            // counter silently.
            // A container that yields links — a directory listing, an archive — is
            // processed and produces nothing, but it is not a page and must not be
            // recorded as one.
            const wasPage = result.isContainer !== true;
            await report(PageOutcome.Empty, {
              currentUrl: finalUrl,
              emptyPage: !wasPage
                ? undefined
                : {
                    url: finalUrl,
                    title: result.title?.trim() || "",
                    sourceContentType: result.sourceContentType ?? null,
                    contentType: result.contentType ?? null,
                    // Withheld when the pipeline errored: storing the validator against
                    // a failure we do not understand would make the next refresh answer
                    // 304 and never retry, turning a transient fault permanent.
                    etag: result.pipelineFailed ? null : (result.etag ?? null),
                    lastModified: result.pipelineFailed
                      ? null
                      : (result.lastModified ?? null),
                    pipelineFailed: result.pipelineFailed === true,
                  },
            });
            throwIfBatchAborted();
          }

          // Extract discovered links - use the final URL as the base for resolving relative links
          const nextItems = result.links || [];
          const linkBaseUrl = finalUrl ? new URL(finalUrl) : baseUrl;
          const internalAllowedFileRoots =
            result.internalAllowedFileRoots ?? item.internalAllowedFileRoots;

          this.recordChildPageCompletion(item, options, result);
          ensureFailureRateWithinThreshold();
          throwIfBatchAborted();

          // Depth is invariant across these links, so reject the whole set at
          // once rather than parsing each URL and discarding it.
          //
          // Rejecting here rather than at dequeue is what keeps the progress
          // denominator honest, and the rejection deliberately does NOT add the
          // URL to `visited`. The queue is breadth-first in a normal crawl, so a
          // URL is first offered at its minimum reachable depth and this cannot
          // lose anything — but refresh mode builds its initial queue in database
          // order, which is not sorted by depth, so the same URL can legitimately
          // be offered again at a shallower depth later. Consuming a dedup slot
          // here would discard it.
          const childDepth = item.depth + 1;
          const linkQueueItems = (childDepth > maxDepth ? [] : nextItems)
            .map((value) => {
              try {
                const targetUrl = new URL(value, linkBaseUrl);
                // Filter using shouldProcessUrl
                if (
                  !this.shouldProcessUrl(targetUrl.href, options, {
                    internalAllowedFileRoots,
                  })
                ) {
                  return null;
                }
                return {
                  url: targetUrl.href,
                  depth: childDepth,
                  ...(internalAllowedFileRoots ? { internalAllowedFileRoots } : {}),
                } satisfies QueueItem;
              } catch (_error) {
                // Invalid URL or path
                logger.warn(`❌ Invalid URL: ${value}`);
              }
              return null;
            })
            .filter((item): item is QueueItem => item !== null);

          return [...(result.queueItems ?? []), ...linkQueueItems];
        } catch (error) {
          if (
            error instanceof FailureThresholdExceededError ||
            error instanceof CancellationError
          ) {
            throw error;
          }

          // Never ignore errors for the root URL (depth 0) - if it fails, the job should fail
          // There's no point in "successfully" completing with 0 documents
          if (this.isRequestedRoot(item, options)) {
            throw error;
          }

          if (batchAbortError) {
            throw batchAbortError;
          }

          this.recordChildPageFailure(item, options);
          ensureFailureRateWithinThreshold();

          if (options.ignoreErrors) {
            logger.error(`❌ Failed to process ${item.url}: ${error}`);
            await report(PageOutcome.Failed);
            return [];
          }
          throw error;
        }
      }),
    );

    // After all concurrent processing is done, deduplicate the results
    const allLinks = results.flat().filter((item): item is QueueItem => item !== null);
    const uniqueLinks: QueueItem[] = [];

    // Now perform deduplication once, after all parallel processing is complete
    for (const item of allLinks) {
      const normalizedUrl = normalizeUrl(item.url, this.getUrlNormalizerOptions(options));
      if (!this.visited.has(normalizedUrl)) {
        this.visited.add(normalizedUrl);
        uniqueLinks.push(item);

        // Always increment the unlimited counter
        this.totalDiscovered++;

        // Clamp at the processed-item budget, not flat at maxPages, so the
        // denominator stays reachable when items produce no content.
        if (this.effectiveTotal < this.processingBudget(options)) {
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
    this.pagesIndexed = 0;
    this.completedChildPageAttempts = 0;
    this.failedChildPages = 0;

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
      this.getUrlNormalizerOptions(options),
    );

    if (isRefreshMode) {
      logger.debug(
        `Starting refresh mode with ${initialQueue.length} pre-populated pages`,
      );

      // Add all items from initialQueue, using visited set to deduplicate
      for (const item of initialQueue) {
        const normalizedUrl = normalizeUrl(
          item.url,
          this.getUrlNormalizerOptions(options),
        );
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

    // Resolve optional values to defaults using temporary config lookup
    // (We'll replace this with proper config merging later)
    const maxPages = options.maxPages ?? this.config.scraper.maxPages;
    const maxConcurrency = options.maxConcurrency ?? this.config.scraper.maxConcurrency;

    // Initialize counters from the populated queue. The denominator is clamped
    // here as well as on increment: a refresh whose initial queue exceeds the
    // page limit would otherwise start with a total the numerator can never
    // reach, which is the defect this capability exists to remove.
    this.totalDiscovered = queue.length;
    this.effectiveTotal = Math.min(queue.length, this.processingBudget(options));

    // Unified processing loop for both normal and refresh modes.
    // `maxPages` bounds pages that produce content, not items processed: asking
    // for 100 pages should yield 100 pages, not stop at 100 attempts of which
    // some produced nothing.
    while (queue.length > 0 && this.pagesIndexed < maxPages) {
      // Check for cancellation at the start of each loop iteration
      if (signal?.aborted) {
        logger.debug(`${isRefreshMode ? "Refresh" : "Scraping"} cancelled by signal.`);
        throw new CancellationError(
          `${isRefreshMode ? "Refresh" : "Scraping"} cancelled by signal`,
        );
      }

      const remainingPages = maxPages - this.pagesIndexed;
      if (remainingPages <= 0) {
        break;
      }

      // Bounding the batch by the remaining budget is what stops a concurrent
      // batch overshooting the limit: at most `remainingPages` items run, so at
      // most `remainingPages` of them can index.
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

/**
 * Returns true if `url` is a `file://` URL whose resolved filesystem path lies
 * inside one of the supplied internal roots. Used by the queue-time scope
 * bypass for archive-member URLs so that arbitrary `file://` links injected
 * into archive content cannot escape the archive sandbox.
 */
function isFileUrlInsideRoots(url: string, roots: string[] | undefined): boolean {
  if (!roots || roots.length === 0) return false;
  let target: string;
  try {
    target = path.resolve(fileUrlToPathLoose(url));
  } catch {
    return false;
  }
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    if (resolvedRoot === target) return true;
    const relative = path.relative(resolvedRoot, target);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}
