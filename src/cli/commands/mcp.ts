/**
 * MCP command - Starts MCP server only.
 */

import type { Command } from "commander";
import { Option } from "commander";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { createDocumentManagement, type DocumentManagementService } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { defaults, loadConfig } from "../../utils/config";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import { registerGlobalServices } from "../main";
import {
  createAppServerConfig,
  getEventBus,
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
          .default(defaults.SERVER_PROTOCOL)
          .choices(["auto", "stdio", "http"]),
      )
      .addOption(
        new Option("--port <number>", "Port for the MCP server")
          .env("DOCS_MCP_PORT")
          .env("PORT")
          .default(defaults.SERVER_MCP_PORT.toString())
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
          .default(defaults.SERVER_HOST)
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
        "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
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
            if (typeof value === "string") {
              return value !== "false" && value !== "0";
            }
            return Boolean(value);
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
        async (
          cmdOptions: {
            protocol: string;
            port: string;
            host: string;
            embeddingModel?: string;
            serverUrl?: string;
            readOnly: boolean;
            authEnabled?: boolean;
            authIssuerUrl?: string;
            authAudience?: string;
          },
          command?: Command,
        ) => {
          await telemetry.track(TelemetryEvent.CLI_COMMAND, {
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

          const appConfig = loadConfig({
            SERVER_PROTOCOL: resolvedProtocol,
            SERVER_MCP_PORT: port,
            SERVER_HOST: host,
            AUTH_ENABLED: cmdOptions.authEnabled,
            AUTH_ISSUER_URL: cmdOptions.authIssuerUrl,
            AUTH_AUDIENCE: cmdOptions.authAudience,
            READ_ONLY: cmdOptions.readOnly,
            EMBEDDING_MODEL: cmdOptions.embeddingModel,
          });

          const globalOptions = program.opts();
          appConfig.app.storePath = globalOptions.storePath ?? appConfig.app.storePath;

          // Parse and validate auth configuration
          const authConfig = parseAuthConfig({
            authEnabled: appConfig.auth.enabled,
            authIssuerUrl: appConfig.auth.issuerUrl,
            authAudience: appConfig.auth.audience,
          });

          if (authConfig) {
            validateAuthConfig(authConfig);
          }

          try {
            // Resolve embedding configuration for local execution
            const embeddingConfig = resolveEmbeddingContext(appConfig.app.embeddingModel);
            if (!serverUrl && !embeddingConfig) {
              logger.error(
                "❌ Embedding configuration is required for local mode. Configure an embedding provider with CLI options or environment variables.",
              );
              process.exit(1);
            }

            const eventBus = getEventBus(command);

            const docService: IDocumentManagement = await createDocumentManagement({
              serverUrl,
              eventBus,
              appConfig: appConfig,
            });
            const pipelineOptions: PipelineOptions = {
              recoverJobs: false, // MCP command doesn't support job recovery
              serverUrl,
              appConfig: appConfig,
            };
            const pipeline = serverUrl
              ? await PipelineFactory.createPipeline(undefined, eventBus, {
                  serverUrl,
                  ...pipelineOptions,
                })
              : await PipelineFactory.createPipeline(
                  docService as DocumentManagementService,
                  eventBus,
                  pipelineOptions,
                );

            if (resolvedProtocol === "stdio") {
              // Direct stdio mode - bypass AppServer entirely
              logger.debug(`Auto-detected stdio protocol (no TTY)`);

              await pipeline.start(); // Start pipeline for stdio mode
              const mcpTools = await initializeTools(docService, pipeline, appConfig);
              const mcpServer = await startStdioServer(mcpTools, appConfig);

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

              // Configure MCP-only server
              const config = createAppServerConfig({
                enableWebInterface: false, // Never enable web interface in mcp command
                enableMcpServer: true,
                enableApiServer: false, // Never enable API in mcp command
                enableWorker: !serverUrl,
                port: appConfig.server.ports.mcp,
                externalWorkerUrl: serverUrl,
                startupContext: {
                  cliCommand: "mcp",
                  mcpProtocol: "http",
                },
              });

              const appServer = await startAppServer(
                docService,
                pipeline,
                eventBus,
                config,
                appConfig,
              );

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
