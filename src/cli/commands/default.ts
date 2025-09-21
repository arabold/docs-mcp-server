/**
 * Default command - Starts unified server when no subcommand is specified.
 */

import type { Command } from "commander";
import { Option } from "commander";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import type { PipelineOptions } from "../../pipeline";
import { createLocalDocumentManagement } from "../../store";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import { registerGlobalServices } from "../main";
import {
  CLI_DEFAULTS,
  createAppServerConfig,
  createOptionWithEnv,
  createPipelineWithCallbacks,
  ensurePlaywrightBrowsersInstalled,
  parseAuthConfig,
  resolveEmbeddingContext,
  resolveProtocol,
  validateAuthConfig,
  validateHost,
  validatePort,
  warnHttpUsage,
} from "../utils";

export function createDefaultAction(program: Command): Command {
  return (
    program
      .addOption(
        createOptionWithEnv(
          "--protocol <protocol>",
          "Protocol for MCP server",
          ["DOCS_MCP_PROTOCOL"],
          "auto",
        ).choices(["auto", "stdio", "http"]),
      )
      .addOption(
        createOptionWithEnv(
          "--port <number>",
          "Port for the server",
          ["DOCS_MCP_PORT", "PORT"],
          CLI_DEFAULTS.HTTP_PORT.toString(),
        ).argParser((v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 65535) {
            throw new Error("Port must be an integer between 1 and 65535");
          }
          return String(n);
        }),
      )
      .addOption(
        createOptionWithEnv(
          "--host <host>",
          "Host to bind the server to",
          ["DOCS_MCP_HOST", "HOST"],
          CLI_DEFAULTS.HOST,
        ).argParser(validateHost),
      )
      .addOption(
        createOptionWithEnv(
          "--embedding-model <model>",
          "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
          ["DOCS_MCP_EMBEDDING_MODEL"],
        ),
      )
      .option("--resume", "Resume interrupted jobs on startup", false)
      .option("--no-resume", "Do not resume jobs on startup")
      .option(
        "--read-only",
        "Run in read-only mode (only expose read tools, disable write/job tools)",
        false,
      )
      // Auth options
      .addOption(
        new Option(
          "--auth-enabled",
          "Enable OAuth2/OIDC authentication for MCP endpoints",
        ),
      )
      .addOption(new Option("--no-auth-enabled", "Disable OAuth2/OIDC authentication"))
      .addOption(
        createOptionWithEnv(
          "--auth-issuer-url <url>",
          "Issuer/discovery URL for OAuth2/OIDC provider",
          ["DOCS_MCP_AUTH_ISSUER_URL"],
        ),
      )
      .addOption(
        createOptionWithEnv(
          "--auth-audience <id>",
          "JWT audience claim (identifies this protected resource)",
          ["DOCS_MCP_AUTH_AUDIENCE"],
        ),
      )
      .hook("preAction", (_thisCommand, actionCommand) => {
        const options = actionCommand.opts();

        // Handle DOCS_MCP_AUTH_ENABLED environment variable
        // Only apply if neither --auth-enabled nor --no-auth-enabled was used
        if (
          options.authEnabled === undefined &&
          process.env.DOCS_MCP_AUTH_ENABLED !== undefined
        ) {
          const envValue = process.env.DOCS_MCP_AUTH_ENABLED;
          // "true" or "1" means enable auth
          options.authEnabled = envValue === "true" || envValue === "1";

          if (process.env.LOG_LEVEL === "DEBUG") {
            console.log(
              `Using environment variable DOCS_MCP_AUTH_ENABLED=${envValue} for option --auth-enabled`,
            );
          }
        }
      })
      .action(
        async (options: {
          protocol: string;
          port: string;
          host: string;
          embeddingModel?: string;
          resume: boolean;
          readOnly: boolean;
          authEnabled?: boolean;
          authIssuerUrl?: string;
          authAudience?: string;
        }) => {
          // Resolve protocol and validate flags
          const resolvedProtocol = resolveProtocol(options.protocol);
          if (resolvedProtocol === "stdio") {
            setLogLevel(LogLevel.ERROR); // Force quiet logging in stdio mode
          }

          logger.debug("No subcommand specified, starting unified server by default...");
          const port = validatePort(options.port);
          const host = validateHost(options.host);

          // Parse and validate auth configuration
          const authConfig = parseAuthConfig({
            authEnabled: options.authEnabled,
            authIssuerUrl: options.authIssuerUrl,
            authAudience: options.authAudience,
          });

          if (authConfig) {
            validateAuthConfig(authConfig);
            warnHttpUsage(authConfig, port);
          }

          // Get global options from parent command
          const globalOptions = program.parent?.opts() || {};

          // Ensure browsers are installed
          ensurePlaywrightBrowsersInstalled();

          // Resolve embedding configuration for local execution (default action needs embeddings)
          const embeddingConfig = resolveEmbeddingContext(options.embeddingModel);
          const docService = await createLocalDocumentManagement(
            embeddingConfig,
            globalOptions.storePath,
          );
          const pipelineOptions: PipelineOptions = {
            recoverJobs: options.resume || false, // Use --resume flag for job recovery
            concurrency: 3,
          };
          const pipeline = await createPipelineWithCallbacks(docService, pipelineOptions);

          if (resolvedProtocol === "stdio") {
            // Direct stdio mode - bypass AppServer entirely
            logger.debug(`Auto-detected stdio protocol (no TTY)`);

            await pipeline.start(); // Start pipeline for stdio mode
            const mcpTools = await initializeTools(docService, pipeline);
            const mcpServer = await startStdioServer(mcpTools, options.readOnly);

            // Register for graceful shutdown (stdio mode)
            registerGlobalServices({
              mcpStdioServer: mcpServer,
              docService,
              pipeline,
            });

            await new Promise(() => {}); // Keep running forever
          } else {
            // HTTP mode - use AppServer
            logger.debug(`Auto-detected http protocol (TTY available)`);

            // Configure services based on resolved protocol
            const config = createAppServerConfig({
              enableWebInterface: true, // Enable web interface in http mode
              enableMcpServer: true, // Always enable MCP server
              enableApiServer: true, // Enable API (tRPC) in http mode
              enableWorker: true, // Always enable in-process worker for unified server
              port,
              host,
              readOnly: options.readOnly,
              auth: authConfig,
              startupContext: {
                cliCommand: "default",
                mcpProtocol: "http",
              },
            });

            const appServer = await startAppServer(docService, pipeline, config);

            // Register for graceful shutdown (http mode)
            // Note: pipeline is managed by AppServer, so don't register it globally
            registerGlobalServices({
              appServer,
              docService,
              // pipeline is owned by AppServer - don't register globally to avoid double shutdown
            });

            await new Promise(() => {}); // Keep running forever
          }
        },
      )
  );
}
