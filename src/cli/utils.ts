/**
 * Shared CLI utilities and helper functions.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Command } from "commander";
import { chromium } from "playwright";
import type { AppServerConfig } from "../app";
import type { AuthConfig } from "../auth/types";
import { EventBusService } from "../events";
import {
  EmbeddingConfig,
  type EmbeddingModelConfig,
} from "../store/embeddings/EmbeddingConfig";
import { TelemetryService } from "../telemetry";
import { LogLevel, logger, setLogLevel } from "../utils/logger";
import { getProjectRoot } from "../utils/paths";
import type { GlobalOptions } from "./types";

/**
 * Extended Command type that includes the global EventBusService instance
 */
export interface CommandWithEventBus extends Command {
  _eventBus?: EventBusService;
}

/**
 * Traverses the command hierarchy to find the root command and returns its options.
 * This is useful for accessing global options from within any subcommand.
 * @param command The current command instance.
 * @returns The global options from the root command.
 */
export function getGlobalOptions(command?: Command): GlobalOptions {
  let rootCommand = command;
  while (rootCommand?.parent) {
    rootCommand = rootCommand.parent;
  }
  return rootCommand?.opts() || {};
}

/**
 * Retrieves the global EventBusService from a command instance.
 * @param command The command instance.
 * @returns The global EventBusService.
 * @throws Error if EventBusService is not initialized.
 */
export function getEventBus(command?: Command): EventBusService {
  const eventBus = (command as CommandWithEventBus)?._eventBus;
  if (!eventBus) {
    throw new Error("EventBusService not initialized");
  }
  return eventBus;
}

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
  if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
    logger.debug(
      "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set, skipping Playwright browser install.",
    );
    return;
  }

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
  } catch (error) {
    // Not installed or not found, attempt to install
    logger.debug(String(error));
    try {
      console.log(
        "🌐 Installing Playwright Chromium browser... (this may take a moment)",
      );
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
    throw new Error("Invalid port number");
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
    throw new Error("Host cannot be empty");
  }

  // Very basic format check - reject obviously invalid values
  if (trimmed.includes(" ") || trimmed.includes("\t") || trimmed.includes("\n")) {
    throw new Error("Host cannot contain whitespace");
  }

  return trimmed;
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
  telemetry?: boolean;
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
    telemetry: options.telemetry,
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
 * Creates EventBusService and TelemetryService together.
 * The TelemetryService automatically subscribes to events from the EventBusService.
 * @returns Object containing both services
 */
export function createEventServices(): {
  eventBus: EventBusService;
  telemetryService: TelemetryService;
} {
  const eventBus = new EventBusService();
  const telemetryService = new TelemetryService(eventBus);
  return { eventBus, telemetryService };
}

/**
 * Resolves embedding configuration from the provided model specification.
 * This function centralizes the logic for determining the embedding model.
 *
 * @param embeddingModel The embedding model specification string.
 * @returns Embedding configuration or null if config is unavailable.
 */
export function resolveEmbeddingContext(
  embeddingModel?: string,
): EmbeddingModelConfig | null {
  try {
    const modelSpec = embeddingModel;

    if (!modelSpec) {
      logger.debug("No embedding model specified. Embeddings are disabled.");
      return null;
    }

    logger.debug(`Resolving embedding configuration for model: ${modelSpec}`);
    return EmbeddingConfig.parseEmbeddingConfig(modelSpec);
  } catch (error) {
    logger.debug(`Failed to resolve embedding configuration: ${error}`);
    return null;
  }
}
