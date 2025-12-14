/**
 * Web command - Starts web interface only.
 */

import type { Command } from "commander";
import { Option } from "commander";
import { startAppServer } from "../../app";
import { PipelineFactory, type PipelineOptions } from "../../pipeline";
import { createDocumentManagement, type DocumentManagementService } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { loadConfig, SERVER_HOST, SERVER_WEB_PORT } from "../../utils/config";
import { logger } from "../../utils/logger";
import { registerGlobalServices } from "../main";
import {
  createAppServerConfig,
  getEventBus,
  getGlobalOptions,
  resolveEmbeddingContext,
  validateHost,
  validatePort,
} from "../utils";

export function createWebCommand(program: Command): Command {
  return program
    .command("web")
    .description("Start web interface only")
    .addOption(
      new Option("--port <number>", "Port for the web interface")
        .env("DOCS_MCP_WEB_PORT")
        .env("DOCS_MCP_PORT")
        .env("PORT")
        .default(SERVER_WEB_PORT.toString())
        .argParser((v: string) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 65535) {
            throw new Error("Port must be an integer between 1 and 65535");
          }
          return String(n);
        }),
    )
    .addOption(
      new Option("--host <host>", "Host to bind the web interface to")
        .env("DOCS_MCP_HOST")
        .env("HOST")
        .default(SERVER_HOST)
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
    .action(
      async (
        cmdOptions: {
          port: string;
          host: string;
          embeddingModel?: string;
          serverUrl?: string;
        },
        command?: Command,
      ) => {
        await telemetry.track(TelemetryEvent.CLI_COMMAND, {
          command: "web",
          port: cmdOptions.port,
          host: cmdOptions.host,
          useServerUrl: !!cmdOptions.serverUrl,
        });

        const port = validatePort(cmdOptions.port);
        const host = validateHost(cmdOptions.host);
        const serverUrl = cmdOptions.serverUrl;
        const appConfig = loadConfig({
          SERVER_WEB_PORT: port,
          SERVER_HOST: host,
          EMBEDDING_MODEL: cmdOptions.embeddingModel,
        });

        const globalOptions = getGlobalOptions(command);
        appConfig.app.storePath = globalOptions.storePath ?? appConfig.app.storePath;

        try {
          // Resolve embedding configuration for local execution
          const embeddingConfig = resolveEmbeddingContext(appConfig.app.embeddingModel);
          if (!serverUrl && !embeddingConfig) {
            logger.error(
              "❌ Embedding configuration is required for local mode. Configure an embedding provider with CLI options or environment variables.",
            );
            process.exit(1);
          }

          // Get the global EventBusService
          const eventBus = getEventBus(command);

          const docService: IDocumentManagement = await createDocumentManagement({
            serverUrl,
            eventBus,
            appConfig: appConfig,
          });
          const pipelineOptions: PipelineOptions = {
            recoverJobs: false, // Web command doesn't support job recovery
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

          // Configure web-only server
          const config = createAppServerConfig({
            enableWebInterface: true,
            enableMcpServer: false,
            enableApiServer: false,
            enableWorker: !serverUrl,
            port: appConfig.server.ports.web,
            externalWorkerUrl: serverUrl,
            startupContext: {
              cliCommand: "web",
            },
          });

          const appServer = await startAppServer(
            docService,
            pipeline,
            eventBus,
            config,
            appConfig,
          );

          // Register for graceful shutdown
          // Note: pipeline is managed by AppServer, so don't register it globally
          registerGlobalServices({
            appServer,
            docService,
            // pipeline is owned by AppServer - don't register globally to avoid double shutdown
          });

          await new Promise(() => {}); // Keep running forever
        } catch (error) {
          logger.error(`❌ Failed to start web interface: ${error}`);
          process.exit(1);
        }
      },
    );
}
