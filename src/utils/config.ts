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
 * Maximum number of cached items in the HTTP fetcher.
 */
export const FETCHER_MAX_CACHE_ITEMS = 200; // 200 items

/**
 * Maximum size in bytes for individual cached responses in the HTTP fetcher.
 */
export const FETCHER_MAX_CACHE_ITEM_SIZE_BYTES = 500 * 1024; // 500 KB

/**
 * Default chunk size settings for splitters
 */
export const SPLITTER_MIN_CHUNK_SIZE = 500;
export const SPLITTER_PREFERRED_CHUNK_SIZE = 1500;
export const SPLITTER_MAX_CHUNK_SIZE = 5000;

/**
 * Maximum nesting depth for JSON document chunking.
 * After this depth, JSON chunking switches to simple recursive text chunking.
 * Set to 5 to support deeply nested structures like OpenAPI schemas while
 * preventing excessive chunk generation from pathological cases.
 */
export const JSON_MAX_NESTING_DEPTH = 5;

/**
 * Maximum number of chunks that can be generated from a single JSON file.
 * If this limit is exceeded, the JSON chunking falls back to text-based chunking.
 * Set to 1000 to keep chunk counts manageable for documentation search.
 */
export const JSON_MAX_CHUNKS = 1000;

/**
 * Maximum number of documents to process in a single batch for embeddings.
 */
export const EMBEDDING_BATCH_SIZE = 100;

/**
 * Maximum total character size for a single embedding batch request.
 * This prevents "413 Request entity too large" errors from embedding APIs.
 * Default is 50000 (~50KB).
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

/**
 * Factor to overfetch vector and FTS candidates before applying Reciprocal Rank Fusion.
 * A factor of 2 means we fetch 2x the requested limit from each source before ranking.
 */
export const SEARCH_OVERFETCH_FACTOR = 2;

/**
 * Weight applied to vector search scores in hybrid search ranking.
 */
export const SEARCH_WEIGHT_VEC = 1.0;

/**
 * Weight applied to full-text search scores in hybrid search ranking.
 */
export const SEARCH_WEIGHT_FTS = 1.0;

/**
 * Multiplier to cast a wider net in vector search before final ranking.
 * Used to increase the number of vector search candidates retrieved.
 */
export const VECTOR_SEARCH_MULTIPLIER = 10;
