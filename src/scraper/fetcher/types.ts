/**
 * Semantic status of a fetch operation, abstracting HTTP status codes
 * into meaningful states for content processing.
 */
export enum FetchStatus {
  /**
   * Content was successfully fetched (HTTP 200 or new file).
   * The content field will contain the fetched data.
   */
  SUCCESS = "success",

  /**
   * Content has not been modified since the last fetch (HTTP 304).
   * The content field will be empty. Occurs when etag is provided
   * in FetchOptions and matches the server's current ETag.
   */
  NOT_MODIFIED = "not_modified",

  /**
   * The resource was not found (HTTP 404 or file doesn't exist).
   * The content field will be empty. In refresh operations,
   * this indicates the page should be removed from the index.
   */
  NOT_FOUND = "not_found",
}

/**
 * Raw content fetched from a source before processing.
 * Includes metadata about the content for proper processing.
 */
export interface RawContent {
  /** Raw content as string or buffer */
  content: string | Buffer;
  /**
   * MIME type of the content (e.g., "text/html", "application/json").
   * Does not include parameters like charset.
   */
  mimeType: string;
  /**
   * Character set of the content (e.g., "utf-8"), extracted from Content-Type header.
   */
  charset?: string;
  /**
   * Content encoding (e.g., "gzip", "deflate"), from Content-Encoding header.
   */
  encoding?: string;
  /** Original source location */
  source: string;
  /**
   * ETag value for caching purposes.
   * For HTTP sources, this comes from the ETag header.
   * For local files, this is a hash of the last modified date.
   */
  etag?: string;
  /**
   * Last modified timestamp in ISO8601 format.
   * For HTTP sources, this comes from the Last-Modified header.
   * For local files, this is the file modification time.
   */
  lastModified?: string;
  /**
   * Semantic status of the fetch operation.
   * Abstracts HTTP status codes into meaningful states:
   * - SUCCESS: Content was fetched successfully
   * - NOT_MODIFIED: Content unchanged since last fetch (conditional request)
   * - NOT_FOUND: Resource doesn't exist (should be removed from index)
   */
  status: FetchStatus;
}

/**
 * Options for configuring content fetching behavior
 */
export interface FetchOptions {
  /** Maximum retry attempts for failed fetches */
  maxRetries?: number;
  /** Base delay between retries in milliseconds */
  retryDelay?: number;
  /** Additional headers for HTTP requests */
  headers?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Whether to follow HTTP redirects (3xx responses) */
  followRedirects?: boolean;
  /**
   * ETag value for conditional requests.
   * When provided, the fetcher will include an If-None-Match header
   * and may return a 304 Not Modified response if content hasn't changed.
   */
  etag?: string | null;
}

/**
 * Interface for fetching content from different sources
 */
export interface ContentFetcher {
  /**
   * Check if this fetcher can handle the given source
   */
  canFetch(source: string): boolean;

  /**
   * Fetch content from the source
   */
  fetch(source: string, options?: FetchOptions): Promise<RawContent>;
}
