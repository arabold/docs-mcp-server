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
import { analytics, TelemetryEvent } from "../../telemetry";
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
          .env("DOCS_MCP_PROTOCOL")
          .default(CLI_DEFAULTS.PROTOCOL)
          .choices(["auto", "stdio", "http"]),
      )
      .addOption(
        new Option("--port <number>", "Port for the MCP server")
          .env("DOCS_MCP_PORT")
          .env("PORT")
          .default(CLI_DEFAULTS.HTTP_PORT.toString())
          .argParser((v: string) => {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 1 || n > 65535) {
              throw new Error("Port must be an integer between 1 and 65535");
            }
            return String(n);
          }),
      )
      .addOption(
        new Option("--host <host>", "Host to bind the MCP server to")
          .env("DOCS_MCP_HOST")
          .env("HOST")
          .default(CLI_DEFAULTS.HOST)
          .argParser(validateHost),
      )
      .addOption(
        new Option(
          "--embedding-model <model>",
          "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
        ).env("DOCS_MCP_EMBEDDING_MODEL"),
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
      .addOption(
        new Option(
          "--auth-enabled",
          "Enable OAuth2/OIDC authentication for MCP endpoints",
        )
          .env("DOCS_MCP_AUTH_ENABLED")
          .argParser((value) => {
            if (value === undefined) {
              return (
                process.env.DOCS_MCP_AUTH_ENABLED === "true" ||
                process.env.DOCS_MCP_AUTH_ENABLED === "1"
              );
            }
            return value;
          })
          .default(false),
      )
      .addOption(
        new Option(
          "--auth-issuer-url <url>",
          "Issuer/discovery URL for OAuth2/OIDC provider",
        ).env("DOCS_MCP_AUTH_ISSUER_URL"),
      )
      .addOption(
        new Option(
          "--auth-audience <id>",
          "JWT audience claim (identifies this protected resource)",
        ).env("DOCS_MCP_AUTH_AUDIENCE"),
      )
      .action(
        async (cmdOptions: {
          protocol: string;
          port: string;
          host: string;
          embeddingModel?: string;
          serverUrl?: string;
          readOnly: boolean;
          authEnabled?: boolean;
          authIssuerUrl?: string;
          authAudience?: string;
        }) => {
          await analytics.track(TelemetryEvent.CLI_COMMAND, {
            command: "mcp",
            protocol: cmdOptions.protocol,
            port: cmdOptions.port,
            host: cmdOptions.host,
            useServerUrl: !!cmdOptions.serverUrl,
            readOnly: cmdOptions.readOnly,
            authEnabled: !!cmdOptions.authEnabled,
          });

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

          // Get global options from parent command
          const globalOptions = program.parent?.opts() || {};

          try {
            // Resolve embedding configuration for local execution
            const embeddingConfig = resolveEmbeddingContext(cmdOptions.embeddingModel);
            if (!serverUrl && !embeddingConfig) {
              logger.error(
                "❌ Embedding configuration is required for local mode. Configure an embedding provider with CLI options or environment variables.",
              );
              process.exit(1);
            }

            const docService: IDocumentManagement = await createDocumentManagement({
              serverUrl,
              embeddingConfig,
              storePath: globalOptions.storePath,
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
