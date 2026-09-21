import type { Chunk } from "../splitter/types";
import type { ProgressCallback } from "../types";

/**
 * Represents an item in the scraping queue
 */
export type QueueItem = {
  url: string;
  depth: number;
  pageId?: number; // Database page ID for efficient deletion during refresh
  etag?: string | null; // Last known ETag for conditional requests during refresh
  /** True when the queue item was seeded from a discovered llms.txt file. */
  fromLlmsTxt?: boolean;
  /** Internal-only allowlist roots for application-managed temporary files. */
  internalAllowedFileRoots?: string[];
};

/**
 * Enum defining the available HTML processing strategies.
 */
export enum ScrapeMode {
  Fetch = "fetch",
  Playwright = "playwright",
  Auto = "auto",
}

/**
 * Strategy interface for implementing different scraping behaviors
 */
export interface ScraperStrategy {
  canHandle(url: string): boolean;
  scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal, // Add optional signal
  ): Promise<void>;

  /**
   * Cleanup resources used by this strategy (e.g., pipeline browser instances).
   * Should be called when the strategy is no longer needed.
   */
  cleanup?(): Promise<void>;
}

/**
 * Internal runtime options for configuring the scraping process.
 *
 * This is the comprehensive configuration object used by ScraperService, PipelineWorker,
 * and scraper strategies. It includes both:
 * - User-facing options (provided via tools like scrape_docs)
 * - System-managed options (set internally by PipelineManager)
 *
 * Note: User-facing tools should NOT expose all these options directly. Instead,
 * PipelineManager is responsible for translating user input into this complete
 * runtime configuration.
 */
export interface ScraperOptions {
  url: string;
  library: string;
  version: string;
  maxPages?: number;
  maxDepth?: number;
  /**
   * Defines the allowed crawling boundary relative to the starting URL
   * - 'subpages': Only crawl URLs on the same hostname and within the same starting path (default)
   * - 'hostname': Crawl any URL on the same exact hostname, regardless of path
   * - 'domain': Crawl any URL on the same top-level domain, including subdomains
   */
  scope?: "subpages" | "hostname" | "domain";
  /**
   * Controls whether HTTP redirects (3xx responses) should be followed
   * - When true: Redirects are followed automatically (default)
   * - When false: A RedirectError is thrown when a 3xx response is received
   */
  followRedirects?: boolean;
  maxConcurrency?: number;
  ignoreErrors?: boolean;
  /** Preserve URL hash fragments for hash-routed SPAs instead of treating them as anchors. */
  preserveHashes?: boolean;
  /** CSS selectors for elements to exclude during HTML processing */
  excludeSelectors?: string[];
  /**
   * Determines the HTML processing strategy.
   * - 'fetch': Use a simple DOM parser (faster, less JS support).
   * - 'playwright': Use a headless browser (slower, full JS support).
   * - 'auto': Automatically select the best strategy (currently defaults to 'playwright').
   * @default ScrapeMode.Auto
   */
  scrapeMode?: ScrapeMode;
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal;
  /**
   * Patterns for including URLs during scraping. If not set, all are included by default.
   */
  includePatterns?: string[];
  /**
   * Patterns for excluding URLs during scraping. Exclude takes precedence over include.
   */
  excludePatterns?: string[];
  /**
   * Custom HTTP headers to send with each HTTP request (e.g., for authentication).
   * Keys are header names, values are header values.
   */
  headers?: Record<string, string>;
  /**
   * Pre-populated queue of pages to visit.
   * When provided:
   * - Disables link discovery and crawling
   * - Processes only the provided URLs
   * - Uses provided metadata (pageId, etag) for optimization
   */
  initialQueue?: QueueItem[];
  /**
   * Indicates whether this is a refresh operation (re-indexing existing version).
   * When true:
   * - Skips initial removeAllDocuments call to preserve existing data
   * - Uses ETags for conditional requests
   * - Only updates changed/deleted pages
   * @default false
   */
  isRefresh?: boolean;
  /**
   * If true, clears existing documents for the library version before scraping.
   * If false, appends to the existing documents.
   * @default true
   */
  clean?: boolean;
  /**
   * Internal-only allowlist roots for application-managed temporary files.
   */
  internalAllowedFileRoots?: string[];
}

/**
 * Result of scraping a single page.
 */
export interface ScrapeResult {
  /** The URL of the page that was scraped */
  url: string;
  /**
   * Where the content was actually retrieved from, when that differs from `url`.
   *
   * `url` is the page's identity; this is the location that served its bytes. They
   * diverge when a representation lives elsewhere — a published Markdown file
   * recorded under the page it represents. Undefined means the two coincide.
   */
  contentUrl?: string;
  /** Page title */
  title: string;
  /** Original MIME type of the fetched resource before pipeline processing */
  sourceContentType: string;
  /** MIME type of the stored content after pipeline processing */
  contentType: string;
  /** The final processed content, typically as a string (e.g., Markdown). Used primarily for debugging */
  textContent: string;
  /** Extracted links from the content. */
  links: string[];
  /** Any non-critical errors encountered during processing. */
  errors: Error[];
  /** Pre-split chunks from pipeline processing */
  chunks: Chunk[];
  /** ETag from HTTP response for caching */
  etag?: string | null;
  /** Last-Modified from HTTP response for caching */
  lastModified?: string | null;
}

/**
 * What happened to a single queued item once it was processed.
 *
 * Named explicitly rather than inferred from `result` being null, because a null
 * result cannot distinguish a page that is unchanged from one that is now empty:
 * a 304 says "keep what you have", an empty 200 says "here it is, and it is
 * empty". Those call for opposite handling.
 */
export enum PageOutcome {
  /** Content was produced and should be stored. The only outcome that indexes. */
  Stored = "stored",
  /** The resource was unchanged since the last fetch (304). Keep what is stored. */
  Unchanged = "unchanged",
  /** The resource is gone (404). During a refresh the stored page is deleted. */
  Absent = "absent",
  /** Fetched successfully but yielded no content. The page exists and is empty. */
  Empty = "empty",
  /** No pipeline can read this content type, so the body was never downloaded. */
  Skipped = "skipped",
  /** Processing failed and the error was ignored under `ignoreErrors`. */
  Failed = "failed",
}

/**
 * Progress information during scraping.
 *
 * Counter semantics are defined by the `scrape-progress-reporting` capability.
 * In short: `pagesScraped` counts work done, `pagesIndexed` counts what came of
 * it, and `totalPages` is what `pagesScraped` converges on.
 */
export interface ScraperProgressEvent {
  /**
   * Queued items that have been dequeued and reached an outcome, whatever that
   * outcome was. The numerator of the progress fraction. Every queued item
   * eventually advances this exactly once, so it converges on `totalPages`.
   */
  pagesScraped: number;
  /**
   * Items the job expects to process: URLs admitted to the queue, clamped at the
   * point the crawl will stop, which is `maxPages` plus the number of processed
   * items that produced no content.
   *
   * This is NOT the configured `maxPages` value.
   */
  totalPages: number;
  /**
   * Total number of URLs admitted to the crawl queue, unbounded by `maxPages`.
   * Exceeds `totalPages` only when the page limit clamps the crawl.
   */
  totalDiscovered: number;
  /**
   * Processed items that produced stored content — the number a user means by
   * "pages added". Bounded by `maxPages`. Not part of the progress fraction.
   */
  pagesIndexed: number;
  /** Current URL being processed */
  currentUrl: string;
  /** Current depth in the crawl tree */
  depth: number;
  /** Maximum depth allowed (from maxDepth option) */
  maxDepth: number;
  /** What happened to this item. Consumers branch on this, not on `result`. */
  outcome: PageOutcome;
  /** The processed content. Non-null only when `outcome` is `Stored`. */
  result: ScrapeResult | null;
  /**
   * Page identity for an `Empty` outcome, so the store can record that the page
   * exists and holds nothing. `etag` and `lastModified` are null when the
   * pipeline failed, which keeps the next refresh unconditional.
   */
  emptyPage?: {
    url: string;
    /** Where the content was retrieved from, when that differs from `url`. */
    contentUrl?: string;
    title: string;
    sourceContentType: string | null;
    contentType: string | null;
    etag: string | null;
    lastModified: string | null;
    pipelineFailed: boolean;
  };
  /** Database page ID (for refresh operations or tracking) */
  pageId?: number;
  /** Indicates this page was deleted (404 during refresh or broken link) */
  deleted?: boolean;
}
