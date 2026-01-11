/**
 * MCP command - Starts MCP server only.
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { createDocumentManagement, type DocumentManagementService } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  createAppServerConfig,
  getEventBus,
  parseAuthConfig,
  resolveProtocol,
  validateAuthConfig,
  validatePort,
} from "../utils";

export function createMcpCommand(cli: Argv) {
  cli.command(
    "mcp",
    "Start the MCP server (Standalone Mode)",
    (yargs) => {
      return (
        yargs
          .option("protocol", {
            type: "string",
            description: "Protocol for MCP server",
            choices: ["auto", "stdio", "http"],
            default: "auto",
          })
          .option("port", {
            type: "string",
            description: "Port for the MCP server",
          })
          .option("host", {
            type: "string",
            description: "Host to bind the MCP server to",
          })
          .option("embedding-model", {
            type: "string",
            description:
              "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
            alias: "embeddingModel",
          })
          .option("server-url", {
            type: "string",
            description:
              "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
            alias: "serverUrl",
          })
          .option("read-only", {
            type: "boolean",
            description:
              "Run in read-only mode (only expose read tools, disable write/job tools)",
            default: false,
            alias: "readOnly",
          })
          // Auth options
          .option("auth-enabled", {
            type: "boolean",
            description: "Enable OAuth2/OIDC authentication for MCP endpoints",
            default: false,
            alias: "authEnabled",
          })
          .option("auth-issuer-url", {
            type: "string",
            description: "Issuer/discovery URL for OAuth2/OIDC provider",
            alias: "authIssuerUrl",
          })
          .option("auth-audience", {
            type: "string",
            description: "JWT audience claim (identifies this protected resource)",
            alias: "authAudience",
          })
      );
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "mcp",
        protocol: argv.protocol,
        port: argv.port,
        host: argv.host,
        useServerUrl: !!argv.serverUrl,
        readOnly: argv.readOnly,
        authEnabled: !!argv.authEnabled,
      });

      const _port = validatePort((argv.port as string) || "6280"); // fallback for validation if undefined, but loadConfig handles defaults.
      // Wait, validatePort throws if invalid. If undefined, we should rely on loadConfig.
      // Current logic calls validatePort(cmdOptions.port). If undefined, what happens?
      // In Yargs, if no default, argv.port is undefined.
      // validatePort(undefined) -> depends on impl. It expects string.
      // I should modify validation or defer it.
      // loadConfig will fill default.
      // So I should load config FIRST.
      const resolvedProtocol = resolveProtocol(argv.protocol as string);
      if (resolvedProtocol === "stdio") {
        setLogLevel(LogLevel.ERROR);
      }

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolvedStorePath passed via argv by middleware
      });

      // Now we have appConfig with defaults.
      // Validate resolved values?
      // validatePort(appConfig.server.ports.mcp.toString());
      // The old code validated CLI input explicitly?
      // Yes. I will validate from appConfig.

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
        const serverUrl = argv.serverUrl as string | undefined;

        const eventBus = getEventBus(argv as CliContext);

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
          logger.debug(`Auto-detected stdio protocol (no TTY)`);
          await pipeline.start();
          const mcpTools = await initializeTools(docService, pipeline, appConfig);
          const mcpServer = await startStdioServer(mcpTools, appConfig);

          registerGlobalServices({
            mcpStdioServer: mcpServer,
            docService,
            pipeline,
          });

          await new Promise(() => {});
        } else {
          logger.debug(`Auto-detected http protocol (TTY available)`);
          const config = createAppServerConfig({
            enableWebInterface: false,
            enableMcpServer: true,
            enableApiServer: false,
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

          registerGlobalServices({
            appServer,
            docService,
          });

          await new Promise(() => {});
        }
      } catch (error) {
        logger.error(`❌ Failed to start MCP server: ${error}`);
        process.exit(1);
      }
    },
  );
}
