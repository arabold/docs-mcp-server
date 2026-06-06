import fs from "node:fs";
import path from "node:path";
import envPaths from "env-paths";
import yaml from "yaml";
import { z } from "zod";
import { normalizeEnvValue } from "./env";
import { logger } from "./logger";

const managedConfigVectorDimensionOmissionMarker =
  "docs-mcp-server-managed-vector-dimension-omitted";
const managedConfigHeader = [
  `# ${managedConfigVectorDimensionOmissionMarker}`,
  "# embeddings.vectorDimension is omitted when it comes from generated defaults.",
  "# Add embeddings.vectorDimension explicitly to override native model dimensions.",
  "",
].join("\n");
const vectorDimensionPath = ["embeddings", "vectorDimension"];

const envStringArray = z
  .union([z.array(z.string()), z.string()])
  .transform((value) => {
    if (Array.isArray(value)) {
      return value;
    }

    const parsed = yaml.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }

    return [value];
  })
  .pipe(z.array(z.string()));

/**
 * Custom zod schema for boolean values that properly handles string representations.
 * Unlike z.coerce.boolean() which treats any non-empty string as true,
 * this schema correctly parses "false", "0", "no", "off" as false.
 */
const envBoolean = z
  .union([z.boolean(), z.string()])
  .transform((val) => {
    if (typeof val === "boolean") return val;
    const lower = val.toLowerCase().trim();
    return (
      lower !== "false" &&
      lower !== "0" &&
      lower !== "no" &&
      lower !== "off" &&
      lower !== ""
    );
  })
  .pipe(z.boolean());

// --- Default Global Configuration ---

export const DEFAULT_CONFIG = {
  app: {
    storePath: "",
    telemetryEnabled: true,
    readOnly: false,
    embeddingModel: "text-embedding-3-small",
  },
  server: {
    protocol: "auto",
    host: "127.0.0.1",
    ports: {
      default: 6280,
      worker: 8080,
      mcp: 6280,
      web: 6281,
    },
    heartbeatMs: 30_000,
  },
  auth: {
    enabled: false,
    issuerUrl: "",
    audience: "",
  },
  scraper: {
    maxPages: 1000,
    maxDepth: 3,
    maxConcurrency: 3,
    abortOnFailureRate: 0.5,
    preserveHashes: false,
    skipKnownTrackers: true,
    pageTimeoutMs: 5000,
    browserTimeoutMs: 30_000,
    htmlExtractor: "cheerio",
    fetcher: {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxCacheItems: 200,
      maxCacheItemSizeBytes: 500 * 1024,
    },
    document: {
      maxSize: 10 * 1024 * 1024, // 10MB max size for PDF/Office documents
    },
    security: {
      network: {
        mode: "open",
        allowPrivateNetworks: false,
        allowedHosts: [] as string[],
        allowedCidrs: [] as string[],
        allowInvalidTls: false,
      },
      fileAccess: {
        mode: "allowedRoots",
        allowedRoots: ["$DOCUMENTS"] as string[],
        followSymlinks: false,
        includeHidden: false,
      },
    },
  },
  splitter: {
    minChunkSize: 500,
    preferredChunkSize: 1500,
    maxChunkSize: 5000,
    treeSitterSizeLimit: 30_000,
    json: {
      maxNestingDepth: 5,
      maxChunks: 1000,
    },
  },
  embeddings: {
    batchSize: 100,
    batchChars: 50_000,
    requestTimeoutMs: 30_000,
    initTimeoutMs: 30_000,
    vectorDimension: 1536,
  },
  db: {
    migrationMaxRetries: 5,
    migrationRetryDelayMs: 300,
  },
  search: {
    overfetchFactor: 2,
    weightVec: 1,
    weightFts: 1,
    vectorMultiplier: 10,
  },
  sandbox: {
    defaultTimeoutMs: 5000,
  },
  assembly: {
    maxParentChainDepth: 10,
    childLimit: 3,
    precedingSiblingsLimit: 1,
    subsequentSiblingsLimit: 2,
    maxChunkDistance: 3,
  },
} as const;

// --- Configuration Schema (Nested) ---

export const AppConfigSchema = z.object({
  app: z
    .object({
      storePath: z.string().default(DEFAULT_CONFIG.app.storePath),
      telemetryEnabled: envBoolean.default(DEFAULT_CONFIG.app.telemetryEnabled),
      readOnly: envBoolean.default(DEFAULT_CONFIG.app.readOnly),
      embeddingModel: z.string().default(DEFAULT_CONFIG.app.embeddingModel),
    })
    .default(DEFAULT_CONFIG.app),
  server: z
    .object({
      protocol: z.string().default(DEFAULT_CONFIG.server.protocol),
      host: z.string().default(DEFAULT_CONFIG.server.host),
      ports: z
        .object({
          default: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.default),
          worker: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.worker),
          mcp: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.mcp),
          web: z.coerce.number().int().default(DEFAULT_CONFIG.server.ports.web),
        })
        .default(DEFAULT_CONFIG.server.ports),
      heartbeatMs: z.coerce.number().int().default(DEFAULT_CONFIG.server.heartbeatMs),
    })
    .default(DEFAULT_CONFIG.server),
  auth: z
    .object({
      enabled: envBoolean.default(DEFAULT_CONFIG.auth.enabled),
      issuerUrl: z.string().default(DEFAULT_CONFIG.auth.issuerUrl),
      audience: z.string().default(DEFAULT_CONFIG.auth.audience),
    })
    .default(DEFAULT_CONFIG.auth),
  scraper: z
    .object({
      maxPages: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.maxPages),
      maxDepth: z.coerce.number().int().default(DEFAULT_CONFIG.scraper.maxDepth),
      maxConcurrency: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.scraper.maxConcurrency),
      abortOnFailureRate: z.coerce
        .number()
        .min(0)
        .max(1)
        .default(DEFAULT_CONFIG.scraper.abortOnFailureRate),
      preserveHashes: envBoolean.default(DEFAULT_CONFIG.scraper.preserveHashes),
      skipKnownTrackers: envBoolean.default(DEFAULT_CONFIG.scraper.skipKnownTrackers),
      pageTimeoutMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.scraper.pageTimeoutMs),
      browserTimeoutMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.scraper.browserTimeoutMs),
      htmlExtractor: z
        .enum(["cheerio", "defuddle"])
        .default(DEFAULT_CONFIG.scraper.htmlExtractor),
      fetcher: z
        .object({
          maxRetries: z.coerce
            .number()
            .int()
            .default(DEFAULT_CONFIG.scraper.fetcher.maxRetries),
          baseDelayMs: z.coerce
            .number()
            .int()
            .default(DEFAULT_CONFIG.scraper.fetcher.baseDelayMs),
          maxCacheItems: z.coerce
            .number()
            .int()
            .default(DEFAULT_CONFIG.scraper.fetcher.maxCacheItems),
          maxCacheItemSizeBytes: z.coerce
            .number()
            .int()
            .default(DEFAULT_CONFIG.scraper.fetcher.maxCacheItemSizeBytes),
        })
        .default(DEFAULT_CONFIG.scraper.fetcher),
      document: z
        .object({
          maxSize: z.coerce
            .number()
            .int()
            .default(DEFAULT_CONFIG.scraper.document.maxSize),
        })
        .default(DEFAULT_CONFIG.scraper.document),
      security: z
        .object({
          network: z
            .object({
              mode: z
                .enum(["open", "allowlist"])
                .default(DEFAULT_CONFIG.scraper.security.network.mode),
              allowPrivateNetworks: envBoolean.default(
                DEFAULT_CONFIG.scraper.security.network.allowPrivateNetworks,
              ),
              allowedHosts: envStringArray.default(
                DEFAULT_CONFIG.scraper.security.network.allowedHosts,
              ),
              allowedCidrs: envStringArray.default(
                DEFAULT_CONFIG.scraper.security.network.allowedCidrs,
              ),
              allowInvalidTls: envBoolean.default(
                DEFAULT_CONFIG.scraper.security.network.allowInvalidTls,
              ),
            })
            .default(DEFAULT_CONFIG.scraper.security.network),
          fileAccess: z
            .object({
              mode: z
                .enum(["disabled", "allowedRoots", "unrestricted"])
                .default(DEFAULT_CONFIG.scraper.security.fileAccess.mode),
              allowedRoots: envStringArray.default(
                DEFAULT_CONFIG.scraper.security.fileAccess.allowedRoots,
              ),
              followSymlinks: envBoolean.default(
                DEFAULT_CONFIG.scraper.security.fileAccess.followSymlinks,
              ),
              includeHidden: envBoolean.default(
                DEFAULT_CONFIG.scraper.security.fileAccess.includeHidden,
              ),
            })
            .default(DEFAULT_CONFIG.scraper.security.fileAccess),
        })
        .default(DEFAULT_CONFIG.scraper.security),
    })
    .default(DEFAULT_CONFIG.scraper),
  splitter: z
    .object({
      minChunkSize: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.minChunkSize),
      preferredChunkSize: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.splitter.preferredChunkSize),
      maxChunkSize: z.coerce.number().int().default(DEFAULT_CONFIG.splitter.maxChunkSize),
      treeSitterSizeLimit: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.splitter.treeSitterSizeLimit),
      json: z
        .object({
          maxNestingDepth: z.coerce
            .number()
            .int()
            .default(DEFAULT_CONFIG.splitter.json.maxNestingDepth),
          maxChunks: z.coerce
            .number()
            .int()
            .default(DEFAULT_CONFIG.splitter.json.maxChunks),
        })
        .default(DEFAULT_CONFIG.splitter.json),
    })
    .default(DEFAULT_CONFIG.splitter),
  embeddings: z
    .object({
      batchSize: z.coerce.number().int().default(DEFAULT_CONFIG.embeddings.batchSize),
      batchChars: z.coerce.number().int().default(DEFAULT_CONFIG.embeddings.batchChars),
      requestTimeoutMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.embeddings.requestTimeoutMs),
      initTimeoutMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.embeddings.initTimeoutMs),
      vectorDimension: z.coerce
        .number()
        .int()
        .min(1, "embedding dimension must be at least 1")
        .default(DEFAULT_CONFIG.embeddings.vectorDimension),
    })
    .default(DEFAULT_CONFIG.embeddings),
  db: z
    .object({
      migrationMaxRetries: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.db.migrationMaxRetries),
      migrationRetryDelayMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.db.migrationRetryDelayMs),
    })
    .default(DEFAULT_CONFIG.db),
  search: z
    .object({
      overfetchFactor: z.coerce.number().default(DEFAULT_CONFIG.search.overfetchFactor),
      weightVec: z.coerce.number().default(DEFAULT_CONFIG.search.weightVec),
      weightFts: z.coerce.number().default(DEFAULT_CONFIG.search.weightFts),
      vectorMultiplier: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.search.vectorMultiplier),
    })
    .default(DEFAULT_CONFIG.search),
  sandbox: z
    .object({
      defaultTimeoutMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.sandbox.defaultTimeoutMs),
    })
    .default(DEFAULT_CONFIG.sandbox),
  assembly: z
    .object({
      maxParentChainDepth: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.assembly.maxParentChainDepth),
      childLimit: z.coerce.number().int().default(DEFAULT_CONFIG.assembly.childLimit),
      precedingSiblingsLimit: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.assembly.precedingSiblingsLimit),
      subsequentSiblingsLimit: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.assembly.subsequentSiblingsLimit),
      maxChunkDistance: z.coerce
        .number()
        .int()
        .min(0)
        .default(DEFAULT_CONFIG.assembly.maxChunkDistance),
    })
    .default(DEFAULT_CONFIG.assembly),
});

const vectorDimensionExplicit = Symbol("vectorDimensionExplicit");

type ParsedAppConfig = z.infer<typeof AppConfigSchema>;

export type AppConfig = Omit<ParsedAppConfig, "embeddings"> & {
  embeddings: ParsedAppConfig["embeddings"] & {
    [vectorDimensionExplicit]?: boolean;
  };
};

// Get defaults from the schema
export const defaults = AppConfigSchema.parse({}) as AppConfig;

// --- Mapping Configuration ---
// Maps flat env vars and CLI args to the nested config structure

interface ConfigMapping {
  path: string[]; // Path in AppConfig
  env?: string[]; // Environment variables
  cli?: string; // CLI argument name (yargs)
}

const configMappings: ConfigMapping[] = [
  { path: ["server", "protocol"], env: ["DOCS_MCP_PROTOCOL"], cli: "protocol" },
  { path: ["app", "storePath"], env: ["DOCS_MCP_STORE_PATH"], cli: "storePath" },
  { path: ["app", "telemetryEnabled"], env: ["DOCS_MCP_TELEMETRY"] }, // Handled via --no-telemetry in CLI usually
  { path: ["app", "readOnly"], env: ["DOCS_MCP_READ_ONLY"], cli: "readOnly" },
  // Ports - Special handling for shared env vars is done in mapping logic
  {
    path: ["server", "ports", "default"],
    env: ["DOCS_MCP_PORT", "PORT"],
    cli: "port",
  },
  {
    path: ["server", "ports", "worker"],
    env: ["DOCS_MCP_PORT", "PORT"],
    cli: "port",
  },
  {
    path: ["server", "ports", "mcp"],
    env: ["DOCS_MCP_PORT", "PORT"],
    cli: "port",
  },
  {
    path: ["server", "ports", "web"],
    env: ["DOCS_MCP_WEB_PORT", "DOCS_MCP_PORT", "PORT"],
    cli: "port",
  },
  { path: ["server", "host"], env: ["DOCS_MCP_HOST", "HOST"], cli: "host" },
  {
    path: ["app", "embeddingModel"],
    env: ["DOCS_MCP_EMBEDDING_MODEL"],
    cli: "embeddingModel",
  },
  { path: ["auth", "enabled"], env: ["DOCS_MCP_AUTH_ENABLED"], cli: "authEnabled" },
  {
    path: ["auth", "issuerUrl"],
    env: ["DOCS_MCP_AUTH_ISSUER_URL"],
    cli: "authIssuerUrl",
  },
  {
    path: ["auth", "audience"],
    env: ["DOCS_MCP_AUTH_AUDIENCE"],
    cli: "authAudience",
  },
  // Add other mappings as needed for CLI/Env overrides
];

// --- Loader Logic ---

export interface LoadConfigOptions {
  configPath?: string; // Explicit config path
  searchDir?: string; // Search directory (store path)
}

// System-specific paths
const systemPaths = envPaths("docs-mcp-server", { suffix: "" });

export function loadConfig(
  cliArgs: Record<string, unknown> = {},
  options: LoadConfigOptions = {},
): AppConfig {
  // 1. Determine Config File Path & Mode
  // Priority: CLI > Options > Env > Default System Path
  const explicitPath =
    (cliArgs.config as string) || options.configPath || process.env.DOCS_MCP_CONFIG;

  let configPath: string;
  let isReadOnlyConfig = false;

  if (explicitPath) {
    configPath = explicitPath;
    isReadOnlyConfig = true; // User provided specific config, do not overwrite
  } else {
    // Default: strict system config path
    configPath = path.join(systemPaths.config, "config.yaml");
    isReadOnlyConfig = false; // Auto-update default config
  }

  logger.debug(`Using config file: ${configPath}`);

  // 2. Load Config File (if exists) or use empty object
  const fileConfig = loadConfigFile(configPath) || {};
  const hasManagedVectorDimensionOmissionMarker =
    hasManagedConfigVectorDimensionOmissionMarker(configPath);

  // 3. Merge Defaults < File
  const baseConfig = deepMerge(defaults, fileConfig) as ConfigObject;

  // 4. Map Env Vars and CLI Args
  const envConfig = mapEnvToConfig();
  const cliConfig = mapCliToConfig(cliArgs);
  const vectorDimensionWasExplicit = wasVectorDimensionExplicit(
    fileConfig,
    envConfig,
    cliConfig,
    isReadOnlyConfig,
    hasManagedVectorDimensionOmissionMarker,
  );
  const fileVectorDimensionWasExplicit = wasVectorDimensionExplicit(
    fileConfig,
    {},
    {},
    isReadOnlyConfig,
    hasManagedVectorDimensionOmissionMarker,
  );

  // 5. Write back to file (Auto-Update) - ONLY if using default path
  if (!isReadOnlyConfig) {
    try {
      saveConfigFile(configPath, baseConfig, {
        managedDefaultConfig: true,
        omitVectorDimension: !fileVectorDimensionWasExplicit,
      });
    } catch (error) {
      logger.warn(`Failed to save config file to ${configPath}: ${error}`);
    }
  }

  // 6. Merge: Base < Env < CLI
  const mergedInput = deepMerge(
    baseConfig,
    deepMerge(envConfig, cliConfig),
  ) as ConfigObject;

  // Special handling for embedding model fallback
  if (!getAtPath(mergedInput, ["app", "embeddingModel"]) && process.env.OPENAI_API_KEY) {
    setAtPath(mergedInput, ["app", "embeddingModel"], "text-embedding-3-small");
  }

  const parseResult = AppConfigSchema.safeParse(mergedInput);
  if (parseResult.success) {
    return markVectorDimensionSource(
      parseResult.data as AppConfig,
      vectorDimensionWasExplicit,
    );
  }

  // The file on disk is structurally wrong (e.g., array fields saved as
  // objects by a prior buggy version, or a hand-edit with a typo). Rather
  // than refusing to start, fall back to env-and-CLI-on-defaults and replace
  // the corrupted file so the next load is clean. The original file is moved
  // aside to `<configPath>.invalid-<timestamp>` so hand-edits aren't lost.
  if (!isReadOnlyConfig && fs.existsSync(configPath)) {
    const quarantinePath = `${configPath}.invalid-${Date.now()}`;
    try {
      fs.renameSync(configPath, quarantinePath);
      logger.warn(
        `Configuration file has invalid shape and was moved to ${quarantinePath}; resetting to defaults. Reason: ${parseResult.error.message}`,
      );
    } catch (renameError) {
      logger.warn(
        `Configuration file has invalid shape; resetting to defaults (could not quarantine original: ${renameError}). Reason: ${parseResult.error.message}`,
      );
    }
  } else {
    logger.warn(
      `Configuration file has invalid shape; resetting to defaults. Reason: ${parseResult.error.message}`,
    );
  }
  const fallbackInput = deepMerge(
    defaults,
    deepMerge(envConfig, cliConfig),
  ) as ConfigObject;
  if (
    !getAtPath(fallbackInput, ["app", "embeddingModel"]) &&
    process.env.OPENAI_API_KEY
  ) {
    setAtPath(fallbackInput, ["app", "embeddingModel"], "text-embedding-3-small");
  }
  const fallback = AppConfigSchema.parse(fallbackInput);
  const fallbackConfig = markVectorDimensionSource(
    fallback as AppConfig,
    wasVectorDimensionExplicit({}, envConfig, cliConfig, false, false),
  );
  if (!isReadOnlyConfig) {
    try {
      saveConfigFile(configPath, fallbackConfig as unknown as ConfigObject, {
        managedDefaultConfig: true,
        omitVectorDimension: true,
      });
    } catch (error) {
      logger.warn(`Failed to write fresh config file ${configPath}: ${error}`);
    }
  }
  return fallbackConfig;
}

function hasManagedConfigVectorDimensionOmissionMarker(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;

  try {
    return fs
      .readFileSync(filePath, "utf8")
      .includes(managedConfigVectorDimensionOmissionMarker);
  } catch {
    return false;
  }
}

/**
 * Returns true when the embedding vector dimension was set by user config,
 * environment, or CLI rather than coming from generated defaults.
 */
export function isVectorDimensionExplicit(config: AppConfig): boolean {
  return config.embeddings[vectorDimensionExplicit] === true;
}

/**
 * Marks an AppConfig as having an explicit or default-derived vector dimension.
 */
export function markVectorDimensionSource(
  config: AppConfig,
  explicit: boolean,
): AppConfig {
  Object.defineProperty(config.embeddings, vectorDimensionExplicit, {
    value: explicit,
    enumerable: false,
    configurable: true,
  });
  return config;
}

function loadConfigFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (filePath.endsWith(".json")) {
      return JSON.parse(content);
    }

    return yaml.parse(content) || {};
  } catch (error) {
    logger.warn(`Failed to parse config file ${filePath}: ${error}`);
    return null;
  }
}

function wasVectorDimensionExplicit(
  fileConfig: ConfigObject,
  envConfig: ConfigObject,
  cliConfig: ConfigObject,
  isReadOnlyConfig: boolean,
  hasManagedVectorDimensionOmissionMarker: boolean,
): boolean {
  if (
    getAtPath(envConfig, vectorDimensionPath) !== undefined ||
    getAtPath(cliConfig, vectorDimensionPath) !== undefined
  ) {
    return true;
  }

  const fileValue = getAtPath(fileConfig, vectorDimensionPath);
  if (fileValue === undefined) {
    return false;
  }

  if (
    isReadOnlyConfig ||
    fileValue !== DEFAULT_CONFIG.embeddings.vectorDimension ||
    hasManagedVectorDimensionOmissionMarker
  ) {
    return true;
  }

  return !looksLikeLegacyGeneratedEmbeddingDefaults(fileConfig);
}

function looksLikeLegacyGeneratedEmbeddingDefaults(fileConfig: ConfigObject): boolean {
  const embeddings = fileConfig.embeddings;
  if (
    typeof embeddings !== "object" ||
    embeddings === null ||
    Array.isArray(embeddings)
  ) {
    return false;
  }

  return Object.keys(DEFAULT_CONFIG.embeddings).every((key) =>
    Object.hasOwn(embeddings, key),
  );
}

interface SaveConfigOptions {
  managedDefaultConfig?: boolean;
  omitVectorDimension?: boolean;
}

function saveConfigFile(
  filePath: string,
  config: Record<string, unknown>,
  options: SaveConfigOptions = {},
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const configToWrite = cloneConfigValue(config) as ConfigObject;
  if (options.omitVectorDimension) {
    unsetAtPath(configToWrite, vectorDimensionPath);
  }

  let content: string;
  if (filePath.endsWith(".json")) {
    content = JSON.stringify(configToWrite, null, 2);
  } else {
    // Default to YAML
    content = yaml.stringify(configToWrite);
    if (options.managedDefaultConfig) {
      content = `${managedConfigHeader}${content}`;
    }
  }

  logger.debug(`Updating config file at ${filePath}`);
  fs.writeFileSync(filePath, content, "utf8");
}

function mapEnvToConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  // 1. Apply explicit mappings first (for aliases like PORT, HOST)
  for (const mapping of configMappings) {
    if (mapping.env) {
      for (const envVar of mapping.env) {
        if (process.env[envVar] !== undefined) {
          setAtPath(
            config,
            mapping.path,
            normalizeEnvValue(process.env[envVar] as string),
          );
          break; // First match wins
        }
      }
    }
  }

  // 2. Apply auto-generated env vars (takes precedence over explicit mappings)
  for (const pathArr of ALL_CONFIG_LEAF_PATHS) {
    const envVar = pathToEnvVar(pathArr);
    if (process.env[envVar] !== undefined) {
      setAtPath(config, pathArr, normalizeEnvValue(process.env[envVar] as string));
    }
  }

  return config;
}

function mapCliToConfig(args: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const mapping of configMappings) {
    if (mapping.cli && args[mapping.cli] !== undefined) {
      setAtPath(config, mapping.path, args[mapping.cli]);
    }
  }
  return config;
}

// --- Helpers ---

// Helper type for nested objects
type ConfigObject = Record<string, unknown>;

/**
 * Convert camelCase to UPPER_SNAKE_CASE
 * Example: "maxSize" → "MAX_SIZE", "maxNestingDepth" → "MAX_NESTING_DEPTH"
 */
export function camelToUpperSnake(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
}

/**
 * Convert config path to environment variable name
 * Example: ["scraper", "document", "maxSize"] → "DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE"
 */
export function pathToEnvVar(pathArr: string[]): string {
  return `DOCS_MCP_${pathArr.map(camelToUpperSnake).join("_")}`;
}

/**
 * Recursively collect all leaf paths from a config object
 */
export function collectLeafPaths(obj: object, prefix: string[] = []): string[][] {
  const paths: string[][] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...prefix, key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectLeafPaths(value, currentPath));
    } else {
      paths.push(currentPath);
    }
  }
  return paths;
}

// Cache leaf paths at module init since DEFAULT_CONFIG is constant
const ALL_CONFIG_LEAF_PATHS = collectLeafPaths(DEFAULT_CONFIG);

function setAtPath(obj: ConfigObject, pathArr: string[], value: unknown) {
  let current = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const key = pathArr[i];
    if (
      current[key] === undefined ||
      typeof current[key] !== "object" ||
      current[key] === null
    ) {
      current[key] = {};
    }
    current = current[key] as ConfigObject;
  }
  current[pathArr[pathArr.length - 1]] = value;
}

function getAtPath(obj: ConfigObject, pathArr: string[]): unknown {
  let current: unknown = obj;
  for (const key of pathArr) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as ConfigObject)[key];
  }
  return current;
}

function unsetAtPath(obj: ConfigObject, pathArr: string[]): void {
  let current: unknown = obj;
  for (const key of pathArr.slice(0, -1)) {
    if (typeof current !== "object" || current === null) {
      return;
    }
    current = (current as ConfigObject)[key];
  }

  if (typeof current === "object" && current !== null) {
    delete (current as ConfigObject)[pathArr[pathArr.length - 1]];
  }
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneConfigValue(item));
  }

  if (typeof value === "object" && value !== null) {
    const output: ConfigObject = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = cloneConfigValue(child);
    }
    return output;
  }

  return value;
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (typeof target !== "object" || target === null) return source;
  if (typeof source !== "object" || source === null) return target;
  // Arrays are scalars from a merge standpoint: source replaces target entirely.
  // Recursing into arrays would either splice into a wrong shape (spreading an
  // array into a plain object) or silently union by index, neither of which
  // matches user expectations for list-shaped config values.
  if (Array.isArray(target) || Array.isArray(source)) return source;

  const t = target as ConfigObject;
  const s = source as ConfigObject;
  const output = { ...t };

  for (const key of Object.keys(s)) {
    const sValue = s[key];
    const tValue = t[key];

    if (
      typeof sValue === "object" &&
      sValue !== null &&
      !Array.isArray(sValue) &&
      typeof tValue === "object" &&
      tValue !== null &&
      !Array.isArray(tValue) &&
      key in t
    ) {
      output[key] = deepMerge(tValue, sValue);
    } else {
      output[key] = sValue;
    }
  }
  return output;
}

// --- CLI Helper Functions ---

/**
 * Check if a config path is valid by verifying it exists in DEFAULT_CONFIG
 */
export function isValidConfigPath(path: string): boolean {
  const pathArr = path.split(".");
  return getAtPath(DEFAULT_CONFIG as ConfigObject, pathArr) !== undefined;
}

/**
 * Get a config value by dot-separated path
 */
export function getConfigValue(config: AppConfig, path: string): unknown {
  const pathArr = path.split(".");
  return getAtPath(config as unknown as ConfigObject, pathArr);
}

/**
 * Parse a string value to the appropriate type (number, boolean, or string)
 */
export function parseConfigValue(value: string): unknown {
  // Try number first
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== "") {
    return num;
  }

  // Try boolean
  const lower = value.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;

  // Default to string
  return value;
}

/**
 * Set a config value and persist to file.
 * Returns the path to the config file that was updated.
 * Validates the updated config against the schema before saving.
 */
export function setConfigValue(path: string, value: string): string {
  const configPath = getDefaultConfigPath();
  const fileConfig = loadConfigFile(configPath) || {};
  const pathArr = path.split(".");
  const parsedValue = parseConfigValue(value);

  // Apply change to a copy so we can validate before persisting
  const updatedConfig = JSON.parse(JSON.stringify(fileConfig));
  setAtPath(updatedConfig, pathArr, parsedValue);

  // Validate against schema before saving
  try {
    AppConfigSchema.parse(updatedConfig);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid config value for "${path}": ${errorMsg}`);
  }

  saveConfigFile(configPath, updatedConfig);

  return configPath;
}

/**
 * Get the default system config path
 */
export function getDefaultConfigPath(): string {
  return path.join(systemPaths.config, "config.yaml");
}
