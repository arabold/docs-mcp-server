/**
 * MCP command - Starts MCP server only.
 */

import type { Command } from "commander";
import { Option } from "commander";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import type { PipelineOptions } from "../../pipeline";
import { createDocumentManagement } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import { registerGlobalServices } from "../main";
import {
  CLI_DEFAULTS,
  createAppServerConfig,
  createPipelineWithCallbacks,
  parseAuthConfig,
  resolveEmbeddingContext,
  resolveProtocol,
  validateAuthConfig,
  validateHost,
  validatePort,
} from "../utils";

export function createMcpCommand(program: Command): Command {
  return (
    program
      .command("mcp")
      .description("Start MCP server only")
      .addOption(
        new Option("--protocol <protocol>", "Protocol for MCP server")
          .choices(["auto", "stdio", "http"])
          .default(CLI_DEFAULTS.PROTOCOL),
      )
      .addOption(
        new Option("--port <number>", "Port for the MCP server")
          .argParser((v) => {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 1 || n > 65535) {
              throw new Error("Port must be an integer between 1 and 65535");
            }
            return String(n);
          })
          .default(CLI_DEFAULTS.HTTP_PORT.toString()),
      )
      .addOption(
        new Option("--host <host>", "Host to bind the MCP server to")
          .argParser(validateHost)
          .default(CLI_DEFAULTS.HOST),
      )
      .option(
        "--server-url <url>",
        "URL of external pipeline worker RPC (e.g., http://localhost:6280/api)",
      )
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
        async (cmdOptions: {
          protocol: string;
          port: string;
          host: string;
          serverUrl?: string;
          readOnly: boolean;
          authEnabled?: boolean;
          authIssuerUrl?: string;
          authAudience?: string;
        }) => {
          const port = validatePort(cmdOptions.port);
          const host = validateHost(cmdOptions.host);
          const serverUrl = cmdOptions.serverUrl;
          // Resolve protocol using same logic as default action
          const resolvedProtocol = resolveProtocol(cmdOptions.protocol);
          if (resolvedProtocol === "stdio") {
            setLogLevel(LogLevel.ERROR); // Force quiet logging in stdio mode
          }

          // Parse and validate auth configuration
          const authConfig = parseAuthConfig({
            authEnabled: cmdOptions.authEnabled,
            authIssuerUrl: cmdOptions.authIssuerUrl,
            authAudience: cmdOptions.authAudience,
          });

          if (authConfig) {
            validateAuthConfig(authConfig);
          }

          try {
            // Resolve embedding configuration for local execution
            const embeddingConfig = resolveEmbeddingContext();
            if (!serverUrl && !embeddingConfig) {
              logger.error(
                "❌ Embedding configuration is required for local mode. Configure an embedding provider with CLI options or environment variables.",
              );
              process.exit(1);
            }

            const docService: IDocumentManagement = await createDocumentManagement({
              serverUrl,
              embeddingConfig,
            });
            const pipelineOptions: PipelineOptions = {
              recoverJobs: false, // MCP command doesn't support job recovery
              serverUrl,
              concurrency: 3,
            };
            const pipeline = await createPipelineWithCallbacks(
              serverUrl ? undefined : (docService as unknown as never),
              pipelineOptions,
            );

            if (resolvedProtocol === "stdio") {
              // Direct stdio mode - bypass AppServer entirely
              logger.debug(`Auto-detected stdio protocol (no TTY)`);
              logger.info("🚀 Starting MCP server (stdio mode)");

              await pipeline.start(); // Start pipeline for stdio mode
              const mcpTools = await initializeTools(docService, pipeline);
              const mcpServer = await startStdioServer(mcpTools, cmdOptions.readOnly);

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
              logger.info("🚀 Starting MCP server (http mode)");

              // Configure MCP-only server
              const config = createAppServerConfig({
                enableWebInterface: false, // Never enable web interface in mcp command
                enableMcpServer: true,
                enableApiServer: false, // Never enable API in mcp command
                enableWorker: !serverUrl,
                port,
                host,
                externalWorkerUrl: serverUrl,
                readOnly: cmdOptions.readOnly,
                auth: authConfig,
                startupContext: {
                  cliCommand: "mcp",
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
          } catch (error) {
            logger.error(`❌ Failed to start MCP server: ${error}`);
            process.exit(1);
          }
        },
      )
  );
}
