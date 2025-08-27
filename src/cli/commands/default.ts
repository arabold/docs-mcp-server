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
  createPipelineWithCallbacks,
  ensurePlaywrightBrowsersInstalled,
  parseAuthConfig,
  resolveEmbeddingContext,
  resolveProtocol,
  setupLogging,
  validateAuthConfig,
  validatePort,
  warnHttpUsage,
} from "../utils";

export function createDefaultAction(program: Command): Command {
  return (
    program
      .addOption(
        new Option("--protocol <protocol>", "Protocol for MCP server")
          .choices(["auto", "stdio", "http"])
          .default("auto"),
      )
      .addOption(
        new Option("--port <number>", "Port for the server")
          .argParser((v) => {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 1 || n > 65535) {
              throw new Error("Port must be an integer between 1 and 65535");
            }
            return String(n);
          })
          .default(CLI_DEFAULTS.HTTP_PORT.toString()),
      )
      .option("--resume", "Resume interrupted jobs on startup", false)
      .option("--no-resume", "Do not resume jobs on startup")
      .option(
        "--read-only",
        "Run in read-only mode (only expose read tools, disable write/job tools)",
        false,
      )
      // Auth options
      .option(
        "--auth-enabled",
        "Enable OAuth2/OIDC authentication for MCP endpoints",
        false,
      )
      .option("--auth-issuer-url <url>", "Issuer/discovery URL for OAuth2/OIDC provider")
      .option(
        "--auth-audience <id>",
        "JWT audience claim (identifies this protected resource)",
      )
      .action(
        async (options: {
          protocol: string;
          port: string;
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

          // Ensure browsers are installed
          ensurePlaywrightBrowsersInstalled();

          // Resolve embedding configuration for local execution (default action needs embeddings)
          const embeddingConfig = resolveEmbeddingContext();
          const docService = await createLocalDocumentManagement(embeddingConfig);
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
              readOnly: options.readOnly,
              auth: authConfig,
              startupContext: {
                cliCommand: "default",
                mcpProtocol: "http",
              },
            });

            const appServer = await startAppServer(docService, pipeline, config);

            // Register for graceful shutdown (http mode)
            registerGlobalServices({
              appServer,
              docService,
              pipeline,
            });

            await new Promise(() => {}); // Keep running forever
          }
        },
      )
  );
}
