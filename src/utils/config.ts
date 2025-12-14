/**
 * Configuration defaults, schema metadata, and loader with env/YAML precedence.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

type Path = readonly [string, ...string[]];

type ConfigSchemaEntry<T, TTarget extends Path = Path> = {
  defaultValue: T;
  env?: string[];
  parser: (raw: string) => T;
  yamlPaths?: readonly Path[];
  target: TTarget;
};

type ConfigSchema = Record<string, ConfigSchemaEntry<unknown>>;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type EnsurePath<Segments extends string[]> = Segments extends [string, ...string[]]
  ? Segments
  : never;

type AssignPath<P extends Path, V> = P extends readonly [
  infer K extends string,
  ...infer Rest extends string[],
]
  ? Rest extends []
    ? { [Key in K]: V }
    : { [Key in K]: AssignPath<EnsurePath<Rest>, V> }
  : never;

type AppConfigFromSchema<S extends ConfigSchema> = Simplify<
  UnionToIntersection<
    {
      [K in keyof S]: S[K] extends ConfigSchemaEntry<infer V, infer P extends Path>
        ? AssignPath<P, V>
        : never;
    }[keyof S]
  >
>;

function defineConfigSchema<const S extends ConfigSchema>(schema: S): S {
  return schema;
}

const configSchema = defineConfigSchema({
  /** Default protocol for the MCP/server */
  SERVER_PROTOCOL: {
    defaultValue: "auto",
    env: ["DOCS_MCP_PROTOCOL"],
    parser: parseString,
    yamlPaths: [["server", "protocol"]],
    target: ["server", "protocol"],
  },
  /** Custom path for data storage directory */
  STORE_PATH: {
    defaultValue: "",
    env: ["DOCS_MCP_STORE_PATH"],
    parser: parseString,
    yamlPaths: [["store", "path"]],
    target: ["app", "storePath"],
  },
  /** Telemetry enablement toggle */
  TELEMETRY: {
    defaultValue: true,
    env: ["DOCS_MCP_TELEMETRY"],
    parser: parseBooleanish,
    yamlPaths: [["telemetry", "enabled"]],
    target: ["app", "telemetryEnabled"],
  },
  /** Standalone server port (single-process mode) */
  SERVER_DEFAULT_PORT: {
    defaultValue: 6280,
    env: ["DOCS_MCP_PORT", "PORT"],
    parser: parseIntStrict,
    yamlPaths: [
      ["server", "port"],
      ["server", "defaultPort"],
    ],
    target: ["server", "ports", "default"],
  },
  /** Worker service port (distributed mode) */
  SERVER_WORKER_PORT: {
    defaultValue: 8080,
    env: ["DOCS_MCP_PORT", "PORT"],
    parser: parseIntStrict,
    yamlPaths: [["server", "workerPort"]],
    target: ["server", "ports", "worker"],
  },
  /** MCP endpoint port (distributed mode) */
  SERVER_MCP_PORT: {
    defaultValue: 6280,
    env: ["DOCS_MCP_PORT", "PORT"],
    parser: parseIntStrict,
    yamlPaths: [["server", "mcpPort"]],
    target: ["server", "ports", "mcp"],
  },
  /** Web UI port (distributed mode) */
  SERVER_WEB_PORT: {
    defaultValue: 6281,
    env: ["DOCS_MCP_WEB_PORT", "DOCS_MCP_PORT", "PORT"],
    parser: parseIntStrict,
    yamlPaths: [["server", "webPort"]],
    target: ["server", "ports", "web"],
  },
  /** Default host for server binding */
  SERVER_HOST: {
    defaultValue: "127.0.0.1",
    env: ["DOCS_MCP_HOST", "HOST"],
    parser: parseString,
    yamlPaths: [["server", "host"]],
    target: ["server", "host"],
  },
  /** Embedding model configuration */
  EMBEDDING_MODEL: {
    defaultValue: "",
    env: ["DOCS_MCP_EMBEDDING_MODEL"],
    parser: parseString,
    yamlPaths: [["embeddings", "model"]],
    target: ["app", "embeddingModel"],
  },
  /** OAuth2/OIDC authentication toggle */
  AUTH_ENABLED: {
    defaultValue: false,
    env: ["DOCS_MCP_AUTH_ENABLED"],
    parser: parseBooleanish,
    yamlPaths: [["auth", "enabled"]],
    target: ["auth", "enabled"],
  },
  /** OAuth2/OIDC issuer/discovery URL */
  AUTH_ISSUER_URL: {
    defaultValue: "",
    env: ["DOCS_MCP_AUTH_ISSUER_URL"],
    parser: parseString,
    yamlPaths: [["auth", "issuerUrl"]],
    target: ["auth", "issuerUrl"],
  },
  /** OAuth2/OIDC audience */
  AUTH_AUDIENCE: {
    defaultValue: "",
    env: ["DOCS_MCP_AUTH_AUDIENCE"],
    parser: parseString,
    yamlPaths: [["auth", "audience"]],
    target: ["auth", "audience"],
  },
  /** Heartbeat interval for long-lived MCP SSE connections */
  SERVER_HEARTBEAT_INTERVAL_MS: {
    defaultValue: 30_000,
    parser: parseIntStrict,
    yamlPaths: [["server", "heartbeatMs"]],
    target: ["server", "heartbeatMs"],
  },
  /** Maximum number of pages to scrape in a single job */
  SCRAPER_MAX_PAGES: {
    defaultValue: 1000,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "maxPages"]],
    target: ["scraper", "maxPages"],
  },
  /** Maximum navigation depth when crawling links */
  SCRAPER_MAX_DEPTH: {
    defaultValue: 3,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "maxDepth"]],
    target: ["scraper", "maxDepth"],
  },
  /** Maximum number of concurrent page requests */
  SCRAPER_MAX_CONCURRENCY: {
    defaultValue: 3,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "maxConcurrency"]],
    target: ["scraper", "maxConcurrency"],
  },
  /** Default timeout in milliseconds for page operations (e.g., Playwright waitForSelector). */
  SCRAPER_PAGE_TIMEOUT_MS: {
    defaultValue: 5000,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "pageTimeoutMs"]],
    target: ["scraper", "pageTimeoutMs"],
  },
  /** Maximum number of retries for HTTP fetcher requests. */
  SCRAPER_FETCHER_MAX_RETRIES: {
    defaultValue: 6,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "fetcher", "maxRetries"]],
    target: ["scraper", "fetcher", "maxRetries"],
  },
  /** Base delay in milliseconds for HTTP fetcher retry backoff. */
  SCRAPER_FETCHER_BASE_DELAY_MS: {
    defaultValue: 1000,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "fetcher", "baseDelayMs"]],
    target: ["scraper", "fetcher", "baseDelayMs"],
  },
  /** Maximum number of cached items in the HTTP fetcher. */
  SCRAPER_FETCHER_MAX_CACHE_ITEMS: {
    defaultValue: 200,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "fetcher", "maxCacheItems"]],
    target: ["scraper", "fetcher", "maxCacheItems"],
  },
  /** Maximum size in bytes for individual cached responses in the HTTP fetcher. */
  SCRAPER_FETCHER_MAX_CACHE_ITEM_SIZE_BYTES: {
    defaultValue: 500 * 1024,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "fetcher", "maxCacheItemSizeBytes"]],
    target: ["scraper", "fetcher", "maxCacheItemSizeBytes"],
  },
  /** Default navigation timeout for browser-based fetches */
  SCRAPER_BROWSER_TIMEOUT_MS: {
    defaultValue: 30_000,
    parser: parseIntStrict,
    yamlPaths: [["scraper", "browserTimeoutMs"]],
    target: ["scraper", "browserTimeoutMs"],
  },
  /** Default chunk size settings for splitters */
  SPLITTER_MIN_CHUNK_SIZE: {
    defaultValue: 500,
    parser: parseIntStrict,
    yamlPaths: [["splitter", "minChunkSize"]],
    target: ["splitter", "minChunkSize"],
  },
  SPLITTER_PREFERRED_CHUNK_SIZE: {
    defaultValue: 1500,
    parser: parseIntStrict,
    yamlPaths: [["splitter", "preferredChunkSize"]],
    target: ["splitter", "preferredChunkSize"],
  },
  SPLITTER_MAX_CHUNK_SIZE: {
    defaultValue: 5000,
    parser: parseIntStrict,
    yamlPaths: [["splitter", "maxChunkSize"]],
    target: ["splitter", "maxChunkSize"],
  },
  /** Maximum nesting depth for JSON document chunking. */
  SPLITTER_JSON_MAX_NESTING_DEPTH: {
    defaultValue: 5,
    parser: parseIntStrict,
    yamlPaths: [["splitter", "json", "maxNestingDepth"]],
    target: ["splitter", "json", "maxNestingDepth"],
  },
  /** Maximum number of chunks that can be generated from a single JSON file. */
  SPLITTER_JSON_MAX_CHUNKS: {
    defaultValue: 1000,
    parser: parseIntStrict,
    yamlPaths: [["splitter", "json", "maxChunks"]],
    target: ["splitter", "json", "maxChunks"],
  },
  /** Maximum number of documents to process in a single batch for embeddings. */
  EMBEDDING_BATCH_SIZE: {
    defaultValue: 100,
    parser: parseIntStrict,
    yamlPaths: [["embeddings", "batchSize"]],
    target: ["embeddings", "batchSize"],
  },
  /** Maximum total character size for a single embedding batch request. */
  EMBEDDING_BATCH_CHARS: {
    defaultValue: 50_000,
    parser: parseIntStrict,
    yamlPaths: [["embeddings", "batchChars"]],
    target: ["embeddings", "batchChars"],
  },
  /** Timeout for embedding service requests */
  EMBEDDING_REQUEST_TIMEOUT_MS: {
    defaultValue: 30_000,
    parser: parseIntStrict,
    yamlPaths: [["embeddings", "requestTimeoutMs"]],
    target: ["embeddings", "requestTimeoutMs"],
  },
  /** Timeout when probing embedding dimensions during initialization */
  EMBEDDING_INIT_TIMEOUT_MS: {
    defaultValue: 30_000,
    parser: parseIntStrict,
    yamlPaths: [["embeddings", "initTimeoutMs"]],
    target: ["embeddings", "initTimeoutMs"],
  },
  /** Maximum number of retries for database migrations if busy. */
  DB_MIGRATION_MAX_RETRIES: {
    defaultValue: 5,
    parser: parseIntStrict,
    yamlPaths: [["db", "migrationMaxRetries"]],
    target: ["db", "migrationMaxRetries"],
  },
  /** Delay in milliseconds between migration retry attempts. */
  DB_MIGRATION_RETRY_DELAY_MS: {
    defaultValue: 300,
    parser: parseIntStrict,
    yamlPaths: [["db", "migrationRetryDelayMs"]],
    target: ["db", "migrationRetryDelayMs"],
  },
  /** Factor to overfetch vector and FTS candidates before applying Reciprocal Rank Fusion. */
  SEARCH_OVERFETCH_FACTOR: {
    defaultValue: 2,
    parser: parseFloatStrict,
    yamlPaths: [["search", "overfetchFactor"]],
    target: ["search", "overfetchFactor"],
  },
  /** Weight applied to vector search scores in hybrid search ranking. */
  SEARCH_WEIGHT_VEC: {
    defaultValue: 1,
    parser: parseFloatStrict,
    yamlPaths: [["search", "weightVec"]],
    target: ["search", "weightVec"],
  },
  /** Weight applied to full-text search scores in hybrid search ranking. */
  SEARCH_WEIGHT_FTS: {
    defaultValue: 1,
    parser: parseFloatStrict,
    yamlPaths: [["search", "weightFts"]],
    target: ["search", "weightFts"],
  },
  /** Multiplier to cast a wider net in vector search before final ranking. */
  VECTOR_SEARCH_MULTIPLIER: {
    defaultValue: 10,
    parser: parseIntStrict,
    yamlPaths: [["search", "vectorMultiplier"]],
    target: ["search", "vectorMultiplier"],
  },
  /** Default vector dimension used across the application */
  VECTOR_DIMENSION: {
    defaultValue: 1536,
    parser: parseIntStrict,
    yamlPaths: [
      ["embeddings", "vectorDimension"],
      ["embeddings", "dimensions"],
    ],
    target: ["embeddings", "vectorDimension"],
  },
  /** Maximum characters fed into tree-sitter parsers to avoid overflow */
  PARSER_TREE_SITTER_SIZE_LIMIT: {
    defaultValue: 30_000,
    parser: parseIntStrict,
    yamlPaths: [["parser", "treeSitterSizeLimit"]],
    target: ["parser", "treeSitterSizeLimit"],
  },
  /** Safety cap for hierarchical parent-chain traversal */
  ASSEMBLY_MAX_PARENT_CHAIN_DEPTH: {
    defaultValue: 50,
    parser: parseIntStrict,
    yamlPaths: [["assembly", "maxParentChainDepth"]],
    target: ["assembly", "maxParentChainDepth"],
  },
  /** Context expansion limits for markdown/text assembly */
  ASSEMBLY_CHILD_LIMIT: {
    defaultValue: 3,
    parser: parseIntStrict,
    yamlPaths: [["assembly", "childLimit"]],
    target: ["assembly", "childLimit"],
  },
  ASSEMBLY_PRECEDING_SIBLINGS_LIMIT: {
    defaultValue: 1,
    parser: parseIntStrict,
    yamlPaths: [["assembly", "precedingSiblingsLimit"]],
    target: ["assembly", "precedingSiblingsLimit"],
  },
  ASSEMBLY_SUBSEQUENT_SIBLINGS_LIMIT: {
    defaultValue: 2,
    parser: parseIntStrict,
    yamlPaths: [["assembly", "subsequentSiblingsLimit"]],
    target: ["assembly", "subsequentSiblingsLimit"],
  },
  /** Default timeout for sandboxed script execution */
  SANDBOX_DEFAULT_TIMEOUT_MS: {
    defaultValue: 5000,
    parser: parseIntStrict,
    yamlPaths: [["sandbox", "defaultTimeoutMs"]],
    target: ["sandbox", "defaultTimeoutMs"],
  },
});

type ConfigKey = keyof typeof configSchema;

type DefaultValues = { [K in ConfigKey]: (typeof configSchema)[K]["defaultValue"] };

export type AppConfig = AppConfigFromSchema<typeof configSchema>;

const defaultValues = Object.fromEntries(
  Object.entries(configSchema).map(([key, entry]) => [key, entry.defaultValue]),
) as DefaultValues;

export const {
  STORE_PATH,
  TELEMETRY,
  SERVER_PROTOCOL,
  SERVER_DEFAULT_PORT,
  SERVER_WORKER_PORT,
  SERVER_MCP_PORT,
  SERVER_WEB_PORT,
  SERVER_HOST,
  EMBEDDING_MODEL,
  AUTH_ENABLED,
  AUTH_ISSUER_URL,
  AUTH_AUDIENCE,
  SERVER_HEARTBEAT_INTERVAL_MS,
  SCRAPER_MAX_PAGES,
  SCRAPER_MAX_DEPTH,
  SCRAPER_MAX_CONCURRENCY,
  SCRAPER_PAGE_TIMEOUT_MS,
  SCRAPER_FETCHER_MAX_RETRIES,
  SCRAPER_FETCHER_BASE_DELAY_MS,
  SCRAPER_FETCHER_MAX_CACHE_ITEMS,
  SCRAPER_FETCHER_MAX_CACHE_ITEM_SIZE_BYTES,
  SCRAPER_BROWSER_TIMEOUT_MS,
  SPLITTER_MIN_CHUNK_SIZE,
  SPLITTER_PREFERRED_CHUNK_SIZE,
  SPLITTER_MAX_CHUNK_SIZE,
  SPLITTER_JSON_MAX_NESTING_DEPTH,
  SPLITTER_JSON_MAX_CHUNKS,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_BATCH_CHARS,
  EMBEDDING_REQUEST_TIMEOUT_MS,
  EMBEDDING_INIT_TIMEOUT_MS,
  DB_MIGRATION_MAX_RETRIES,
  DB_MIGRATION_RETRY_DELAY_MS,
  SEARCH_OVERFETCH_FACTOR,
  SEARCH_WEIGHT_VEC,
  SEARCH_WEIGHT_FTS,
  VECTOR_SEARCH_MULTIPLIER,
  VECTOR_DIMENSION,
  PARSER_TREE_SITTER_SIZE_LIMIT,
  ASSEMBLY_MAX_PARENT_CHAIN_DEPTH,
  ASSEMBLY_CHILD_LIMIT,
  ASSEMBLY_PRECEDING_SIBLINGS_LIMIT,
  ASSEMBLY_SUBSEQUENT_SIBLINGS_LIMIT,
  SANDBOX_DEFAULT_TIMEOUT_MS,
} = defaultValues;

const DEFAULT_CONFIG_PATH = "docs-mcp.config.yaml";

const cachedYaml: { path: string | null; values: unknown } = {
  path: null,
  values: {},
};

let cachedConfig: AppConfig | null = null;

export function loadConfig(
  overrides: Partial<Record<ConfigKey, unknown>> = {},
): AppConfig {
  if (cachedConfig && Object.keys(overrides).length === 0) {
    return cachedConfig;
  }

  const yamlValues = loadYamlConfig();
  const resolved: Partial<Record<ConfigKey, unknown>> = {};

  for (const [key, entry] of Object.entries(configSchema) as [
    ConfigKey,
    ConfigSchemaEntry<unknown>,
  ][]) {
    const yamlValue = getYamlValue(key, entry, yamlValues);
    const legacyEnv = getFirstDefined(entry.env?.map((name) => process.env[name]));
    const genericEnv = process.env[`DOCS_MCP_${key}`];
    const raw = getFirstDefined([
      overrides[key],
      genericEnv,
      legacyEnv,
      yamlValue,
      entry.defaultValue,
    ]);

    resolved[key] = coerceValue(raw, entry.parser, key);
  }

  if (!resolved.EMBEDDING_MODEL && process.env.OPENAI_API_KEY) {
    resolved.EMBEDDING_MODEL = "text-embedding-3-small";
  }

  cachedConfig = shapeConfig(resolved as Record<ConfigKey, unknown>);
  return cachedConfig;
}

function shapeConfig(values: Record<ConfigKey, unknown>): AppConfig {
  const shaped: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(configSchema) as [
    ConfigKey,
    ConfigSchemaEntry<unknown>,
  ][]) {
    setAtPath(shaped, entry.target, values[key]);
  }

  return shaped as AppConfig;
}

function coerceValue<T>(
  value: unknown,
  parser: (raw: string) => T,
  key: ConfigKey,
): T | unknown {
  if (typeof value === "string") {
    return parser(value);
  }
  if (value === undefined) {
    throw new Error(`Config value for ${key} resolved to undefined`);
  }
  return value as T;
}

function getFirstDefined<T>(values?: (T | undefined)[]): T | undefined {
  if (!values) return undefined;
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function loadYamlConfig(): unknown {
  const userPath = process.env.DOCS_MCP_CONFIG;
  const configPath = userPath ?? path.join(process.cwd(), DEFAULT_CONFIG_PATH);

  if (cachedYaml.path === configPath) {
    return cachedYaml.values;
  }

  if (!fs.existsSync(configPath)) {
    cachedYaml.path = configPath;
    cachedYaml.values = {};
    return cachedYaml.values;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;

  try {
    parsed = yaml.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch (jsonError) {
      throw new Error(
        `Failed to parse config file at ${configPath} as YAML or JSON: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`,
      );
    }
  }

  cachedYaml.path = configPath;
  cachedYaml.values = parsed ?? {};
  return cachedYaml.values;
}

function getYamlValue(
  key: ConfigKey,
  entry: ConfigSchemaEntry<unknown>,
  yaml: unknown,
): unknown {
  if (entry.yamlPaths) {
    for (const yamlPath of entry.yamlPaths) {
      if (isRecord(yaml)) {
        const dottedPath = yamlPath.join(".");
        if (yaml[dottedPath] !== undefined) {
          return yaml[dottedPath];
        }
      }

      const value = getAtPath(yaml, yamlPath);
      if (value !== undefined) {
        return value;
      }
    }
  }

  if (isRecord(yaml) && yaml[key] !== undefined) {
    return yaml[key];
  }

  return undefined;
}

function getAtPath(source: unknown, path: readonly string[]): unknown {
  if (!isRecord(source)) {
    return undefined;
  }

  let cursor: unknown = source;
  for (const segment of path) {
    if (!isRecord(cursor) || !(segment in cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function setAtPath(target: Record<string, unknown>, path: Path, value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const isLeaf = index === path.length - 1;

    if (isLeaf) {
      cursor[segment] = value;
      return;
    }

    const next = cursor[segment];
    if (!isRecord(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseIntStrict(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid integer value: ${raw}`);
  }
  return value;
}

function parseFloatStrict(raw: string): number {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid number value: ${raw}`);
  }
  return value;
}

function parseString(raw: string): string {
  return raw;
}

function parseBooleanish(raw: string): boolean {
  const normalized = raw.toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  return Boolean(normalized);
}
