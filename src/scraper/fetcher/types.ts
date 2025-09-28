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
