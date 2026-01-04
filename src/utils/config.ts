import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { z } from "zod";
import { getProjectRoot } from "./paths";

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
    pageTimeoutMs: 5000,
    browserTimeoutMs: 30_000,
    fetcher: {
      maxRetries: 6,
      baseDelayMs: 1000,
      maxCacheItems: 200,
      maxCacheItemSizeBytes: 500 * 1024,
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
  },
} as const;

// --- Configuration Schema (Nested) ---

export const AppConfigSchema = z.object({
  app: z
    .object({
      storePath: z.string().default(DEFAULT_CONFIG.app.storePath),
      telemetryEnabled: z.coerce.boolean().default(DEFAULT_CONFIG.app.telemetryEnabled),
      readOnly: z.coerce.boolean().default(DEFAULT_CONFIG.app.readOnly),
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
      enabled: z.coerce.boolean().default(DEFAULT_CONFIG.auth.enabled),
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
      pageTimeoutMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.scraper.pageTimeoutMs),
      browserTimeoutMs: z.coerce
        .number()
        .int()
        .default(DEFAULT_CONFIG.scraper.browserTimeoutMs),
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
    })
    .default(DEFAULT_CONFIG.assembly),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// Get defaults from the schema
export const defaults = AppConfigSchema.parse({});

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

export function loadConfig(
  cliArgs: Record<string, unknown> = {},
  options: LoadConfigOptions = {},
): AppConfig {
  // 1. Load Config File
  const fileConfig = loadConfigFile(options, cliArgs.config as string);

  // 2. Map Env Vars and CLI Args to nested structure
  const envConfig = mapEnvToConfig();
  const cliConfig = mapCliToConfig(cliArgs);

  // 3. Merge: Defaults (base) < File < Env < CLI
  // We rely on Zod to apply defaults to the merged result of File < Env < CLI
  // BUT deep merging is tricky.
  // Strategy: Start with empty object, deep merge File -> Env -> CLI.
  // Then parse with Zod, which will fill in defaults for missing keys.

  const mergedInput = deepMerge(
    fileConfig,
    deepMerge(envConfig, cliConfig),
  ) as ConfigObject;

  // Special handling for embedding model fallback
  if (!getAtPath(mergedInput, ["app", "embeddingModel"]) && process.env.OPENAI_API_KEY) {
    setAtPath(mergedInput, ["app", "embeddingModel"], "text-embedding-3-small");
  }

  return AppConfigSchema.parse(mergedInput);
}

function loadConfigFile(
  options: LoadConfigOptions,
  cliConfigPath?: string,
): Record<string, unknown> {
  const candidatePaths: string[] = [];

  // 1. Explicit path
  if (cliConfigPath) {
    if (!fs.existsSync(cliConfigPath)) {
      throw new Error(`Config file not found: ${cliConfigPath}`);
    }
    candidatePaths.push(cliConfigPath);
  }
  if (options.configPath) {
    if (!fs.existsSync(options.configPath)) {
      throw new Error(`Config file not found: ${options.configPath}`);
    }
    candidatePaths.push(options.configPath);
  }
  if (process.env.DOCS_MCP_CONFIG) {
    if (!fs.existsSync(process.env.DOCS_MCP_CONFIG)) {
      throw new Error(`Config file not found: ${process.env.DOCS_MCP_CONFIG}`);
    }
    candidatePaths.push(process.env.DOCS_MCP_CONFIG);
  }

  // 2. Storage Directory
  if (options.searchDir) {
    candidatePaths.push(path.join(options.searchDir, "config.yaml"));
    candidatePaths.push(path.join(options.searchDir, "config.yml"));
    candidatePaths.push(path.join(options.searchDir, "config.json"));
  }

  // 3. Binary/Project Root
  try {
    const projectRoot = getProjectRoot();
    if (projectRoot) {
      candidatePaths.push(path.join(projectRoot, "config.yaml"));
      candidatePaths.push(path.join(projectRoot, "config.yml"));
      candidatePaths.push(path.join(projectRoot, "config.json"));
    }
  } catch {
    // Ignore if project root not found
  }

  // 4. CWD
  const cwd = process.cwd();
  candidatePaths.push(path.join(cwd, "config.yaml"));
  candidatePaths.push(path.join(cwd, "config.yml"));
  candidatePaths.push(path.join(cwd, "config.json"));
  candidatePaths.push(path.join(cwd, "docs-mcp.config.yaml")); // Legacy fallback

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return parseConfigFile(p);
    }
  }

  return {};
}

function parseConfigFile(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, "utf8");
  try {
    if (filePath.endsWith(".json")) {
      return JSON.parse(content);
    }
    return yaml.parse(content) || {};
  } catch (error) {
    console.warn(`Failed to parse config file ${filePath}: ${error}`);
    return {};
  }
}

function mapEnvToConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const mapping of configMappings) {
    if (mapping.env) {
      for (const envVar of mapping.env) {
        if (process.env[envVar] !== undefined) {
          setAtPath(config, mapping.path, process.env[envVar]);
          break; // First match wins
        }
      }
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

function deepMerge(target: unknown, source: unknown): unknown {
  if (typeof target !== "object" || target === null) return source;
  if (typeof source !== "object" || source === null) return target;

  const t = target as ConfigObject;
  const s = source as ConfigObject;
  const output = { ...t };

  for (const key of Object.keys(s)) {
    const sValue = s[key];
    const tValue = t[key];

    if (
      typeof sValue === "object" &&
      sValue !== null &&
      typeof tValue === "object" &&
      tValue !== null &&
      key in t
    ) {
      output[key] = deepMerge(tValue, sValue);
    } else {
      output[key] = sValue;
    }
  }
  return output;
}
