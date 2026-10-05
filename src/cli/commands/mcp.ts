/**
 * MCP command - Starts MCP server only.
 */

import type { Argv } from "yargs";
import { startAppServer } from "../../app";
import { startStdioServer } from "../../mcp/startStdioServer";
import { initializeTools } from "../../mcp/tools";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { DocumentManagementClient, DocumentManagementService } from "../../store";
import { EmbeddingModelChangedError } from "../../store/errors";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig } from "../../utils/config";
import { LogLevel, logger, setLogLevel } from "../../utils/logger";
import { withAuthOptions, withPublicUrlOptions } from "../options";
import { applyGlobalCliOutputMode } from "../output";
import { registerGlobalServices } from "../services";
import {
  type CliContext,
  checkAuthForProtocol,
  createAppServerConfig,
  getEventBus,
  handleEmbeddingModelChange,
  resolveProtocol,
  validatePort,
} from "../utils";

export function createMcpCommand(cli: Argv) {
  cli.command(
    "mcp",
    "Start the MCP server (Standalone Mode)",
    (yargs) =>
      withAuthOptions(
        withPublicUrlOptions(
          yargs
            .option("protocol", {
              type: "string",
              description: "Protocol for MCP server",
              choices: ["auto", "stdio", "http"],
              defaultDescription: "auto",
            })
            .option("port", {
              type: "string",
              description: "Port for the MCP server",
            })
            .option("host", {
              type: "string",
              description: "Host to bind the MCP server to",
            }),
        )
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
            defaultDescription: "false",
            alias: "readOnly",
          }),
      ),
    async (argv) => {
      // Reject a malformed --port before anything starts.
      validatePort((argv.port as string) || "6280");
      // Options the user did not pass are absent from argv, so the protocol,
      // read-only mode and auth come from env, config file or defaults here.
      // The logger writes to stderr, so loading before the stdio log level is
      // set cannot corrupt the protocol stream on stdout.
      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string, // resolvedStorePath passed via argv by middleware
      });

      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "mcp",
        protocol: appConfig.server.protocol,
        port: argv.port,
        host: argv.host,
        useServerUrl: !!argv.serverUrl,
        readOnly: appConfig.app.readOnly,
        authEnabled: appConfig.auth.enabled,
      });

      const resolvedProtocol = resolveProtocol(appConfig.server.protocol);
      if (resolvedProtocol === "stdio") {
        setLogLevel(LogLevel.ERROR);
      } else {
        applyGlobalCliOutputMode({
          verbose: argv.verbose as boolean,
          quiet: argv.quiet as boolean,
        });
      }

      checkAuthForProtocol(appConfig.auth, resolvedProtocol, appConfig.server.ports.mcp);

      try {
        const serverUrl = argv.serverUrl as string | undefined;

        const eventBus = getEventBus(argv as CliContext);

        let docService: IDocumentManagement;
        if (serverUrl) {
          const client = new DocumentManagementClient(serverUrl);
          await client.initialize();
          docService = client;
        } else {
          const service = new DocumentManagementService(eventBus, appConfig);
          try {
            await service.initialize();
          } catch (error) {
            if (error instanceof EmbeddingModelChangedError) {
              await handleEmbeddingModelChange(error, service);
            } else {
              throw error;
            }
          }
          docService = service;
        }
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
            showLogo: argv.logo as boolean,
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
