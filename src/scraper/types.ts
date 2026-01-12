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
}

/**
 * Result of scraping a single page.
 */
export interface ScrapeResult {
  /** The URL of the page that was scraped */
  url: string;
  /** Page title */
  title: string;
  /** MIME type of the content being processed */
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
 * Progress information during scraping
 */
export interface ScraperProgressEvent {
  /** Number of pages successfully scraped so far */
  pagesScraped: number;
  /**
   * Maximum number of pages to scrape (from maxPages option).
   * May be undefined if no limit is set.
   */
  totalPages: number;
  /**
   * Total number of URLs discovered during crawling.
   * This may be higher than totalPages if maxPages limit is reached.
   */
  totalDiscovered: number;
  /** Current URL being processed */
  currentUrl: string;
  /** Current depth in the crawl tree */
  depth: number;
  /** Maximum depth allowed (from maxDepth option) */
  maxDepth: number;
  /** The result of scraping the current page, if available. This may be null if the page has been deleted or if an error occurred. */
  result: ScrapeResult | null;
  /** Database page ID (for refresh operations or tracking) */
  pageId?: number;
  /** Indicates this page was deleted (404 during refresh or broken link) */
  deleted?: boolean;
}
