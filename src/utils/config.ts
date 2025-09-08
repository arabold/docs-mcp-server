/**
 * Default configuration values for the scraping pipeline and server
 */

/** Maximum number of pages to scrape in a single job */
export const DEFAULT_MAX_PAGES = 1000;

/** Maximum navigation depth when crawling links */
export const DEFAULT_MAX_DEPTH = 3;

/** Maximum number of concurrent page requests */
export const DEFAULT_MAX_CONCURRENCY = 3;

/** Default protocol for the MCP server */
export const DEFAULT_PROTOCOL = "auto";

/** Default port for the HTTP protocol */
export const DEFAULT_HTTP_PORT = 6280;

/** Default port for the Web UI */
export const DEFAULT_WEB_PORT = 6281;

/** Default host for server binding */
export const DEFAULT_HOST = "127.0.0.1";

/**
 * Default timeout in milliseconds for page operations (e.g., Playwright waitForSelector).
 */
export const DEFAULT_PAGE_TIMEOUT = 5000;

/**
 * Maximum number of retries for HTTP fetcher requests.
 */
export const FETCHER_MAX_RETRIES = 6;

/**
 * Base delay in milliseconds for HTTP fetcher retry backoff.
 */
export const FETCHER_BASE_DELAY = 1000;

/**
 * Default chunk size settings for splitters
 */
export const SPLITTER_MIN_CHUNK_SIZE = 500;
export const SPLITTER_PREFERRED_CHUNK_SIZE = 1500;
export const SPLITTER_MAX_CHUNK_SIZE = 5000;

/**
 * Maximum number of documents to process in a single batch for embeddings.
 */
export const EMBEDDING_BATCH_SIZE = 100;

/**
 * Maximum total character size for a single embedding batch request.
 * This prevents "413 Request entity too large" errors from embedding APIs.
 * Default is 50000 (~50KB), can be overridden with DOCS_MCP_EMBEDDING_BATCH_CHARS environment variable.
 */
export const EMBEDDING_BATCH_CHARS = 50000;

/**
 * Maximum number of retries for database migrations if busy.
 */
export const MIGRATION_MAX_RETRIES = 5;

/**
 * Delay in milliseconds between migration retry attempts.
 */
export const MIGRATION_RETRY_DELAY_MS = 300;
