/**
 * Shared CLI utilities and helper functions.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import type { AppServerConfig } from "../app";
import type { AuthConfig } from "../auth/types";
import type { IPipeline, PipelineOptions } from "../pipeline";
import { PipelineFactory } from "../pipeline";
import type { DocumentManagementService } from "../store";
import {
  EmbeddingConfig,
  type EmbeddingModelConfig,
} from "../store/embeddings/EmbeddingConfig";
import {
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_PROTOCOL,
  DEFAULT_WEB_PORT,
} from "../utils/config";
import { LogLevel, logger, setLogLevel } from "../utils/logger";
import { getProjectRoot } from "../utils/paths";
import type { GlobalOptions } from "./types";

/**
 * Embedding context.
 * Simplified subset of EmbeddingModelConfig for telemetry purposes.
 */
export interface EmbeddingContext {
  aiEmbeddingProvider: string;
  aiEmbeddingModel: string;
  aiEmbeddingDimensions: number | null;
}

/**
 * Ensures that the Playwright browsers are installed, unless a system Chromium path is set.
 */
export function ensurePlaywrightBrowsersInstalled(): void {
  // If PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set, skip install
  const chromiumEnvPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (chromiumEnvPath && existsSync(chromiumEnvPath)) {
    logger.debug(
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set to '${chromiumEnvPath}', skipping Playwright browser install.`,
    );
    return;
  }
  try {
    // Dynamically require Playwright and check for Chromium browser
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const chromiumPath = chromium.executablePath();
    if (!chromiumPath || !existsSync(chromiumPath)) {
      throw new Error("Playwright Chromium browser not found");
    }
  } catch (_err) {
    // Not installed or not found, attempt to install
    logger.debug(
      "Playwright browsers not found. Installing Chromium browser for dynamic scraping (this may take a minute)...",
    );
    try {
      logger.debug("Installing Playwright Chromium browser...");
      execSync("npm exec -y playwright install --no-shell --with-deps chromium", {
        stdio: "ignore", // Suppress output
        cwd: getProjectRoot(),
      });
    } catch (_installErr) {
      console.error(
        "❌ Failed to install Playwright browsers automatically. Please run:\n  npx playwright install --no-shell --with-deps chromium\nand try again.",
      );
      process.exit(1);
    }
  }
}

/**
 * Resolves the protocol based on auto-detection or explicit specification.
 * Auto-detection uses TTY status to determine appropriate protocol.
 */
export function resolveProtocol(protocol: string): "stdio" | "http" {
  if (protocol === "auto") {
    // VS Code and CI/CD typically run without TTY
    if (!process.stdin.isTTY && !process.stdout.isTTY) {
      return "stdio";
    }
    return "http";
  }

  // Explicit protocol specification
  if (protocol === "stdio" || protocol === "http") {
    return protocol;
  }

  throw new Error(`Invalid protocol: ${protocol}. Must be 'auto', 'stdio', or 'http'`);
}

/**
 * Validates that --resume flag is only used with in-process workers.
 */
export function validateResumeFlag(resume: boolean, serverUrl?: string): void {
  if (resume && serverUrl) {
    throw new Error(
      "--resume flag is incompatible with --server-url. " +
        "External workers handle their own job recovery.",
    );
  }
}

/**
 * Formats output for CLI commands
 */
export const formatOutput = (data: unknown): string => JSON.stringify(data, null, 2);

/**
 * Sets up logging based on global options
 */
export function setupLogging(options: GlobalOptions, protocol?: "stdio" | "http"): void {
  // Suppress logging in stdio mode (before any logger calls)
  if (protocol === "stdio") {
    setLogLevel(LogLevel.ERROR);
  } else if (options.silent) {
    setLogLevel(LogLevel.ERROR);
  } else if (options.verbose) {
    setLogLevel(LogLevel.DEBUG);
  }
}

/**
 * Validates and parses port number
 */
export function validatePort(portString: string): number {
  const port = Number.parseInt(portString, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error("❌ Invalid port number");
  }
  return port;
}

/**
 * Validates host string for basic format checking
 */
export function validateHost(hostString: string): string {
  // Basic validation - allow IPv4, IPv6, and hostnames
  const trimmed = hostString.trim();
  if (!trimmed) {
    throw new Error("❌ Host cannot be empty");
  }

  // Very basic format check - reject obviously invalid values
  if (trimmed.includes(" ") || trimmed.includes("\t") || trimmed.includes("\n")) {
    throw new Error("❌ Host cannot contain whitespace");
  }

  return trimmed;
}

/**
 * Creates a pipeline (local or client) and attaches default CLI callbacks.
 * This makes the side-effects explicit and keeps creation consistent.
 */
export async function createPipelineWithCallbacks(
  docService: DocumentManagementService | undefined,
  options: PipelineOptions = {},
): Promise<IPipeline> {
  logger.debug(`Initializing pipeline with options: ${JSON.stringify(options)}`);
  const { serverUrl, ...rest } = options;
  const pipeline = serverUrl
    ? await PipelineFactory.createPipeline(undefined, { serverUrl, ...rest })
    : await (async () => {
        if (!docService) {
          throw new Error("Local pipeline requires a DocumentManagementService instance");
        }
        return PipelineFactory.createPipeline(docService, rest);
      })();

  // Configure progress callbacks for real-time updates
  pipeline.setCallbacks({
    onJobProgress: async (job, progress) => {
      logger.debug(
        `Job ${job.id} progress: ${progress.pagesScraped}/${progress.totalPages} pages`,
      );
    },
    onJobStatusChange: async (job) => {
      logger.debug(`Job ${job.id} status changed to: ${job.status}`);
    },
    onJobError: async (job, error, document) => {
      logger.warn(
        `⚠️ Job ${job.id} error ${document ? `on document ${document.metadata.url}` : ""}: ${error.message}`,
      );
    },
  });

  return pipeline;
}

/**
 * Creates AppServerConfig based on service requirements
 */
export function createAppServerConfig(options: {
  enableWebInterface?: boolean;
  enableMcpServer?: boolean;
  enableApiServer?: boolean;
  enableWorker?: boolean;
  port: number;
  host: string;
  externalWorkerUrl?: string;
  readOnly?: boolean;
  auth?: AuthConfig;
  startupContext?: {
    cliCommand?: string;
    mcpProtocol?: "stdio" | "http";
    mcpTransport?: "sse" | "streamable";
  };
}): AppServerConfig {
  return {
    enableWebInterface: options.enableWebInterface ?? false,
    enableMcpServer: options.enableMcpServer ?? true,
    enableApiServer: options.enableApiServer ?? false,
    enableWorker: options.enableWorker ?? true,
    port: options.port,
    host: options.host,
    externalWorkerUrl: options.externalWorkerUrl,
    readOnly: options.readOnly ?? false,
    auth: options.auth,
    startupContext: options.startupContext,
  };
}

/**
 * Parses custom headers from CLI options
 */
export function parseHeaders(headerOptions: string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  if (Array.isArray(headerOptions)) {
    for (const entry of headerOptions) {
      const idx = entry.indexOf(":");
      if (idx > 0) {
        const name = entry.slice(0, idx).trim();
        const value = entry.slice(idx + 1).trim();
        if (name) headers[name] = value;
      }
    }
  }

  return headers;
}

/**
 * Default configuration values
 */
export const CLI_DEFAULTS = {
  PROTOCOL: DEFAULT_PROTOCOL,
  HTTP_PORT: DEFAULT_HTTP_PORT,
  WEB_PORT: DEFAULT_WEB_PORT,
  HOST: DEFAULT_HOST,
  MAX_CONCURRENCY: DEFAULT_MAX_CONCURRENCY,
  TELEMETRY: true,
} as const;

/**
 * Parses auth configuration from CLI options.
 * Environment variables are handled by createOptionWithEnv in command definitions.
 * Precedence: CLI flags > env vars (handled by commander) > defaults
 */
export function parseAuthConfig(options: {
  authEnabled?: boolean;
  authIssuerUrl?: string;
  authAudience?: string;
}): AuthConfig | undefined {
  // Check if auth is enabled via CLI flag (environment variables handled by commander)
  if (!options.authEnabled) {
    return undefined;
  }

  return {
    enabled: true,
    issuerUrl: options.authIssuerUrl,
    audience: options.authAudience,
    scopes: ["openid", "profile"], // Default scopes for OAuth2/OIDC
  };
}

/**
 * Validates auth configuration when auth is enabled.
 */
export function validateAuthConfig(authConfig: AuthConfig): void {
  if (!authConfig.enabled) {
    return;
  }

  const errors: string[] = [];

  // Issuer URL is required when auth is enabled
  if (!authConfig.issuerUrl) {
    errors.push("--auth-issuer-url is required when auth is enabled");
  } else {
    try {
      const url = new URL(authConfig.issuerUrl);
      if (url.protocol !== "https:") {
        errors.push("Issuer URL must use HTTPS protocol");
      }
    } catch {
      errors.push("Issuer URL must be a valid URL");
    }
  }

  // Audience is required when auth is enabled
  if (!authConfig.audience) {
    errors.push("--auth-audience is required when auth is enabled");
  } else {
    // Audience can be any valid URI (URL or URN)
    // Examples: https://api.example.com, urn:docs-mcp-server:api, urn:company:service
    try {
      // Try parsing as URL first (most common case)
      const url = new URL(authConfig.audience);
      if (url.protocol === "http:" && url.hostname !== "localhost") {
        // Warn about HTTP in production but don't fail
        logger.warn(
          "⚠️  Audience uses HTTP protocol - consider using HTTPS for production",
        );
      }
      if (url.hash) {
        errors.push("Audience must not contain URL fragments");
      }
    } catch {
      // If not a valid URL, check if it's a valid URN
      if (authConfig.audience.startsWith("urn:")) {
        // Basic URN validation: urn:namespace:specific-string
        const urnParts = authConfig.audience.split(":");
        if (urnParts.length < 3 || !urnParts[1] || !urnParts[2]) {
          errors.push("URN audience must follow format: urn:namespace:specific-string");
        }
      } else {
        errors.push(
          "Audience must be a valid absolute URL or URN (e.g., https://api.example.com or urn:company:service)",
        );
      }
    }
  }

  // Scopes are not validated in binary authentication mode
  // They're handled internally by the OAuth proxy

  if (errors.length > 0) {
    throw new Error(`Auth configuration validation failed:\n${errors.join("\n")}`);
  }
}

/**
 * Warns about HTTP usage in production when auth is enabled.
 */
export function warnHttpUsage(authConfig: AuthConfig | undefined, port: number): void {
  if (!authConfig?.enabled) {
    return;
  }

  // Check if we're likely running in production (not localhost)
  const isLocalhost =
    process.env.NODE_ENV !== "production" ||
    port === 6280 || // default dev port
    process.env.HOSTNAME?.includes("localhost");

  if (!isLocalhost) {
    logger.warn(
      "⚠️  Authentication is enabled but running over HTTP in production. " +
        "Consider using HTTPS for security.",
    );
  }
}

/**
 * Resolves embedding configuration from the provided model specification.
 * This function centralizes the logic for determining the embedding model.
 *
 * Precedence:
 * 1. Explicitly passed `embeddingModel` parameter.
 * 2. `OPENAI_API_KEY` environment variable (defaults to OpenAI model).
 * 3. No configuration (embeddings disabled).
 *
 * @param embeddingModel The embedding model specification string.
 * @returns Embedding configuration or null if config is unavailable.
 */
export function resolveEmbeddingContext(
  embeddingModel?: string,
): EmbeddingModelConfig | null {
  try {
    let modelSpec = embeddingModel;

    // If no model is specified, check for OPENAI_API_KEY
    // to enable OpenAI embeddings by default.
    if (!modelSpec && process.env.OPENAI_API_KEY) {
      modelSpec = "text-embedding-3-small"; // Default OpenAI model
      logger.debug(
        "Using default OpenAI embedding model due to OPENAI_API_KEY presence.",
      );
    }

    if (!modelSpec) {
      logger.debug(
        "No embedding model specified and OPENAI_API_KEY not found. Embeddings are disabled.",
      );
      return null;
    }

    logger.debug(`Resolving embedding configuration for model: ${modelSpec}`);
    return EmbeddingConfig.parseEmbeddingConfig(modelSpec);
  } catch (error) {
    logger.debug(`Failed to resolve embedding configuration: ${error}`);
    return null;
  }
}
